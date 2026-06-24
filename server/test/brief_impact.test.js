"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "ImpactOrg", "impact");
});

after(() => srv.close());

test("GET /api/briefs/:id/impact returns impact stats", async () => {
  // Report a blockage on the brief
  const blkRes = await org.student.post("/api/blockages", {
    title: "Brief impact test blockage",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Test",
  });
  assert.equal(blkRes.status, 201);

  const r = await org.owner.get(`/api/briefs/${org.briefId}/impact`);
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.impact === "object", "should return impact object");
  assert.ok(typeof r.body.impact.totalBlockages === "number", "should have totalBlockages");
  assert.ok(typeof r.body.impact.resolvedBlockages === "number", "should have resolvedBlockages");
  assert.ok(typeof r.body.impact.resolveRate === "number", "should have resolveRate");
});

test("GET /api/briefs/:id/impact resolve rate 0 before any resolved", async () => {
  const r = await org.owner.get(`/api/briefs/${org.briefId}/impact`);
  assert.equal(r.status, 200);
  assert.equal(r.body.impact.resolvedBlockages, 0);
  assert.equal(r.body.impact.resolveRate, 0);
});

test("GET /api/briefs/:id/impact updates after resolution", async () => {
  const blkRes = await org.student.post("/api/blockages", {
    title: "Impact resolution test",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "For resolution",
  });
  const blkId = blkRes.body.blockage.id;

  // Claim and resolve
  await org.instructor.post(`/api/blockages/${blkId}/claim`);
  await org.instructor.post(`/api/blockages/${blkId}/resolve`, {
    type: "explained",
    note: "Explained the concept",
  });

  const r = await org.owner.get(`/api/briefs/${org.briefId}/impact`);
  assert.equal(r.status, 200);
  assert.ok(r.body.impact.resolvedBlockages >= 1, "should count resolved blockage");
  assert.ok(r.body.impact.resolveRate > 0, "resolve rate should be positive");
});

test("GET /api/briefs/:id/impact 404 for unknown brief", async () => {
  const r = await org.owner.get("/api/briefs/99999/impact");
  assert.equal(r.status, 404);
});
