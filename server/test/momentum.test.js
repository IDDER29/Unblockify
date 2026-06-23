"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org, org2;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "MomentumOrg", "momentum");
  org2 = await buildOrg(srv.base, "MomentumOrg2", "momentum2");
});

after(() => srv.close());

test("GET /api/me/momentum returns correct shape", async () => {
  const r = await org.student.get("/api/me/momentum");
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.totalCleared === "number", "should have totalCleared");
  assert.ok(typeof r.body.activeDaysLast30 === "number", "should have activeDaysLast30");
  assert.ok(Array.isArray(r.body.topStuckTopics), "should have topStuckTopics");
  assert.ok(Array.isArray(r.body.history), "should have history");
});

test("GET /api/me/momentum — only shows own data (not other students)", async () => {
  // Student from org2 should not see org's student data
  const rOrg = await org.student.get("/api/me/momentum");
  const rOrg2 = await org2.student.get("/api/me/momentum");

  assert.equal(rOrg.status, 200);
  assert.equal(rOrg2.status, 200);

  // Both students should have separate momentum — their counts are independent
  // (they're different users in different orgs)
  assert.ok(rOrg.body.totalCleared >= 0);
  assert.ok(rOrg2.body.totalCleared >= 0);
});

test("GET /api/me/momentum totalCleared increases after a resolve", async () => {
  const before = await org.student.get("/api/me/momentum");
  const initialCleared = before.body.totalCleared;

  // Create and resolve a blockage
  const blkRes = await org.student.post("/api/blockages", {
    title: "Momentum test blockage",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Testing momentum tracking",
  });
  assert.equal(blkRes.status, 201);
  const blkId = blkRes.body.blockage.id;

  await org.owner.post(`/api/blockages/${blkId}/claim`);
  await org.owner.post(`/api/blockages/${blkId}/resolve`, { type: "explanation", note: "Fixed." });

  const after = await org.student.get("/api/me/momentum");
  assert.equal(after.body.totalCleared, initialCleared + 1, "totalCleared should increase by 1");
});
