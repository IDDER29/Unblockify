"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org, org2;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "AtRiskOrg", "atrisk");
  org2 = await buildOrg(srv.base, "OtherOrg", "atrisk2");
});

after(() => srv.close());

test("nudge writes a notification to the student", async () => {
  const r = await org.owner.post(`/api/students/${org.studentId}/nudge`, {
    message: "Hey, check in soon!",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);

  // Notification should be created for the student
  const notifRes = await org.student.get("/api/notifications");
  assert.equal(notifRes.status, 200);
  const hasNudge = (notifRes.body.notifications || []).some(
    (n) => n.type === "nudge" && n.body === "Hey, check in soon!"
  );
  assert.ok(hasNudge, "nudge notification should be created");
});

test("flag creates a check_in row", async () => {
  const r = await org.owner.post(`/api/students/${org.studentId}/flag`, {
    note: "Struggling with module 3",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.checkIn, "should return the check-in row");
  assert.equal(r.body.checkIn.student_id, org.studentId);
  assert.equal(r.body.checkIn.note, "Struggling with module 3");
  assert.equal(r.body.checkIn.status, "open");
});

test("at-risk response includes lastInterventionAt and recovered fields", async () => {
  // Flag the student first and check analytics reflects intervention
  await org.owner.post(`/api/students/${org.studentId}/flag`, {});

  // Create blockages to push student into at-risk
  await org.student.post("/api/blockages", {
    title: "Stuck on loop",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "I don't understand how loops work",
  });
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

  const r = await org.owner.get("/api/analytics");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.atRisk), "atRisk should be an array");

  const studentEntry = r.body.atRisk.find((s) => s.id === org.studentId);
  assert.ok(studentEntry, `student ${org.studentId} should be in atRisk list`);
  assert.ok("lastInterventionAt" in studentEntry, "should have lastInterventionAt field");
  assert.ok("recovered" in studentEntry, "should have recovered field");
});

test("cross-tenant 404: student from org B cannot be nudged by org A staff", async () => {
  const r = await org2.owner.post(`/api/students/${org.studentId}/nudge`, {
    message: "Cross-tenant nudge attempt",
  });
  assert.equal(r.status, 404, "should return 404 for cross-tenant nudge");
});

test("cross-tenant 404: student from org B cannot be flagged by org A staff", async () => {
  const r = await org2.owner.post(`/api/students/${org.studentId}/flag`, {
    note: "Cross-tenant flag attempt",
  });
  assert.equal(r.status, 404, "should return 404 for cross-tenant flag");
});
