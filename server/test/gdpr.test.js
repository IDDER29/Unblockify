"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("gdpr: org export includes student blockage; student forbidden", async () => {
  const { base, close } = await startServer();
  try {
    const a = await buildOrg(base, "Acme", "acme");
    const rep = await a.student.post("/api/blockages", {
      title: "Stuck on X", cohortId: a.cohortId, details: "help",
    });
    assert.equal(rep.status, 201);

    // (1) owner org export
    const orgExp = await a.owner.get("/api/export/org.json");
    assert.equal(orgExp.status, 200);
    assert.ok(orgExp.body.org && orgExp.body.org.slug.startsWith("acme"));
    assert.ok(Array.isArray(orgExp.body.users) && orgExp.body.users.length >= 3);
    assert.ok(Array.isArray(orgExp.body.blockages));
    assert.ok(
      orgExp.body.blockages.some((b) => b.title === "Stuck on X"),
      "student's blockage present in export"
    );

    // (2) student forbidden
    const stu = await a.student.get("/api/export/org.json");
    assert.equal(stu.status, 403);
  } finally {
    await close();
  }
});

test("gdpr: user export tenant-guarded (cross-org → 404)", async () => {
  const { base, close } = await startServer();
  try {
    const a = await buildOrg(base, "Acme", "acme");
    const b = await buildOrg(base, "Beta", "beta");

    const own = await a.owner.get(`/api/export/users/${a.studentId}.json`);
    assert.equal(own.status, 200);
    assert.equal(own.body.user.id, a.studentId);

    // (3) cross-tenant target → 404
    const cross = await a.owner.get(`/api/export/users/${b.studentId}.json`);
    assert.equal(cross.status, 404);
  } finally {
    await close();
  }
});

test("gdpr: erasure deletes blockages + anonymizes; cannot erase self", async () => {
  const { base, db, close } = await startServer();
  try {
    const a = await buildOrg(base, "Acme", "acme");
    await a.student.post("/api/blockages", {
      title: "Erase me", cohortId: a.cohortId, details: "d",
    });

    // (4) owner erases the student
    const del = await a.owner.del(`/api/users/${a.studentId}/data`);
    assert.equal(del.status, 200);
    assert.equal(del.body.ok, true);

    const blk = db
      .prepare("SELECT COUNT(*) AS n FROM blockages WHERE user_id = ?")
      .get(a.studentId);
    assert.equal(blk.n, 0, "student's blockages deleted");

    const members = await a.owner.get("/api/members");
    assert.equal(members.status, 200);
    const erased = members.body.members.find((m) => m.id === a.studentId);
    assert.ok(erased, "erased user still listed");
    assert.equal(erased.name, "Deleted user");
    assert.match(erased.email, /^deleted\+\d+@removed\.invalid$/);

    const audited = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?")
      .get("gdpr.user_delete");
    assert.ok(audited.n >= 1, "erasure audited");

    // (5) owner cannot erase self
    const ownerId = db
      .prepare("SELECT id FROM users WHERE org_id = ? AND role = 'owner'")
      .get(
        db.prepare("SELECT org_id FROM users WHERE id = ?").get(a.studentId).org_id
      ).id;
    const self = await a.owner.del(`/api/users/${ownerId}/data`);
    assert.equal(self.status, 400);
  } finally {
    await close();
  }
});
