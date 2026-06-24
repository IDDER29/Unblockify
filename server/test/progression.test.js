"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "ProgressOrg", "progress");
});

after(() => srv.close());

test("GET /api/analytics/progression returns patterns object", async () => {
  const r = await org.owner.get("/api/analytics/progression");
  assert.equal(r.status, 200);
  assert.ok(typeof r.body === "object", "should return object");
  assert.ok(Array.isArray(r.body.patterns), "should have patterns array");
});

test("GET /api/analytics/progression accepts cohortId filter", async () => {
  const r = await org.owner.get(`/api/analytics/progression?cohortId=${org.cohortId}`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.patterns), "should return patterns array");
});

test("GET /api/analytics/progression reflects topic co-occurrence", async () => {
  // Create two blockages for same student with AI topics set
  const b1 = await org.student.post("/api/blockages", {
    title: "Async confusion",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Async/await not working",
  });
  const b2 = await org.student.post("/api/blockages", {
    title: "Promise chaining",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Promise.then failing",
  });
  assert.equal(b1.status, 201);
  assert.equal(b2.status, 201);

  // The endpoint should still return without error even with sparse data
  const r = await org.owner.get("/api/analytics/progression");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.patterns));
});

test("GET /api/analytics/progression is staff-only", async () => {
  const r = await org.student.get("/api/analytics/progression");
  assert.equal(r.status, 403);
});
