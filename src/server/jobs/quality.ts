import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  parseQualityOutput,
  type QualityCandidate,
  type QualityStepInput,
  qualityMessages,
  structuralQuality,
} from "@/lib/quality";
import { modelProfile, streamModel } from "@/server/ai/client";
import { getPool } from "@/server/db";
import { getServerEnv } from "@/server/env";
import { AccessError } from "@/server/errors";
import {
  enqueueQuality,
  type QualityRun,
  qualityAuthor,
  qualitySnapshot,
  saveQualityFindings,
} from "@/server/services/quality";

async function checkCurrent(db: Pick<PoolClient, "query">, run: QualityRun) {
  await qualityAuthor(db, run.workspace_id, run.author_id);
  const current = await qualitySnapshot(
    db,
    run.workspace_id,
    run.domain_id,
    run.project_id,
  );
  if (current.hash !== run.basis_hash)
    throw new AccessError(
      409,
      "페이지·원문·목적이 바뀌었습니다. 현재 자료로 다시 점검해 주세요.",
    );
}
export async function scheduleQuality() {
  await getPool().query(
    "UPDATE quality_run SET state='interrupted',lease_token=NULL,error_message='점검 작업자의 연결이 종료되었습니다. 새 점검을 실행해 주세요.',updated_at=now() WHERE state='running' AND updated_at<now()-interval '30 seconds'",
  );
  const policies = await getPool().query<{
    workspace_id: string;
    domain_id: string;
    author_id: string;
    mode: "structural" | "semantic";
    interval_days: number;
    after_revision: boolean;
    last_basis_hash: string | null;
    next_run_at: Date | null;
  }>(
    "SELECT * FROM quality_policy WHERE interval_days>0 OR after_revision ORDER BY updated_at LIMIT 100",
  );
  for (const candidate of policies.rows) {
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      const locked = await db.query<typeof candidate>(
        "SELECT * FROM quality_policy WHERE workspace_id=$1 AND domain_id=$2 FOR UPDATE",
        [candidate.workspace_id, candidate.domain_id],
      );
      const policy = locked.rows[0];
      if (!policy) {
        await db.query("COMMIT");
        continue;
      }
      await qualityAuthor(db, policy.workspace_id, policy.author_id);
      const { hash } = await qualitySnapshot(
        db,
        policy.workspace_id,
        policy.domain_id,
        null,
      );
      const revision = policy.after_revision && hash !== policy.last_basis_hash;
      const due =
        policy.interval_days > 0 &&
        !!policy.next_run_at &&
        policy.next_run_at.getTime() <= Date.now();
      if (revision || due) {
        const result = await enqueueQuality(
          db,
          policy.workspace_id,
          policy.author_id,
          {
            domainId: policy.domain_id,
            projectId: null,
            mode: policy.mode,
            requestId: randomUUID(),
            force: true,
          },
          revision ? "revision" : "scheduled",
        );
        if (result.run.basis_hash === hash)
          await db.query(
            "UPDATE quality_policy SET last_basis_hash=$3,next_run_at=CASE WHEN interval_days>0 THEN now()+make_interval(days=>interval_days) ELSE NULL END WHERE workspace_id=$1 AND domain_id=$2",
            [policy.workspace_id, policy.domain_id, hash],
          );
      }
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      if (!(e instanceof AccessError))
        console.error("정기 품질 점검 등록을 확인하지 못했습니다.");
    } finally {
      db.release();
    }
  }
}
export async function runNextQuality() {
  const db = await getPool().connect();
  let run: QualityRun | undefined;
  try {
    await db.query("BEGIN");
    const queued = await db.query<QualityRun>(
      "SELECT * FROM quality_run WHERE state='queued' ORDER BY updated_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (queued.rows[0])
      run = (
        await db.query<QualityRun>(
          "UPDATE quality_run SET state='running',lease_token=$2,updated_at=now() WHERE id=$1 RETURNING *",
          [queued.rows[0].id, randomUUID()],
        )
      ).rows[0];
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
  if (!run) return false;
  const claimed = run;
  const controller = new AbortController();
  let checking = false;
  let generationId: string | null = null;
  let guardError: unknown;
  const guard = async () => {
    await checkCurrent(getPool(), claimed);
    const updated = await getPool().query(
      "UPDATE quality_run SET updated_at=now() WHERE id=$1 AND state='running' AND lease_token=$2 RETURNING id",
      [claimed.id, claimed.lease_token],
    );
    if (!updated.rowCount)
      throw new AccessError(
        409,
        "점검이 중지되었거나 다른 작업자가 이어받았습니다.",
      );
    if (generationId)
      await getPool().query(
        "UPDATE generation SET updated_at=now() WHERE id=$1 AND state='running'",
        [generationId],
      );
  };
  const heartbeat = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      await guard();
    } catch (e) {
      guardError = e;
      controller.abort();
    } finally {
      checking = false;
    }
  }, 2000);
  try {
    await guard();
    const findings: QualityCandidate[] =
      claimed.mode === "structural"
        ? structuralQuality(claimed.workspace_id, claimed.snapshot)
        : [];
    const steps = await getPool().query<{
      id: string;
      input: QualityStepInput;
      state: string;
      result: QualityCandidate[] | null;
    }>(
      "SELECT id,input,state,result FROM quality_step WHERE run_id=$1 ORDER BY ordinal",
      [claimed.id],
    );
    for (const step of steps.rows) {
      await guard();
      if (step.state === "completed" && step.result) {
        findings.push(...step.result);
        continue;
      }
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,3))",
          [claimed.workspace_id],
        );
        const capacity = await client.query<{
          active: string;
          capacity: number;
        }>(
          `SELECT (SELECT count(*) FROM chat_run WHERE workspace_id=$1 AND state='running' AND updated_at>=now()-interval '30 seconds')+(SELECT count(*) FROM generation WHERE workspace_id=$1 AND state='running' AND task_id IS NULL AND (CASE WHEN kind IN ('wiki-quality','deep-research') THEN updated_at ELSE created_at END)>=now()-interval '3 minutes')+(SELECT count(*) FROM ai_task WHERE workspace_id=$1 AND state='running') AS active,COALESCE((SELECT concurrency FROM operations_policy WHERE workspace_id=$1),$2) AS capacity`,
          [claimed.workspace_id, getServerEnv().AI_MAX_CONCURRENT],
        );
        if (Number(capacity.rows[0].active) >= capacity.rows[0].capacity)
          throw new AccessError(
            429,
            "팀의 다른 AI 작업이 끝나기를 기다리고 있습니다.",
          );
        generationId = randomUUID();
        await client.query(
          "INSERT INTO generation(id,workspace_id,author_id,request_id,input_hash,kind,state,model) VALUES($1,$2,$3,$4,$5,'wiki-quality','running',$6)",
          [
            generationId,
            claimed.workspace_id,
            claimed.author_id,
            step.id,
            claimed.basis_hash,
            modelProfile("knowledge").model,
          ],
        );
        await client.query(
          "UPDATE quality_step SET generation_id=$2 WHERE id=$1",
          [step.id, generationId],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      const output = await streamModel(
        qualityMessages(step.input),
        async () => {
          if (controller.signal.aborted)
            throw guardError ?? new Error("점검이 중지되었습니다.");
        },
        AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(getServerEnv().AI_TIMEOUT_SECONDS * 1000),
        ]),
        "knowledge",
      );
      // Usage is kept even when the output contract or current-version guard rejects the result.
      await getPool().query(
        "UPDATE generation SET input_tokens=$2,output_tokens=$3,updated_at=now() WHERE id=$1",
        [generationId, output.inputTokens, output.outputTokens],
      );
      const parsed = parseQualityOutput(output.text, step.input);
      await guard();
      const commit = await getPool().connect();
      try {
        await commit.query("BEGIN");
        const owner = await commit.query(
          "SELECT id FROM quality_run WHERE id=$1 AND lease_token=$2 AND state='running' FOR UPDATE",
          [claimed.id, claimed.lease_token],
        );
        if (!owner.rowCount)
          throw new AccessError(409, "점검이 중지되었습니다.");
        await commit.query(
          "UPDATE generation SET state='completed',result=$2::jsonb,updated_at=now() WHERE id=$1",
          [generationId, JSON.stringify({ findings: parsed })],
        );
        await commit.query(
          "UPDATE quality_step SET state='completed',result=$2::jsonb WHERE id=$1",
          [step.id, JSON.stringify(parsed)],
        );
        await commit.query(
          "UPDATE quality_run SET completed_steps=completed_steps+1,updated_at=now() WHERE id=$1",
          [claimed.id],
        );
        await commit.query("COMMIT");
      } catch (e) {
        await commit.query("ROLLBACK");
        throw e;
      } finally {
        commit.release();
      }
      generationId = null;
      findings.push(...parsed);
    }
    const finish = await getPool().connect();
    try {
      await finish.query("BEGIN");
      await finish.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,14))",
        [
          `${claimed.workspace_id}:${claimed.domain_id}:${claimed.project_id ?? "*"}`,
        ],
      );
      await finish.query(
        "SELECT id FROM domain WHERE workspace_id=$1 AND id=$2 FOR SHARE",
        [claimed.workspace_id, claimed.domain_id],
      );
      await finish.query(
        "SELECT id FROM wiki_page WHERE workspace_id=$1 AND domain_id=$2 FOR SHARE",
        [claimed.workspace_id, claimed.domain_id],
      );
      await finish.query(
        "SELECT id FROM source WHERE workspace_id=$1 AND domain_id=$2 FOR SHARE",
        [claimed.workspace_id, claimed.domain_id],
      );
      const owner = await finish.query(
        "SELECT id FROM quality_run WHERE id=$1 AND lease_token=$2 AND state='running' FOR UPDATE",
        [claimed.id, claimed.lease_token],
      );
      if (!owner.rowCount) throw new AccessError(409, "점검이 중지되었습니다.");
      await checkCurrent(finish, claimed);
      await saveQualityFindings(finish, claimed, findings);
      await finish.query(
        "UPDATE quality_run SET state='completed',lease_token=NULL,updated_at=now() WHERE id=$1",
        [claimed.id],
      );
      await finish.query("COMMIT");
    } catch (e) {
      await finish.query("ROLLBACK");
      throw e;
    } finally {
      finish.release();
    }
  } catch (error) {
    const e = guardError ?? error;
    const message =
      e instanceof AccessError
        ? e.message
        : e instanceof Error && /구절|후보|질문 원문/.test(e.message)
          ? e.message
          : "AI 점검 응답을 확인하지 못했습니다. 새 점검을 실행해 주세요.";
    if (generationId)
      await getPool().query(
        "UPDATE generation SET state='failed',error_message=$2,updated_at=now() WHERE id=$1 AND state='running'",
        [generationId, message],
      );
    await getPool().query(
      "UPDATE quality_run SET state=$3,lease_token=NULL,error_message=$4,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running'",
      [
        claimed.id,
        claimed.lease_token,
        e instanceof AccessError && e.status === 429
          ? "queued"
          : e instanceof AccessError && [403, 409].includes(e.status)
            ? "outdated"
            : "failed",
        message,
      ],
    );
  } finally {
    clearInterval(heartbeat);
    controller.abort();
  }
  return true;
}
