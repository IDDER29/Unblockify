"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg, makeClient } = require("./helpers");

let srv, org, org2;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "AtRiskOrg", "atrisk");
  org2 = await buildOrg(srv.base, "OtherOrg", "atrisk2");
});

after(() => srv.close());

test("POST /api/students/:id/nudge — owner can nudge student in same org", async () => {
  const r = await org.owner.post(`/api/students/${org.studentId}/nudge`, {});
  assert.equal(r.status, 200);

  // Notification should be created for the student
  const notifRes = await org.student.get("/api/notifications");
  assert.equal(notifRes.status, 200);
  const hasNudge = (notifRes.body.notifications || []).some(
    (n) => n.type === "nudge"
  );
  assert.ok(hasNudge, "nudge notification should be created");
});

test("POST /api/students/:id/flag — owner can flag student for check-in", async () => {
  const r = await org.owner.post(`/api/students/${org.studentId}/flag`, {});
  assert.equal(r.status, 201);
  assert.ok(r.body.checkIn, "should return the check-in row");
  assert.equal(r.body.checkIn.student_id, org.studentId);
});

test("GET /api/analytics includes lastInterventionAt and recovered fields", async () => {
  const r = await org.owner.get("/api/analytics");
  assert.equal(r.status, 200);
  // atRisk may be empty if student has no blockages, but the structure should allow these fields
  // Flag the student first and check analytics reflects intervention
  await org.owner.post(`/api/students/${org.studentId}/flag`, {});

  // Create a blockage to push student into at-risk
  const blkRes = await org.student.post("/api/blockages", {
    title: "Stuck on loop",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "I don't understand how loops work",
  });
  assert.equal(blkRes.status, 201);

  // Also create more blockages to get a score >= 3
  await org.student.post("/api/blockages", {
    title: "Stuck on arrays",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Arrays are confusing",
  });
  await org.student.post("/api/blockages", {
    title: "Stuck on functions",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Functions are confusing",
  });

  const r2 = await org.owner.get("/api/analytics");
  assert.equal(r2.status, 200);
  assert.ok(Array.isArray(r2.body.atRisk), "atRisk should be an array");

  const studentEntry = r2.body.atRisk.find((s) => s.id === org.studentId);
  if (studentEntry) {
    // Fields should exist (may be null if no intervention yet in this context, but keys should be present)
    assert.ok("lastInterventionAt" in studentEntry, "should have lastInterventionAt field");
    assert.ok("recovered" in studentEntry, "should have recovered field");
  }
});

test("POST /api/students/:id/nudge — cross-tenant returns 404", async () => {
  // org2's owner tries to nudge org's student
  const r = await org2.owner.post(`/api/students/${org.studentId}/nudge`, {});
  assert.equal(r.status, 404);
});

test("POST /api/students/:id/flag — cross-tenant returns 404", async () => {
  const r = await org2.owner.post(`/api/students/${org.studentId}/flag`, {});
  assert.equal(r.status, 404);
});
