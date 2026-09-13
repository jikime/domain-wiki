import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  outsiderWorkspaceId: string;
  domainId: string;
  outsiderDomainId: string;
  accounts: { id: string; email: string; password: string; role: string }[];
};
export function registerPaginationTests(
  fixture: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("검색·목록 경계", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const origin = "http://localhost:3101";
    const base = `/api/workspaces/${fixture.workspaceId}`;
    const root = `/w/${fixture.workspaceId}`;
    const domains: string[] = [];
    const conversationIds: string[] = [];
    const author = fixture.accounts.find(
      (a: { role: string }) => a.role === "writer",
    )?.id;
    const owner = fixture.accounts.find(
      (a: { role: string }) => a.role === "reader",
    )?.id;
    if (!author || !owner) throw new Error("시험 계정이 없습니다.");
    test.describe.configure({ mode: "serial" });
    test.afterAll(async () => {
      for (const id of domains) {
        await pool.query("DELETE FROM wiki_page WHERE domain_id=$1", [id]);
        await pool.query("DELETE FROM source WHERE domain_id=$1", [id]);
        await pool.query("DELETE FROM domain WHERE id=$1", [id]);
      }
      await pool.query("DELETE FROM conversation WHERE id=ANY($1::uuid[])", [
        conversationIds,
      ]);
      await pool.end();
    });
    async function seedDomain(name: string) {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,$3,'누락 경계 점검')",
        [id, fixture.workspaceId, name],
      );
      domains.push(id);
      return id;
    }
    async function seedSource(
      domain: string,
      title: string,
      category = "guideline",
      old = false,
    ) {
      const id = randomUUID(),
        version = randomUUID(),
        chunk = randomUUID();
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7,1,now()-$8::interval)",
        [
          id,
          fixture.workspaceId,
          domain,
          title,
          category,
          author,
          version,
          old ? "1 day" : "0 seconds",
        ],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'audit.md','text/markdown',$4,$4,10,$5,'published','completed')",
        [version, fixture.workspaceId, id, randomUUID(), author],
      );
      await pool.query(
        "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,$4,$5)",
        [
          chunk,
          fixture.workspaceId,
          version,
          title,
          { kind: "lines", startLine: 1, endLine: 1 },
        ],
      );
      return { id, version, chunk };
    }
    test("101번째 대화를 서버에서 검색하고 본인 대화만 페이지로 조회한다", async ({
      browser,
    }) => {
      const scope = {
        domainId: fixture.domainId,
        projectId: null,
        sourceId: null,
        wikiId: null,
      };
      const inserted = await pool.query(
        "INSERT INTO conversation(workspace_id,owner_id,title,scope,updated_at) SELECT $1,$2,'경계 대화 '||i,$3,now()-i*interval '1 second' FROM generate_series(1,101) i RETURNING id",
        [fixture.workspaceId, owner, scope],
      );
      conversationIds.push(...inserted.rows.map((r) => r.id));
      const rows = await (
        await clients.reader.get(`${base}/conversations`)
      ).json();
      expect(rows).toHaveLength(100);
      expect(
        rows.some((r: { title: string }) => r.title === "경계 대화 101"),
      ).toBe(false);
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
      });
      try {
        const page = await context.newPage();
        await page.goto(`${origin}${root}/chat`);
        await page.getByLabel("최근 대화 검색").fill("경계 대화 101");
        await expect(
          page
            .getByRole("navigation", { name: "최근 대화 목록" })
            .getByText("경계 대화 101", { exact: true }),
        ).toBeVisible();
        const searched = await (
          await clients.reader.get(
            `${base}/conversations?page=1&q=${encodeURIComponent("경계 대화 101")}`,
          )
        ).json();
        expect(searched.total).toBe(1);
        expect(searched.items[0].title).toBe("경계 대화 101");
        const denied = await (
          await clients.writer.get(
            `${base}/conversations?page=1&q=${encodeURIComponent("경계 대화 101")}`,
          )
        ).json();
        expect(denied.total).toBe(0);
        const next = await (
          await clients.reader.get(`${base}/conversations?page=2&pageSize=100`)
        ).json();
        expect(
          next.items.some(
            (r: { title: string }) => r.title === "경계 대화 101",
          ),
        ).toBe(true);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: "내 대화 열기" }).click();
        await page
          .getByRole("dialog")
          .getByLabel("최근 대화 검색")
          .fill("경계 대화 101");
        await expect(
          page.getByRole("dialog").getByText("경계 대화 101", { exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      } finally {
        await context.close();
      }
    });
    test("새 원본 100건 뒤의 실무 기록도 API와 화면에서 찾고 전체 자료를 페이지로 조회한다", async ({
      browser,
    }) => {
      const domain = await seedDomain("실무 기록 경계");
      const record = await seedSource(
        domain,
        "기존 실무 기록",
        "testimony",
        true,
      );
      for (let i = 0; i < 100; i++) await seedSource(domain, `새 자료 ${i}`);
      const rows = await (await clients.reader.get(`${base}/records`)).json();
      expect(rows.some((r: { id: string }) => r.id === record.id)).toBe(true);
      expect(
        (await clients.reader.get(`${base}/sources/${record.id}`)).status(),
      ).toBe(200);
      const first = await (
        await clients.reader.get(
          `${base}/sources?page=1&pageSize=100&domainId=${domain}`,
        )
      ).json();
      const second = await (
        await clients.reader.get(
          `${base}/sources?page=2&pageSize=100&domainId=${domain}`,
        )
      ).json();
      expect(first.total).toBe(101);
      expect(second.items).toHaveLength(1);
      expect(second.items[0].id).toBe(record.id);
      expect(
        new Set(
          [...first.items, ...second.items].map((r: { id: string }) => r.id),
        ).size,
      ).toBe(101);
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
      });
      try {
        const page = await context.newPage();
        await page.goto(`${origin}${root}/records`);
        await expect(
          page.getByRole("link").filter({ hasText: "기존 실무 기록" }),
        ).toBeVisible();
      } finally {
        await context.close();
      }
    });
    test("위키 50건과 원문 1건을 함께 검색하고 유형 필터와 다음 페이지를 유지한다", async ({
      browser,
    }) => {
      const domain = await seedDomain("통합 검색 경계");
      const source = await seedSource(domain, "감사검색표본 원문");
      for (let i = 0; i < 50; i++) {
        const page = randomUUID(),
          version = randomUUID();
        await pool.query(
          "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,$5,1)",
          [page, fixture.workspaceId, domain, author, version],
        );
        await pool.query(
          "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,author_id,state) VALUES($1,$2,$3,1,$4,'감사검색표본 본문',$5,'approved')",
          [
            version,
            fixture.workspaceId,
            page,
            `감사검색표본 위키 ${i}`,
            author,
          ],
        );
        await pool.query(
          "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
          [fixture.workspaceId, version, source.chunk],
        );
      }
      const query = `q=${encodeURIComponent("감사검색표본")}&domainId=${domain}`;
      const all = await (
        await clients.reader.get(`${base}/search?${query}&kind=all`)
      ).json();
      const sources = await (
        await clients.reader.get(`${base}/search?${query}&kind=source`)
      ).json();
      expect(all).toHaveLength(50);
      expect(
        all.filter((r: { kind: string }) => r.kind === "source"),
      ).toHaveLength(1);
      expect(sources).toHaveLength(1);
      const first = await (
        await clients.reader.get(
          `${base}/search?${query}&kind=all&page=1&pageSize=50`,
        )
      ).json();
      const second = await (
        await clients.reader.get(
          `${base}/search?${query}&kind=all&page=2&pageSize=50`,
        )
      ).json();
      expect(first.total).toBe(51);
      expect(second.items).toHaveLength(1);
      expect(
        new Set(
          [...first.items, ...second.items].map(
            (r: { versionId: string }) => r.versionId,
          ),
        ).size,
      ).toBe(51);
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
      });
      try {
        const page = await context.newPage();
        await page.goto(`${origin}${root}/sources?${query}&kind=all`);
        await expect(
          page.getByRole("link").filter({ hasText: "감사검색표본 원문" }),
        ).toBeVisible();
        await page
          .getByRole("navigation", { name: "목록 페이지" })
          .getByRole("link", { name: "다음 →" })
          .click();
        await expect(page).toHaveURL(new RegExp(`domainId=${domain}`));
        await expect(page).toHaveURL(/page=2/);
        await page.getByRole("combobox", { name: "자료 유형" }).click();
        await page
          .getByRole("option", { name: "공개 원문", exact: true })
          .click();
        await page.getByRole("button", { name: "검색", exact: true }).click();
        await expect(
          page.getByRole("navigation", { name: "목록 페이지" }),
        ).toContainText("전체 1개");
        await expect(page).toHaveURL(/kind=source/);
        await page.setViewportSize({ width: 390, height: 844 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      } finally {
        await context.close();
      }
    });
    test("개정 이력 200개가 있어도 두 위키를 대표 버전으로 표시하고 권한을 유지한다", async ({
      browser,
    }) => {
      const domain = await seedDomain("위키 이력 경계");
      const oldPage = randomUUID(),
        oldVersion = randomUUID(),
        changedPage = randomUUID();
      await pool.query(
        "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,version_count) VALUES($1,$2,$3,$4,$5,1),($6,$2,$3,$4,null,200)",
        [oldPage, fixture.workspaceId, domain, author, oldVersion, changedPage],
      );
      await pool.query(
        "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,author_id,state,created_at) VALUES($1,$2,$3,1,'오래된 별도 페이지','기존 초안',$4,'draft',now()-interval '1 day')",
        [oldVersion, fixture.workspaceId, oldPage, author],
      );
      const versions = await pool.query(
        "INSERT INTO wiki_version(workspace_id,page_id,number,title,body,author_id,state,created_at) SELECT $1,$2,i,'자주 개정한 페이지','개정 초안',$3,'draft',now()+i*interval '1 millisecond' FROM generate_series(1,200) i RETURNING id,number",
        [fixture.workspaceId, changedPage, author],
      );
      await pool.query(
        "UPDATE wiki_page SET latest_version_id=$1 WHERE id=$2",
        [versions.rows.find((r) => r.number === 200).id, changedPage],
      );
      const listed = await (
        await clients.reviewer.get(`${base}/wiki?domainId=${domain}`)
      ).json();
      expect(listed).toHaveLength(2);
      expect(listed[0].pageId).toBe(changedPage);
      expect(
        (await clients.reviewer.get(`${base}/wiki/${oldPage}`)).status(),
      ).toBe(200);
      expect(listed[0].version.number).toBe(200);
      const first = await (
        await clients.reviewer.get(
          `${base}/wiki?page=1&pageSize=1&domainId=${domain}`,
        )
      ).json();
      const second = await (
        await clients.reviewer.get(
          `${base}/wiki?page=2&pageSize=1&domainId=${domain}`,
        )
      ).json();
      expect(first.total).toBe(2);
      expect(second.items[0].pageId).toBe(oldPage);
      const reader = await (
        await clients.reader.get(`${base}/wiki?page=1&domainId=${domain}`)
      ).json();
      expect(reader.total).toBe(0);
      const writer = await (
        await clients.writer.get(`${base}/wiki?page=1&domainId=${domain}`)
      ).json();
      expect(writer.total).toBe(2);
      const context = await browser.newContext({
        storageState: await clients.reviewer.storageState(),
      });
      try {
        const page = await context.newPage();
        await page.goto(`${origin}${root}/wiki?domainId=${domain}`);
        await expect(
          page.getByRole("link").filter({ hasText: "오래된 별도 페이지" }),
        ).toBeVisible();
        await expect(
          page.getByRole("link").filter({ hasText: "자주 개정한 페이지" }),
        ).toBeVisible();
      } finally {
        await context.close();
      }
    });

    test("잘못된 페이지와 다른 공간의 범위를 거절한다", async () => {
      for (const resource of [
        "sources",
        "wiki",
        "conversations",
        "search",
        "records",
      ]) {
        expect(
          (await clients.reader.get(`${base}/${resource}?page=0`)).status(),
        ).toBe(400);
        expect(
          (
            await clients.reader.get(
              `${base}/${resource}?page=1&pageSize=10000`,
            )
          ).status(),
        ).toBe(400);
      }
      expect(
        (
          await clients.reader.get(
            `${base}/search?page=1&domainId=${fixture.outsiderDomainId}`,
          )
        ).status(),
      ).toBe(404);
    });
  });
}
