import "server-only";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  cleanResearchSynthesis,
  validateResearchSynthesis,
} from "@/lib/reference/deep-research";
import { researchSynthesisPrompt } from "@/lib/reference/research-prompts";
import { activeResearchStates, collectResearchSources } from "@/lib/research";
import { modelProfile, streamModel } from "@/server/ai/client";
import { getPool } from "@/server/db";
import type { CitationSnapshot } from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import { AccessError } from "@/server/errors";
import {
  checkResearchCurrent,
  type ResearchRecord,
  researchScope,
  researchWikiIndex,
} from "@/server/research/context";
import { saveResearchDraft } from "@/server/research/save";
import { searchResearchWeb } from "@/server/research/search";
import { checkAiCapacity } from "@/server/services/operations";
import {
  retrieveAuthorizedKnowledge,
  sanitizeKnowledgeLinks,
} from "@/server/services/retrieval";

export async function reconcileResearch() {
  const result = await getPool().query<{ generation_id: string | null }>(
    "UPDATE research_run SET state='failed',lease_token=NULL,synthesis='',\"references\"='[]',error_message='작업자 연결이 종료되었습니다. 새 요청으로 다시 실행해 주세요.',updated_at=now() WHERE state IN ('searching','synthesizing','saving') AND updated_at<now()-interval '30 seconds' RETURNING generation_id",
  );
  const ids = result.rows.flatMap((r) =>
    r.generation_id ? [r.generation_id] : [],
  );
  if (ids.length)
    await getPool().query(
      "UPDATE generation SET state='failed',error_message='조사 작업자 연결이 종료되었습니다.',updated_at=now() WHERE id=ANY($1::uuid[]) AND state='running'",
      [ids],
    );
}
export async function runNextResearch(shutdown?: AbortSignal) {
  const db = await getPool().connect();
  let run: ResearchRecord | undefined, queuedId: string | undefined;
  try {
    await db.query("BEGIN");
    const queued = await db.query<ResearchRecord>(
      "SELECT * FROM research_run WHERE state='queued' ORDER BY updated_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (queued.rows[0]) {
      const candidate = queued.rows[0];
      queuedId = candidate.id;
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,3))", [
        candidate.workspace_id,
      ]);
      await checkAiCapacity(drizzle(db), candidate.workspace_id);
      const generationId = randomUUID();
      await db.query(
        "INSERT INTO generation(id,workspace_id,author_id,request_id,input_hash,kind,state,model) VALUES($1,$2,$3,$4,$5,'deep-research','running',$6)",
        [
          generationId,
          candidate.workspace_id,
          candidate.author_id,
          candidate.id,
          candidate.input_hash,
          modelProfile("knowledge").model,
        ],
      );
      run = (
        await db.query<ResearchRecord>(
          "UPDATE research_run SET state='searching',generation_id=$2,lease_token=$3,updated_at=now() WHERE id=$1 RETURNING *",
          [candidate.id, generationId, randomUUID()],
        )
      ).rows[0];
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    if (error instanceof AccessError && error.status === 429 && queuedId) {
      await db.query(
        "UPDATE research_run SET updated_at=now() WHERE id=$1 AND state='queued'",
        [queuedId],
      );
      return false;
    }
    throw error;
  } finally {
    db.release();
  }
  if (!run) return false;
  const current = run,
    abort = new AbortController();
  const signal = AbortSignal.any([
    abort.signal,
    ...(shutdown ? [shutdown] : []),
    AbortSignal.timeout(360000),
  ]);
  let checking = false,
    finished = false;
  const guard = async () => {
    signal.throwIfAborted();
    await checkResearchCurrent(current);
    if (finished) return;
    const updated = await getPool().query(
      "UPDATE research_run SET updated_at=now() WHERE id=$1 AND lease_token=$2 AND state=ANY($3::text[]) RETURNING id",
      [current.id, current.lease_token, activeResearchStates],
    );
    if (!updated.rowCount)
      throw new AccessError(
        409,
        "조사가 중지되었거나 작업자가 변경되었습니다.",
      );
    await getPool().query(
      "UPDATE generation SET updated_at=now() WHERE id=$1 AND state='running'",
      [current.generation_id],
    );
  };
  const heartbeat = setInterval(async () => {
    if (checking || finished || signal.aborted) return;
    checking = true;
    try {
      await guard();
    } catch (error) {
      abort.abort(error);
    } finally {
      checking = false;
    }
  }, 2000);
  let inputTokens: number | null = null,
    outputTokens: number | null = null;
  try {
    await guard();
    const scope = researchScope(current.input);
    const collected = await collectResearchSources(
      current.input.queries,
      current.input.sourceMode,
      {
        web:
          current.input.sourceMode === "local"
            ? undefined
            : (query, limit) =>
                searchResearchWeb(
                  current.workspace_id,
                  current.input,
                  query,
                  limit,
                  signal,
                ),
        local: async (queries, limit) => {
          const results = await Promise.all(
            queries.map((query) =>
              retrieveAuthorizedKnowledge(
                current.workspace_id,
                scope,
                query,
                signal,
                { graph: false, limit },
              ),
            ),
          );
          const refs = [
            ...new Map(
              results
                .flatMap((r) => r.refs)
                .map((r) => [
                  `${r.kind}:${r.id}:${r.chunkId ?? r.versionId}`,
                  r,
                ]),
            ).values(),
          ].slice(0, limit);
          return refs.map((ref) => ({
            title: ref.title,
            url: ref.href,
            snippet: ref.text,
            source: ref.kind === "wiki" ? "공개 위키" : "공개 원문",
            citation: { ...ref, text: "", title: "", href: "" },
          }));
        },
      },
    );
    signal.throwIfAborted();
    current.references = collected.results;
    current.source_errors = collected.errors;
    await guard();
    if (!current.references.length) {
      if (collected.errors.length)
        throw new AccessError(
          502,
          "사용할 조사 자료를 수집하지 못했습니다. 검색 제공자와 검색어를 확인해 주세요.",
        );
      finished = true;
      await getPool().query(
        "UPDATE research_run SET state='completed',lease_token=NULL,synthesis='조사할 자료를 찾지 못했습니다. 검색어를 바꿔 다시 실행해 주세요.',updated_at=now() WHERE id=$1 AND lease_token=$2",
        [current.id, current.lease_token],
      );
      await getPool().query(
        "UPDATE generation SET state='completed',input_tokens=0,output_tokens=0,updated_at=now() WHERE id=$1 AND state='running'",
        [current.generation_id],
      );
      return true;
    }
    const index = await researchWikiIndex(current.workspace_id, current.input);
    const profile = modelProfile("knowledge");
    const fixedChars =
      researchSynthesisPrompt("").length +
      current.input.topic.length +
      current.references.reduce(
        (n, r) => n + r.title.length + r.source.length + 40,
        0,
      ) +
      400;
    const perSource = Math.floor(
      (profile.contextChars - fixedChars) / current.references.length,
    );
    if (perSource < 200)
      throw new AccessError(
        413,
        "모델 입력 한도가 조사 자료보다 작습니다. 검색 범위나 모델 설정을 확인해 주세요.",
      );
    // The same bounded excerpt is shown, sent to the model and saved as evidence.
    const excerptLimit = Math.min(12000, perSource);
    if (current.references.some((r) => r.snippet.length > excerptLimit))
      current.source_errors.push(
        `모델 입력 한도에 맞춰 자료별 앞 ${excerptLimit.toLocaleString()}자를 발췌했습니다.`,
      );
    current.references = current.references.map((r) => ({
      ...r,
      snippet: r.snippet.slice(0, excerptLimit),
    }));
    const searchContext = current.references
      .map((r, i) => `[${i + 1}] **${r.title}** (${r.source})\n${r.snippet}`)
      .join("\n\n");
    const userPrompt = `Research topic: **${current.input.topic}**\n\n## Research Sources\n\n${searchContext}\n\nSynthesize into a wiki page.`;
    while (
      index.length &&
      researchSynthesisPrompt(index.map((r) => r.line).join("\n")).length +
        userPrompt.length +
        32 >
        profile.contextChars
    )
      index.pop();
    current.dependencies = [
      ...current.references.flatMap((r) => (r.citation ? [r.citation] : [])),
      ...index.map((r) => r.dependency),
    ];
    await guard();
    await getPool().query(
      "UPDATE research_run SET state='synthesizing',\"references\"=$3::jsonb,dependencies=$4::jsonb,source_errors=$5::jsonb,updated_at=now() WHERE id=$1 AND lease_token=$2",
      [
        current.id,
        current.lease_token,
        JSON.stringify(current.references),
        JSON.stringify(current.dependencies),
        JSON.stringify(current.source_errors),
      ],
    );
    let accumulated = "",
      lastSave = 0;
    const output = await streamModel(
      [
        {
          role: "system",
          content: researchSynthesisPrompt(index.map((r) => r.line).join("\n")),
        },
        { role: "user", content: userPrompt },
      ],
      async (token) => {
        accumulated += token;
        signal.throwIfAborted();
        if (Date.now() - lastSave >= 250) {
          await guard();
          await getPool().query(
            "UPDATE research_run SET synthesis=$3,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='synthesizing'",
            [
              current.id,
              current.lease_token,
              cleanResearchSynthesis(accumulated),
            ],
          );
          lastSave = Date.now();
        }
      },
      AbortSignal.any([
        signal,
        AbortSignal.timeout(getServerEnv().AI_TIMEOUT_SECONDS * 1000),
      ]),
      "knowledge",
    );
    inputTokens = output.inputTokens;
    outputTokens = output.outputTokens;
    await guard();
    const validation = validateResearchSynthesis(
      output.text,
      current.references.length,
    );
    if (!validation.valid)
      throw new AccessError(
        502,
        validation.citedSourceIndexes.length
          ? "조사 본문이 비어 있거나 충분히 작성되지 않았습니다. 다시 실행해 주세요."
          : "수집한 자료를 인용하는 조사 본문을 완성하지 못했습니다. 다시 실행해 주세요.",
      );
    const synthesized: CitationSnapshot = {
      key: "",
      kind: "wiki",
      id: current.id,
      versionId: current.id,
      text: validation.cleaned,
      title: "",
      category: "wiki",
      href: "",
    };
    await sanitizeKnowledgeLinks(current.workspace_id, scope, [synthesized]);
    current.synthesis = synthesized.text;
    current.dependencies.push(
      ...(synthesized.linkedPages ?? []).map((page) => ({
        key: "",
        kind: "wiki" as const,
        id: page.id,
        versionId: page.versionId,
        text: "",
        title: "",
        category: "wiki",
        href: "",
      })),
    );
    await getPool().query(
      "UPDATE research_run SET state='saving',synthesis=$3,dependencies=$4::jsonb,updated_at=now() WHERE id=$1 AND lease_token=$2",
      [
        current.id,
        current.lease_token,
        current.synthesis,
        JSON.stringify(current.dependencies),
      ],
    );
    await guard();
    await saveResearchDraft(current, validation.citedSourceIndexes);
    finished = true;
    await getPool().query(
      "UPDATE generation SET state='completed',input_tokens=$2,output_tokens=$3,updated_at=now() WHERE id=$1 AND state='running'",
      [current.generation_id, inputTokens, outputTokens],
    );
    return true;
  } catch (error) {
    const reason = signal.aborted ? signal.reason : error;
    const message =
      reason instanceof AccessError
        ? reason.message
        : "조사를 완료하지 못했습니다. 검색·모델 연결을 확인한 뒤 다시 실행해 주세요.";
    await getPool().query(
      "UPDATE research_run SET state=$3,lease_token=NULL,synthesis='',\"references\"='[]',source_errors=$4::jsonb,error_message=$5,updated_at=now() WHERE id=$1 AND lease_token=$2",
      [
        current.id,
        current.lease_token,
        reason instanceof AccessError && reason.status === 409
          ? "outdated"
          : "failed",
        JSON.stringify(current.source_errors),
        message,
      ],
    );
    await getPool().query(
      "UPDATE generation SET state='failed',input_tokens=$2,output_tokens=$3,error_message=$4,updated_at=now() WHERE id=$1 AND state='running'",
      [current.generation_id, inputTokens, outputTokens, message],
    );
    return true;
  } finally {
    finished = true;
    clearInterval(heartbeat);
  }
}
