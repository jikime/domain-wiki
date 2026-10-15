// Real chat routes and a local search/model fixture; no external calls or build.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import nextEnv from "@next/env";
import {
  type APIRequestContext,
  type Browser,
  chromium,
  expect,
  request,
} from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL ?? "").hostname,
  ),
);
const origin = "http://localhost:3010",
  workspace = randomUUID(),
  outside = randomUUID(),
  domain = randomUUID();
const queries: string[] = [];
const modelMessages: { role: string; content: unknown }[][] = [];
let mode = "plain",
  searchMode = "normal",
  modelStep = 0;
let searchStarted: (() => void) | undefined;
const mock = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://fixture.invalid");
  if (url.pathname === "/search") {
    const query = url.searchParams.get("q") ?? "";
    queries.push(query);
    if (searchMode === "hold") {
      searchStarted?.();
      const timer = setTimeout(() => res.end('{"results":[]}'), 5000);
      res.once("close", () => clearTimeout(timer));
      return;
    }
    if (searchMode === "failure") {
      res.writeHead(503);
      res.end("unavailable");
      return;
    }
    const extra = query.includes("추가");
    const result = {
      title: extra ? "공개 추가 안내" : "공개 보관 안내",
      url: `https://example.test/${extra ? "extra" : "guide"}`,
      content:
        "공개 표본은 기록을 45일 보관한다고 설명합니다. 실제 적용 대상은 원문에서 확인해야 합니다.",
    };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        results:
          searchMode === "empty"
            ? []
            : [
                result,
                { ...result, url: `${result.url}#section` },
                {
                  title: "잘못된 주소",
                  url: "javascript:alert(1)",
                  content: "제외할 결과",
                },
              ],
      }),
    );
    return;
  }
  assert.equal(url.pathname, "/v1/chat/completions");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString());
  modelMessages.push(data.messages);
  const content =
    mode === "invalid"
      ? "잘못된 근거입니다. [W99]"
      : mode === "tool" && modelStep++ === 0
        ? JSON.stringify({
            action: "tool",
            tool: "web.search",
            query: "공개 추가 안내",
          })
        : "[W1] 공개 검색 발췌에서는 45일 기준을 설명합니다.";
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 20 } })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
const address = mock.address();
assert.ok(address && typeof address !== "string");
const fixtureUrl = `http://127.0.0.1:${address.port}`;
const config = JSON.stringify([
  {
    provider: "searxng",
    baseUrl: fixtureUrl,
    apiKey: "private-fixture-search-key",
    workspaceIds: [workspace],
  },
]);
Object.assign(process.env, {
  RESEARCH_SEARCH_PROVIDERS: config,
  AI_TRANSPORT: "api",
  AI_CHAT_TRANSPORT: "api",
  AI_KNOWLEDGE_TRANSPORT: "api",
  AI_VISION_TRANSPORT: "api",
  AI_BASE_URL: `${fixtureUrl}/v1`,
  AI_MODEL: "web-fixture",
  AI_API_KEY: "local-model-key",
  AI_CHAT_BASE_URL: `${fixtureUrl}/v1`,
  AI_CHAT_MODEL: "web-fixture",
  AI_CHAT_API_KEY: "local-model-key",
  AI_CHAT_CONTEXT_CHARS: "120000",
  AI_EMBEDDING_MODEL: "",
});
const { POST: stream } = await import(
  "../src/app/api/workspaces/[workspaceId]/conversations/[conversationId]/stream/route"
);
const { GET: providers } = await import(
  "../src/app/api/workspaces/[workspaceId]/conversations/web-providers/route"
);
const { PATCH } = await import(
  "../src/app/api/workspaces/[workspaceId]/conversations/[conversationId]/route"
);
const {
  createConversation,
  updateConversation,
  conversationDetails,
  cancelRun,
} = await import("../src/server/services/chat");
const { runAgentLoop } = await import("../src/lib/chat-agent");
const { chatWebContext } = await import("../src/lib/chat-web");
const { getPool } = await import("../src/server/db");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const clients: Record<string, APIRequestContext> = {},
  auth: Record<string, Headers> = {};
const accounts: string[] = [];
const base = `/api/workspaces/${workspace}`;
const root = `/w/${workspace}`;
let browser: Browser | undefined,
  checks = 0;
