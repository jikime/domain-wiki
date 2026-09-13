// Focused check against the running local app; creates and removes only its own fixtures.
// No model calls, build, migration, worker, or container operations.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { chromium, expect, request } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const origin = "http://localhost:3010";
const database = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const pool = new pg.Pool({ connectionString: database.href, max: 2 });
const w = randomUUID(),
  domain = randomUUID(),
  source = randomUUID();
const outsiderWorkspace = randomUUID();
const sourceVersion = randomUUID(),
  chunk = randomUUID();
const wiki = randomUUID(),
  wikiVersion = randomUUID(),
  conversation = randomUUID();
const scope = {
  domainId: domain,
  projectId: null,
  sourceId: null,
  wikiId: null,
};
const base = `/api/workspaces/${w}`,
  root = `/w/${w}`;
const accounts = [],
  clients = {};
const started = Date.now();
let browser;
let checks = 0;
const pass = (label) => console.log(`통과 ${++checks}: ${label}`);
const post = (role, runId, extra = {}, options = {}) =>
  clients[role].post(`${base}/conversations/${conversation}`, {
    data: { action: "save-wiki", runId, ...extra },
    ...options,
  });
const status = async (response, expected) =>
  assert.equal(response.status(), expected, await response.text());
async function runFixture(state = "completed") {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO chat_run(id,workspace_id,conversation_id,request_id,prompt,scope,state,model) VALUES($1,$2,$3,$4,'저장하면 안 되는 개인 질문',$5,$6,'고정 답변, 모델 호출 없음')",
    [id, w, conversation, randomUUID(), scope, state],
  );
  await pool.query(
    "INSERT INTO chat_message(workspace_id,run_id,role,body) VALUES($1,$2,'assistant',$3)",
    [
      w,
      id,
      "<!-- sources: private.md -->\n<think>숨김 내용</think>\n# 관제 갱신 기준\n\n화면을 30초마다 갱신합니다. [E1] [E2]\n\n```text\n[E1] 코드 표본\n```",
    ],
  );
  for (const ref of [
    {
      key: "E1",
      kind: "source",
      id: source,
      versionId: sourceVersion,
      chunkId: chunk,
      title: "관제 근거",
      category: "guideline",
      text: "30초마다 갱신",
      href: `${root}/sources/${source}`,
    },
    {
      key: "E2",
      kind: "wiki",
      id: wiki,
      versionId: wikiVersion,
      title: "관제 위키",
      category: "wiki",
      text: "30초마다 갱신",
      href: `${root}/wiki/${wiki}`,
    },
  ])
    await pool.query(
      "INSERT INTO chat_citation(workspace_id,run_id,key,snapshot,used) VALUES($1,$2,$3,$4,true)",
      [w, id, ref.key, ref],
    );
  return id;
}
try {
  await pool.query(
    "INSERT INTO workspace(id,name) VALUES($1,'답변 저장 단기 검사'),($2,'별도 접근 검사')",
    [w, outsiderWorkspace],
  );
  for (const role of ["writer", "reader", "reviewer", "admin", "outsider"]) {
    const id = randomUUID(),
      password = randomBytes(18).toString("base64url");
    const email = `chat-save-${role}-${id}@test.invalid`;
    accounts.push({ id, role });
    await pool.query("INSERT INTO app_user(id,name,email) VALUES($1,$2,$3)", [
      id,
      `저장 검사 ${role}`,
      email,
    ]);
    await pool.query(
      "INSERT INTO auth_account(id,account_id,provider_id,user_id,password) VALUES($1,$2,'credential',$2,$3)",
      [randomUUID(), id, await hashPassword(password)],
    );
    await pool.query(
      "INSERT INTO membership(workspace_id,user_id,role,is_admin) VALUES($1,$2,$3,$4)",
      [
        role === "outsider" ? outsiderWorkspace : w,
        id,
        ["writer", "reviewer"].includes(role) ? role : "reader",
        role === "admin",
      ],
    );
    const client = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
      timeout: 20000,
    });
    clients[role] = client;
    await status(
      await client.post("/api/auth/sign-in/email", {
        data: { email, password },
      }),
      200,
    );
  }
  const author = accounts.find((a) => a.role === "writer").id;
  await pool.query(
    "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,'답변 저장 범위','고정 표본 검사')",
    [domain, w],
  );
  await pool.query(
    "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,'관제 근거','guideline',$4,$5,$5,1)",
    [source, w, domain, author, sourceVersion],
  );
  await pool.query(
    "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'chat-save.md','text/markdown',$4,$4,20,$5,'published','completed')",
    [sourceVersion, w, source, randomUUID(), author],
  );
  await pool.query(
    "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,'30초마다 갱신합니다.',$4)",
    [chunk, w, sourceVersion, { kind: "lines", startLine: 1, endLine: 1 }],
  );
  await pool.query(
    "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,$5,1)",
    [wiki, w, domain, author, wikiVersion],
  );
  await pool.query(
    "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,author_id,state) VALUES($1,$2,$3,1,'관제 위키','30초마다 갱신합니다.',$4,'approved')",
    [wikiVersion, w, wiki, author],
  );
  await pool.query(
    "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
    [w, wikiVersion, chunk],
  );
  await pool.query(
    "INSERT INTO conversation(id,workspace_id,owner_id,title,scope) VALUES($1,$2,$3,'답변 저장 검사',$4)",
    [conversation, w, author, scope],
  );
  const run = await runFixture();
  const response = await post("writer", run);
  await status(response, 200);
  const saved = await response.json();
  const draft = (
    await pool.query(
      "SELECT v.*,p.published_version_id FROM wiki_version v JOIN wiki_page p ON p.id=v.page_id WHERE v.id=$1",
      [saved.versionId],
    )
  ).rows[0];
  assert.equal(draft.state, "draft");
  assert.equal(draft.published_version_id, null);
  assert.equal(draft.title, "관제 갱신 기준");
  assert.equal(draft.metadata.type, "query");
  assert.match(draft.metadata.path, /^wiki\/queries\/.+\.md$/);
  assert.ok(!/개인 질문|숨김 내용|private\.md|<think>/.test(draft.body));
  assert.ok(draft.body.includes("```text\n[E1] 코드 표본\n```"));
  assert.ok(
    draft.body.includes(
      `[E1]: ${root}/sources/${source}?version=${sourceVersion}&chunk=${chunk}`,
    ),
  );
  assert.ok(
    draft.body.includes(`[E2]: ${root}/wiki/${wiki}?version=${wikiVersion}`),
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT chunk_id FROM wiki_evidence WHERE version_id=$1",
        [saved.versionId],
      )
    ).rows,
    [{ chunk_id: chunk }],
  );
  pass("본문·제목·원문/위키 근거를 비공개 query 초안으로 저장");

  const concurrentRun = await runFixture();
  const replies = await Promise.all([
    post("writer", concurrentRun),
    post("writer", concurrentRun),
  ]);
  for (const reply of replies) await status(reply, 200);
  const duplicates = await Promise.all(replies.map((r) => r.json()));
  assert.equal(duplicates[0].pageId, duplicates[1].pageId);
  assert.equal(duplicates.filter((r) => r.replay).length, 1);
  const replay = await post("writer", run);
  assert.equal((await replay.json()).pageId, saved.pageId);
  assert.equal(
    Number(
      (
        await pool.query("SELECT count(*) FROM wiki_version WHERE page_id=$1", [
          saved.pageId,
        ])
      ).rows[0].count,
    ),
    1,
  );
  pass("동시 저장·재시도에서 같은 위키와 버전 유지");

  for (const [role, code] of [
    ["reader", 403],
    ["reviewer", 404],
    ["admin", 404],
    ["outsider", 404],
  ])
    await status(await post(role, run), code);
  await status(await post("writer", run, { body: "조작한 답변" }), 400);
  await status(
    await post(
      "writer",
      run,
      {},
      { headers: { Origin: "https://untrusted.invalid" } },
    ),
    403,
  );
  await status(await post("writer", await runFixture("canceled")), 409);
  await status(await clients.reader.get(`${base}/wiki/${saved.pageId}`), 404);
  pass("개인 대화·작성 권한·본문 조작·외부 요청·미완료 답변 차단");

  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    storageState: await clients.writer.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${root}/chat?conversation=${conversation}`);
  await page
    .getByRole("button", { name: "위키 초안으로 저장", exact: true })
    .first()
    .click();
  const link = page.getByRole("link", {
    name: "저장한 위키 초안 열기",
    exact: true,
  });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    `${root}/wiki/${saved.pageId}/edit`,
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await link.click();
  await expect(page.getByLabel("위키 제목", { exact: true })).toHaveValue(
    "관제 갱신 기준",
  );
  await page.goto(`${root}/wiki/${saved.pageId}`);
  await expect(
    page
      .locator(
        `a[href="${root}/sources/${source}?version=${sourceVersion}&chunk=${chunk}"]`,
      )
      .first(),
  ).toBeVisible();
  await context.close();
  pass("390px 실제 화면에서 저장·초안 편집 이동·본문 근거 링크 확인");

  await status(
    await clients.writer.post(
      `${base}/wiki-versions/${saved.versionId}/action`,
      { data: { action: "submit", note: "답변 저장 검사" } },
    ),
    200,
  );
  await status(
    await clients.reviewer.post(
      `${base}/wiki-versions/${saved.versionId}/action`,
      { data: { action: "approve", note: "근거 확인" } },
    ),
    200,
  );
  await status(await clients.reader.get(`${base}/wiki/${saved.pageId}`), 200);
  pass("기존 제출·동료 승인 이후 독자에게 게시");

  const withdrawnRun = await runFixture();
  await pool.query("UPDATE source SET published_version_id=null WHERE id=$1", [
    source,
  ]);
  await status(await post("writer", withdrawnRun), 409);
  await status(await post("writer", run), 409);
  await status(await clients.reader.get(`${base}/wiki/${saved.pageId}`), 404);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM generation WHERE workspace_id=$1",
          [w],
        )
      ).rows[0].count,
    ),
    0,
  );
  pass("근거 철회 시 신규/기존 저장과 게시 열람 차단, 추가 AI 생성 없음");
  console.log(
    `${checks}개 집중 검사 통과 (${((Date.now() - started) / 1000).toFixed(1)}초)`,
  );
} finally {
  await browser?.close();
  await Promise.all(Object.values(clients).map((client) => client.dispose()));
  // IDs are generated above; existing user content is never selected for deletion.
  await pool.query("DELETE FROM workspace WHERE id=ANY($1::uuid[])", [
    [w, outsiderWorkspace],
  ]);
  for (const account of accounts)
    await pool.query("DELETE FROM app_user WHERE id=$1", [account.id]);
  await pool.end();
}
