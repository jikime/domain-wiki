import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import JSZip from "jszip";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  domainId: string;
  outsiderDomainId: string;
  accounts: { id: string; role: string }[];
};
export function registerOriginalArchiveTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("원본 기능 복원 — 프로젝트 ZIP", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      base = `/api/workspaces/${f.workspaceId}`;
    let imported: { domainId: string },
      wikiId: string,
      versionId: string,
      publishedVersion: string,
      sourceVersion: string,
      imageUrl: string;
    let worker: ChildProcess | undefined;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=",
      "base64",
    );
    const body =
      "---\ntype: finding\ntitle: 원본 관제 정리\naliases: [관제]\nsources: [raw/team/guide.md]\n---\n\n# 관제 기준\n\n문서는 72시간 보관합니다. [[concepts/backup|복구 기준]]\n\n[복구 문서](../concepts/backup.md)\n\n![검증 그림](../media/chart.png)\n\n```mermaid\ngraph LR\n A-->B\n```\n\n$E=mc^2$\n";
    const originals: Record<string, string | Buffer> = {
      "wiki/index.md": "# Native index\n\n- [[findings/control]]\n",
      "wiki/overview.md":
        "# 직접 작성한 개요\n\n관제 프로젝트의 흐름을 설명합니다.\n",
      "wiki/log.md":
        "# Wiki Log\n\n## [2026-07-20] ingest | raw/team/guide.md\n",
      "purpose.md": "# 목적\n\n기간과 복구 기준을 정리합니다.\n",
      "schema.md":
        "# Wiki Schema\n\n## Page Types\n\n| Type | Directory | Description |\n| --- | --- | --- |\n| finding | findings/ | 발견 |\n",
      "wiki/findings/control.md": body,
      "wiki/concepts/backup.md":
        "---\ntype: concept\ntitle: 복구 기준\n---\n\n# 복구 기준\n복구 순서를 점검합니다.\n",
      "wiki/media/chart.png": png,
      "raw/team/guide.md":
        "관제 문서는 72시간 보관합니다. 복구 순서는 별도 기준을 따릅니다.",
      "raw/other/guide.md": "별도 부서의 안내 문서입니다.",
      ".llm-wiki/ingest-cache.json": '{"preserve":true}',
      ".llm-wiki/skills/example.sh": "#!/bin/sh\nexit 91\n",
      "attachments/opaque.bin": Buffer.from([0, 1, 2, 255]),
    };
    async function zipBytes(values = originals) {
      const zip = new JSZip();
      for (const [path, value] of Object.entries(values)) zip.file(path, value);
      zip.folder("empty-preserved");
      return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    }
    async function sendZip(
      bytes: Buffer,
      name = `가져온 프로젝트 ${randomUUID()}`,
    ) {
      return clients.admin.post(
        `${base}/archives?name=${encodeURIComponent(name)}`,
        { headers: { "Content-Type": "application/zip" }, data: bytes },
      );
    }
    test.afterAll(async () => {
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        const done = new Promise((resolve) => worker?.once("exit", resolve));
        worker.kill("SIGTERM");
        await done;
      }
      await pool.end();
    });
    test("원본 구조·숨김 상태·그림을 보존하고 원문 대기·위키 초안으로 원자적으로 가져온다", async () => {
      const response = await sendZip(await zipBytes(), "원본 프로젝트 복원");
      expect(response.status(), await response.text()).toBe(201);
      imported = await response.json();
      const result = await response.json();
      expect(result).toMatchObject({
        files: 13,
        wikiPages: 2,
        sources: 2,
        warnings: [],
      });
      const pages = await pool.query(
        "SELECT p.id,v.id AS version_id,v.state,v.body,v.metadata FROM wiki_page p JOIN wiki_version v ON v.id=p.latest_version_id WHERE p.domain_id=$1 ORDER BY v.title",
        [imported.domainId],
      );
      expect(pages.rows.every((p) => p.state === "draft")).toBe(true);
      const target = pages.rows.find(
        (p) => p.metadata.path === "wiki/findings/control.md",
      );
      expect(target.body).toBe(body);
      wikiId = target.id;
      versionId = target.version_id;
      const detail = await (
        await clients.admin.get(`${base}/wiki/${wikiId}`)
      ).json();
      expect(detail.linkDestinations["../concepts/backup.md"]).toMatch(
        /\/wiki\//,
      );
      imageUrl = detail.linkDestinations["../media/chart.png"];
      const image = await clients.admin.get(imageUrl);
      expect(image.status()).toBe(200);
      expect(await image.body()).toEqual(png);
      expect((await clients.reader.get(imageUrl)).status()).toBe(404);
      expect(
        (
          await clients.outsider.get(
            `${base}/archives?domainId=${imported.domainId}`,
          )
        ).status(),
      ).toBe(404);
      const zip = await JSZip.loadAsync(
        await (
          await clients.admin.get(
            `${base}/archives?domainId=${imported.domainId}&drafts=1`,
          )
        ).body(),
      );
      expect(zip.files["empty-preserved/"].dir).toBe(true);
      for (const path of [
        ".llm-wiki/ingest-cache.json",
        ".llm-wiki/skills/example.sh",
        "attachments/opaque.bin",
        "raw/team/guide.md",
        "raw/other/guide.md",
        "wiki/media/chart.png",
        "purpose.md",
        "schema.md",
        "wiki/overview.md",
        "wiki/findings/control.md",
      ])
        expect(await zip.file(path)?.async("nodebuffer")).toEqual(
          Buffer.from(originals[path]),
        );
      expect(await zip.file("wiki/index.md")?.async("string")).toContain(
        "[[findings/control|원본 관제 정리]]",
      );
      expect(
        await zip.file(".domain-wiki/imported/wiki/index.md")?.async("string"),
      ).toBe(originals["wiki/index.md"]);
      const readerZip = await JSZip.loadAsync(
        await (
          await clients.reader.get(
            `${base}/archives?domainId=${imported.domainId}`,
          )
        ).body(),
      );
      expect(readerZip.file("wiki/findings/control.md")).toBeNull();
      expect(readerZip.file(".llm-wiki/ingest-cache.json")).toBeNull();
      expect(
        (
          await clients.reader.get(
            `${base}/archives?domainId=${imported.domainId}&drafts=1`,
          )
        ).status(),
      ).toBe(403);
      const roundtrip = await sendZip(
        await zip.generateAsync({ type: "nodebuffer" }),
      );
      expect(roundtrip.status(), await roundtrip.text()).toBe(201);
      expect((await roundtrip.json()).sources).toBe(2);
    });
    test("가져온 원문 처리·근거 연결·동료 승인 후 공개하고 철회 시 목차·첨부 접근을 함께 닫는다", async () => {
      worker = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
        { env: process.env, stdio: "ignore" },
      );
      const sourceRows = await pool.query(
        "SELECT s.id,v.id AS version_id FROM source s JOIN source_version v ON v.id=s.latest_version_id WHERE s.domain_id=$1 AND v.relative_path='team/guide.md'",
        [imported.domainId],
      );
      sourceVersion = sourceRows.rows[0].version_id;
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT processing FROM source_version WHERE id=$1",
                [sourceVersion],
              )
            ).rows[0].processing,
          { timeout: 30_000 },
        )
        .toBe("completed");
      expect(
        (
          await clients.reviewer.post(
            `${base}/source-versions/${sourceVersion}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(200);
      const chunks = await pool.query(
        "SELECT id FROM source_chunk WHERE version_id=$1 ORDER BY ordinal",
        [sourceVersion],
      );
      const save = await clients.admin.post(`${base}/wiki/${wikiId}`, {
        data: {
          domainId: imported.domainId,
          projectId: null,
          title: "원본 관제 정리",
          body,
          parentVersionId: versionId,
          basePublishedVersionId: null,
          chunkIds: [chunks.rows[0].id],
        },
      });
      expect(save.status(), await save.text()).toBe(201);
      publishedVersion = (await save.json()).versionId;
      expect(
        (
          await clients.admin.post(
            `${base}/wiki-versions/${publishedVersion}/action`,
            { data: { action: "submit" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await clients.reviewer.post(
            `${base}/wiki-versions/${publishedVersion}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(200);
      const detail = await (
        await clients.reader.get(`${base}/wiki/${wikiId}`)
      ).json();
      imageUrl = detail.linkDestinations["../media/chart.png"];
      expect((await clients.reader.get(imageUrl)).status()).toBe(200);
      await pool.query(
        "INSERT INTO ingest_run(workspace_id,source_id,source_version_id,domain_id,author_id,origin,basis_hash,rules_hash,knowledge_stamp,state) VALUES($1,$2,$3,$4,$5,'manual','archive-fixture','archive-fixture','{\"wikis\":[],\"sources\":[]}','completed')",
        [
          f.workspaceId,
          sourceRows.rows[0].id,
          sourceVersion,
          imported.domainId,
          f.accounts.find((a) => a.role === "admin")?.id,
        ],
      );
      const catalog = await (
        await clients.reader.get(`${base}/project-catalog/${imported.domainId}`)
      ).json();
      expect(catalog.count).toBe(1);
      expect(catalog.index).toContain("원본 관제 정리");
      expect(catalog.index).not.toContain("복구 기준");
      expect(catalog.log).toContain("ingest | raw/team/guide.md");
      const published = await JSZip.loadAsync(
        await (
          await clients.reader.get(
            `${base}/archives?domainId=${imported.domainId}`,
          )
        ).body(),
      );
      expect(
        await published.file("wiki/media/chart.png")?.async("nodebuffer"),
      ).toEqual(png);
      expect(published.file(".llm-wiki/ingest-cache.json")).toBeNull();
      expect(
        (
          await clients.reviewer.post(
            `${base}/source-versions/${sourceVersion}/action`,
            { data: { action: "withdraw", note: "철회 후 파일 접근 확인" } },
          )
        ).status(),
      ).toBe(200);
      expect((await clients.reader.get(imageUrl)).status()).toBe(404);
      const removed = await (
        await clients.reader.get(`${base}/project-catalog/${imported.domainId}`)
      ).json();
      expect(removed.count).toBe(0);
      expect(removed.index).not.toContain("원본 관제 정리");
      expect(removed.log).not.toContain("raw/team/guide.md");
    });
    test("경로 이동·심볼릭 링크·손상·누락·중복과 잘못된 권한을 거부하고 기존 도메인을 유지한다", async () => {
      const count = async () =>
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM domain WHERE workspace_id=$1",
            [f.workspaceId],
          )
        ).rows[0].n;
      const before = await count();
      const traversal = new JSZip();
      traversal.file("wiki/index.md", "# index");
      traversal.file("../secret.md", "위험 경로");
      expect(
        (
          await sendZip(await traversal.generateAsync({ type: "nodebuffer" }))
        ).status(),
      ).toBe(400);
      const symbolic = new JSZip();
      const duplicated = await zipBytes({
        "wiki/index.md": "# Index",
        "wiki/a.md": "a",
        "wiki/b.md": "b",
      });
      for (
        let at = duplicated.indexOf("wiki/b.md");
        at >= 0;
        at = duplicated.indexOf("wiki/b.md", at + 1)
      )
        duplicated.write("wiki/a.md", at);
      expect((await sendZip(duplicated)).status()).toBe(400);
      symbolic.file("wiki/index.md", "# index");
      symbolic.file("hidden", "/etc/passwd", { unixPermissions: 0o120777 });
      expect(
        (
          await sendZip(
            await symbolic.generateAsync({
              type: "nodebuffer",
              platform: "UNIX",
            }),
          )
        ).status(),
      ).toBe(400);
      expect(
        (
          await sendZip(await zipBytes({ "wiki/other.md": "목차 없음" }))
        ).status(),
      ).toBe(400);
      const corrupt = await zipBytes({ "wiki/index.md": "CRC-CHECK-ORIGINAL" });
      // Corrupt both central and local CRC fields while leaving the compressed data valid.
      for (let i = 0; i < corrupt.length - 46; i++) {
        if (corrupt.readUInt32LE(i) === 0x02014b50)
          corrupt.writeUInt32LE(1, i + 16);
        if (corrupt.readUInt32LE(i) === 0x04034b50)
          corrupt.writeUInt32LE(1, i + 14);
      }
      expect((await sendZip(corrupt)).status()).toBe(400);
      const duplicate = await sendZip(await zipBytes(), "원본 프로젝트 복원");
      expect(duplicate.status()).toBe(409);
      expect(await count()).toBe(before);
      for (const role of ["reader", "writer", "reviewer"])
        expect(
          (
            await clients[role].post(`${base}/archives?name=권한시험`, {
              headers: { "Content-Type": "application/zip" },
              data: await zipBytes(),
            })
          ).status(),
        ).toBe(403);
    });
    test("390px에서 프로젝트 문서·ZIP 폼과 가져온 문서의 그림을 실제로 표시한다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.admin.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      try {
        await page.goto(
          `http://localhost:3101/w/${f.workspaceId}/wiki/project?domainId=${imported.domainId}&document=overview`,
        );
        await expect(
          page.getByRole("heading", { name: "직접 작성한 개요", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByLabel("프로젝트 ZIP 파일", { exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: ".local/parity-archive-390.png",
          fullPage: true,
        });
        await page
          .getByLabel("새 도메인 이름", { exact: true })
          .fill("브라우저 ZIP 복원");
        await page
          .getByLabel("프로젝트 ZIP 파일", { exact: true })
          .setInputFiles({
            name: "native-project.zip",
            mimeType: "application/zip",
            buffer: await zipBytes(),
          });
        await page
          .getByRole("button", { name: "새 도메인으로 가져오기", exact: true })
          .click();
        await expect(
          page.getByRole("link", {
            name: "브라우저 ZIP 복원의 위키 확인 →",
            exact: true,
          }),
        ).toBeVisible();
        await page.goto(
          `http://localhost:3101/w/${f.workspaceId}/wiki/${wikiId}?version=${versionId}`,
        );
        const img = page.getByRole("img", { name: "검증 그림" });
        await expect(img).toBeVisible();
        await expect
          .poll(() =>
            img.evaluate(
              (node: HTMLImageElement) =>
                node.complete && node.naturalWidth > 0,
            ),
          )
          .toBe(true);
        await page
          .getByRole("link", { name: "복구 문서", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "복구 기준", exact: true }).first(),
        ).toBeVisible();
      } finally {
        await context.close();
      }
    });
  });
}
