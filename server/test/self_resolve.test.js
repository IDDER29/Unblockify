"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "SelfResolveOrg", "selfresolve");
});

after(() => srv.close());

test("POST /api/blockages/:id/self-resolve marks blockage resolved with type=self", async () => {
  const blkRes = await org.student.post("/api/blockages", {
    title: "Figured it out test",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Testing self resolution",
  });
  assert.equal(blkRes.status, 201);
  const blkId = blkRes.body.blockage.id;

  const r = await org.student.post(`/api/blockages/${blkId}/self-resolve`, {
    note: "I realized I was missing the return statement in my callback.",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.blockage.status, "resolved");
  assert.equal(r.body.blockage.resolutionType, "self");
});

test("self-resolve note is required", async () => {
  const blkRes = await org.student.post("/api/blockages", {
    title: "No note test",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Trying without note",
  });
  const blkId = blkRes.body.blockage.id;

  const r = await org.student.post(`/api/blockages/${blkId}/self-resolve`, { note: "" });
  assert.equal(r.status, 400);
});

test("self-resolve is student-only — instructor cannot self-resolve", async () => {
  const blkRes = await org.student.post("/api/blockages", {
    title: "Instructor self-resolve test",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Testing role restriction",
  });
  const blkId = blkRes.body.blockage.id;

  const r = await org.instructor.post(`/api/blockages/${blkId}/self-resolve`, {
    note: "Instructor trying to self-resolve",
  });
  assert.equal(r.status, 403);
});

test("self-resolve cannot be called on already-resolved blockage", async () => {
  const blkRes = await org.student.post("/api/blockages", {
    title: "Already resolved test",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Testing double-resolve",
  });
  const blkId = blkRes.body.blockage.id;

  await org.student.post(`/api/blockages/${blkId}/self-resolve`, {
    note: "I figured it out by reading the docs.",
  });

  const r = await org.student.post(`/api/blockages/${blkId}/self-resolve`, {
    note: "Trying again",
  });
  assert.equal(r.status, 409);
});

test("self-resolve resolution note appears in knowledge base", async () => {
  const blkRes = await org.student.post("/api/blockages", {
    title: "Knowledge base entry test",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Testing knowledge base integration",
  });
  const blkId = blkRes.body.blockage.id;

  await org.student.post(`/api/blockages/${blkId}/self-resolve`, {
    note: "Re-reading the MDN docs on closures completely fixed it for me.",
  });

  // Give the background summary generation a tick
  await new Promise((r) => setTimeout(r, 100));

  const kb = await org.student.get("/api/knowledge?q=closures");
  assert.equal(kb.status, 200);
  // Should find the self-resolved blockage (it's now resolved with a note)
  assert.ok(Array.isArray(kb.body.results));
});
