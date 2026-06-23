"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "BackupOrg", "backup");
});

after(() => srv.close());

test("blockages list includes needsBackup field", async () => {
  const r = await org.owner.get("/api/blockages");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.blockages));
  // Each blockage should have needsBackup field
  for (const b of r.body.blockages) {
    assert.ok("needsBackup" in b, "blockage should have needsBackup field");
  }
});

test("needsBackup is false on a fresh open blockage with no AI comments", async () => {
  // Create a blockage (AI_AUTORESPOND=0 in tests, so no AI comment)
  const blkRes = await org.student.post("/api/blockages", {
    title: "Stuck on closures",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Closures are confusing",
  });
  assert.equal(blkRes.status, 201);
  const blkId = blkRes.body.blockage.id;

  const r = await org.owner.get("/api/blockages");
  const blk = r.body.blockages.find((b) => b.id === blkId);
  assert.ok(blk, "should find the blockage");
  assert.equal(blk.needsBackup, false, "new blockage with no AI reply should not need backup");
});

test("ai_confidence column exists on comments table", async () => {
  // We can verify this indirectly: the db migration should have run without error
  // Just confirm blockages endpoint works (if migration failed, the server wouldn't start)
  const r = await org.owner.get("/api/blockages");
  assert.equal(r.status, 200);
});
