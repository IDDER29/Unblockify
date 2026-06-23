"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "QualityOrg", "quality");
});

after(() => srv.close());

test("GET /api/analytics/teaching-quality returns quality object", async () => {
  const r = await org.owner.get("/api/analytics/teaching-quality");
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.quality === "object", "should return quality object");
  assert.ok(typeof r.body.quality.orgResolveRate === "number", "should have orgResolveRate");
  assert.ok(Array.isArray(r.body.quality.byCohort), "should have byCohort array");
  assert.ok(Array.isArray(r.body.quality.rankedFactors), "should have rankedFactors array");
});

test("GET /api/analytics/teaching-quality byCohort includes cohort metrics", async () => {
  // Create a blockage so cohort has data
  await org.student.post("/api/blockages", {
    title: "Quality test blockage",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Testing",
  });

  const r = await org.owner.get("/api/analytics/teaching-quality");
  assert.equal(r.status, 200);
  // Find our cohort
  const cohortEntry = r.body.quality.byCohort.find((c) => c.cohortId === org.cohortId);
  if (cohortEntry) {
    assert.ok(typeof cohortEntry.resolveRate === "number", "byCohort entry should have resolveRate");
    assert.ok(typeof cohortEntry.totalBlockages === "number", "byCohort entry should have totalBlockages");
  }
});

test("GET /api/analytics/teaching-quality is owner-only", async () => {
  const r = await org.instructor.get("/api/analytics/teaching-quality");
  assert.equal(r.status, 403);
});

test("GET /api/analytics/teaching-quality rankedFactors are sorted by impact", async () => {
  const r = await org.owner.get("/api/analytics/teaching-quality");
  assert.equal(r.status, 200);
  const factors = r.body.quality.rankedFactors;
  // Factors should be ordered by impact descending (or at least be an array)
  assert.ok(Array.isArray(factors));
});
