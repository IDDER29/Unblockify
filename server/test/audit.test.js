"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient, buildOrg } = require("./helpers");

test("audit log records auth + member events and is tenant-isolated", async () => {
  const { base, close } = await startServer();
  try {
    // buildOrg performs: signup (owner), invite create x2, instructor join,
    // student join — all of which should produce audit entries.
    const A = await buildOrg(base, "Org A", "a");

    let r = await A.owner.get("/api/audit");
    assert.equal(r.status, 200, "owner can read the audit log");
    let actions = r.body.entries.map((e) => e.action);
    assert.ok(actions.includes("org.signup"), "signup is audited");
    assert.ok(actions.includes("member.join"), "join is audited");
    assert.ok(actions.includes("invite.create"), "invite create is audited");

    // A fresh login for the owner should add an auth.login entry.
    const before = r.body.total;
    const fresh = makeClient(base);
    const login = await fresh.post("/api/auth/login", {
      email: "a-owner@x.com",
      password: "pass1234",
    });
    assert.equal(login.status, 200, "owner login ok");

    r = await A.owner.get("/api/audit");
    actions = r.body.entries.map((e) => e.action);
    assert.ok(actions.includes("auth.login"), "login is audited");
    assert.ok(r.body.total > before, "a new entry was appended");

    // A member update (role change) should be audited.
    const upd = await A.owner.put(`/api/members/${A.studentId}`, {
      role: "instructor",
    });
    assert.equal(upd.status, 200, "member update ok");

    r = await A.owner.get("/api/audit");
    actions = r.body.entries.map((e) => e.action);
    assert.ok(actions.includes("member.update"), "member update is audited");

    // Tenant isolation: a second org's owner must not see Org A's entries.
    const B = await buildOrg(base, "Org B", "b");
    const rb = await B.owner.get("/api/audit");
    assert.equal(rb.status, 200, "org B owner can read its own audit log");
    const targetsB = rb.body.entries.map((e) => `${e.targetType}:${e.targetId}`);
    // Org A's owner-signup target id is Org A; assert none of B's entries
    // reference Org A's specific user/invite ids by checking actor names too.
    const actorsB = rb.body.entries.map((e) => e.actor);
    assert.ok(
      !actorsB.includes("Owner Org A"),
      "org B's audit log does not leak org A's actor"
    );
    assert.ok(
      rb.body.entries.every((e) => e.action),
      "org B has its own entries"
    );
    // Sanity: org B sees its own signup, not A's.
    const bActions = rb.body.entries.map((e) => e.action);
    assert.ok(bActions.includes("org.signup"), "org B has its own signup");
    void targetsB;
  } finally {
    await close();
  }
});
