import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:http";
import { type APIRequestContext, expect, test } from "@playwright/test";
import JSZip from "jszip";
import { Pool } from "pg";
import sharp from "sharp";
import { safeRelativePath } from "../src/lib/source-formats";
import { parseDocument } from "../src/server/parsers/document";
import { parseMineru } from "../src/server/parsers/mineru";

type Fixture = {
  workspaceId: string;
  outsiderWorkspaceId: string;
  domainId: string;
};
export function registerOriginalParserTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("원본 기능 복원 — 문서 추출과 이미지", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const base = `/api/workspaces/${f.workspaceId}`;
    let worker: ChildProcess | undefined;
    test.afterAll(async () => {
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        const done = new Promise((resolve) => worker?.once("exit", resolve));
        worker.kill("SIGTERM");
        await done;
      }
      await pool.end();
    });
    test("CSV·노트북·Org를 읽고 폴더 상대 경로의 상위 이동을 거부한다", async () => {
      const csv = await parseDocument(
        Buffer.from('구분,기간\n검수,72시간\n"예외, 장비",적용 안 함'),
        "text/csv",
      );
      expect(csv.chunks.map((c) => c.text).join("\n")).toContain("72시간");
      expect(csv.chunks.map((c) => c.locator.kind)).toContain("spreadsheet");
      const notebook = await parseDocument(
        Buffer.from(
          JSON.stringify({
            cells: [
              { cell_type: "markdown", source: ["# 정리\n", "관찰 내용"] },
              { cell_type: "code", source: ["print(72)"] },
            ],
          }),
        ),
        "application/x-ipynb+json",
      );
      expect(notebook.chunks.map((c) => c.text).join("\n")).toContain(
        "print(72)",
      );
      const org = await parseDocument(
        Buffer.from("* 운영\n[[https://example.com][참조]]"),
        "text/x-org",
      );
      expect(org.chunks[0].text).toContain("# 운영");
      expect(safeRelativePath("프로젝트/참고/문서.md")).toBe(
        "프로젝트/참고/문서.md",
      );
      for (const value of [
        "../private",
        "/etc/passwd",
        "C:\\private",
        "a/../../x",
        "a//b",
      ])
        expect(safeRelativePath(value)).toBeNull();
    });
    test("BMP·ICO 원본도 PNG 사본으로 변환해 화소와 크기를 보존한다", async () => {
      const bmp = Buffer.alloc(58);
      bmp.write("BM");
      bmp.writeUInt32LE(58, 2);
      bmp.writeUInt32LE(54, 10);
      bmp.writeUInt32LE(40, 14);
      bmp.writeInt32LE(1, 18);
      bmp.writeInt32LE(1, 22);
      bmp.writeUInt16LE(1, 26);
      bmp.writeUInt16LE(24, 28);
      bmp.writeUInt32LE(4, 34);
      bmp[56] = 255;
      const png = await sharp({
        create: {
          width: 16,
          height: 16,
          channels: 4,
          background: { r: 0, g: 0, b: 255, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      const header = Buffer.alloc(22);
      header.writeUInt16LE(1, 2);
      header.writeUInt16LE(1, 4);
      header[6] = 16;
      header[7] = 16;
      header.writeUInt16LE(1, 10);
      header.writeUInt16LE(32, 12);
      header.writeUInt32LE(png.length, 14);
      header.writeUInt32LE(22, 18);
      for (const sample of [
        { bytes: bmp, mime: "image/bmp", size: 1, pixel: [255, 0, 0] },
        {
          bytes: Buffer.concat([header, png]),
          mime: "image/x-icon",
          size: 16,
          pixel: [0, 0, 255],
        },
      ]) {
        const result = await parseDocument(sample.bytes, sample.mime);
        expect(result.images).toHaveLength(1);
        const image = result.images?.[0];
        expect(image?.width).toBe(sample.size);
        expect(image?.height).toBe(sample.size);
        expect(image?.mimeType).toBe("image/png");
        const raw = await sharp(Buffer.from(image?.base64 ?? "", "base64"))
          .removeAlpha()
          .raw()
          .toBuffer();
        expect([...raw.subarray(0, 3)]).toEqual(sample.pixel);
      }
    });
    test("XLSX의 시트·행·열과 EPUB 본문을 실제 파일 구조에서 추출한다", async () => {
      const zip = new JSZip();
      zip.file(
        "[Content_Types].xml",
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      );
      zip.file(
        "_rels/.rels",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      );
      zip.file(
        "xl/workbook.xml",
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="검수표" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      );
      zip.file(
        "xl/_rels/workbook.xml.rels",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      );
      zip.file(
        "xl/worksheets/sheet1.xml",
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>검수</t></is></c><c r="B1"><v>72</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>예외</t></is></c><c r="B3"><f>24*3</f><v>72</v></c></row></sheetData></worksheet>`,
      );
      const result = await parseDocument(
        await zip.generateAsync({ type: "uint8array" }),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(result.chunks[0]).toMatchObject({
        locator: { kind: "spreadsheet", sheet: "검수표", row: 1 },
      });
      expect(
        result.chunks.find(
          (c) => c.locator.kind === "spreadsheet" && c.locator.row === 3,
        )?.text,
      ).toContain("2열: 72");
      const epub = new JSZip();
      epub.file("mimetype", "application/epub+zip");
      epub.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      );
      epub.file(
        "OEBPS/content.opf",
        `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>검수 안내</dc:title><dc:identifier id="book">parity</dc:identifier><dc:language>ko</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
      );
      epub.file(
        "OEBPS/chapter.xhtml",
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>검수</title></head><body><h1>검수 안내</h1><p>기록은 72시간 보관합니다.</p></body></html>`,
      );
      const book = await parseDocument(
        await epub.generateAsync({ type: "uint8array" }),
        "application/epub+zip",
      );
      expect(book.chunks.map((c) => c.text).join("\n")).toContain("72시간");
    });
    test("원본 MinerU 작업 프로토콜로 표·수식·이미지를 처리하고 지정 서버만 호출한다", async () => {
      const png = await sharp({
        create: { width: 100, height: 80, channels: 3, background: "white" },
      })
        .png()
        .toBuffer();
      const requests: {
        url: string;
        auth: string | undefined;
        body: string;
      }[] = [];
      const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c);
        requests.push({
          url: req.url ?? "",
          auth: req.headers.authorization,
          body: Buffer.concat(chunks).toString(),
        });
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            req.url === "/health"
              ? { version: "3.0.0" }
              : req.url === "/tasks"
                ? {
                    task_id: "sample/1",
                    status_url: "http://untrusted.invalid/status",
                  }
                : req.url?.endsWith("/result")
                  ? {
                      results: {
                        source: {
                          md_content:
                            "# OCR 결과\n\n보관은 72시간입니다.\n\n<table><tr><th>구분</th><th>기간</th></tr><tr><td>검수</td><td>72시간</td></tr></table>\n\n$E=mc^2$\n\n![](fig.png)",
                          images: {
                            "fig.png": `data:image/png;base64,${png.toString("base64")}`,
                          },
                        },
                      },
                    }
                  : { status: "completed" },
          ),
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error();
        const result = await parseMineru(Buffer.from("%PDF-1.7\nfixture"), {
          enabled: true,
          backend: "local",
          localEndpoint: `http://127.0.0.1:${address.port}`,
          localToken: "fixture-token",
          localLanguage: "korean",
          localBackend: "hybrid-engine",
          token: "",
          modelVersion: "pipeline",
        });
        expect(result.chunks.map((c) => c.text).join("\n")).toContain("72시간");
        expect(result.chunks.map((c) => c.text).join("\n")).toContain(
          "asset://image-1",
        );
        expect(result.images?.[0]).toMatchObject({
          mimeType: "image/png",
          width: 100,
          height: 80,
        });
        expect(requests.map((r) => r.url)).toEqual([
          "/health",
          "/tasks",
          "/tasks/sample%2F1",
          "/tasks/sample%2F1/result",
        ]);
        expect(requests.every((r) => r.auth === "Bearer fixture-token")).toBe(
          true,
        );
        expect(requests[1].body).toContain("%PDF-1.7");
        expect(requests[1].body).toContain("korean");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
    test("이미지 설명을 검색하고 중복 설명을 재사용하며 승인·철회에 따라 이미지 접근을 바꾼다", async ({
      page,
    }) => {
      test.setTimeout(60_000);
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
          stdio: ["ignore", "pipe", "pipe"],
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
      const image = await sharp(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="150"><rect width="500" height="150" fill="white"/><text x="30" y="80" font-size="42">72 hours</text></svg>',
        ),
      )
        .png()
        .toBuffer();
      const uploaded: { sourceId: string; versionId: string }[] = [];
      for (const title of ["이미지 원문", "동일 이미지 사본"]) {
        const r = await clients.writer.post(`${base}/sources`, {
          multipart: {
            title,
            domainId: f.domainId,
            projectId: "",
            category: "reference",
            relativePath: `자료/${title}.png`,
            file: { name: "figure.png", mimeType: "image/png", buffer: image },
          },
        });
        expect(r.status(), await r.text()).toBe(201);
        uploaded.push(await r.json());
      }
      for (const s of uploaded)
        await expect
          .poll(
            async () => {
              const d = await (
                await clients.writer.get(`${base}/sources/${s.sourceId}`)
              ).json();
              return d.version.processing;
            },
            { timeout: 30_000 },
          )
          .toBe("completed");
      const info = await (
        await clients.writer.get(`${base}/sources/${uploaded[0].sourceId}`)
      ).json();
      expect(
        info.chunks.map((c: { text: string }) => c.text).join("\n"),
      ).toContain("72시간");
      const asset = info.chunks
        .map((c: { text: string }) => c.text)
        .join("\n")
        .match(/\/api\/workspaces\/[^)\s]+\/source-assets\/[a-f0-9-]+/)?.[0];
      expect(asset).toBeTruthy();
      expect((await clients.reader.get(asset)).status()).toBe(404);
      expect((await clients.outsider.get(asset)).status()).toBe(404);
      expect((await clients.writer.get(asset)).headers()["content-type"]).toBe(
        "image/png",
      );
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) AS count FROM generation WHERE workspace_id=$1 AND kind='image-caption'",
              [f.workspaceId],
            )
          ).rows[0].count,
        ),
      ).toBe(1);
      expect(
        (
          await clients.reviewer.post(
            `${base}/source-versions/${uploaded[0].versionId}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(200);
      expect((await clients.reader.get(asset)).status()).toBe(200);
      const hits = await (
        await clients.reader.get(
          `${base}/search?q=${encodeURIComponent("72시간")}&kind=source&domainId=${f.domainId}`,
        )
      ).json();
      expect(
        hits.some((h: { id: string }) => h.id === uploaded[0].sourceId),
      ).toBe(true);
      await page
        .context()
        .addCookies((await clients.reader.storageState()).cookies);
      await page.goto(`/w/${f.workspaceId}/sources/${uploaded[0].sourceId}`);
      await page.locator(".markdown-image-button").click();
      await expect(page.getByRole("dialog").locator("img")).toBeVisible();
      await page.keyboard.press("Escape");
      expect(
        (
          await clients.reviewer.post(
            `${base}/source-versions/${uploaded[0].versionId}/action`,
            { data: { action: "withdraw", note: "이미지 철회 표본" } },
          )
        ).status(),
      ).toBe(200);
      expect((await clients.reader.get(asset)).status()).toBe(404);
      expect((await clients.writer.get(asset)).status()).toBe(200);
    });
  });
}
