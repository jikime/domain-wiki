import { readFileSync } from "node:fs";
import {
  type APIRequestContext,
  expect,
  request,
  test,
} from "@playwright/test";
import { Pool } from "pg";
import { registerActivityNavigationTests } from "./activity-navigation-cases";
import { registerAiTaskTests } from "./ai-task-cases";
import { registerAuthoringAccountTests } from "./authoring-account-cases";
import { registerBusinessTests } from "./business-cases";
import { registerChatTests } from "./chat-cases";
import { registerDiscoveryTests } from "./discovery-cases";
import { registerDocumentAnalysisTests } from "./document-analysis-cases";
import { registerDomainPurposeTests } from "./domain-purpose-cases";
import { registerEmbeddingInputTests } from "./embedding-input-cases";
import { registerGraphSearchTests } from "./graph-search-cases";
import { registerGraphViewTests } from "./graph-view-cases";
import { registerIngestTests } from "./ingest-cases";
import { registerKnowledgeTests } from "./knowledge-cases";
import { registerMilkdownTests } from "./milkdown-cases";
import { registerOperationsTests } from "./operations-cases";
import { registerOriginalArchiveTests } from "./original-archive-cases";
import { registerOriginalDocumentTests } from "./original-document-cases";
import { registerOriginalFolderMediaTests } from "./original-folder-media-cases";
import { registerOriginalImportTests } from "./original-import-cases";
import { registerOriginalParityTests } from "./original-parity-cases";
import { registerOriginalParserTests } from "./original-parser-cases";
import { registerOriginalQualityActionsTests } from "./original-quality-actions-cases";
import { registerOriginalResearchTests } from "./original-research-cases";
import { registerOriginalSelectionTests } from "./original-selection-cases";
import { registerPaginationTests } from "./pagination-cases";
import { registerPermissionTests } from "./permission-cases";
import { registerProposalTests } from "./proposal-cases";
import { registerQualityTests } from "./quality-cases";
import { registerWikiGenerationTests } from "./wiki-generation-cases";

const fixture: {
  workspaceId: string;
  outsiderWorkspaceId: string;
  domainId: string;
  outsiderDomainId: string;
  accounts: { id: string; email: string; password: string; role: string }[];
} = JSON.parse(readFileSync(".local/test-accounts.json", "utf8"));
test.describe.configure({ mode: "serial" });
const origin = "http://localhost:3101";
const base = `/api/workspaces/${fixture.workspaceId}`;
const clients: Record<string, APIRequestContext> = {};
const domainValue = {
  name: "지속 저장 시험",
  purpose: "페이지를 새로 열어도 목적과 용어를 유지합니다.",
  terms: [{ term: "검수", definition: "개발 표본의 점검 확인" }],
  recordTemplate: "상황\n이유\n결과",
};
test.beforeAll(async () => {
  for (const account of fixture.accounts) {
    const client = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    const response = await client.post("/api/auth/sign-in/email", {
      data: { email: account.email, password: account.password },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["set-cookie"]).toContain("HttpOnly");
    clients[account.role] = client;
  }
});
test.afterAll(async () => {
  await Promise.all(Object.values(clients).map((client) => client.dispose()));
});

test("비로그인·공개 가입·잘못된 비밀번호를 거부한다", async ({
  request: anonymous,
}) => {
  expect((await anonymous.get(base)).status()).toBe(401);
  expect(
    (
      await anonymous.post(`${base}/domains`, {
        headers: { Origin: origin },
        data: domainValue,
      })
    ).status(),
  ).toBe(401);
  const signup = await anonymous.post("/api/auth/sign-up/email", {
    headers: { Origin: origin },
    data: {
      name: "임의 가입",
      email: "unwanted@test.invalid",
      password: "UnwantedTest1234!",
    },
  });
  expect(signup.status()).toBe(400);
  const wrongPassword = await anonymous.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: {
      email: fixture.accounts[0].email,
      password: "IncorrectPassword1234!",
    },
  });
  expect(wrongPassword.status()).toBe(401);
});

