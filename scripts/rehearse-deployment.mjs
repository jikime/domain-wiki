import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, request } from "@playwright/test";
import { deployment, literal } from "./lib/deployment.mjs";

const [mode, profile, originProfile = profile] = process.argv.slice(2);
if (!["seed", "verify"].includes(mode) || !profile?.startsWith("wiki-stage7"))
  throw new Error("개발 리허설 wiki-stage7 프로필만 실행할 수 있습니다.");
const target = deployment(profile);
const source = deployment(originProfile);
const admin = JSON.parse(
  readFileSync(join(source.folder, "initial-admin.json"), "utf8"),
);
const { workspaceId } = JSON.parse(
  readFileSync(join(source.folder, "workspace.json"), "utf8"),
);
const origin = target.env.BETTER_AUTH_URL;
const base = `/api/workspaces/${workspaceId}`;
const clients = [];
async function login(account) {
  const client = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  clients.push(client);
  expect(
    (
      await client.post("/api/auth/sign-in/email", {
        data: { email: account.email, password: account.password },
      })
    ).status(),
  ).toBe(200);
  return client;
}
async function post(client, path, data, status = 201) {
  const r = await client.post(path, { data });
  expect(r.status(), await r.text()).toBe(status);
  return r.json();
}
try {
  if (mode === "seed") {
    const manager = await login(admin);
    const accounts = {};
    for (const role of ["writer", "reviewer", "reader"]) {
      accounts[role] = {
        name: `${role} 복구 시험`,
        email: `${role}@rehearsal.invalid`,
        password: randomBytes(24).toString("base64url"),
        role,
        isAdmin: false,
      };
      await post(manager, `${base}/members`, accounts[role]);
    }
    const writer = await login(accounts.writer);
    const reviewer = await login(accounts.reviewer);
    const reader = await login(accounts.reader);
    const domain = await post(manager, `${base}/domains`, {
      name: "관제 복구 시험",
      purpose: "복구 전후 원본과 근거를 대조하는 개발 예시입니다.",
      terms: [],
      recordTemplate: "상황·판단·결과",
    });
    const files = [
      [
        "복구시험.md",
        "text/markdown",
        Buffer.from(
          "# 개발용 관제 조건\n\n관제 화면은 30초마다 갱신합니다. 모든 화면에 일괄 적용하지 않습니다.\n\n실제 고객 지침이 아닌 복구 시험 표본입니다.",
        ),
      ],
      [
        "조건표.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        readFileSync("docs/evaluation/stage-02/fixtures/conditions-table.docx"),
      ],
      [
        "점검표.pdf",
        "application/pdf",
        readFileSync("docs/evaluation/stage-02/fixtures/text-pages.pdf"),
      ],
    ];
    const sources = [];
    for (const [name, mimeType, buffer] of files) {
      const r = await writer.post(`${base}/sources`, {
        multipart: {
          title: name,
          category: "reference",
          domainId: domain.id,
          projectId: "",
          file: { name, mimeType, buffer },
        },
      });
      expect(r.status()).toBe(201);
      const s = await r.json();
      await expect
        .poll(
          async () =>
            (await (await writer.get(`${base}/sources/${s.sourceId}`)).json())
              .version.processing,
          { timeout: 45000 },
        )
        .toBe("completed");
      await post(
        reviewer,
        `${base}/source-versions/${s.versionId}/action`,
        { action: "approve", note: "복구 시험 표본 검토" },
        200,
      );
      sources.push(s);
    }
    const details = await (
      await writer.get(`${base}/sources/${sources[0].sourceId}`)
    ).json();
    const chunk = details.chunks.find((c) => c.text.includes("30초"));
    expect(chunk).toBeTruthy();
    const wiki = await post(writer, `${base}/wiki`, {
      title: "관제 복구 시험 위키",
      body: "관제 화면은 30초마다 갱신합니다. 모든 화면에 일괄 적용하지 않습니다.",
      domainId: domain.id,
      projectId: null,
      parentVersionId: null,
      basePublishedVersionId: null,
      chunkIds: [chunk.id],
    });
    await post(
      writer,
      `${base}/wiki-versions/${wiki.versionId}/action`,
      { action: "submit", note: "" },
      200,
    );
    await post(
      reviewer,
      `${base}/wiki-versions/${wiki.versionId}/action`,
      { action: "approve", note: "근거를 확인했습니다." },
      200,
    );
    const conversation = await post(reader, `${base}/conversations`, {
      title: "복구 시험용 저장 대화",
      scope: { domainId: domain.id },
    });
    const runId = randomUUID();
    // 고정 표본 저장. 모델 연결·생성 품질 시험으로 집계하지 않습니다.
    const snapshot = {
      key: "E1",
      kind: "source",
      id: sources[0].sourceId,
      versionId: sources[0].versionId,
      chunkId: chunk.id,
      title: "개발용 관제 조건",
      text: chunk.text,
      href: `/w/${workspaceId}/sources/${sources[0].sourceId}`,
      category: "reference",
    };
    target.sql(
      `INSERT INTO chat_run(id, workspace_id, conversation_id, request_id, prompt, scope, state, model) SELECT ${literal(runId)},workspace_id,id,${literal(randomUUID())},'복구 시험용 고정 질문',scope,'completed','고정 저장 표본 (모델 호출 없음)' FROM conversation WHERE id=${literal(conversation.id)}; INSERT INTO chat_message(workspace_id,run_id,role,body) VALUES(${literal(workspaceId)},${literal(runId)},'assistant','복구 시험용 고정 답변: 30초 조건을 확인하세요. [E1]'); INSERT INTO chat_citation(workspace_id,run_id,key,snapshot,used) VALUES(${literal(workspaceId)},${literal(runId)},'E1',${literal(JSON.stringify(snapshot))},true);`,
    );
    writeFileSync(
      join(source.folder, "rehearsal.json"),
      JSON.stringify({ accounts, domain, sources, wiki, conversation, runId }),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "운영 컨테이너에서 3종 문서 처리·게시 위키·근거·저장 대화 준비 완료",
    );
  } else {
    const f = JSON.parse(
      readFileSync(join(source.folder, "rehearsal.json"), "utf8"),
    );
    const reader = await login(f.accounts.reader);
    expect((await reader.get(`${base}/members`)).status()).toBe(403);
    for (const s of f.sources) {
      const info = await (
        await reader.get(`${base}/sources/${s.sourceId}`)
      ).json();
      expect(info.version.processing).toBe("completed");
      expect(
        (
          await reader.get(`${base}/source-versions/${s.versionId}/file`)
        ).status(),
      ).toBe(200);
    }
    const wiki = await (
      await reader.get(`${base}/wiki/${f.wiki.pageId}`)
    ).json();
    expect(JSON.stringify(wiki)).toContain("30초");
    const chat = await (
      await reader.get(`${base}/conversations/${f.conversation.id}`)
    ).json();
    expect(chat.runs[0].messages[0].body).toContain("복구 시험용 고정 답변");
    expect(chat.runs[0].citations).toHaveLength(1);
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        storageState: await reader.storageState(),
        viewport: { width: 390, height: 844 },
        timezoneId: "Asia/Seoul",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      mkdirSync("docs/stages/07-deployment/screenshots", { recursive: true });
      for (const [name, path] of [
        ["wiki", `wiki/${f.wiki.pageId}`],
        ["chat", `chat?conversation=${f.conversation.id}`],
        ["source", `sources/${f.sources[1].sourceId}`],
      ]) {
        expect(
          (await page.goto(`${origin}/w/${workspaceId}/${path}`)).status(),
        ).toBe(200);
        await expect(page.locator("h1").first()).toBeVisible();
        if (name === "chat")
          await expect(
            page.getByText("복구 시험용 고정 답변:", { exact: false }),
          ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `docs/stages/07-deployment/screenshots/${profile}-${name}.png`,
          fullPage: true,
        });
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
    console.log(
      "복원 환경 로그인·권한·문서 원본·위키·답변·근거 및 모바일 3개 화면 통과",
    );
  }
} finally {
  await Promise.all(clients.map((c) => c.dispose()));
}