const started = Date.now();
const pass = (text: string) => console.log(`통과 ${++checks}: ${text}`);
const scope = {
  domainId: domain,
  projectId: null,
  sourceId: null,
  wikiId: null,
  webProvider: "searxng",
  agentMode: "standard",
};
const create = async (web = true) =>
  (
    await createConversation(auth.writer, workspace, {
      scope: { ...scope, webProvider: web ? "searxng" : undefined },
    })
  ).id;
async function send(
  id: string,
  prompt = "공개 보관 안내",
  requestId = randomUUID(),
  role = "writer",
) {
  return stream(
    new Request(`${origin}${base}/conversations/${id}/stream`, {
      method: "POST",
      headers: auth[role],
      body: JSON.stringify({ requestId, prompt }),
    }),
    { params: Promise.resolve({ workspaceId: workspace, conversationId: id }) },
  );
}
async function events(response: Response) {
  assert.equal(response.status, 200);
  return (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)));
}
async function complete(response: Response) {
  const output = await events(response);
  assert.ok(
    !output.some((event) => event.type === "error"),
    JSON.stringify(output),
  );
  const done = output.find((event) => event.type === "done");
  assert.ok(done);
  return done;
}
try {
  await pool.query(
    "INSERT INTO workspace(id,name) VALUES($1,'웹 채팅 검사'),($2,'다른 공간 검사')",
    [workspace, outside],
  );
  for (const role of ["writer", "admin", "outsider"]) {
    const id = randomUUID(),
      email = `web-${id}@test.invalid`,
      password = randomBytes(18).toString("base64url");
    accounts.push(id);
    await pool.query("INSERT INTO app_user(id,name,email) VALUES($1,$2,$3)", [
      id,
      `웹 검사 ${role}`,
      email,
    ]);
    await pool.query(
      "INSERT INTO auth_account(id,account_id,provider_id,user_id,password) VALUES($1,$2,'credential',$2,$3)",
      [randomUUID(), id, await hashPassword(password)],
    );
    await pool.query(
      "INSERT INTO membership(workspace_id,user_id,role,is_admin) VALUES($1,$2,$3,$4)",
      [
        role === "outsider" ? outside : workspace,
        id,
        role === "writer" ? "writer" : "reader",
        role === "admin",
      ],
    );
    const client = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    clients[role] = client;
    assert.equal(
      (
        await client.post("/api/auth/sign-in/email", {
          data: { email, password },
        })
      ).status(),
      200,
    );
    auth[role] = new Headers({
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: (await client.storageState()).cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; "),
    });
  }
  await pool.query(
    "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,'공개 안내 질문','가상 제공자 확인')",
    [domain, workspace],
  );
  const list = await providers(
    new Request(`${origin}${base}/conversations/web-providers`, {
      headers: auth.writer,
    }),
    { params: Promise.resolve({ workspaceId: workspace }) },
  );
  assert.deepEqual(await list.json(), {
    providers: [{ provider: "searxng", label: "SearXNG" }],
  });
  const outsideList = await providers(
    new Request(
      `${origin}/api/workspaces/${outside}/conversations/web-providers`,
      { headers: auth.outsider },
    ),
    { params: Promise.resolve({ workspaceId: outside }) },
  );
  assert.deepEqual(await outsideList.json(), { providers: [] });
  await assert.rejects(
    createConversation(auth.writer, workspace, {
      scope: { ...scope, sourceOnly: true },
    }),
    { status: 400 },
  );
  await assert.rejects(
    createConversation(auth.writer, workspace, {
      scope: { ...scope, webProvider: "tavily" },
    }),
    { status: 503 },
  );
  for (const flags of [
    { sourceOnly: false, webSearch: false },
    { sourceOnly: true, webSearch: true },
  ]) {
    let step = 0,
      executed = 0;
    await runAgentLoop({
      ...flags,
      signal: new AbortController().signal,
      maxIterations: 2,
      generate: async () => ({
        text:
          ++step === 1
            ? '{"action":"tool","tool":"web.search","query":"허용되지 않은 검색"}'
            : '{"action":"final","answer":"차단 확인"}',
        inputTokens: 1,
        outputTokens: 1,
      }),
      execute: async () => {
        executed++;
        return "실행하면 안 됨";
      },
    });
    assert.equal(executed, 0);
  }
  pass(
    "제공자 작업공간 제한·비밀 설정 비노출·미설정/원문 전용 차단·비활성 도구 요청 거부",
  );

  const id = await create(),
    requestId = randomUUID();
  mode = "tool";
  modelStep = 0;
  const done = await complete(await send(id, "공개 보관 안내", requestId));
  const run = done.runs.at(-1);
  assert.deepEqual(queries, ["공개 보관 안내", "공개 추가 안내"]);
  assert.equal(run.webReferences.length, 2);
  assert.equal(
    run.webReferences.filter((ref: { used: boolean }) => ref.used).length,
    1,
  );
  assert.equal(run.webReferences[0].key, "W1");
  assert.ok(run.webReferences[0].searchedAt);
  assert.equal(
    run.webReferences.some((ref: { url: string }) =>
      ref.url.startsWith("javascript:"),
    ),
    false,
  );
  assert.ok(
    run.toolEvents.some(
      (event: { tool: string; status: string }) =>
        event.tool === "web.search" && event.status === "completed",
    ),
  );
  assert.ok(JSON.stringify(modelMessages.at(-1)).includes("45일"));
  assert.ok(
    chatWebContext(
      Array.from({ length: 20 }, () => run.webReferences[0]),
      4000,
    ).text.length <= 4000,
  );
  const counts = [queries.length, modelMessages.length];
  await complete(await send(id, "공개 보관 안내", requestId));
  assert.deepEqual([queries.length, modelMessages.length], counts);
  for (const role of ["admin", "outsider"])
    assert.equal(
      (await send(id, "공개 보관 안내", randomUUID(), role)).status,
      404,
    );
  pass(
    "일반 채팅의 실제 검색→추가 웹 도구→W 인용·중복 URL 제거·범위 예산·저장·재시도·개인 대화 보호",
  );

  mode = "plain";
  searchMode = "empty";
  const followup = await complete(
    await send(id, "앞서 확인한 보관 기간을 다시 설명해 주세요."),
  );
  assert.equal(
    followup.runs.at(-1).webReferences[0].url,
    "https://example.test/guide",
  );
  await updateConversation(auth.writer, workspace, id, {
    scope: { ...scope, webProvider: undefined },
  });
  const beforeOff = queries.length;
  const off = await complete(await send(id));
  assert.equal(queries.length, beforeOff);
  assert.deepEqual(off.runs.at(-1).webReferences, []);
  searchMode = "failure";
  const failedId = await create();
  assert.ok(
    (await events(await send(failedId))).some(
      (event) => event.type === "error",
    ),
  );
  searchMode = "normal";
  mode = "invalid";
  assert.ok(
    (await events(await send(failedId))).some(
      (event) => event.type === "error",
    ),
  );
  assert.equal(
    (await conversationDetails(auth.writer, workspace, failedId)).runs.at(-1)
      ?.state,
    "failed",
  );
  mode = "plain";
  pass(
    "후속 질문의 검색 스냅샷 유지·웹 해제 시 문맥 제외·제공자 실패와 없는 W 인용 차단",
  );

  const ui = await create(false);
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    storageState: await clients.writer.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(
    "Object.defineProperty(navigator, 'clipboard', { value: { writeText: async function(value) { window.copiedAnswer = value; } }, configurable: true });",
  );
  await page.route("**/conversations/web-providers", async (route) => {
    const response = await providers(
      new Request(route.request().url(), {
        headers: await route.request().allHeaders(),
      }),
      { params: Promise.resolve({ workspaceId: workspace }) },
    );
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: await response.text(),
    });
  });
  await page.route(`**/conversations/${ui}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const req = route.request();
    const response = await PATCH(
      new Request(req.url(), {
        method: "PATCH",
        headers: await req.allHeaders(),
        body: req.postData(),
      }),
      {
        params: Promise.resolve({ workspaceId: workspace, conversationId: ui }),
      },
    );
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: await response.text(),
    });
  });
  await page.route(`**/conversations/${ui}/stream`, async (route) => {
    const req = route.request();
    const response = await stream(
      new Request(req.url(), {
        method: "POST",
        headers: await req.allHeaders(),
        body: req.postData(),
      }),
      {
        params: Promise.resolve({ workspaceId: workspace, conversationId: ui }),
      },
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  await page.goto(`${root}/chat?conversation=${ui}`);
  const webToggle = page.getByRole("checkbox", {
    name: "웹 검색 사용",
    exact: true,
  });
  await expect(webToggle).toBeEnabled();
  await webToggle.check();
  await expect(
    page.getByRole("combobox", { name: "웹 검색 제공자" }),
  ).toHaveText("SearXNG");
  await page
    .getByRole("checkbox", { name: "원문만 사용", exact: true })
    .check();
  await expect(webToggle).not.toBeChecked();
  await expect(webToggle).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "원문만 사용", exact: true })
    .uncheck();
  await expect(webToggle).toBeEnabled();
  await webToggle.check();
  await page
    .getByRole("textbox", { name: "업무 질문", exact: true })
    .fill("공개 보관 안내");
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  const citation = page.getByRole("button", {
    name: "출처 W1: 공개 보관 안내",
    exact: true,
  });
  await expect(citation).toBeVisible();
  await citation.click();
  await expect(
    page.getByRole("link", { name: "웹 원문 열기 ↗", exact: true }),
  ).toHaveAttribute("href", "https://example.test/guide");
  await expect(
    page.getByText(
      "검색 당시 발췌입니다. 업무에 적용하기 전에 원문과 조건을 확인하세요.",
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "답변 복사", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { copiedAnswer: string }).copiedAnswer,
      ),
    )
    .toContain("https://example.test/guide");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.reload();
  await expect(citation).toBeVisible();
  pass(
    "390px 웹 검색 선택·제공자·원문 전용 전환·W 출처 패널·복사·새로고침 보존",
  );

  await page
    .getByRole("button", { name: "위키 초안으로 저장", exact: true })
    .click();
  const savedLink = page.getByRole("link", {
    name: "저장한 위키 초안 열기",
    exact: true,
  });
  await expect(savedLink).toBeVisible();
  const pageId = (await savedLink.getAttribute("href"))?.split("/").at(-2);
  const draft = (
    await pool.query(
      "SELECT v.* FROM wiki_version v JOIN wiki_page p ON p.latest_version_id=v.id WHERE p.id=$1",
      [pageId],
    )
  ).rows[0];
  assert.equal(draft.state, "draft");
  assert.ok(draft.body.includes("[W1]: <https://example.test/guide>"));
  assert.ok(draft.body.includes("45일"));
  assert.equal(
    (
      await clients.writer.post(`${base}/wiki-versions/${draft.id}/action`, {
        data: { action: "submit", note: "근거 등록 전" },
      })
    ).status(),
    409,
  );
  await context.close();
  pass(
    "웹 답변의 위키 초안에 URL·발췌·검색 시각 보존, 공개 원문 근거 없는 게시 차단",
  );

  const cancelId = await create();
  searchMode = "hold";
  let waiting = new Promise<void>((resolve) => {
    searchStarted = resolve;
  });
  const cancelResponse = await send(cancelId, "중지 표본");
  await waiting;
  const cancelRunId = (
    await pool.query("SELECT id FROM chat_run WHERE conversation_id=$1", [
      cancelId,
    ])
  ).rows[0].id;
  await cancelRun(auth.writer, workspace, cancelId, cancelRunId);
  await cancelResponse.text();
  assert.equal(
    (await conversationDetails(auth.writer, workspace, cancelId)).runs[0].state,
    "canceled",
  );
  const revokeId = await create();
  waiting = new Promise<void>((resolve) => {
    searchStarted = resolve;
  });
  const revokeResponse = await send(revokeId, "연결 해제 표본");
  await waiting;
  process.env.RESEARCH_SEARCH_PROVIDERS = "[]";
  await revokeResponse.text();
  const revoked = (await conversationDetails(auth.writer, workspace, revokeId))
    .runs[0];
  assert.notEqual(revoked.state, "completed");
  assert.deepEqual(revoked.webReferences, []);
  process.env.RESEARCH_SEARCH_PROVIDERS = config;
  searchMode = "normal";
  pass(
    "검색 중 중지·제공자 연결 해제 시 요청 취소 및 완성 답변/출처 노출 차단",
  );
  console.log(
    `${checks}개 집중 검사 통과 (${((Date.now() - started) / 1000).toFixed(1)}초), 실제 외부 검색·모델 호출 0`,
  );
} finally {
  await browser?.close();
  await Promise.all(Object.values(clients).map((client) => client.dispose()));
  await pool.query("DELETE FROM workspace WHERE id=ANY($1::uuid[])", [
    [workspace, outside],
  ]);
  for (const id of accounts)
    await pool.query("DELETE FROM app_user WHERE id=$1", [id]);
  await pool.end();
  await getPool().end();
  mock.closeAllConnections();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
}
