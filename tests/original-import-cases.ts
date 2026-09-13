import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  domainId: string;
  outsiderDomainId: string;
  accounts: { id: string; role: string }[];
};
export function registerOriginalImportTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("원본 기능 복원 — 폴더 가져오기", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      base = `/api/workspaces/${f.workspaceId}`;
    let worker: ChildProcess | undefined;
    test.afterAll(async () => {
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        const done = new Promise((r) => worker?.once("exit", r));
        worker.kill("SIGTERM");
        await done;
      }
      await pool.end();
    });
    const input = {
      label: "운영팀 자료",
      mode: "upload",
      domainId: f.domainId,
      projectId: null,
      category: "reference",
      config: { includeExtensions: [] },
    };
    async function upload(importId: string, path: string, body: string) {
      const res = await clients.writer.post(`${base}/sources`, {
        multipart: {
          importId,
          relativePath: path,
          title:
            path
              .split("/")
              .at(-1)
              ?.replace(/\.[^.]+$/, "") ?? "자료",
          domainId: f.domainId,
          projectId: "",
          category: "reference",
          file: {
            name: path.split("/").at(-1) ?? "자료.md",
            mimeType: "text/markdown",
            buffer: Buffer.from(body),
          },
        },
      });
      expect(res.status()).toBe(201);
      return res.json();
    }
    test("같은 이름·내용의 하위 폴더를 구분하고 변경·원상 복원을 같은 자료의 버전으로 보존한다", async () => {
      const res = await clients.writer.post(`${base}/source-imports`, {
        data: input,
      });
      expect(res.status()).toBe(201);
      const collection = await res.json();
      const [one, repeat] = await Promise.all([
        upload(collection.id, "A/guide.md", "원래 내용입니다."),
        upload(collection.id, "A/guide.md", "원래 내용입니다."),
      ]);
      expect(one.sourceId).toBe(repeat.sourceId);
      expect(one.versionId).toBe(repeat.versionId);
      const two = await upload(collection.id, "B/guide.md", "원래 내용입니다.");
      expect(two.sourceId).not.toBe(one.sourceId);
      const changed = await upload(
        collection.id,
        "A/guide.md",
        "기간을 72시간으로 바꿉니다.",
      );
      expect(changed.sourceId).toBe(one.sourceId);
      expect(changed.versionId).not.toBe(one.versionId);
      const reverted = await upload(
        collection.id,
        "A/guide.md",
        "원래 내용입니다.",
      );
      expect(reverted.sourceId).toBe(one.sourceId);
      expect(reverted.versionId).not.toBe(one.versionId);
      const versions = await pool.query(
        "SELECT number,relative_path FROM source_version WHERE source_id=$1 ORDER BY number",
        [one.sourceId],
      );
      expect(versions.rows).toEqual(
        [1, 2, 3].map((number) => ({ number, relative_path: "A/guide.md" })),
      );
      expect(
        (await clients.reader.get(`${base}/source-imports`)).status(),
      ).toBe(403);
      expect(
        (
          await clients.outsider.get(`${base}/source-imports/${collection.id}`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.writer.post(`${base}/source-imports`, {
            data: { ...input, domainId: f.outsiderDomainId },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.writer.post(`${base}/sources`, {
            multipart: {
              importId: collection.id,
              relativePath: "../secret.md",
              title: "자료",
              domainId: f.domainId,
              projectId: "",
              category: "reference",
              file: {
                name: "secret.md",
                mimeType: "text/markdown",
                buffer: Buffer.from("상위 이동 금지"),
              },
            },
          })
        ).status(),
      ).toBe(400);
    });
    test("웹 주소별 원본·이동 주소를 보관하고 공개 검토와 내부망 차단을 적용한다", async () => {
      const saved = await clients.writer.post(`${base}/source-imports`, {
        data: { ...input, label: "URL 수집" },
      });
      expect(saved.status()).toBe(201);
      const collection = await saved.json();
      const collect = () =>
        clients.writer.post(`${base}/web-imports`, {
          data: {
            importId: collection.id,
            url: "https://official.example.test/redirect-ok",
          },
        });
      const response = await collect();
      expect(response.status()).toBe(201);
      const result = await response.json();
      expect(result.url).toBe("https://official.example.test/notice");
      expect(result.title).toBe("가상 기관 관제 기준");
      expect((await (await collect()).json()).versionId).toBe(result.versionId);
      const detail = await (
        await clients.writer.get(`${base}/sources/${result.sourceId}`)
      ).json();
      expect(detail.version.originUrl).toBe(result.url);
      expect(detail.version.publication).toBe("pending");
      expect(
        (
          await clients.reader.get(`${base}/sources/${result.sourceId}`)
        ).status(),
      ).toBe(404);
      for (const url of [
        "https://private.example.test/secret",
        "http://127.0.0.1/private",
        "file:///etc/passwd",
        "https://user:secret@example.org/",
      ]) {
        const blocked = await clients.writer.post(`${base}/web-imports`, {
          data: { importId: collection.id, url },
        });
        expect([400, 403]).toContain(blocked.status());
      }
      expect(
        (
          await clients.reader.post(`${base}/web-imports`, {
            data: {
              importId: collection.id,
              url: "https://official.example.test/notice",
            },
          })
        ).status(),
      ).toBe(403);
    });
    test("서버 폴더를 정기 감지하고 이동·삭제를 구분하며 담당자 권한 철회 후에는 등록을 중단한다", async () => {
      const root = resolve(`.local/test-watch/${f.workspaceId}`);
      await mkdir(join(root, "team"), { recursive: true });
      await mkdir(join(root, ".git"));
      await writeFile(join(root, "team/a.md"), "운영 지침 최초 내용");
      await writeFile(join(root, ".git/hidden.md"), "제외 폴더");
      await writeFile(join(root, "draft-temp.md"), "제외 패턴");
      const outside = join(root, "../outside.md");
      await writeFile(outside, "외부 파일");
      await symlink(outside, join(root, "outside-link.md"));
      let collection: { id: string } | undefined;
      try {
        const roots = await (
          await clients.writer.get(`${base}/source-imports`)
        ).json();
        expect(roots.roots).toEqual([
          { key: "fixture", label: "시험 공유 폴더" },
        ]);
        const res = await clients.writer.post(`${base}/source-imports`, {
          data: {
            ...input,
            label: "공유 폴더",
            mode: "watch",
            rootKey: "fixture",
            enabled: true,
            intervalMinutes: 1,
          },
        });
        expect(res.status()).toBe(201);
        collection = await res.json();
        if (!collection) throw new Error("가져오기 설정 없음");
        const id = collection.id;
        worker = spawn(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            "tsx",
            "src/worker/index.ts",
          ],
          { env: process.env, stdio: "pipe" },
        );
        const files = async () => {
          const response = await clients.writer.get(
            `${base}/source-imports/${id}`,
          );
          expect(response.status()).toBe(200);
          return (await response.json()).files as {
            sourceId: string;
            versionId: string;
            relativePath: string;
            missing: boolean;
          }[];
        };
        await expect
          .poll(async () => (await files()).length, { timeout: 25_000 })
          .toBe(1);
        const first = (await files())[0];
        expect(first.relativePath).toBe("team/a.md");
        await writeFile(join(root, "team/a.md"), "운영 지침 수정 내용 72시간");
        await clients.writer.post(`${base}/source-imports/${id}/action`, {
          data: { action: "scan" },
        });
        await expect
          .poll(async () => (await files())[0]?.versionId, { timeout: 20_000 })
          .not.toBe(first.versionId);
        const revision = (await files())[0];
        expect(revision.sourceId).toBe(first.sourceId);
        await rename(join(root, "team/a.md"), join(root, "team/moved.md"));
        await clients.writer.post(`${base}/source-imports/${id}/action`, {
          data: { action: "scan" },
        });
        await expect
          .poll(async () => (await files())[0]?.relativePath, {
            timeout: 20_000,
          })
          .toBe("team/moved.md");
        expect((await files())[0].sourceId).toBe(first.sourceId);
        expect((await files()).length).toBe(1);
        await rm(join(root, "team/moved.md"));
        await clients.writer.post(`${base}/source-imports/${id}/action`, {
          data: { action: "scan" },
        });
        await expect
          .poll(async () => (await files())[0]?.missing, { timeout: 20_000 })
          .toBe(true);
        expect(
          (
            await clients.writer.get(`${base}/sources/${first.sourceId}`)
          ).status(),
        ).toBe(200);
        await pool.query(
          "UPDATE membership SET role='reader' WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, f.accounts.find((a) => a.role === "writer")?.id],
        );
        await writeFile(join(root, "new.md"), "권한 철회 후 새 자료");
        await pool.query(
          "UPDATE source_import SET next_scan_at=now() WHERE id=$1",
          [id],
        );
        await expect
          .poll(
            async () =>
              (
                await pool.query(
                  "SELECT state FROM source_import WHERE id=$1",
                  [id],
                )
              ).rows[0].state,
            { timeout: 20_000 },
          )
          .toBe("failed");
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM source_import_file WHERE import_id=$1",
              [id],
            )
          ).rows[0].n,
        ).toBe(1);
      } finally {
        await pool.query(
          "UPDATE membership SET role='writer' WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, f.accounts.find((a) => a.role === "writer")?.id],
        );
        if (collection)
          await pool.query(
            "UPDATE source_import SET enabled=false WHERE id=$1",
            [collection.id],
          );
        await rm(outside, { force: true });
      }
    });
    test("390px에서 실제 폴더를 등록하고 경로별 결과를 다시 연다", async ({
      browser,
    }) => {
      const root = resolve(`.local/test-watch/${f.workspaceId}/browser`);
      await mkdir(join(root, "nested"), { recursive: true });
      await writeFile(join(root, "nested/guide.md"), "브라우저 폴더 등록 지침");
      const context = await browser.newContext({
        storageState: await clients.writer.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      try {
        await page.goto(
          `http://localhost:3101/w/${f.workspaceId}/sources/imports`,
        );
        await page.getByLabel("가져오기 이름").fill("브라우저 폴더 시험");
        await page.getByLabel("폴더 선택", { exact: true }).setInputFiles(root);
        await page.getByRole("button", { name: "파일 등록 시작" }).click();
        await expect(
          page.getByText("선택한 파일의 등록 결과를 확인해 주세요."),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "browser/nested/guide.md" }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
        await page
          .getByRole("heading", { name: "파일·폴더 가져오기", exact: true })
          .click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: ".local/parity-import-390.png",
          fullPage: true,
        });
        await page
          .getByRole("link", { name: "browser/nested/guide.md" })
          .click();
        await expect(
          page.getByRole("heading", { name: "guide", exact: true }),
        ).toBeVisible();
      } finally {
        await context.close();
      }
    });
  });
}
