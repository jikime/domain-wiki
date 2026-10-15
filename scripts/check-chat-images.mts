// Focused image chat check. Uses the real route/service, a local model fixture,
// and the running app for authenticated UI and file requests. No external AI or build.
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
import sharp from "sharp";

nextEnv.loadEnvConfig(process.cwd());
const origin = "http://localhost:3010";
assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL ?? "").hostname,
  ),
);
const seen: {
  images: string[];
  messages: { role: string; content: unknown }[];
}[] = [];
let failNext = false;
const mock = createServer(async (req, res) => {
  const parts = [];
  for await (const part of req) parts.push(part);
  const data = JSON.parse(Buffer.concat(parts).toString());
  const images = data.messages.flatMap((message: { content: unknown }) =>
    Array.isArray(message.content)
      ? message.content
          .filter((part) => part.type === "image_url")
          .map((part) => part.image_url.url)
      : [],
  );
  seen.push({ images, messages: data.messages });
  if (failNext) {
    failNext = false;
    res.writeHead(400);
    res.end("fixture failure");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(
    `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ action: "final", answer: "첨부 이미지에서 색상 표본을 확인했습니다. 공개 업무 기준은 별도로 확인해야 합니다." }) }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
const address = mock.address();
assert.ok(address && typeof address !== "string");
Object.assign(process.env, {
  AI_TRANSPORT: "api",
  AI_CHAT_TRANSPORT: "api",
  AI_KNOWLEDGE_TRANSPORT: "api",
  AI_VISION_TRANSPORT: "api",
  AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
  AI_API_KEY: "local-fixture-only",
  AI_MODEL: "image-fixture",
  AI_CHAT_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
  AI_CHAT_API_KEY: "local-fixture-only",
  AI_CHAT_MODEL: "image-fixture",
  AI_EMBEDDING_MODEL: "",
  AI_CHAT_CONTEXT_CHARS: "120000",
});
const { POST } = await import(
  "../src/app/api/workspaces/[workspaceId]/conversations/[conversationId]/stream/route"
);
const { getPool } = await import("../src/server/db");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const workspace = randomUUID(),
  outside = randomUUID(),
  domain = randomUUID();
const accounts: string[] = [],
  clients: Record<string, APIRequestContext> = {};
const cookies: Record<string, string> = {};
const base = `/api/workspaces/${workspace}`;
const started = Date.now();
let checks = 0,
  browser: Browser | undefined;
const pass = (text: string) => console.log(`통과 ${++checks}: ${text}`);
const bytes = await sharp({
  create: { width: 12, height: 10, channels: 3, background: "#aa3355" },
})
  .png()
  .toBuffer();
const image = {
  name: "표본.png",
  mediaType: "image/png",
  dataBase64: bytes.toString("base64"),
};
const jpeg = await sharp(bytes).jpeg().toBuffer();
const webp = await sharp(bytes).webp().toBuffer();
const gif = await sharp(bytes).gif().toBuffer();
async function send(
  id: string,
  input: unknown,
  role = "writer",
  requestOrigin = origin,
) {
  return POST(
    new Request(`${origin}${base}/conversations/${id}/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: requestOrigin,
        Cookie: cookies[role] ?? "",
      },
      body: JSON.stringify(input),
    }),
    { params: Promise.resolve({ workspaceId: workspace, conversationId: id }) },
  );
}
async function complete(response: Response) {
  assert.equal(response.status, 200);
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)));
  assert.ok(
    !events.some((event) => event.type === "error"),
    JSON.stringify(events),
  );
  return events.find((event) => event.type === "done");
}
async function conversation() {
  const response = await clients.writer.post(`${base}/conversations`, {
    data: {
      scope: {
        domainId: domain,
        projectId: null,
        sourceId: null,
        wikiId: null,
        agentMode: "fast",
      },
    },
  });
  assert.equal(response.status(), 201);
  return (await response.json()).id as string;
}
try {
  await pool.query(
    "INSERT INTO workspace(id,name) VALUES($1,'이미지 채팅 검사'),($2,'외부 접근 검사')",
    [workspace, outside],
  );
  for (const role of ["writer", "reader", "admin", "outsider"]) {
    const id = randomUUID(),
      password = randomBytes(18).toString("base64url"),
      email = `image-${id}@test.invalid`;
    accounts.push(id);
    await pool.query("INSERT INTO app_user(id,name,email) VALUES($1,$2,$3)", [
      id,
      `이미지 검사 ${role}`,
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
    cookies[role] = (await client.storageState()).cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }
  await pool.query(
    "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,'이미지 질문','가상 이미지 검사')",
    [domain, workspace],
  );
  const id = await conversation(),
    requestId = randomUUID();
  const payload = {
    requestId,
    prompt: "",
    images: [
      image,
      {
        name: "표본.jpg",
        mediaType: "image/jpeg",
        dataBase64: jpeg.toString("base64"),
      },
      {
        name: "표본.webp",
        mediaType: "image/webp",
        dataBase64: webp.toString("base64"),
      },
      {
        name: "표본.gif",
        mediaType: "image/gif",
        dataBase64: gif.toString("base64"),
      },
    ],
  };
  const done = await complete(await send(id, payload));
  assert.equal(done.runs[0].images.length, 4);
  assert.equal(seen[0].images.length, 4);
  assert.equal(seen[0].images[0], `data:image/png;base64,${image.dataBase64}`);
  assert.equal(JSON.stringify(done).includes(image.dataBase64), false);
  const fileHref = done.runs[0].images[0].href;
  const file = await clients.writer.get(fileHref);
  assert.equal(file.status(), 200);
  assert.deepEqual(await file.body(), bytes);
  assert.equal(file.headers()["cache-control"], "private, no-store");
  pass("4개 형식·이미지만 질문·원본 저장·멀티모달 요청·대화 응답의 이미지 URL");

  const beforeReplay = seen.length;
  await complete(await send(id, payload));
  assert.equal(seen.length, beforeReplay);
  assert.equal((await send(id, { ...payload, images: [image] })).status, 409);
  await complete(
    await send(id, {
      requestId: randomUUID(),
      prompt: "방금 이미지의 색상을 비교해 주세요.",
    }),
  );
  assert.equal(seen.at(-1)?.images.length, 4);
  assert.ok(
    seen
      .at(-1)
      ?.messages.some(
        (message) => message.role === "user" && Array.isArray(message.content),
      ),
  );
  pass("재시도 중복 방지·이미지 변경 충돌·텍스트 후속 질문에 이전 이미지 전달");

  const invalid = [
    { images: [{ ...image, mediaType: "image/svg+xml" }] },
    { images: [{ ...image, mediaType: "image/jpeg" }] },
    {
      images: [
        {
          ...image,
          dataBase64: Buffer.from("broken image").toString("base64"),
        },
      ],
    },
    { images: [{ ...image, dataBase64: `${image.dataBase64}!` }] },
    { images: Array.from({ length: 6 }, () => image) },
    {
      images: [
        {
          ...image,
          dataBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
        },
      ],
    },
    { images: [], prompt: "" },
  ];
  const beforeInvalid = seen.length;
  for (const input of invalid)
    assert.equal(
      (
        await send(id, {
          requestId: randomUUID(),
          prompt: "이미지 확인",
          ...input,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await send(
        id,
        { requestId: randomUUID(), prompt: "확인", images: [image] },
        "writer",
        "https://untrusted.invalid",
      )
    ).status,
    403,
  );
  for (const role of ["reader", "admin", "outsider"]) {
    assert.equal((await clients[role].get(fileHref)).status(), 404);
    assert.equal(
      (
        await send(
          id,
          { requestId: randomUUID(), prompt: "확인", images: [image] },
          role,
        )
      ).status,
      404,
    );
  }
  assert.equal(
    await request.newContext({ baseURL: origin }).then(async (client) => {
      const response = await client.get(fileHref);
      await client.dispose();
      return response.status();
    }),
    401,
  );
  assert.equal(seen.length, beforeInvalid);
  pass(
    "손상·MIME 위장·SVG·용량/개수·빈 입력·CSRF 및 타인/관리자/외부 이미지 접근 차단",
  );

  const otherDomain = randomUUID();
  await pool.query(
    "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,'다른 범위','이전 이미지 제외')",
    [otherDomain, workspace],
  );
  await clients.writer.patch(`${base}/conversations/${id}`, {
    data: {
      scope: {
        domainId: otherDomain,
        projectId: null,
        sourceId: null,
        wikiId: null,
      },
    },
  });
  const beforeScope = seen.length;
  await complete(
    await send(id, {
      requestId: randomUUID(),
      prompt: "이전 그림을 봐 주세요.",
    }),
  );
  assert.equal(seen.length, beforeScope);
  pass("질문 범위 변경 후 이전 이미지 문맥 제외·일반 텍스트 채팅 유지");

  const uiConversation = await conversation();
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    storageState: await clients.writer.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route("**/conversations/*/stream", async (route) => {
    const req = route.request();
    const conversationId = req.url().split("/").at(-2);
    assert.ok(conversationId);
    const response = await POST(
      new Request(req.url(), {
        method: "POST",
        headers: await req.allHeaders(),
        body: req.postData(),
      }),
      { params: Promise.resolve({ workspaceId: workspace, conversationId }) },
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  await page.goto(`/w/${workspace}/chat?conversation=${uiConversation}`);
  const picker = page.getByLabel("채팅 이미지 파일", { exact: true });
  await picker.setInputFiles({
    name: "표본.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await expect(
    page.getByRole("button", { name: "표본.png 첨부 삭제" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "표본.png 첨부 삭제" }).click();
  await expect(page.locator(".chat-image-picker img")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "업무 질문" })
    .evaluate((element, data) => {
      const file = new File(
        [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
        "붙여넣기.png",
        { type: "image/png" },
      );
      const transfer = new DataTransfer();
      transfer.items.add(file);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, image.dataBase64);
  await expect(
    page.getByRole("button", { name: "붙여넣기.png 첨부 삭제" }),
  ).toBeVisible();
  await page.locator(".chat-composer").evaluate((element, data) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
        "끌어놓기.webp",
        { type: "image/webp" },
      ),
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, webp.toString("base64"));
  await expect(page.locator(".chat-image-picker img")).toHaveCount(2);
  await page.getByRole("button", { name: "붙여넣기.png 확대" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  failNext = true;
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(
    page.getByRole("button", { name: "다시 질문", exact: true }),
  ).toBeVisible();
  assert.equal(seen.at(-1)?.images.length, 2);
  await page.getByRole("button", { name: "다시 질문", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "위키 초안으로 저장", exact: true }),
  ).toBeVisible();
  assert.equal(seen.at(-1)?.images.length, 2);
  await expect(page.locator(".chat-image-picker img")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".chat-question img")).toHaveCount(4);
  await expect
    .poll(() =>
      page
        .locator(".chat-question img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  pass(
    "390px 파일 선택·삭제·붙여넣기·끌어놓기·확대·이미지만 전송·실패 후 이미지 재전송·새로고침 보존",
  );
  await context.close();

  const runIds = (
    await pool.query("SELECT id FROM chat_run WHERE conversation_id=$1", [id])
  ).rows.map((row) => row.id);
  assert.equal(
    (await clients.writer.delete(`${base}/conversations/${id}`)).status(),
    200,
  );
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM chat_image WHERE run_id=ANY($1::uuid[])",
          [runIds],
        )
      ).rows[0].count,
    ),
    0,
  );
  assert.equal((await clients.writer.get(fileHref)).status(), 404);
  pass("대화 삭제 시 첨부 이미지 함께 삭제 및 이전 주소 차단");
  console.log(
    `${checks}개 집중 검사 통과 (${((Date.now() - started) / 1000).toFixed(1)}초), 외부 모델 호출 0`,
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
