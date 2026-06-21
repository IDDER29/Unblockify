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
const joinMember = (owner, role, cohortId, email) => joinMemberH(srv.base, owner, role, cohortId, email);

test("owner can rename their organization; empty name rejected", async () => {
  const org = await buildOrg("Renamable", "rename");

  const ok = await org.owner.put("/api/org", { name: "New Name Inc" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.org.name, "New Name Inc");

  const me = await org.owner.get("/api/auth/me");
  assert.equal(me.body.org.name, "New Name Inc");

  const empty = await org.owner.put("/api/org", { name: "   " });
  assert.equal(empty.status, 400);

  // non-owner can't rename
  const stuTry = await org.student.put("/api/org", { name: "Hijack" });
  assert.equal(stuTry.status, 403);
});

test("owner can transfer ownership to another member", async () => {
  const org = await buildOrg("Transfer", "transfer");

  const tr = await org.owner.post(`/api/members/${org.instructorId}/transfer-ownership`);
  assert.equal(tr.status, 200);
  assert.equal(tr.body.ok, true);

  // the instructor is now the owner
  const insMe = await org.instructor.get("/api/auth/me");
  assert.equal(insMe.body.user.role, "owner");

  // the original owner is now an instructor
  const oldMe = await org.owner.get("/api/auth/me");
  assert.equal(oldMe.body.user.role, "instructor");

  // and is denied the owner-only invite route (their session was refreshed to instructor)
  const denied = await org.owner.post("/api/invites", { role: "student" });
  assert.equal(denied.status, 403);
});

test("owner can't transfer ownership to themselves", async () => {
  const org = await buildOrg("SelfTransfer", "selftransfer");
  const me = await org.owner.get("/api/auth/me");
  const self = await org.owner.post(`/api/members/${me.body.user.id}/transfer-ownership`);
  assert.equal(self.status, 400);
});
