// Local release fixtures: exercise new durable records without touching earlier content.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, request } from "@playwright/test";
import JSZip from "jszip";
import sharp from "sharp";
import { deployment, hash } from "./lib/deployment.mjs";

const [mode, profile, originalProfile = profile] = process.argv.slice(2);
if (
  !["seed", "verify"].includes(mode) ||
  !/^wiki-stage16-/.test(profile ?? "") ||
  originalProfile !== "wiki-stage16-main"
)
  throw new Error("원본 복원 로컬 검증 인수를 확인하세요.");
const target = deployment(profile),
  original = deployment(originalProfile);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const legacy = read(join(original.folder, "core-rehearsal.json"));
const admin = read(join(original.folder, "initial-admin.json"));
const { workspaceId } = read(join(original.folder, "workspace.json"));
const statePath = join(original.folder, "parity-rehearsal.json");
const state = existsSync(statePath) ? read(statePath) : {};
const save = () =>
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const out = "docs/evaluation/core/original-parity-deployment";
mkdirSync(out, { recursive: true });
const origin = target.env.BETTER_AUTH_URL,
  base = `/api/workspaces/${workspaceId}`;
const api = {};
const json = async (r, status = 200) => {
  const d = await r.json();
  expect(r.status(), d.error).toBe(status);
  return d;
};
async function ready(item) {
  await expect
    .poll(
      async () =>
        (
          await json(
            await api.writer.get(
              `${base}/sources/${item.sourceId}?version=${item.versionId}`,
            ),
          )
        ).version.processing,
      { timeout: 60_000 },
    )
    .toBe("completed");
  return json(
    await api.writer.get(
      `${base}/sources/${item.sourceId}?version=${item.versionId}`,
    ),
  );
}
async function upload(path, bytes) {
  return json(
    await api.writer.post(`${base}/sources`, {
      multipart: {
        importId: state.importId,
        relativePath: path,
        title: path.split("/").at(-1),
        domainId: state.domainId,
        projectId: "",
        category: "reference",
        file: {
          name: path.split("/").at(-1),
          mimeType: path.endsWith(".png") ? "image/png" : "text/markdown",
          buffer: Buffer.from(bytes),
        },
      },
    }),
    201,
  );
}
let browser;
try {
  for (const [role, account] of Object.entries({ admin, ...legacy.accounts })) {
    api[role] = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    await json(
      await api[role].post("/api/auth/sign-in/email", {
        data: { email: account.email, password: account.password },
      }),
    );
  }
  if (mode === "seed") {
    if (profile !== originalProfile)
      throw new Error("원본 검증 프로필에서만 표본을 만듭니다.");
    if (!state.domainId) {
      const domain = await json(
        await api.admin.post(`${base}/domains`, {
          data: {
            name: "원본 기능 복원 보존 시험",
            purpose:
              "고정 가상 자료로 연결 이미지와 이동 기록의 복원을 확인합니다.",
            terms: [],
            recordTemplate: "상황\n근거\n확인 결과",
            autoIngest: false,
          },
        }),
        201,
      );
      state.domainId = domain.id;
      save();
    }
    if (!state.importId) {
      state.importId = (
        await json(
          await api.writer.post(`${base}/source-imports`, {
            data: {
              label: "복원 이미지 폴더",
              domainId: state.domainId,
              projectId: null,
              category: "reference",
              mode: "upload",
            },
          }),
          201,
        )
      ).id;
      save();
    }
    if (!state.image) {
      state.image = await upload(
        "bundle/images/chart.png",
        await sharp({
          create: { width: 64, height: 40, channels: 3, background: "#B67585" },
        })
          .png()
          .toBuffer(),
      );
      save();
    }
    if (!state.document) {
      state.document = await upload(
        "bundle/docs/guide.md",
        "# 복원 검증 표본\n이미지는 등록 시점의 사본으로 보관합니다.\n![고정 그림](../images/chart.png)\n본문 뒤 문장도 유지합니다.",
      );
      save();
    }
    let details = await ready(state.document);
    const assetUrl = details.chunks
      .map((c) => c.text)
      .join("\n")
      .match(/\/api\/workspaces\/[\w-]+\/source-assets\/[\w-]+/)?.[0];
    expect(assetUrl).toBeTruthy();
    state.assetUrl = assetUrl;
    state.assetHash = hash(await (await api.writer.get(assetUrl)).body());
    if (details.version.publication === "pending")
      await json(
        await api.reviewer.post(
          `${base}/source-versions/${state.document.versionId}/action`,
          {
            data: {
              action: "approve",
              note: "직접 만든 가상 이미지와 원문을 확인한 복원 시험입니다.",
            },
          },
        ),
      );
    details = await ready(state.document);
    state.documentBody = details.chunks.map((c) => c.text).join("\n");
    save();
    if (!state.archive) {
      const zip = new JSZip();
      zip.file("wiki/index.md", "# 복원 목차\n");
      zip.file("purpose.md", "# 이동 표본\n가상 보존 시험입니다.");
      zip.file("raw/source.md", "보관 내용은 가상 개발 표본입니다.");
      zip.file(".llm-wiki/state.json", '{"preserved":true}');
      zip.file("attachments/opaque.bin", Buffer.from([0, 1, 2, 255]));
      zip.folder("empty-folder");
      state.archive = await json(
        await api.admin.post(
          `${base}/archives?name=${encodeURIComponent("복원 ZIP 보존 표본")}`,
          {
            headers: { "Content-Type": "application/zip" },
            data: await zip.generateAsync({
              type: "nodebuffer",
              compression: "DEFLATE",
            }),
          },
        ),
        201,
      );
      save();
    }
    if (!state.research) {
      state.research = await json(
        await api.writer.post(`${base}/research`, {
          data: {
            domainId: state.domainId,
            projectId: null,
            requestId: randomUUID(),
            topic: "복원 취소 기록",
            queries: ["이미지 보관"],
            sourceMode: "local",
          },
        }),
        201,
      );
      save();
      await json(
        await api.writer.patch(`${base}/research/${state.research.id}`, {
          data: { action: "cancel" },
        }),
      );
    }
    await expect
      .poll(
        async () =>
          (
            await json(
              await api.writer.get(`${base}/research/${state.research.id}`),
            )
          ).state,
      )
      .toBe("canceled");
    state.folderMedia = JSON.parse(
      target.sql(
        `SELECT folder_media::text FROM source_version WHERE id='${state.document.versionId}'`,
      ),
    );
    expect(state.folderMedia[0].versionId).toBe(state.image.versionId);
    save();
  }
  const details = await ready(state.document);
  expect(details.chunks.map((c) => c.text).join("\n")).toBe(state.documentBody);
  expect(
    JSON.parse(
      target.sql(
        `SELECT folder_media::text FROM source_version WHERE id='${state.document.versionId}'`,
      ),
    ),
  ).toEqual(state.folderMedia);
  const readerImage = await api.reader.get(state.assetUrl);
  expect(readerImage.status()).toBe(200);
  expect(hash(await readerImage.body())).toBe(state.assetHash);
  expect(
    (
      await api.reader.get(
        `${base}/source-versions/${state.image.versionId}/file`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (await json(await api.writer.get(`${base}/research/${state.research.id}`)))
      .state,
  ).toBe("canceled");
  expect(
    (await api.reader.get(`${base}/research/${state.research.id}`)).status(),
  ).toBe(403);
  const archiveResponse = await api.admin.get(
    `${base}/archives?domainId=${state.archive.domainId}&drafts=1`,
  );
  expect(archiveResponse.status()).toBe(200);
  const archive = await JSZip.loadAsync(await archiveResponse.body());
  expect(await archive.file(".llm-wiki/state.json")?.async("string")).toBe(
    '{"preserved":true}',
  );
  expect(
    await archive.file("attachments/opaque.bin")?.async("nodebuffer"),
  ).toEqual(Buffer.from([0, 1, 2, 255]));
  expect(archive.files["empty-folder/"].dir).toBe(true);
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    storageState: await api.reader.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/w/${workspaceId}/sources/${state.document.sourceId}`);
  const image = page.locator('img[src*="source-assets"]').first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((i) => i.naturalWidth)).toBe(64);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `${out}/${profile}-folder-image-390.png`,
    fullPage: true,
  });
  const result = {
    date: new Date().toISOString(),
    profile,
    image: target.env.APP_IMAGE,
    migrationCount: Number(
      target.sql("SELECT count(*) FROM drizzle.__drizzle_migrations"),
    ),
    folderImageHash: true,
    folderMediaVersion: true,
    documentText: true,
    privateOriginal: true,
    researchCancellation: true,
    researchPrivacy: true,
    archiveHiddenFile: true,
    archiveOpaqueFile: true,
    archiveEmptyDirectory: true,
    mobileOverflow: 0,
    browserErrors: errors,
    counts: target.tableCounts(),
  };
  expect(result.migrationCount).toBe(30);
  writeFileSync(
    `${out}/${profile}-new-records.json`,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await Promise.all(Object.values(api).map((c) => c.dispose()));
}
