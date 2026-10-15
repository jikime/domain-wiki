import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  type APIRequestContext,
  expect,
  request,
  test,
} from "@playwright/test";
import { Pool } from "pg";
import type { aiTaskDetails } from "../src/server/services/ai-tasks";
import type { batchDetails } from "../src/server/services/proposals";

type Task = Awaited<ReturnType<typeof aiTaskDetails>>;
type Batch = Awaited<ReturnType<typeof batchDetails>>;
const fixture = JSON.parse(
  readFileSync(".local/test-accounts.json", "utf8"),
) as {
  workspaceId: string;
  domainId: string;
  accounts: { id: string; email: string; password: string; role: string }[];
};
const origin = "http://localhost:3101";
const base = `/api/workspaces/${fixture.workspaceId}`;
const clients: Record<string, APIRequestContext> = {};
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sampleDir = "docs/evaluation/topic-accumulation-20260924";
const inputs = ["01-rfp.md", "02-design.md", "03-exception.md"].map((name) =>
  readFileSync(`${sampleDir}/${name}`, "utf8").trim(),
);
let worker: ChildProcess | undefined;
let topicId = "";
let projectId = "";
const phaseResults: Record<string, unknown>[] = [];
test.describe.configure({ mode: "serial" });

async function taskDetails(id: string): Promise<Task> {
  const response = await clients.writer.get(`${base}/ai-tasks/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function waitTask(id: string, state = "completed") {
  await expect
    .poll(async () => (await taskDetails(id)).state, {
      timeout: 60000,
      intervals: [300, 600, 1000],
    })
    .toMatch(/^(completed|failed|canceled)$/);
  const task = await taskDetails(id);
  expect(task.state, task.errorMessage ?? "작업 완료").toBe(state);
  return task;
}
async function createTask(
  sourceId: string,
  kind: string,
  analysisTaskId?: string,
) {
  const response = await clients.writer.post(`${base}/ai-tasks`, {
    data: {
      sourceId,
      kind,
      requestId: randomUUID(),
      ...(analysisTaskId ? { analysisTaskId } : {}),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id as string;
}
async function seed(title: string, text: string, project: string) {
  const source = randomUUID(),
    version = randomUUID(),
    chunk = randomUUID();
  const writer = fixture.accounts.find((a) => a.role === "writer");
  await pool.query(
    "INSERT INTO source(id,workspace_id,domain_id,project_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,'project',$6,$7,$7,1)",
    [
      source,
      fixture.workspaceId,
      fixture.domainId,
      project,
      title,
      writer?.id,
      version,
    ],
  );
  await pool.query(
    "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'topic.md','text/markdown',$4,$4,$5,$6,'published','completed')",
    [
      version,
      fixture.workspaceId,
      source,
      randomUUID(),
      Buffer.byteLength(text),
      writer?.id,
    ],
  );
  await pool.query(
    "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,$4,$5)",
    [
      chunk,
      fixture.workspaceId,
      version,
      text,
      { kind: "lines", startLine: 1, endLine: 1 },
    ],
  );
  return { source, version, chunk };
}
async function createProject(name: string) {
  const result = await clients.admin.post(`${base}/projects`, {
    data: {
      domainId: fixture.domainId,
      name,
      clientName: "가상 평가기관",
      description: "주제 축적 계약 평가",
    },
  });
  expect(result.status()).toBe(201);
  return (await result.json()).id as string;
}

test.beforeAll(async () => {
  test.setTimeout(120000);
  for (const account of fixture.accounts) {
    const client = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    const response = await client.post("/api/auth/sign-in/email", {
      data: { email: account.email, password: account.password },
    });
    expect(response.status()).toBe(200);
    clients[account.role] = client;
  }
  projectId = await createProject("주제 축적 대상 사업");
  worker = spawn(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
    { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  worker.stdout?.on("data", (c) => {
    output += c;
  });
  worker.stderr?.on("data", (c) => {
    output += c;
  });
  await expect
    .poll(() => output, { timeout: 15000 })
    .toContain("문서 처리 작업자가 준비되었습니다.");
});
test.afterAll(async () => {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    const done = new Promise<void>((resolve) =>
      worker?.once("exit", () => resolve()),
    );
    worker.kill("SIGTERM");
    await done;
  }
  await Promise.all(Object.values(clients).map((c) => c.dispose()));
  await pool.end();
});

test("서로 다른 원문 3개가 같은 주제 주소에 누적되고 검토 전에는 기존 게시본이 유지된다", async () => {
  const chunks: string[] = [];
  let previousVersion = "";
  for (const [index, text] of inputs.entries()) {
    const source = await seed(
      `주제축적 ${["첫자료", "가시화응답성", "예외"][index]}`,
      text,
      projectId,
    );
    chunks.push(source.chunk);
    const analysis = await waitTask(
      await createTask(source.source, "analysis"),
    );
    const task = await waitTask(
      await createTask(source.source, "wiki-generation", analysis.id),
    );
    const knowledge = task.steps.find((s) => s.kind === "generation-prepare")
      ?.result?.knowledge as {
      candidates: { pageId: string; title: string }[];
    };
    if (index)
      expect(knowledge.candidates.some((c) => c.pageId === topicId)).toBe(true);
    if (index) {
      const prior = await clients.reader.get(`${base}/wiki/${topicId}`);
      expect(prior.status()).toBe(200);
      expect((await prior.json()).version.id).toBe(previousVersion);
    }
    for (const group of task.groups) {
      const response = await clients.writer.get(
        `${base}/proposals/${group.id}`,
      );
      expect(response.status()).toBe(200);
      const detail = (await response.json()) as Batch;
      const item = detail.batch.items.find((i) => i.title === "화면 갱신 조건");
      if (item) {
        expect(item.kind).toBe(index ? "update" : "new");
        expect(item.requiresResolution).toBe(false);
        expect(item.metadata?.subject).toBe("화면 갱신");
        expect(item.metadata?.scope).toContain("보조 화면");
        if (index) expect(item.pageId).toBe(topicId);
        else topicId = item.plannedPageId as string;
        for (const expected of inputs.slice(0, index + 1))
          expect(item.body).toContain(expected);
        expect(item.chunkIds).toEqual(expect.arrayContaining(chunks));
      }
      for (const [role, action] of [
        ["writer", "submit"],
        ["reviewer", "approve"],
      ]) {
        const result = await clients[role].post(
          `${base}/proposals/${group.id}/action`,
          { data: { action, note: "가상 표본의 원문·조건 대조" } },
        );
        expect(result.status(), await result.text()).toBe(200);
      }
    }
    const response = await clients.reader.get(`${base}/wiki/${topicId}`);
    expect(response.status()).toBe(200);
    const published = await response.json();
    expect(published.version.metadata.scope).toContain("통신 단절 예외");
    expect(published.version.id).not.toBe(previousVersion);
    previousVersion = published.version.id;
    for (const expected of inputs.slice(0, index + 1))
      expect(published.version.body).toContain(expected);
    const evidence = await pool.query(
      "SELECT chunk_id FROM wiki_evidence WHERE version_id=$1 ORDER BY chunk_id",
      [previousVersion],
    );
    expect(evidence.rows.map((r) => r.chunk_id).sort()).toEqual(
      [...chunks].sort(),
    );
    phaseResults.push({
      phase: index + 1,
      topicId,
      version: published.version.number,
      evidenceCount: evidence.rowCount,
      preservedInputs: index + 1,
      kind: index ? "update" : "new",
      draftDidNotReplacePublished: true,
    });
  }
  const count = await pool.query(
    "SELECT v.metadata->>'type' AS type,count(*)::int AS count FROM wiki_page p JOIN wiki_version v ON v.id=p.published_version_id WHERE p.workspace_id=$1 AND p.project_id=$2 GROUP BY v.metadata->>'type'",
    [fixture.workspaceId, projectId],
  );
  expect(count.rows.find((r) => r.type === "concept")?.count).toBe(1);
  expect(count.rows.find((r) => r.type === "source")?.count).toBe(3);
  writeFileSync(
    "test-results/topic-phases.json",
    JSON.stringify(
      {
        evaluation:
          "deterministic model fixture; real API, worker, PostgreSQL, approval and readback",
        phases: phaseResults,
        counts: count.rows,
      },
      null,
      2,
    ),
  );
});

test("기존 주제와 같은 이름의 신규 제안은 저장하지 않는다", async () => {
  const source = await seed("주제축적 중복오류", inputs[0], projectId);
  const analysis = await waitTask(await createTask(source.source, "analysis"));
  const failed = await waitTask(
    await createTask(source.source, "wiki-generation", analysis.id),
    "failed",
  );
  expect(failed.errorMessage).toContain("주제 위키");
  expect(failed.groups).toHaveLength(0);
  const existing = await clients.reader.get(`${base}/wiki/${topicId}`);
  expect(existing.status()).toBe(200);
  expect((await existing.json()).version.number).toBe(3);
});

test("같은 이름의 다른 프로젝트는 별도 주제를 유지한다", async () => {
  const other = await createProject("주제 축적 다른 사업");
  const source = await seed(
    "주제축적 다른사업",
    "주 화면은 60초마다 갱신한다.",
    other,
  );
  const analysis = await waitTask(await createTask(source.source, "analysis"));
  const task = await waitTask(
    await createTask(source.source, "wiki-generation", analysis.id),
  );
  const knowledge = task.steps.find((s) => s.kind === "generation-prepare")
    ?.result?.knowledge as { candidates: { pageId: string }[] };
  expect(knowledge.candidates.some((c) => c.pageId === topicId)).toBe(false);
  const response = await clients.writer.get(
    `${base}/proposals/${task.groups[0].id}`,
  );
  const detail = (await response.json()) as Batch;
  const item = detail.batch.items.find((i) => i.title === "화면 갱신 조건");
  expect(item?.kind).toBe("new");
  expect(item?.plannedPageId).not.toBe(topicId);
  expect(item?.body).toContain("60초");
  expect(item?.body).not.toContain("30초");
});
