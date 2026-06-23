"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "TeachingOrg", "teaching");
});

after(() => srv.close());

test("GET /api/me/teaching returns teaching stats for instructor", async () => {
  const r = await org.instructor.get("/api/me/teaching");
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.teaching === "object", "should return teaching object");
  assert.ok(typeof r.body.teaching.totalResolved === "number", "should have totalResolved");
  assert.ok(Array.isArray(r.body.teaching.byTopic), "should have byTopic array");
});

test("GET /api/me/teaching reflects resolved blockages", async () => {
  // Report and resolve a blockage to populate stats
  const blkRes = await org.student.post("/api/blockages", {
    title: "Teaching test blockage",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "async/await confusion",
  });
  const blkId = blkRes.body.blockage.id;
  await org.instructor.post(`/api/blockages/${blkId}/claim`);
  await org.instructor.post(`/api/blockages/${blkId}/resolve`, { type: "explained", note: "Walked through async" });

  const r = await org.instructor.get("/api/me/teaching");
  assert.equal(r.status, 200);
  assert.ok(r.body.teaching.totalResolved >= 1, "should count at least one resolved");
});

test("GET /api/me/teaching is private — student cannot access", async () => {
  const r = await org.student.get("/api/me/teaching");
  assert.equal(r.status, 403);
});

test("GET /api/me/teaching returns avgResolveHours", async () => {
  const r = await org.instructor.get("/api/me/teaching");
  assert.equal(r.status, 200);
  assert.ok("avgResolveHours" in r.body.teaching, "should have avgResolveHours");
});