test("업무 역할과 작업공간 경계는 직접 API에도 적용된다", async () => {
  for (const role of ["reader", "writer", "reviewer"]) {
    expect((await clients[role].get(base)).status()).toBe(200);
    expect((await clients[role].get(`${base}/members`)).status()).toBe(403);
    expect(
      (
        await clients[role].post(`${base}/domains`, { data: domainValue })
      ).status(),
    ).toBe(403);
    expect(
      (
        await clients[role].post(`${base}/members`, {
          data: {
            name: "임의",
            email: "invalid@test.invalid",
            password: "InvalidRequest1234!",
            role: "reviewer",
            isAdmin: true,
          },
        })
      ).status(),
    ).toBe(403);
  }
  expect((await clients.outsider.get(base)).status()).toBe(404);
  expect(
    (
      await clients.admin.get(`/api/workspaces/${fixture.outsiderWorkspaceId}`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await clients.admin.patch(`${base}/domains/${fixture.outsiderDomainId}`, {
        data: domainValue,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await clients.admin.post(`${base}/projects`, {
        data: {
          domainId: fixture.outsiderDomainId,
          name: "범위 우회",
          clientName: "표본",
          description: "",
        },
      })
    ).status(),
  ).toBe(404);
});

test("도메인·용어·양식·프로젝트를 저장하고 다시 조회한다", async () => {
  const created = await clients.admin.post(`${base}/domains`, {
    data: domainValue,
  });
  expect(created.status()).toBe(201);
  const saved = await created.json();
  expect(
    (
      await clients.admin.post(`${base}/domains`, { data: domainValue })
    ).status(),
  ).toBe(409);
  const updated = { ...domainValue, purpose: "수정한 목적" };
  expect(
    (
      await clients.admin.patch(`${base}/domains/${saved.id}`, {
        data: updated,
      })
    ).status(),
  ).toBe(200);
  const createdProject = await clients.admin.post(`${base}/projects`, {
    data: {
      domainId: saved.id,
      name: "가상 시험사업",
      clientName: "가상 발주처",
      description: "개발 표본",
    },
  });
  expect(createdProject.status()).toBe(201);
  const project = await createdProject.json();
  expect(
    (
      await clients.admin.patch(`${base}/projects/${project.id}`, {
        data: {
          domainId: saved.id,
          name: "수정 시험사업",
          clientName: "가상 발주처",
          description: "수정 설명",
        },
      })
    ).status(),
  ).toBe(200);
  const result = await (await clients.reader.get(base)).json();
  expect(
    result.domains.find((item: { id: string }) => item.id === saved.id),
  ).toMatchObject(updated);
  expect(
    result.projects.find((item: { id: string }) => item.id === project.id),
  ).toMatchObject({ name: "수정 시험사업", description: "수정 설명" });
});

test("출처·JSON·입력 길이를 검사하고 관리자 자기 잠금을 막는다", async () => {
  expect(
    (
      await clients.admin.post(`${base}/domains`, {
        headers: { Origin: "https://untrusted.invalid" },
        data: domainValue,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await clients.admin.post(`${base}/domains`, {
        data: { ...domainValue, isAdmin: true },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await clients.admin.post(`${base}/domains`, {
        headers: { "Content-Type": "application/json" },
        data: "{",
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await clients.admin.post(`${base}/domains`, {
        data: { ...domainValue, purpose: "a".repeat(70_000) },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await clients.admin.post(`${base}/domains`, {
        data: { ...domainValue, purpose: "a".repeat(1024 * 1024 + 1) },
      })
    ).status(),
  ).toBe(413);
  const admin = fixture.accounts.find((item) => item.role === "admin");
  expect(
    (
      await clients.admin.patch(`${base}/members/${admin?.id}`, {
        data: { role: "reader", isAdmin: false, isActive: false },
      })
    ).status(),
  ).toBe(409);
});

test("직원 계정 생성·역할 변경·이용 중지는 현재 세션에 반영된다", async () => {
  const email = `new-${fixture.workspaceId}@test.invalid`;
  const password = "LocalTestingPassword1234!";
  const created = await clients.admin.post(`${base}/members`, {
    data: { name: "새 직원", email, password, role: "writer", isAdmin: false },
  });
  expect(created.status()).toBe(201);
  const member = await created.json();
  expect(JSON.stringify(member)).not.toContain(password);
  const client = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  try {
    expect(
      (
        await client.post("/api/auth/sign-in/email", {
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    expect((await client.get(`${base}/members`)).status()).toBe(403);
    expect(
      (
        await clients.admin.patch(`${base}/members/${member.id}`, {
          data: { role: "reviewer", isAdmin: true, isActive: true },
        })
      ).status(),
    ).toBe(200);
    expect((await client.get(`${base}/members`)).status()).toBe(200);
    expect(
      (
        await clients.admin.patch(`${base}/members/${member.id}`, {
          data: { role: "reader", isAdmin: false, isActive: true },
        })
      ).status(),
    ).toBe(200);
    expect((await client.get(`${base}/members`)).status()).toBe(403);
    const cookies = (await client.storageState()).cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    expect(
      (
        await clients.admin.patch(`${base}/members/${member.id}`, {
          data: { role: "reader", isAdmin: false, isActive: false },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await client.get(base, { headers: { Cookie: cookies } })).status(),
    ).toBe(401);
    expect(
      (
        await client.post("/api/auth/sign-in/email", {
          data: { email, password },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await client.dispose();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query("DELETE FROM app_user WHERE id=$1", [member.id]);
    } finally {
      await pool.end();
    }
  }
});

test("모바일 메뉴는 역할에 맞게 열리고 Escape와 이동 후 닫힌다", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: await clients.reader.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/w/${fixture.workspaceId}`);
    const trigger = page.getByRole("button", { name: "전체 메뉴 열기" });
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "우리 업무 위키" });
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "관리", exact: true }),
    ).toHaveCount(0);
    await expect(
      menu.getByRole("link", { name: "검토함", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({ path: "test-results/hince-menu-390.png" });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await menu.getByRole("link", { name: "자료실", exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/w/${fixture.workspaceId}/sources$`),
    );
    await expect(menu).toBeHidden();
    await expect(
      page.getByRole("button", { name: "새 자료 등록" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("자료 등록은 작성 권한이 필요합니다."),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("자료 등록 창의 선택창과 닫기 동작은 모바일 키보드 포커스를 보존한다", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: await clients.writer.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/w/${fixture.workspaceId}/sources`);
    const trigger = page.getByRole("button", { name: "새 자료 등록" });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "새 자료 등록",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("자료 제목")).toBeEnabled();
    const category = dialog.getByRole("combobox", { name: "자료 분류" });
    await category.click();
    await expect(
      page.getByRole("option", { name: "참고 자료", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(category).toBeFocused();
    await page.screenshot({ path: "test-results/hince-upload-390.png" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

test("로그아웃한 세션 쿠키를 재전송해도 접근할 수 없다", async () => {
  const cookies = (await clients.writer.storageState()).cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  expect(
    (await clients.writer.post("/api/auth/sign-out", { data: {} })).status(),
  ).toBe(200);
  expect(
    (await clients.writer.get(base, { headers: { Cookie: cookies } })).status(),
  ).toBe(401);
});

test("한국어 로그인·홈·관리 저장·채팅 화면과 모바일 화면을 확인한다", async ({
  page,
}) => {
  const account = fixture.accounts.find((item) => item.role === "admin");
  if (!account) throw new Error("관리자 표본 없음");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.getByLabel("이메일", { exact: true }).fill(account.email);
  await page.getByLabel("비밀번호", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${fixture.workspaceId}$`));
  await expect(
    page.getByRole("heading", { name: "오늘은 어떤 업무를 알아볼까요?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link"),
  ).toHaveCount(9);
  await page.getByRole("link", { name: "관리", exact: true }).click();
  await page.getByText("+ 새 도메인 만들기", { exact: true }).click();
  const form = page
    .locator("details")
    .filter({ has: page.getByText("+ 새 도메인 만들기", { exact: true }) });
  await form.getByLabel("도메인 이름").fill("화면에서 생성한 도메인");
  await form.getByLabel("도메인의 목적").fill("브라우저 저장을 확인합니다.");
  await form.getByLabel("핵심 용어").fill("약어 | 용어 설명");
  await form.getByRole("button", { name: "도메인 생성" }).click();
  await expect(form.getByRole("status")).toHaveText("저장했습니다.");
  await expect(form.getByLabel("도메인 이름")).toHaveValue("");
  const projectForm = page
    .locator("details")
    .filter({ has: page.getByText("+ 새 프로젝트 만들기", { exact: true }) });
  await projectForm.locator("summary").click();
  await projectForm.getByRole("combobox", { name: "업무 도메인" }).click();
  await page
    .getByRole("option", { name: "화면에서 생성한 도메인", exact: true })
    .click();
  await projectForm.getByLabel("프로젝트 이름").fill("선택창 저장 시험");
  await projectForm.getByLabel("발주처 이름").fill("가상 발주처");
  const projectSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${base}/projects`) &&
      response.request().method() === "POST",
  );
  await projectForm.getByRole("button", { name: "프로젝트 생성" }).click();
  expect((await projectSaved).status()).toBe(201);
  await expect(projectForm.getByLabel("프로젝트 이름")).toHaveValue("");
  const readerAccount = fixture.accounts.find((item) => item.role === "reader");
  if (!readerAccount) throw new Error("이용 직원 표본 없음");
  const memberForm = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: readerAccount.email }),
  });
  await memberForm.locator("summary").click();
  await memberForm
    .getByRole("checkbox", { name: "작성 · 자료 등록과 위키 작성" })
    .check();
  await memberForm.getByRole("checkbox", { name: "관리자 권한 부여" }).focus();
  await page.keyboard.press("Space");
  const changed = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${base}/members/${readerAccount.id}`) &&
      response.request().method() === "PATCH",
  );
  await memberForm.getByRole("button", { name: "저장", exact: true }).click();
  expect((await changed).status()).toBe(200);
  const updatedMembers = await (
    await clients.admin.get(`${base}/members`)
  ).json();
  expect(
    updatedMembers.find((item: { id: string }) => item.id === readerAccount.id),
  ).toMatchObject({
    role: "writer",
    isAdmin: true,
    roles: ["reader", "writer", "reviewer"],
  });
  await expect(
    memberForm.getByRole("checkbox", {
      name: "검토 · 원문과 변경안 검토·승인",
    }),
  ).toBeChecked();
  await memberForm
    .getByRole("checkbox", { name: "관리자 권한 부여" })
    .uncheck();
  await memberForm
    .getByRole("checkbox", { name: "작성 · 자료 등록과 위키 작성" })
    .uncheck();
  const restored = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${base}/members/${readerAccount.id}`) &&
      response.request().method() === "PATCH",
  );
  await memberForm.getByRole("button", { name: "저장", exact: true }).click();
  expect((await restored).status()).toBe(200);
  await page.reload();
  await expect(
    page.locator("summary").filter({ hasText: "화면에서 생성한 도메인" }),
  ).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(process.env.AI_API_KEY);
  expect(html).not.toContain(process.env.BETTER_AUTH_SECRET);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("link", { name: "채팅" })
    .click();
  await expect(
    page.getByRole("button", { name: "질문 보내기" }),
  ).toBeDisabled();
  await expect(page.getByLabel("업무 질문", { exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/01-mobile-chat.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(`/w/${fixture.workspaceId}`);
  await page.screenshot({ path: "test-results/01-home.png", fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("이용 직원 화면에서 관리·검토 메뉴 및 직접 주소 접근을 제한한다", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: await clients.reader.storageState(),
  });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/w/${fixture.workspaceId}`);
    await expect(
      page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link"),
    ).toHaveCount(7);
    await page.goto(`${origin}/w/${fixture.workspaceId}/admin`);
    await expect(
      page.getByRole("heading", { name: "접근 가능한 페이지를 확인해 주세요" }),
    ).toBeVisible();
    await page.goto(`${origin}/w/${fixture.workspaceId}/reviews`);
    await expect(
      page.getByRole("heading", { name: "접근 가능한 페이지를 확인해 주세요" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("DB 계정은 슈퍼유저가 아니며 공간 간 프로젝트 연결은 FK로 차단된다", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      "SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user",
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    await expect(
      pool.query(
        "INSERT INTO project (workspace_id, domain_id, name, client_name) VALUES ($1,$2,'잘못된 연결','표본')",
        [fixture.workspaceId, fixture.outsiderDomainId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const migrations = await pool.query(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    expect(migrations.rows[0].count).toBe(
      JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries
        .length,
    );
  } finally {
    await pool.end();
  }
});

registerKnowledgeTests(fixture, clients);

registerChatTests(fixture, clients);

registerProposalTests(fixture, clients);
registerDiscoveryTests(fixture, clients);

registerOperationsTests(fixture, clients);

registerBusinessTests(fixture, clients);

registerPaginationTests(fixture, clients);
registerAuthoringAccountTests(fixture, clients);
registerActivityNavigationTests(fixture, clients);

registerAiTaskTests(fixture, clients);
registerDocumentAnalysisTests(fixture, clients);
registerPermissionTests(fixture, clients);
registerMilkdownTests(fixture, clients);
registerDomainPurposeTests(fixture, clients);

registerWikiGenerationTests(fixture, clients);
registerIngestTests(fixture, clients);
registerEmbeddingInputTests();
registerGraphSearchTests(fixture, clients);

registerQualityTests(fixture, clients);

registerGraphViewTests(fixture, clients);
registerOriginalParityTests(fixture, clients);

registerOriginalDocumentTests(fixture, clients);

registerOriginalParserTests(fixture, clients);

registerOriginalImportTests(fixture, clients);
registerOriginalArchiveTests(fixture, clients);
registerOriginalSelectionTests(fixture, clients);
registerOriginalQualityActionsTests(fixture, clients);

registerOriginalResearchTests(fixture, clients);

registerOriginalFolderMediaTests(fixture, clients);
