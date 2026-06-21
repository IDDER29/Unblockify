"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg: buildOrgH, joinMember: joinMemberH } = require("./helpers");

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv.close();
});

const buildOrg = (orgName, prefix) => buildOrgH(srv.base, orgName, prefix);
const joinMember = (owner, role, cohortId, email) =>
  joinMemberH(srv.base, owner, role, cohortId, email);

test("staff can reassign a blockage to a second instructor", async () => {
  const org = await buildOrg("Assign", "assign");

  // A second instructor, joined and assigned to the cohort.
  const ins2 = await joinMember(org.owner, "instructor", org.cohortId, "assign-ins2");
  await org.owner.post(`/api/cohorts/${org.cohortId}/instructors`, {
    userId: ins2.user.id,
  });

  const rep = await org.student.post("/api/blockages", {
    title: "needs reassign",
    cohortId: org.cohortId,
    details: "d",
  });
  const blkId = rep.body.blockage.id;

  // Eligible assignees include the second instructor.
  const list = await org.owner.get(`/api/blockages/${blkId}/assignees`);
  assert.equal(list.status, 200);
  assert.ok(list.body.assignees.some((a) => a.id === ins2.user.id));

  // Owner reassigns to the second instructor → status becomes in_support.
  const assigned = await org.owner.post(`/api/blockages/${blkId}/assign`, {
    assigneeId: ins2.user.id,
  });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.blockage.status, "in_support");

  // The second instructor now sees it as the assignee.
  const detail = await ins2.client.get(`/api/blockages/${blkId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.blockage.assigneeId, ins2.user.id);

  // An instructor can also reassign (back to themselves here works too).
  const reassign = await org.instructor.post(`/api/blockages/${blkId}/assign`, {
    assigneeId: org.instructorId,
  });
  assert.equal(reassign.status, 200);
  assert.equal(reassign.body.blockage.assigneeName, "Ins Assign");

  // Bad assignee (the student) is rejected.
  const bad = await org.owner.post(`/api/blockages/${blkId}/assign`, {
    assigneeId: org.studentId,
  });
  assert.equal(bad.status, 400);
});

test("student can reopen an AI-resolved blockage", async () => {
  const org = await buildOrg("AiReopen", "aireopen");
  const rep = await org.student.post("/api/blockages", {
    title: "ai resolved",
    cohortId: org.cohortId,
    details: "d",
  });
  const blkId = rep.body.blockage.id;

  // Student marks it AI-resolved.
  const ai = await org.student.post(`/api/blockages/${blkId}/ai-resolve`);
  assert.equal(ai.body.blockage.status, "resolved");

  // Student reopens it.
  const re = await org.student.post(`/api/blockages/${blkId}/student-reopen`);
  assert.equal(re.status, 200);
  assert.equal(re.body.blockage.status, "open");

  // A 'reopened' event is recorded.
  const detail = await org.student.get(`/api/blockages/${blkId}`);
  assert.ok(detail.body.blockage.events.some((e) => e.type === "reopened"));
});

test("student cannot reopen an instructor-resolved blockage", async () => {
  const org = await buildOrg("HumanRes", "humanres");
  const rep = await org.student.post("/api/blockages", {
    title: "human resolved",
    cohortId: org.cohortId,
    details: "d",
  });
  const blkId = rep.body.blockage.id;

  await org.instructor.post(`/api/blockages/${blkId}/resolve`, {
    type: "guidedSupport",
    note: "fixed it together",
  });

  const re = await org.student.post(`/api/blockages/${blkId}/student-reopen`);
  assert.ok(re.status >= 400, "student-reopen is rejected for a human resolution");
  assert.equal(re.status, 409);
});
