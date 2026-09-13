// Read-only release and usage evidence; never export credentials or auth rows.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { deployment, execute, hash } from "./lib/deployment.mjs";

const [profile] = process.argv.slice(2);
assert.match(profile ?? "", /^wiki-stage16-/);
const t = deployment(profile);
const query = (sql) => JSON.parse(t.sql(sql));
const runtime = {};
for (const service of ["web", "worker"]) {
  const id = t.compose(["ps", "-q", service]);
  const info = JSON.parse(execute("docker", ["inspect", id]))[0];
  const env = Object.fromEntries(
    info.Config.Env.map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
  );
  for (const key of [
    "AI_MODEL",
    "AI_BASE_URL",
    "AI_API_KEY",
    "AI_CHAT_MODEL",
    "AI_KNOWLEDGE_MODEL",
    "AI_EMBEDDING_MODEL",
    "AI_CHAT_BASE_URL",
    "AI_KNOWLEDGE_BASE_URL",
    "AI_EMBEDDING_BASE_URL",
    "AI_CHAT_API_KEY",
    "AI_KNOWLEDGE_API_KEY",
    "AI_EMBEDDING_API_KEY",
  ])
    assert.equal(env[key], t.env[key], `${service} ${key}`);
  runtime[service] = {
    imageId: info.Image,
    healthy: info.State.Health?.Status ?? info.State.Status,
    chatModel: env.AI_CHAT_MODEL || env.AI_MODEL,
    knowledgeModel: env.AI_KNOWLEDGE_MODEL || env.AI_MODEL,
    embeddingModel: env.AI_EMBEDDING_MODEL,
    profileValuesMatch: true,
    keysConfigured: !!(
      (env.AI_CHAT_API_KEY || env.AI_API_KEY) &&
      (env.AI_KNOWLEDGE_API_KEY || env.AI_API_KEY) &&
      (env.AI_EMBEDDING_API_KEY || env.AI_API_KEY)
    ),
  };
  assert.equal(runtime[service].keysConfigured, true);
}
assert.equal(runtime.web.imageId, runtime.worker.imageId);
const result = {
  date: new Date().toISOString(),
  profile,
  image: t.env.APP_IMAGE,
  runtime,
  migrationCount: Number(
    t.sql("SELECT count(*) FROM drizzle.__drizzle_migrations"),
  ),
  role: query(
    "SELECT json_build_object('superuser',rolsuper,'createDatabase',rolcreatedb,'createRole',rolcreaterole) FROM pg_roles WHERE rolname='domain_wiki'",
  ),
  sourceCode: Object.fromEntries(
    [
      "Dockerfile",
      "package.json",
      "package-lock.json",
      "src/lib/wiki-generation.ts",
      "src/lib/document-analysis.ts",
      "compose.production.yaml",
    ].map((p) => [p, hash(readFileSync(p))]),
  ),
  counts: t.tableCounts(),
  generations: query(
    "SELECT coalesce(json_agg(json_build_object('id',id,'taskId',task_id,'kind',kind,'state',state,'model',model,'inputTokens',input_tokens,'outputTokens',output_tokens,'errorMessage',error_message,'createdAt',created_at,'updatedAt',updated_at) ORDER BY created_at),'[]') FROM generation",
  ),
  chats: query(
    "SELECT coalesce(json_agg(json_build_object('id',id,'conversationId',conversation_id,'state',state,'model',model,'inputTokens',input_tokens,'outputTokens',output_tokens) ORDER BY created_at),'[]') FROM chat_run",
  ),
  embeddings: query(
    "SELECT coalesce(json_agg(to_jsonb(e)),'[]') FROM embedding_usage e",
  ),
  qualitySteps: query(
    "SELECT coalesce(json_agg(to_jsonb(s)),'[]') FROM quality_step s",
  ),
};
assert.deepEqual(result.role, {
  superuser: false,
  createDatabase: false,
  createRole: false,
});
assert.equal(result.migrationCount, 18);
writeFileSync(
  `docs/evaluation/core/deployment-16/${profile}-snapshot.json`,
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    profile,
    migrations: result.migrationCount,
    tables: Object.keys(result.counts).length,
    generations: result.generations.length,
    chatRuns: result.chats.length,
    runtime,
  }),
);
