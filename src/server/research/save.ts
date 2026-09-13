import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  addResearchTaskDiscriminator,
  buildResearchPageContent,
  makeDeepResearchFileName,
} from "@/lib/reference/deep-research";
import { metadataFromMarkdown } from "@/lib/wiki-links";
import { emptyWikiMetadata } from "@/lib/wiki-metadata";
import { getPool } from "@/server/db";
import { AccessError } from "@/server/errors";
import { checkEvidence } from "@/server/services/wiki";
import { publishedWikiReferences } from "@/server/services/wiki-references";
import { originals } from "@/server/storage/originals";
import {
  checkResearchCurrent,
  type ResearchRecord,
  researchAuthor,
  researchContext,
  researchScope,
} from "./context";

const linkLabel = (value: string) => value.replace(/[\\[\]\n\r]/g, " ").trim();
export async function saveResearchDraft(run: ResearchRecord, cited: number[]) {
  const refs = cited.map((index) => ({
    index,
    reference: run.references[index - 1],
  }));
  const web = refs.filter((r) => !r.reference.citation);
  const sourceId = randomUUID(),
    sourceVersionId = randomUUID();
  const storageKey = `${run.workspace_id}/${sourceVersionId}`;
  let bundle = `# 조사 검색 발췌: ${run.input.topic}\n\n수집 시각: ${new Date().toISOString()}\n\n이 자료는 검색 제공자가 반환한 발췌문입니다. 웹 문서 전문과 다를 수 있으며, 조사 본문과 별도로 검토합니다.\n`;
  const chunks = web.map(({ index, reference }) => {
    const text = `[${index}] ${reference.title}\n주소: ${reference.url}\n제공 출처: ${reference.source}\n\n${reference.snippet}`;
    const startLine = bundle.split("\n").length + 1;
    bundle += `\n${text}\n`;
    return {
      id: randomUUID(),
      text,
      locator: {
        kind: "lines" as const,
        heading: reference.title.slice(0, 500),
        startLine,
        endLine: startLine + text.split("\n").length - 1,
      },
    };
  });
  const { fileName, date } = makeDeepResearchFileName(run.input.topic);
  const path = `wiki/queries/${addResearchTaskDiscriminator(fileName, run.id)}`;
  const body = buildResearchPageContent(
    run.input.topic,
    date,
    run.synthesis,
    refs
      .map(
        ({ index, reference }) =>
          `${index}. [${linkLabel(reference.title)}](<${reference.url}>) — ${reference.source}`,
      )
      .join("\n"),
  );
  if (body.length > 40000)
    throw new AccessError(
      413,
      "조사 결과가 편집 가능한 40,000자를 넘었습니다. 주제나 검색어를 좁혀 주세요.",
    );
  const pageId = randomUUID(),
    versionId = randomUUID();
  const referenceIndex = await publishedWikiReferences(
    run.workspace_id,
    researchScope(run.input),
  );
  const metadata = metadataFromMarkdown(
    body,
    run.workspace_id,
    pageId,
    { ...emptyWikiMetadata, type: "query", path },
    referenceIndex,
  );
  let stored = false,
    committed = false;
  const db = await getPool().connect();
  try {
    if (chunks.length) {
      await originals.put(storageKey, Buffer.from(bundle));
      stored = true;
    }
    await db.query("BEGIN");
    await db.query(
      "SELECT user_id FROM membership WHERE workspace_id=$1 AND user_id=$2 FOR SHARE",
      [run.workspace_id, run.author_id],
    );
    await researchAuthor(
      db,
      run.workspace_id,
      run.author_id,
      run.input.origin.kind === "review",
    );
    const current = await db.query<ResearchRecord>(
      "SELECT * FROM research_run WHERE id=$1 AND lease_token=$2 AND state='saving' FOR UPDATE",
      [run.id, run.lease_token],
    );
    if (!current.rowCount)
      throw new AccessError(409, "조사가 중지되어 초안을 저장하지 않았습니다.");
    // Lock the inputs for the final publication/version check and draft write.
    await db.query(
      "LOCK TABLE wiki_page,source,domain IN SHARE ROW EXCLUSIVE MODE",
    );
    if (
      (await researchContext(db, run.workspace_id, run.input)).hash !==
      run.context_hash
    )
      throw new AccessError(
        409,
        "조사 입력이 변경되어 초안을 저장하지 않았습니다.",
      );
    await checkResearchCurrent(run);
    const local = refs.flatMap((r) =>
      r.reference.citation ? [r.reference.citation] : [],
    );
    const wikiIds = local
      .filter((r) => r.kind === "wiki")
      .map((r) => r.versionId);
    const evidence = await db.query<{ chunk_id: string }>(
      "SELECT DISTINCT chunk_id FROM wiki_evidence WHERE workspace_id=$1 AND version_id=ANY($2::uuid[])",
      [run.workspace_id, wikiIds],
    );
    const chunkIds = [
      ...new Set([
        ...local.flatMap((r) => (r.chunkId ? [r.chunkId] : [])),
        ...evidence.rows.map((r) => r.chunk_id),
      ]),
    ];
    await checkEvidence(
      drizzle(db),
      run.workspace_id,
      run.domain_id,
      run.project_id,
      chunkIds,
      true,
    );
    if (chunks.length) {
      await db.query(
        "INSERT INTO source(id,workspace_id,domain_id,project_id,title,category,created_by,latest_version_id,version_count) VALUES($1,$2,$3,$4,$5,'reference',$6,$7,1)",
        [
          sourceId,
          run.workspace_id,
          run.domain_id,
          run.project_id,
          `조사 검색 발췌: ${run.input.topic}`,
          run.author_id,
          sourceVersionId,
        ],
      );
      await db.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing,parser_version,warnings) VALUES($1,$2,$3,1,$4,'text/markdown',$5,$6,$7,$8,'pending','completed','research-search-excerpts-v1',$9::jsonb)",
        [
          sourceVersionId,
          run.workspace_id,
          sourceId,
          `research-sources-${run.id}.md`,
          storageKey,
          createHash("sha256").update(bundle).digest("hex"),
          Buffer.byteLength(bundle),
          run.author_id,
          JSON.stringify([
            "웹 전문이 아닌 검색 결과 발췌입니다. 주소와 발췌 내용을 대조한 뒤 공개 여부를 검토해 주세요.",
          ]),
        ],
      );
      for (const [ordinal, chunk] of chunks.entries())
        await db.query(
          "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
          [
            chunk.id,
            run.workspace_id,
            sourceVersionId,
            ordinal,
            chunk.text,
            JSON.stringify(chunk.locator),
          ],
        );
      chunkIds.push(...chunks.map((c) => c.id));
    }
    await db.query(
      "INSERT INTO wiki_page(id,workspace_id,domain_id,project_id,created_by,latest_version_id,version_count) VALUES($1,$2,$3,$4,$5,$6,1)",
      [
        pageId,
        run.workspace_id,
        run.domain_id,
        run.project_id,
        run.author_id,
        versionId,
      ],
    );
    await db.query(
      "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,metadata,author_id) VALUES($1,$2,$3,1,$4,$5,$6::jsonb,$7)",
      [
        versionId,
        run.workspace_id,
        pageId,
        `Research: ${run.input.topic.replace(/\s+/g, " ").trim()}`,
        body,
        JSON.stringify(metadata),
        run.author_id,
      ],
    );
    for (const chunkId of chunkIds)
      await db.query(
        "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
        [run.workspace_id, versionId, chunkId],
      );
    if (run.input.origin.reviewId)
      await db.query(
        "INSERT INTO review_event(workspace_id,kind,target_id,actor_id,action,note) VALUES($1,'quality',$2,$3,'research-draft',$4)",
        [
          run.workspace_id,
          run.input.origin.reviewId,
          run.author_id,
          `조사 초안 ${pageId}를 작성했습니다. 근거와 게시 내용을 검토한 뒤 해결 여부를 결정해 주세요.`,
        ],
      );
    await db.query(
      "UPDATE research_run SET state='completed',lease_token=NULL,page_id=$2,version_id=$3,updated_at=now() WHERE id=$1",
      [run.id, pageId, versionId],
    );
    await db.query("COMMIT");
    committed = true;
    return { pageId, versionId };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
    if (stored && !committed) await originals.remove(storageKey);
  }
}
