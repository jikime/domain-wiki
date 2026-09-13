import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const out = "docs/evaluation/core/deployment-16";
const read = (name) => JSON.parse(readFileSync(`${out}/${name}.json`, "utf8"));
const before = read("initial"),
  after = read("revision"),
  snapshot = read("wiki-stage16-main-snapshot");
const backup = read("backup-manifest"),
  restored = read("wiki-stage16-restored-verified"),
  rollback = read("failed-release-recovery"),
  guards = read("restore-guards");
assert.deepEqual(
  before.publication.map((p) => p.pageId).sort(),
  after.publication.map((p) => p.pageId).sort(),
);
for (const p of after.publication)
  assert.equal(
    p.body,
    before.publication
      .find((b) => b.pageId === p.pageId)
      .body.replaceAll("30초", "45초"),
  );
const citations = after.queries.flatMap((q) =>
  q.run.citations.filter((c) => c.used),
);
assert.ok(
  citations.every((c) => c.snapshot.versionId === after.source.versionId),
);
for (const q of [...before.queries, ...after.queries])
  assert.equal(q.run.state, "completed");
const stale = after.finalQuality.findings.filter(
  (f) => f.kind === "stale-evidence",
);
assert.equal(stale.length, 3);
assert.ok(
  stale.every((f) => f.state === "resolved" && !f.present && f.current),
);
const semantic = after.finalQuality.findings.filter(
  (f) => f.mode === "semantic",
);
assert.equal(semantic.length, 5);
assert.ok(semantic.every((f) => f.state === "deferred" && f.current));
assert.equal(backup.files.length, 2);
assert.equal(Object.keys(backup.counts).length, 48);
assert.equal(rollback.rejected, true);
assert.equal(rollback.health, 200);
assert.equal(guards.existingServiceRejected, true);
assert.equal(restored.sourceHashes, true);
assert.equal(restored.wikiBodies, true);
assert.equal(restored.savedChats, true);
assert.equal(restored.readerRole, true);
const totals = (rows) => ({
  calls: rows.length,
  inputTokens: rows.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
  outputTokens: rows.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
  unknown: rows.filter((r) => r.inputTokens == null || r.outputTokens == null)
    .length,
});
const probe = read("analysis-subject-probe");
const result = {
  date: new Date().toISOString(),
  image: snapshot.image,
  imageId: snapshot.runtime.web.imageId,
  businessReview: null,
  stablePages: after.publication.length,
  changedBodies: after.publication.filter((p) => p.body.includes("45초"))
    .length,
  unchangedBodies: 1,
  heldOutQuestions: before.queries.length + after.queries.length,
  latestCitationsCurrent: true,
  sourceVersions: [before.source.versionId, after.source.versionId],
  generation: totals(
    snapshot.generations.filter((g) => g.kind !== "wiki-quality"),
  ),
  quality: totals(
    snapshot.generations.filter((g) => g.kind === "wiki-quality"),
  ),
  chats: totals(snapshot.chats),
  failedAttemptsIncluded: totals(
    snapshot.generations.filter((g) => g.state === "failed"),
  ),
  isolatedProbe: totals([probe]),
  overall: totals([...snapshot.generations, ...snapshot.chats, probe]),
  embeddings: {
    calls: snapshot.embeddings.length,
    inputTokens: snapshot.embeddings.reduce(
      (n, e) => n + (e.input_tokens ?? 0),
      0,
    ),
    unknown: snapshot.embeddings.filter((e) => e.input_tokens == null).length,
  },
  qualityReview: {
    staleResolved: 3,
    semanticDeferred: 5,
    counts: snapshot.counts.quality_finding,
    events: snapshot.counts.review_event,
  },
  backup: {
    tables: 48,
    files: 2,
    imageId: backup.appImageId,
    databaseSha256: backup.databaseSha256,
  },
  restored: {
    sourceHashes: true,
    wikiBodies: true,
    savedChats: true,
    readerRole: true,
    views: restored.views.length,
  },
  guards,
  rollback,
};
assert.equal(result.overall.unknown, 0);
assert.equal(result.embeddings.unknown, 0);
writeFileSync(`${out}/summary.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
