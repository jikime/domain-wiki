// Read-only release evidence. Never export secrets or auth rows.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { deployment, execute, hash } from "./lib/deployment.mjs";

const [profile] = process.argv.slice(2);
assert.ok(
  ["wiki-stage16-main", "wiki-stage16-parity-restored"].includes(profile),
);
const target = deployment(profile);
const runtime = {};
for (const service of ["web", "worker"]) {
  const id = target.compose(["ps", "-q", service]);
  const info = JSON.parse(execute("docker", ["inspect", id]))[0];
  const env = Object.fromEntries(
    info.Config.Env.map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
  );
  for (const [key, value] of Object.entries(target.env)) {
    if (
      /^(?:AI_|MINERU_|SOURCE_IMPORT_ROOTS$|RESEARCH_SEARCH_PROVIDERS$)/.test(
        key,
      )
    )
      assert.ok(env[key] === value, `${service}: ${key} 전달 불일치`);
  }
  assert.equal(info.State.Status, "running");
  if (service === "web") assert.equal(info.State.Health.Status, "healthy");
  runtime[service] = {
    imageId: info.Image,
    status: info.State.Health?.Status ?? info.State.Status,
    chatModel: env.AI_CHAT_MODEL || env.AI_MODEL,
    knowledgeModel: env.AI_KNOWLEDGE_MODEL || env.AI_MODEL,
    embeddingModel: env.AI_EMBEDDING_MODEL,
    modelKeysConfigured: !!(
      (env.AI_CHAT_API_KEY || env.AI_API_KEY) &&
      (env.AI_KNOWLEDGE_API_KEY || env.AI_API_KEY) &&
      (env.AI_EMBEDDING_API_KEY || env.AI_API_KEY)
    ),
    researchConfigurationPresent: Object.hasOwn(
      env,
      "RESEARCH_SEARCH_PROVIDERS",
    ),
    profileValuesMatch: true,
  };
}
assert.equal(runtime.web.imageId, runtime.worker.imageId);
assert.equal(
  runtime.web.imageId,
  execute("docker", [
    "image",
    "inspect",
    target.env.APP_IMAGE,
    "--format",
    "{{.Id}}",
  ]),
);
const role = JSON.parse(
  target.sql(
    "SELECT json_build_object('superuser',rolsuper,'createDatabase',rolcreatedb,'createRole',rolcreaterole) FROM pg_roles WHERE rolname='domain_wiki'",
  ),
);
assert.deepEqual(role, {
  superuser: false,
  createDatabase: false,
  createRole: false,
});
const migrationCount = Number(
  target.sql("SELECT count(*) FROM drizzle.__drizzle_migrations"),
);
assert.equal(migrationCount, 30);
const counts = target.tableCounts();
assert.equal(Object.keys(counts).length, 54);
const result = {
  date: new Date().toISOString(),
  profile,
  image: target.env.APP_IMAGE,
  runtime,
  migrationCount,
  role,
  counts,
  sourceCode: Object.fromEntries(
    [
      "Dockerfile",
      "package.json",
      "package-lock.json",
      "compose.production.yaml",
      "src/server/services/selection-assistance.ts",
      "src/components/selection-assistant.tsx",
      "src/server/services/source-imports.ts",
      "src/server/services/research.ts",
    ].map((path) => [path, hash(readFileSync(path))]),
  ),
};
writeFileSync(
  `docs/evaluation/core/original-parity-deployment/${profile}-snapshot.json`,
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    profile,
    image: result.image,
    migrationCount,
    tables: Object.keys(counts).length,
    runtime,
  }),
);
