import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  domainId: string;
  outsiderWorkspaceId: string;
  accounts: { id: string; role: string; email: string; password: string }[];
};
export function registerOperationsTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("6단계 개정·검토·운영", () => {
    const base = `/api/workspaces/${f.workspaceId}`;
    const root = `/w/${f.workspaceId}`;
    let worker: ChildProcess;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let source: { sourceId: string; versionId: string };
    let record: typeof source;
    let wiki: { pageId: string; versionId: string };
    let issueId: string;
    let chunk: string;
    let recordChunk: string;
    let conversationId: string;
    let runId: string;
    let otherConversation: string;
    const reviewer =
      f.accounts.find((a) => a.role === "reviewer") ?? f.accounts[0];
    const reader = f.accounts.find((a) => a.role === "reader") ?? f.accounts[0];
    const action = (kind: string, id: string, action: string) =>
      clients.reviewer.post(`${base}/${kind}/${id}/action`, {
        data: { action, note: "6단계 개발 표본 검증" },
      });
    const details = async (s: typeof source) =>
      (await clients.writer.get(`${base}/sources/${s.sourceId}`)).json();
    const ready = async (s: typeof source) =>
      expect
        .poll(async () => (await details(s)).version.processing, {
          timeout: 30000,
        })
        .toBe("completed");
    async function createChat(owner: string, title: string) {
      const id = randomUUID();
      const run = randomUUID();
      await pool.query(
        `INSERT INTO conversation(id,workspace_id,owner_id,title,scope) VALUES($1,$2,$3,$4,$5)`,
        [
          id,
          f.workspaceId,
          owner,
          title,
          JSON.stringify({
            domainId: f.domainId,
            projectId: null,
            sourceId: null,
            wikiId: null,
          }),
        ],
      );
      await pool.query(
        `INSERT INTO chat_run(id,workspace_id,conversation_id,request_id,prompt,scope,state,model,input_tokens,output_tokens) SELECT $1,workspace_id,id,$2,'개인 질문 비밀',scope,'completed','test-model',100,50 FROM conversation WHERE id=$3`,
        [run, randomUUID(), id],
      );
      await pool.query(
        `INSERT INTO chat_message(workspace_id,run_id,role,body) VALUES($1,$2,'assistant','개인 답변 비밀')`,
        [f.workspaceId, run],
      );
      await pool.query(
        `INSERT INTO chat_citation(workspace_id,run_id,key,snapshot,used) VALUES($1,$2,'S1',$3,true)`,
        [
          f.workspaceId,
          run,
          JSON.stringify({
            key: "S1",
            kind: "source",
            id: record.sourceId,
            versionId: record.versionId,
            chunkId: recordChunk,
            title: "연결 실무 기록",
            text: "개인 근거 내용",
            category: "testimony",
            href: `${root}/sources/${record.sourceId}`,
          }),
        ],
      );
      return { id, run };
    }
    test.beforeAll(async () => {
      for (const a of f.accounts) {
        if (
          !(await (await clients[a.role].get("/api/auth/get-session")).json())
            ?.user
        )
          expect(
            (
              await clients[a.role].post("/api/auth/sign-in/email", {
                data: { email: a.email, password: a.password },
              })
            ).status(),
          ).toBe(200);
      }
      worker = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      worker.stdout?.on("data", (c) => {
        output += c;
      });
      worker.stderr?.on("data", () => {});
      await expect
        .poll(() => output, { timeout: 15000 })
        .toContain("문서 처리 작업자가 준비되었습니다.");
    });
    test.afterAll(async () => {
      if (worker?.exitCode === null && worker.signalCode === null) {
        const exited = new Promise<void>((r) => worker.once("exit", () => r()));
        worker.kill("SIGTERM");
        await exited;
      }
      await pool.end();
    });
    test("원본·연결 진술·위키를 실제 승인 흐름으로 준비한다", async () => {
      source = await (
        await clients.writer.post(`${base}/sources`, {
          multipart: {
            title: "6단계 정상 조건 원본",
            domainId: f.domainId,
            projectId: "",
            category: "guideline",
            file: {
              name: "원본.md",
              mimeType: "text/markdown",
              buffer: Buffer.from(
                "# 정상 조건\n정상 통신일 때만 30초 주기로 표시한다. 통신 오류를 정상으로 표시하면 안 된다.\n6단계 연결 표본.",
              ),
            },
          },
        })
      ).json();
      expect(source.sourceId).toBeTruthy();
      await ready(source);
      chunk = (await details(source)).chunks[0].id;
      expect(
        (await action("source-versions", source.versionId, "approve")).status(),
      ).toBe(200);
      const r = await clients.writer.post(`${base}/records`, {
        data: {
          title: "6단계 연결 실무 기록",
          domainId: f.domainId,
          projectId: null,
          rawNote: "직접 경험한 개발 상황",
          situation: "표시 오류를 확인했다.",
          reasoning: "정상 조건 원본을 확인했다.",
          result: "오류 표시를 구분했다.",
          followUp: "개정 근거 확인",
          chunkIds: [chunk],
        },
      });
      expect(r.status()).toBe(201);
      record = await r.json();
      await ready(record);
      expect(
        (await action("source-versions", record.versionId, "approve")).status(),
      ).toBe(200);
      recordChunk = (await details(record)).chunks[0].id;
      const created = await clients.writer.post(`${base}/wiki`, {
        data: {
          title: "6단계 연결 위키",
          body: "# 실무 조건\n연결한 기록과 정상 조건을 함께 확인합니다.",
          domainId: f.domainId,
          projectId: null,
          parentVersionId: null,
          basePublishedVersionId: null,
          chunkIds: [recordChunk],
        },
      });
      expect(created.status()).toBe(201);
      wiki = await created.json();
      expect(
        (
          await clients.writer.post(
            `${base}/wiki-versions/${wiki.versionId}/action`,
            { data: { action: "submit", note: "검토 요청" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (await action("wiki-versions", wiki.versionId, "approve")).status(),
      ).toBe(200);
      ({ id: conversationId, run: runId } = await createChat(
        reader.id,
        "내 개정 확인 대화",
      ));
      ({ id: otherConversation } = await createChat(
        reviewer.id,
        "다른 직원 비공개 대화",
      ));
    });
    test("원본 영향은 연결 진술·위키를 추적하고 본인 대화만 조회한다", async () => {
      expect(
        (
          await clients.reader.get(`${base}/source-impact/${source.sourceId}`)
        ).status(),
      ).toBe(403);
      expect(
        (
          await clients.outsider.get(`${base}/source-impact/${source.sourceId}`)
        ).status(),
      ).toBe(404);
      const r = await clients.reviewer.get(
        `${base}/source-impact/${source.sourceId}`,
      );
      expect(r.status()).toBe(200);
      const d = await r.json();
      expect(
        d.records.some((r: { id: string }) => r.id === record.sourceId),
      ).toBe(true);
      expect(d.wikis.some((r: { id: string }) => r.id === wiki.pageId)).toBe(
        true,
      );
      expect(d.chats.map((r: { id: string }) => r.id)).toContain(
        otherConversation,
      );
      expect(d.chats.map((r: { id: string }) => r.id)).not.toContain(
        conversationId,
      );
      expect(d.versions[0].published_at).toBeTruthy();
    });
    test("자료 신고를 내 목록에서 확인하고 외부 공간·이용 역할의 검토를 차단한다", async () => {
      const r = await clients.reader.post(`${base}/issues`, {
        data: {
          kind: "wiki",
          targetId: wiki.pageId,
          note: "정상 조건의 설명을 조금 더 구체적으로 확인해 주세요.",
        },
      });
      expect(r.status()).toBe(201);
      issueId = (await r.json()).id;
      expect(
        (
          await clients.outsider.post(`${base}/issues`, {
            data: {
              kind: "wiki",
              targetId: wiki.pageId,
              note: "외부 자료 신고 시도",
            },
          })
        ).status(),
      ).toBe(404);
      expect((await clients.reader.get(`${base}/review-desk`)).status()).toBe(
        403,
      );
      expect((await clients.admin.get(`${base}/review-desk`)).status()).toBe(
        200,
      );
      const own = await (await clients.reader.get(`${base}/issues`)).json();
      expect(own.issues.map((i: { id: string }) => i.id)).toContain(issueId);
      expect(
        (await (await clients.writer.get(`${base}/issues`)).json()).issues.map(
          (i: { id: string }) => i.id,
        ),
      ).not.toContain(issueId);
    });
    test("담당 지정·적체 확인·수정 게시 연결·처리 이력을 보존한다", async () => {
      const endpoint = `${base}/review-desk`;
      const common = { kind: "issue", targetId: issueId };
      expect(
        (
          await clients.reviewer.post(endpoint, {
            data: { ...common, action: "assign", assigneeId: reader.id },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.reviewer.post(endpoint, {
            data: { ...common, action: "assign", assigneeId: reviewer.id },
          })
        ).status(),
      ).toBe(201);
      await pool.query(
        "UPDATE content_issue SET created_at=now()-interval '9 days' WHERE id=$1",
        [issueId],
      );
      const d = await (await clients.reviewer.get(endpoint)).json();
      const target = d.targets.find((t: { id: string }) => t.id === issueId);
      expect(target.assignee_id).toBe(reviewer.id);
      expect(target.age_days).toBe(9);
      expect(
        (
          await clients.reviewer.post(endpoint, {
            data: {
              ...common,
              action: "triage",
              note: "원본과 게시 내용을 대조합니다.",
            },
          })
        ).status(),
      ).toBe(201);
      expect(
        (
          await clients.reviewer.post(endpoint, {
            data: {
              ...common,
              action: "resolve",
              note: "설명을 검토하고 게시 위키에 연결합니다.",
              fixedWikiId: randomUUID(),
            },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.reviewer.post(endpoint, {
            data: {
              ...common,
              action: "resolve",
              note: "설명을 검토하고 게시 위키에 연결합니다.",
              fixedWikiId: wiki.pageId,
            },
          })
        ).status(),
      ).toBe(201);
      const own = await (await clients.reader.get(`${base}/issues`)).json();
      expect(
        own.issues.find((i: { id: string }) => i.id === issueId),
      ).toMatchObject({ state: "resolved", fixedWikiId: wiki.pageId });
      expect(
        own.events.filter(
          (i: { target_id: string }) => i.target_id === issueId,
        ),
      ).toHaveLength(3);
      expect(
        (
          await clients.reviewer.post(endpoint, {
            data: {
              ...common,
              action: "reopen",
              note: "추가 조건 확인을 위해 다시 접수합니다.",
            },
          })
        ).status(),
      ).toBe(201);
    });
    test("근거 철회가 연결 기록·파생 위키·대화·임베딩에 전파된다", async () => {
      await pool.query(
        "INSERT INTO content_embedding(workspace_id,kind,target_id,model,dimensions,vector) VALUES($1,'source',$2,'operations-fixture',3,'[1,0,0]'),($1,'wiki',$3,'operations-fixture',3,'[1,0,0]')",
        [f.workspaceId, recordChunk, wiki.versionId],
      );
      expect(
        (
          await action("source-versions", source.versionId, "withdraw")
        ).status(),
      ).toBe(200);
      expect(
        (
          await clients.reader.get(`${base}/sources/${record.sourceId}`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.reader.get(
            `${base}/source-versions/${record.versionId}/file`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (await clients.reader.get(`${base}/wiki/${wiki.pageId}`)).status(),
      ).toBe(404);
      const search = await (
        await clients.reader.get(
          `${base}/search?q=${encodeURIComponent("6단계")}`,
        )
      ).json();
      expect(search.map((r: { id: string }) => r.id)).not.toContain(
        record.sourceId,
      );
      expect(search.map((r: { id: string }) => r.id)).not.toContain(
        wiki.pageId,
      );
      const list = await (await clients.reader.get(`${base}/sources`)).json();
      expect(list.map((s: { id: string }) => s.id)).not.toContain(
        record.sourceId,
      );
      const d = await (
        await clients.reader.get(`${base}/conversations/${conversationId}`)
      ).json();
      expect(d.runs[0].state).toBe("restricted");
      expect(JSON.stringify(d)).not.toContain("개인 답변 비밀");
      expect(JSON.stringify(d)).not.toContain("개인 근거 내용");
      expect(
        (
          await pool.query(
            "SELECT 1 FROM content_embedding WHERE workspace_id=$1 AND model='operations-fixture'",
            [f.workspaceId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await clients.writer.post(`${base}/wiki`, {
            data: {
              title: "제한된 기록 재인용",
              body: "더 이상 사용할 수 없는 근거",
              domainId: f.domainId,
              projectId: null,
              parentVersionId: null,
              basePublishedVersionId: null,
              chunkIds: [recordChunk],
            },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.writer.get(`${base}/sources/${source.sourceId}`)
        ).status(),
      ).toBe(200);
    });
    test("운영 화면은 관리자만 조회하고 사용량 미확인·추정 비용을 구분한다", async () => {
      expect((await clients.reviewer.get(`${base}/operations`)).status()).toBe(
        403,
      );
      expect((await clients.outsider.get(`${base}/operations`)).status()).toBe(
        404,
      );
      expect(
        (
          await clients.admin.post(`${base}/operations`, {
            data: {
              concurrency: 2,
              retentionDays: 30,
              inputPrice: 1000,
              outputPrice: 2000,
              currency: "KRW",
            },
          })
        ).status(),
      ).toBe(201);
      const r = await clients.admin.get(`${base}/operations`);
      expect(r.status()).toBe(200);
      const d = await r.json();
      expect(
        d.usage.find((u: { model: string }) => u.model === "test-model")
          .estimate,
      ).toBeGreaterThan(0);
      expect(JSON.stringify(d)).not.toContain("개인 질문 비밀");
      expect(JSON.stringify(d)).not.toContain("개인 답변 비밀");
      expect(d.policy.retentionDays).toBe(30);
      expect(
        (
          await clients.admin.post(`${base}/operations`, {
            data: {
              concurrency: 0,
              retentionDays: 30,
              inputPrice: null,
              outputPrice: null,
              currency: "KRW",
            },
          })
        ).status(),
      ).toBe(400);
    });
    test("채팅과 지식 생성은 같은 동시 요청 한도를 지킨다", async () => {
      await clients.admin.post(`${base}/operations`, {
        data: {
          concurrency: 1,
          retentionDays: 30,
          inputPrice: null,
          outputPrice: null,
          currency: "KRW",
        },
      });
      const genId = randomUUID();
      await pool.query(
        "INSERT INTO generation(id,workspace_id,author_id,request_id,input_hash,kind,state) VALUES($1,$2,$3,$4,'test','summarize','running')",
        [genId, f.workspaceId, reviewer.id, randomUUID()],
      );
      const c = await (
        await clients.reader.post(`${base}/conversations`, {
          data: {
            title: "동시 한도",
            scope: {
              domainId: f.domainId,
              projectId: null,
              sourceId: null,
              wikiId: null,
            },
          },
        })
      ).json();
      try {
        expect(
          (
            await clients.reader.post(`${base}/conversations/${c.id}/stream`, {
              data: {
                requestId: randomUUID(),
                prompt: "정상 조건을 확인해 주세요.",
              },
            })
          ).status(),
        ).toBe(429);
        expect(
          (
            await clients.writer.post(`${base}/generations`, {
              data: {
                action: "memo",
                requestId: randomUUID(),
                rawNote: "정상 조건을 확인하고 경험을 정리합니다.",
              },
            })
          ).status(),
        ).toBe(429);
      } finally {
        await pool.query("DELETE FROM generation WHERE id=$1", [genId]);
        await clients.admin.post(`${base}/operations`, {
          data: {
            concurrency: 3,
            retentionDays: 30,
            inputPrice: null,
            outputPrice: null,
            currency: "KRW",
          },
        });
      }
    });
    test("본인 대화 삭제는 의견·메시지·인용을 함께 지우고 타인 삭제를 막는다", async () => {
      expect(
        (
          await clients.admin.delete(`${base}/conversations/${conversationId}`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.reader.delete(
            `${base}/conversations/${otherConversation}`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.reader.delete(`${base}/conversations/${conversationId}`)
        ).status(),
      ).toBe(200);
      for (const table of ["chat_run", "chat_message", "chat_citation"]) {
        const column = table === "chat_run" ? "id" : "run_id";
        expect(
          (
            await pool.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [
              runId,
            ])
          ).rowCount,
        ).toBe(0);
      }
      expect(
        (
          await clients.reviewer.get(
            `${base}/conversations/${otherConversation}`,
          )
        ).status(),
      ).toBe(200);
    });
    test("보존 삭제는 미리 본 대상만 지우며 진행·미처리 의견은 보존한다", async () => {
      const a = await createChat(reader.id, "보존 기간 경과 대화");
      const b = await createChat(reader.id, "미처리 의견 대화");
      await pool.query(
        "UPDATE conversation SET updated_at=now()-interval '40 days' WHERE id=ANY($1::uuid[])",
        [[a.id, b.id]],
      );
      await pool.query(
        "INSERT INTO chat_feedback(workspace_id,run_id,author_id,rating,note) VALUES($1,$2,$3,'incorrect','처리해야 하는 의견')",
        [f.workspaceId, b.run, reader.id],
      );
      const r = await clients.admin.post(`${base}/retention`, {
        data: { action: "preview" },
      });
      expect(r.status()).toBe(201);
      const preview = await r.json();
      expect(preview.counts.conversations).toBe(1);
      expect(
        (
          await clients.admin.post(`${base}/retention`, {
            data: {
              action: "delete",
              cutoff: preview.cutoff,
              token: "0".repeat(64),
              confirmation: "보존 기간이 지난 대화 삭제",
            },
          })
        ).status(),
      ).toBe(409);
      await pool.query("UPDATE conversation SET updated_at=now() WHERE id=$1", [
        a.id,
      ]);
      expect(
        (
          await clients.admin.post(`${base}/retention`, {
            data: {
              action: "delete",
              cutoff: preview.cutoff,
              token: preview.token,
              confirmation: "보존 기간이 지난 대화 삭제",
            },
          })
        ).status(),
      ).toBe(409);
      await pool.query(
        "UPDATE conversation SET updated_at=now()-interval '40 days' WHERE id=$1",
        [a.id],
      );
      const fresh = await (
        await clients.admin.post(`${base}/retention`, {
          data: { action: "preview" },
        })
      ).json();
      expect(
        (
          await clients.admin.post(`${base}/retention`, {
            data: {
              action: "delete",
              cutoff: fresh.cutoff,
              token: fresh.token,
              confirmation: "보존 기간이 지난 대화 삭제",
            },
          })
        ).status(),
      ).toBe(201);
      expect(
        (await clients.reader.get(`${base}/conversations/${a.id}`)).status(),
      ).toBe(404);
      expect(
        (await clients.reader.get(`${base}/conversations/${b.id}`)).status(),
      ).toBe(200);
    });
    test("참조 중인 원본 삭제는 거부하고 종료 원본은 파일까지 정리한다", async () => {
      await pool.query(
        "UPDATE source SET updated_at=now()-interval '40 days' WHERE id=$1",
        [source.sourceId],
      );
      expect(
        (
          await clients.admin.post(`${base}/retirements`, {
            data: { action: "preview", sourceId: source.sourceId },
          })
        ).status(),
      ).toBe(409);
      const uploaded = await clients.writer.post(`${base}/sources`, {
        multipart: {
          title: "삭제 가능한 종료 원본",
          domainId: f.domainId,
          projectId: "",
          category: "reference",
          file: {
            name: "종료.md",
            mimeType: "text/markdown",
            buffer: Buffer.from(
              "# 일시 검증 원본\n다른 자료에서 사용하지 않는 종료 자료입니다.",
            ),
          },
        },
      });
      expect(uploaded.status()).toBe(201);
      const retire = await uploaded.json();
      await ready(retire);
      expect(
        (await action("source-versions", retire.versionId, "reject")).status(),
      ).toBe(200);
      expect(
        (
          await clients.admin.post(`${base}/retirements`, {
            data: { action: "preview", sourceId: retire.sourceId },
          })
        ).status(),
      ).toBe(409);
      await pool.query(
        "UPDATE source SET updated_at=now()-interval '40 days' WHERE id=$1",
        [retire.sourceId],
      );
      const key = (
        await pool.query("SELECT storage_key FROM source_version WHERE id=$1", [
          retire.versionId,
        ])
      ).rows[0].storage_key;
      const file = resolve(
        process.env.ORIGINALS_DIR ?? ".local/test-originals",
        key,
      );
      expect(existsSync(file)).toBe(true);
      expect(
        (
          await clients.reviewer.post(`${base}/retirements`, {
            data: { action: "preview", sourceId: retire.sourceId },
          })
        ).status(),
      ).toBe(403);
      const p = await clients.admin.post(`${base}/retirements`, {
        data: { action: "preview", sourceId: retire.sourceId },
      });
      expect(p.status()).toBe(201);
      const preview = await p.json();
      expect(preview.files).toHaveLength(1);
      expect(
        (
          await clients.admin.post(`${base}/retirements`, {
            data: {
              action: "delete",
              sourceId: retire.sourceId,
              token: preview.token,
              confirmation: "잘못 입력한 이름",
            },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.admin.post(`${base}/retirements`, {
            data: {
              action: "delete",
              sourceId: retire.sourceId,
              token: preview.token,
              confirmation: preview.title,
            },
          })
        ).status(),
      ).toBe(201);
      expect(
        (
          await clients.writer.get(`${base}/sources/${retire.sourceId}`)
        ).status(),
      ).toBe(404);
      await expect.poll(() => existsSync(file), { timeout: 15000 }).toBe(false);
      const metadata = (
        await pool.query("SELECT metadata FROM source_retirement WHERE id=$1", [
          retire.sourceId,
        ])
      ).rows[0].metadata;
      expect(metadata.versions[0].sha256).toHaveLength(64);
      expect(metadata.decisions[0].action).toBe("reject");
      expect(JSON.stringify(metadata)).not.toContain(
        "다른 자료에서 사용하지 않는 종료 자료입니다.",
      );
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM original_gc WHERE storage_key=$1 AND removed_at IS NOT NULL",
            [key],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    test("작업자가 끊긴 채팅·생성 실행을 복구 가능한 종료 상태로 정리한다", async () => {
      const c = await createChat(reader.id, "중단된 작업 확인");
      await pool.query(
        "UPDATE chat_run SET state='running',updated_at=now()-interval '1 minute' WHERE id=$1",
        [c.run],
      );
      const g = randomUUID();
      await pool.query(
        "INSERT INTO generation(id,workspace_id,author_id,request_id,input_hash,kind,state,created_at) VALUES($1,$2,$3,$4,'expired','memo','running',now()-interval '4 minutes')",
        [g, f.workspaceId, reviewer.id, randomUUID()],
      );
      await expect
        .poll(
          async () =>
            (
              await pool.query("SELECT state FROM chat_run WHERE id=$1", [
                c.run,
              ])
            ).rows[0].state,
          { timeout: 15000 },
        )
        .toBe("interrupted");
      await expect
        .poll(
          async () =>
            (await pool.query("SELECT state FROM generation WHERE id=$1", [g]))
              .rows[0].state,
          { timeout: 15000 },
        )
        .toBe("failed");
    });
    test("운영·담당·내 신고 화면은 모바일에서 정상 동작한다", async ({
      browser,
    }) => {
      mkdirSync("docs/stages/06-operations/screenshots", { recursive: true });
      const uiIssueResponse = await clients.writer.post(`${base}/issues`, {
        data: {
          kind: "source",
          targetId: source.sourceId,
          note: "담당 지정 폼의 선택값 유지 시험",
        },
      });
      expect(uiIssueResponse.status()).toBe(201);
      const uiIssue = await uiIssueResponse.json();
      for (const [role, path, title] of [
        ["admin", "admin/operations", "작업·사용량·보존 관리"],
        ["reviewer", "reviews/desk", "담당 검토·오류 처리"],
        ["reader", "issues", "내 신고와 답변 의견"],
        ["writer", `sources/${source.sourceId}/impact`, "개정·철회 영향 확인"],
      ]) {
        const context = await browser.newContext({
          storageState: await clients[role].storageState(),
          viewport: { width: 390, height: 844 },
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`http://localhost:3101${root}/${path}`);
        await expect(
          page.getByRole("heading", { name: title, exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        if (role === "reviewer") {
          const card = page
            .locator("article")
            .filter({ hasText: "담당 지정 폼의 선택값 유지 시험" });
          await card.getByRole("combobox", { name: "담당 검토 직원" }).click();
          await page
            .getByRole("option", { name: "reviewer 시험 직원", exact: true })
            .click();
          await card.getByRole("button", { name: "처리 저장" }).click();
          await expect(
            card.getByText("처리 내용을 저장했습니다.", { exact: true }),
          ).toBeVisible();
          await expect
            .poll(
              async () =>
                (
                  await (
                    await clients.reviewer.get(`${base}/review-desk`)
                  ).json()
                ).targets.find((t: { id: string }) => t.id === uiIssue.id)
                  .assignee_id,
            )
            .toBe(reviewer.id);
          await expect(
            card.getByRole("combobox", { name: "담당 검토 직원" }),
          ).toContainText("reviewer 시험 직원");
          await page.getByRole("combobox", { name: "검토 담당 범위" }).click();
          await page
            .getByRole("option", { name: "내 담당", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: "6단계 연결 위키", exact: true }),
          ).toBeVisible();
        }
        if (role === "admin") {
          await page
            .getByRole("button", { name: "삭제 대상 미리보기" })
            .click();
          await expect(page.getByText(/이전 · 대화/)).toBeVisible();
        }
        await page.screenshot({
          path: `docs/stages/06-operations/screenshots/${role}-mobile.png`,
          fullPage: true,
        });
        expect(errors).toEqual([]);
        await context.close();
      }
    });
  });
}
