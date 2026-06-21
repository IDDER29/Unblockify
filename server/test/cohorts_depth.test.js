"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("cohort detail lists students; brief rename; student removal", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const org = await buildOrg(srv.base, "Acme", "acme");

  // (1) GET /api/cohorts/:id includes the buildOrg student in `students`.
  let detail = await org.owner.get(`/api/cohorts/${org.cohortId}`);
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.body.cohort.students), "students is an array");
  const listed = detail.body.cohort.students.find((s) => s.id === org.studentId);
  assert.ok(listed, "buildOrg student is listed");
  assert.equal(listed.name, "Stu Acme");
  assert.equal(listed.email, "acme-stu@x.com");

  // (2) Rename a brief via PUT /api/briefs/:id; new name shows in cohort detail.
  const renamed = await org.owner.put(`/api/briefs/${org.briefId}`, { name: "Renamed Brief" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.brief.name, "Renamed Brief");

  detail = await org.owner.get(`/api/cohorts/${org.cohortId}`);
  const brief = detail.body.cohort.briefs.find((b) => b.id === org.briefId);
  assert.ok(brief, "brief still present");
  assert.equal(brief.name, "Renamed Brief", "renamed name reflected in detail");

  // Empty name is rejected.
  const empty = await org.owner.put(`/api/briefs/${org.briefId}`, { name: "   " });
  assert.equal(empty.status, 400);

  // (3) Remove the student from the cohort; detail no longer lists them.
  const removed = await org.owner.put(`/api/members/${org.studentId}`, { cohortId: null });
  assert.equal(removed.status, 200);

  detail = await org.owner.get(`/api/cohorts/${org.cohortId}`);
  const stillThere = detail.body.cohort.students.find((s) => s.id === org.studentId);
  assert.ok(!stillThere, "removed student no longer listed in cohort");
});
