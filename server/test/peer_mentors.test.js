"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "PeerOrg", "peer");
});

after(() => srv.close());

test("student can opt in to peer mentorship", async () => {
  const r = await org.student.post("/api/me/peer-mentor-opt-in", {});
  assert.equal(r.status, 200);
  assert.equal(r.body.optedIn, true);
});

test("GET /api/me/peer-mentor-opt-in returns current opt-in status", async () => {
  const r = await org.student.get("/api/me/peer-mentor-opt-in");
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.optedIn, "boolean");
});

test("student can opt out of peer mentorship", async () => {
  await org.student.post("/api/me/peer-mentor-opt-in", {});
  const r = await org.student.del("/api/me/peer-mentor-opt-in");
  assert.equal(r.status, 200);
  assert.equal(r.body.optedIn, false);
});

test("GET /api/blockages/:id/peer-mentors returns array", async () => {
  const blkRes = await org.student.post("/api/blockages", {
    title: "Peer mentor test",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Testing peer mentorship",
  });
  assert.equal(blkRes.status, 201);
  const blkId = blkRes.body.blockage.id;

  const r = await org.student.get(`/api/blockages/${blkId}/peer-mentors`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.mentors), "should return mentors array");
});

test("peer mentor endpoint 403 for instructors", async () => {
  const r = await org.instructor.get("/api/blockages/1/peer-mentors");
  assert.equal(r.status, 403);
});
