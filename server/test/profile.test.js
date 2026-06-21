"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg, makeClient } = require("./helpers");

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

test("PUT /api/auth/me updates the name and /me reflects it", async () => {
  const { student } = await buildOrg(srv.base, "Prof", "prof");

  const r = await student.put("/api/auth/me", { name: "Renamed Student" });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.name, "Renamed Student");

  const me = await student.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.user.name, "Renamed Student");
});

test("empty name is rejected", async () => {
  const { instructor } = await buildOrg(srv.base, "ProfEmpty", "profempty");
  const r = await instructor.put("/api/auth/me", { name: "   " });
  assert.equal(r.status, 400);
});

test("change password with correct current password succeeds; new login works, old fails", async () => {
  const { student } = await buildOrg(srv.base, "ProfPwd", "profpwd");

  const r = await student.put("/api/auth/me", {
    currentPassword: "pass1234",
    newPassword: "newsecret",
  });
  assert.equal(r.status, 200);

  // Fresh client logs in with the new password.
  const fresh = makeClient(srv.base);
  const okLogin = await fresh.post("/api/auth/login", {
    email: "profpwd-stu@x.com",
    password: "newsecret",
  });
  assert.equal(okLogin.status, 200);

  // Old password no longer works.
  const badLogin = makeClient(srv.base);
  const failLogin = await badLogin.post("/api/auth/login", {
    email: "profpwd-stu@x.com",
    password: "pass1234",
  });
  assert.equal(failLogin.status, 401);
});

test("wrong current password is rejected", async () => {
  const { student } = await buildOrg(srv.base, "ProfWrong", "profwrong");
  const r = await student.put("/api/auth/me", {
    currentPassword: "wrongpass",
    newPassword: "anothersecret",
  });
  assert.ok(r.status >= 400, "expected a non-2xx status");
});

test("short new password is rejected", async () => {
  const { student } = await buildOrg(srv.base, "ProfShort", "profshort");
  const r = await student.put("/api/auth/me", {
    currentPassword: "pass1234",
    newPassword: "abc",
  });
  assert.equal(r.status, 400);
});
