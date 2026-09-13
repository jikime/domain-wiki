import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import sharp from "sharp";

type Fixture = { workspaceId: string; domainId: string };
export function registerOriginalFolderMediaTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("원본 기능 복원 — 폴더 연결 이미지", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const base = `/api/workspaces/${f.workspaceId}`;
    const input = {
      label: "연결 이미지",
      mode: "upload",
      domainId: f.domainId,
      projectId: null,
      category: "reference",
    };
    let worker: ChildProcess;
    const png = (color: string) =>
      sharp({
        create: { width: 160, height: 100, channels: 3, background: color },
      })
        .png()
        .toBuffer();
    async function collection(extra = {}) {
      const r = await clients.writer.post(`${base}/source-imports`, {
        data: { ...input, ...extra },
      });
      expect(r.status(), await r.text()).toBe(201);
      return r.json();
    }
    async function upload(
      importId: string,
      path: string,
      body: string | Buffer,
    ) {
      const r = await clients.writer.post(`${base}/sources`, {
        multipart: {
          importId,
          relativePath: path,
          title:
            path
              .split("/")
              .at(-1)
              ?.replace(/\.[^.]+$/, "") ?? "문서",
          domainId: f.domainId,
          projectId: "",
          category: "reference",
          file: {
            name: path.split("/").at(-1) ?? "문서.md",
            mimeType: path.endsWith(".png") ? "image/png" : "text/markdown",
            buffer: Buffer.from(body),
          },
        },
      });
      expect(r.status(), await r.text()).toBe(201);
      return r.json();
    }
    async function details(item: { sourceId: string; versionId: string }) {
      const r = await clients.writer.get(
        `${base}/sources/${item.sourceId}?version=${item.versionId}`,
      );
      expect(r.status(), await r.text()).toBe(200);
      return r.json();
    }
    async function completed(item: { sourceId: string; versionId: string }) {
      await expect
        .poll(async () => (await details(item)).version.processing, {
          timeout: 40_000,
        })
        .toBe("completed");
      return details(item);
    }
    const bodyOf = (d: { chunks: { text: string }[] }) =>
      d.chunks.map((c) => c.text).join("\n");
    async function assets(version: string) {
      return (
        await pool.query(
          "SELECT id,sha256,caption FROM source_asset WHERE version_id=$1 ORDER BY name",
          [version],
        )
      ).rows;
    }
    const assetUrl = (id: string) => `${base}/source-assets/${id}`;
    async function action(version: string, action: string) {
      const r = await clients.reviewer.post(
        `${base}/source-versions/${version}/action`,
        { data: { action, note: "이미지 보존 검증" } },
      );
      expect(r.status(), await r.text()).toBe(200);
    }
    test.beforeAll(async () => {
      worker = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
        {
          env: {
            ...process.env,
            AI_VISION_MODEL: "test-vision",
            AI_VISION_API_KEY: "",
            AI_VISION_BASE_URL: "",
          },
          stdio: "pipe",
        },
      );
      let ready = "";
      worker.stdout?.on("data", (b) => {
        ready += b;
      });
      worker.stderr?.on("data", () => {});
      await expect
        .poll(() => ready, { timeout: 15_000 })
        .toContain("문서 처리 작업자가 준비되었습니다.");
    });
    test.afterAll(async () => {
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        const done = new Promise((r) => worker.once("exit", r));
        worker.kill("SIGTERM");
        await done;
      }
      await pool.end();
    });
    test("상대 경로·공백·Obsidian 이미지를 복사하고 본문·설명·경로별 근거를 함께 보존한다", async () => {
      const group = await collection();
      const first = await upload(
        group.id,
        "bundle/media/plot 1.png",
        await png("red"),
      );
      const second = await upload(
        group.id,
        "bundle/other/plot 1.png",
        await png("blue"),
      );
      await upload(group.id, "bundle/media/broken.png", "잘못된 이미지");
      const foreign = await collection({ label: "다른 폴더" });
      await upload(foreign.id, "bundle/media/private.png", await png("green"));
      const md =
        '# 연결 안내\n처리 기간은 72시간입니다.\n![첫 번째](../media/plot%201.png "그림")\n두 그림 사이 문장입니다.\n![[../other/plot 1.png|400]]\n마지막 원문 문장입니다.\n\n![누락](../media/missing.png)\n![오류](../media/broken.png)\n![다른 폴더](../media/private.png)\n![상위](../../../private.png)\n![외부](https://example.com/image.png)\n\n```md\n![코드 예시](../media/plot%201.png)\n```';
      const doc = await upload(group.id, "bundle/docs/guide.md", md);
      const duplicate = await upload(group.id, "bundle/docs/guide.md", md);
      expect(duplicate.versionId).toBe(doc.versionId);
      expect(duplicate.duplicate).toBe(true);
      const snapshot = (
        await pool.query(
          "SELECT folder_media FROM source_version WHERE id=$1",
          [doc.versionId],
        )
      ).rows[0].folder_media;
      expect(
        snapshot.find((s: { ref: string }) => s.ref === "../media/plot 1.png")
          .versionId,
      ).toBe(first.versionId);
      expect(
        snapshot.find((s: { ref: string }) => s.ref === "../other/plot 1.png")
          .versionId,
      ).toBe(second.versionId);
      expect(
        snapshot.find((s: { ref: string }) => s.ref === "../../../private.png")
          .path,
      ).toBeNull();
      expect(
        snapshot.find((s: { ref: string }) => s.ref === "../media/private.png")
          .versionId,
      ).toBeNull();
      const d = await completed(doc),
        body = bodyOf(d),
        rows = await assets(doc.versionId);
      expect(rows).toHaveLength(2);
      expect(rows[0].sha256).not.toBe(rows[1].sha256);
      for (const text of [
        "처리 기간은 72시간입니다.",
        "두 그림 사이 문장입니다.",
        "마지막 원문 문장입니다.",
        "이미지 설명",
        "72시간",
        "```md\n![코드 예시](../media/plot%201.png)\n```",
      ])
        expect(body).toContain(text);
      for (const row of rows) {
        expect(body).toContain(assetUrl(row.id));
        expect(row.caption).toContain("72시간");
        expect((await clients.reader.get(assetUrl(row.id))).status()).toBe(404);
        expect((await clients.outsider.get(assetUrl(row.id))).status()).toBe(
          404,
        );
        expect((await clients.writer.get(assetUrl(row.id))).status()).toBe(200);
      }
      expect(body).not.toContain("![[../other/");
      for (const name of ["missing.png", "broken.png", "private.png"])
        expect(d.version.warnings.join("\n")).toContain(name);
      expect(
        (
          await clients.writer.get(
            `${base}/source-versions/${doc.versionId}/file`,
          )
        ).status(),
      ).toBe(200);
    });
    test("이미지만 바뀌어도 문서 새 버전을 만들고 기존 문서 사본은 원본 이미지 변경·철회 뒤에도 보존한다", async () => {
      const group = await collection({ label: "이미지 변경 이력" });
      const original = await upload(
        group.id,
        "history/figure.png",
        await png("orange"),
      );
      const md =
        "# 고정 사본\n앞 문장을 보존합니다.\n![도표](figure.png)\n뒤 문장을 보존합니다.";
      const doc = await upload(group.id, "history/guide.md", md);
      await completed(doc);
      const oldAsset = (await assets(doc.versionId))[0];
      const oldBytes = await (
        await clients.writer.get(assetUrl(oldAsset.id))
      ).body();
      await action(doc.versionId, "approve");
      expect((await clients.reader.get(assetUrl(oldAsset.id))).status()).toBe(
        200,
      );
      const imageRevision = await upload(
        group.id,
        "history/figure.png",
        await png("purple"),
      );
      const revision = await upload(group.id, "history/guide.md", md);
      expect(revision.sourceId).toBe(doc.sourceId);
      expect(revision.versionId).not.toBe(doc.versionId);
      await completed(revision);
      const newAsset = (await assets(revision.versionId))[0];
      expect(newAsset.sha256).not.toBe(oldAsset.sha256);
      const records = (
        await pool.query(
          "SELECT sha256,folder_media FROM source_version WHERE id=ANY($1::uuid[])",
          [[doc.versionId, revision.versionId]],
        )
      ).rows;
      expect(records[0].sha256).toBe(records[1].sha256);
      expect(
        records.flatMap((r) =>
          r.folder_media.map((m: { versionId: string }) => m.versionId),
        ),
      ).toEqual(
        expect.arrayContaining([original.versionId, imageRevision.versionId]),
      );
      await action(imageRevision.versionId, "approve");
      await action(imageRevision.versionId, "withdraw");
      expect((await clients.reader.get(assetUrl(oldAsset.id))).status()).toBe(
        200,
      );
      expect(
        await (await clients.reader.get(assetUrl(oldAsset.id))).body(),
      ).toEqual(oldBytes);
      expect((await clients.reader.get(assetUrl(newAsset.id))).status()).toBe(
        404,
      );
      await action(doc.versionId, "withdraw");
      expect((await clients.reader.get(assetUrl(oldAsset.id))).status()).toBe(
        404,
      );
    });
    test("390px 폴더 업로드는 문서보다 이미지를 먼저 등록하고 본문 안에서 표시한다", async ({
      browser,
    }) => {
      const root = resolve(`.local/test-watch/${f.workspaceId}/browser-media`);
      await mkdir(join(root, "a"), { recursive: true });
      await mkdir(join(root, "z"), { recursive: true });
      await writeFile(
        join(root, "a/guide.md"),
        "# 브라우저 연결 이미지\n그림 앞에 남겨야 하는 문장입니다.\n![연결 이미지](../z/figure.png)\n그림 뒤에 남겨야 하는 문장입니다.",
      );
      await writeFile(join(root, "z/figure.png"), await png("pink"));
      const context = await browser.newContext({
        storageState: await clients.writer.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      try {
        await page.goto(
          `http://localhost:3101/w/${f.workspaceId}/sources/imports`,
        );
        await page.getByLabel("가져오기 이름").fill("브라우저 연결 이미지");
        await page.getByLabel("폴더 선택", { exact: true }).setInputFiles(root);
        await page.getByRole("button", { name: "파일 등록 시작" }).click();
        await expect(
          page.getByText("선택한 파일의 등록 결과를 확인해 주세요."),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "browser-media/z/figure.png" }),
        ).toBeVisible();
        const link = page.getByRole("link", {
          name: "browser-media/a/guide.md",
        });
        await expect(link).toBeVisible();
        const sourceId = (await link.getAttribute("href"))?.split("/").at(-1);
        const row = (
          await pool.query(
            "SELECT latest_version_id AS id FROM source WHERE id=$1",
            [sourceId],
          )
        ).rows[0];
        await completed({ sourceId: sourceId as string, versionId: row.id });
        await link.click();
        await expect(
          page
            .locator("p")
            .filter({ hasText: "그림 앞에 남겨야 하는 문장입니다." }),
        ).toBeVisible();
        const img = page.locator('img[src*="/source-assets/"]').first();
        await expect(img).toBeVisible();
        await expect
          .poll(() =>
            img.evaluate((element: HTMLImageElement) => element.naturalWidth),
          )
          .toBe(160);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: ".local/parity-folder-image-390.png",
          fullPage: true,
        });
      } finally {
        await context.close();
      }
    });
    test("자동 감지는 하위 폴더 이미지를 먼저 읽고 이미지 변경·누락만으로도 문서 버전을 갱신한다", async () => {
      test.setTimeout(100_000);
      const root = resolve(`.local/test-watch/${f.workspaceId}/watch-media`);
      await mkdir(join(root, "a"), { recursive: true });
      await mkdir(join(root, "z"), { recursive: true });
      await writeFile(
        join(root, "a/guide.md"),
        "# 감지 이미지\n![그림](../z/figure.png)\n본문은 바뀌지 않습니다.",
      );
      await writeFile(join(root, "z/figure.png"), await png("cyan"));
      const group = await collection({
        label: "이미지 감지",
        mode: "watch",
        rootKey: "fixture",
        enabled: true,
        intervalMinutes: 1,
        config: {
          excludeGlobs: (await readdir(resolve(root, "..")))
            .filter((name) => name !== "watch-media")
            .flatMap((name) => [name, `${name}/**`]),
        },
      });
      const records = async () =>
        (
          await pool.query(
            "SELECT f.relative_path,f.version_id,v.folder_media FROM source_import_file f JOIN source_version v ON v.id=f.version_id WHERE f.import_id=$1 ORDER BY f.relative_path",
            [group.id],
          )
        ).rows;
      try {
        await expect
          .poll(async () => (await records()).length, { timeout: 30_000 })
          .toBe(2);
        const first = (await records())[0];
        expect(first.folder_media[0].versionId).toBe(
          (await records())[1].version_id,
        );
        await expect
          .poll(
            async () =>
              (
                await pool.query(
                  "SELECT state FROM source_import WHERE id=$1",
                  [group.id],
                )
              ).rows[0].state,
          )
          .toBe("idle");
        await writeFile(join(root, "z/figure.png"), await png("yellow"));
        expect(
          (
            await clients.writer.post(
              `${base}/source-imports/${group.id}/action`,
              { data: { action: "scan" } },
            )
          ).status(),
        ).toBe(200);
        await expect
          .poll(async () => (await records())[0].version_id, {
            timeout: 30_000,
          })
          .not.toBe(first.version_id);
        const changed = (await records())[0];
        expect(changed.folder_media[0].sha256).not.toBe(
          first.folder_media[0].sha256,
        );
        await expect
          .poll(
            async () =>
              (
                await pool.query(
                  "SELECT state FROM source_import WHERE id=$1",
                  [group.id],
                )
              ).rows[0].state,
          )
          .toBe("idle");
        await rm(join(root, "z/figure.png"));
        expect(
          (
            await clients.writer.post(
              `${base}/source-imports/${group.id}/action`,
              { data: { action: "scan" } },
            )
          ).status(),
        ).toBe(200);
        await expect
          .poll(async () => (await records())[0].version_id, {
            timeout: 30_000,
          })
          .not.toBe(changed.version_id);
        expect((await records())[0].folder_media[0].versionId).toBeNull();
        expect((await records())[0].folder_media[0].sha256).toBeNull();
      } finally {
        await pool.query("UPDATE source_import SET enabled=false WHERE id=$1", [
          group.id,
        ]);
      }
    });
  });
}
