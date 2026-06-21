"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { startServer, buildOrg, joinMember } = require("./helpers");

test("owner moves a cohort's students + blockages, then can delete the empty cohort", async () => {
  const srv = await startServer();
  try {
    const { owner, student, cohortId, briefId, studentId } = await buildOrg(
      srv.base,
      "MoveCo",
      "move"
    );

    // Destination cohort B.
    const cB = await owner.post("/api/cohorts", { name: "Cohort B" });
    assert.equal(cB.status, 201, "create cohort B");
    const cohortB = cB.body.cohort.id;

    // Student reports a blockage in cohort A.
    const rep = await student.post("/api/blockages", {
      title: "Stuck on flexbox",
      details: "Items won't wrap as expected.",
      cohortId,
      briefId,
    });
    assert.equal(rep.status, 201, "blockage created");
    const blockageId = rep.body.blockage.id;

    // Deleting non-empty cohort A is refused (was previously 409).
    const refused = await owner.del(`/api/cohorts/${cohortId}`);
    assert.equal(refused.status, 409, "delete blocked while non-empty");

    // Owner moves students + blockages A -> B.
    const moved = await owner.post(`/api/cohorts/${cohortId}/move-students`, {
      toCohortId: cohortB,
    });
    assert.equal(moved.status, 200, "move ok");
    assert.equal(moved.body.ok, true);
    assert.equal(moved.body.movedStudents, 1, "one student moved");
    assert.equal(moved.body.movedBlockages, 1, "one blockage moved");

    // Same-cohort move is rejected.
    const same = await owner.post(`/api/cohorts/${cohortId}/move-students`, {
      toCohortId: cohortId,
    });
    assert.equal(same.status, 400, "same id rejected");

    // The student now lives in cohort B (per /api/members).
    const members = await owner.get("/api/members");
    const stu = members.body.members.find((m) => m.id === studentId);
    assert.ok(stu, "student present in members");
    assert.equal(stu.cohort_id, cohortB, "student moved to cohort B");

    // The blockage now belongs to cohort B.
    const blk = await owner.get(`/api/blockages/${blockageId}`);
    assert.equal(blk.status, 200, "fetch blockage");
    assert.equal(blk.body.blockage.cohortId, cohortB, "blockage moved to cohort B");

    // Cohort A is now empty and can be deleted.
    const del = await owner.del(`/api/cohorts/${cohortId}`);
    assert.equal(del.status, 200, "empty cohort deletes");
    assert.equal(del.body.ok, true);
  } finally {
    await srv.close();
  }
});

test("owner analytics at-risk includes cohort-less students", async () => {
  const srv = await startServer();
  try {
    const { owner } = await buildOrg(srv.base, "RiskCo", "risk");

    // A student with no cohort — the most stuck (can't even report).
    const lonely = await joinMember(srv.base, owner, "student", null, "lonely");
    assert.ok(lonely.user, "cohort-less student joined");

    const an = await owner.get("/api/analytics");
    assert.equal(an.status, 200, "analytics ok");
    const entry = an.body.atRisk.find(
      (s) => Array.isArray(s.reasons) && s.reasons.includes("no cohort")
    );
    assert.ok(entry, "at-risk contains a 'no cohort' entry");
    assert.equal(entry.name, "lonely", "the cohort-less student is flagged");
  } finally {
    await srv.close();
  }
});
