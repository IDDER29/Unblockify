"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg, joinMember } = require("./helpers");

test("staff sees a student's 360 profile; cross-tenant is 404", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");
    // student reports two blockages, owner resolves one
    const c = await a.student.post("/api/blockages", {
      title: "stuck on routing", cohortId: a.cohortId, details: "help me",
    });
    await a.student.post("/api/blockages", {
      title: "css overflow", cohortId: a.cohortId, details: "scroll bug",
    });
    await a.owner.post(`/api/blockages/${c.body.blockage.id}/resolve`, {
      type: "guidedSupport", note: "fixed it",
    });

    const prof = await a.owner.get(`/api/members/${a.studentId}/profile`);
    assert.equal(prof.status, 200);
    assert.equal(prof.body.student.id, a.studentId);
    assert.equal(prof.body.stats.total, 2);
    assert.equal(prof.body.stats.resolved, 1);
    assert.equal(prof.body.recent.length, 2);

    // tenant isolation: org B owner cannot see org A's student
    const b = await buildOrg(srv.base, "Beta", "b");
    const x = await b.owner.get(`/api/members/${a.studentId}/profile`);
    assert.equal(x.status, 404);

    // students cannot call the staff endpoint
    const s = await a.student.get(`/api/members/${a.studentId}/profile`);
    assert.equal(s.status, 403);
  } finally {
    await srv.close();
  }
});
