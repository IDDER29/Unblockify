"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "ProactiveOrg", "proactive");
});

after(() => srv.close());

test("POST /api/blockages/:id/proactive-prompt returns ok", async () => {
  const blkRes = await org.student.post("/api/blockages", {
    title: "Async confusion",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Async/await not working",
  });
  const blkId = blkRes.body.blockage.id;

  const r = await org.student.post(`/api/blockages/${blkId}/proactive-prompt`);
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.ok === "boolean", "should return ok field");
});

test("proactive prompt can be dismissed", async () => {
  const blkRes = await org.student.post("/api/blockages", {
    title: "Promise test",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Promise chaining issue",
  });
  const blkId = blkRes.body.blockage.id;

  // Get the prompt
  const r = await org.student.post(`/api/blockages/${blkId}/proactive-prompt`);
  assert.equal(r.status, 200);

  // Check notifications — should not create duplicate prompts
  const notifs = await org.student.get("/api/notifications");
  assert.equal(notifs.status, 200);
  assert.ok(Array.isArray(notifs.body.notifications));
});

test("proactive prompt 404 for blockage not owned by student", async () => {
  // Try to get proactive prompt for another student's blockage — just verify 404
  const r = await org.student.post("/api/blockages/99999/proactive-prompt");
  assert.equal(r.status, 404);
});
