"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg, joinMember } = require("./helpers");

test("auto-assignment: none = unassigned, round_robin spreads across instructors", async () => {
  const srv = await startServer();
  try {
    const org = await buildOrg(srv.base, "AS", "as");
    const ins2 = await joinMember(srv.base, org.owner, "instructor", org.cohortId, "as-ins2");
    await org.owner.post(`/api/cohorts/${org.cohortId}/instructors`, { userId: ins2.user.id });

    // default strategy 'none' → no auto-assign
    const b0 = (await org.student.post("/api/blockages", { title: "n", cohortId: org.cohortId, details: "d" })).body.blockage.id;
    assert.equal(srv.db.prepare("SELECT assignee_id FROM blockages WHERE id=?").get(b0).assignee_id, null);

    // round_robin → two reports land on two different instructors
    srv.db.prepare("UPDATE cohorts SET assign_strategy='round_robin', rr_cursor=0 WHERE id=?").run(org.cohortId);
    const b1 = (await org.student.post("/api/blockages", { title: "a", cohortId: org.cohortId, details: "d" })).body.blockage.id;
    const b2 = (await org.student.post("/api/blockages", { title: "b", cohortId: org.cohortId, details: "d" })).body.blockage.id;
    const a1 = srv.db.prepare("SELECT assignee_id FROM blockages WHERE id=?").get(b1).assignee_id;
    const a2 = srv.db.prepare("SELECT assignee_id FROM blockages WHERE id=?").get(b2).assignee_id;
    assert.ok(a1 && a2, "both auto-assigned");
    assert.notEqual(a1, a2, "round robin spreads across the two instructors");
  } finally {
    await srv.close();
  }
});
