"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Isolate the email outbox BEFORE startServer reads EMAIL_OUTBOX_DIR.
const OUTBOX = fs.mkdtempSync(path.join(os.tmpdir(), "ubx-"));
process.env.EMAIL_OUTBOX_DIR = OUTBOX;

const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient, buildOrg } = require("./helpers");

// Read all outbox files, return their parsed JSON.
function outboxMessages() {
  return fs
    .readdirSync(OUTBOX)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), "utf8")));
}
function resetMessages() {
  return outboxMessages().filter((m) => (m.text || "").includes("reset.html?token="));
}
// Email is written asynchronously (best-effort, not awaited by the route);
// wait until the reset-email count reaches `n`.
async function waitForResetCount(n) {
  for (let i = 0; i < 50; i++) {
    if (resetMessages().length >= n) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}
function tokenFrom(msg) {
  const m = /reset\.html\?token=([A-Za-z0-9_-]+)/.exec(msg.text || "");
  return m && m[1];
}

test("password reset flow", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const base = srv.base;

  const org = await buildOrg(base, "ResetCo", "rc");
  const ownerEmail = "rc-owner@x.com";

  // (a) Unknown email → 200 and no reset email written.
  const before = resetMessages().length;
  const r1 = await org.owner.post("/api/auth/forgot", { email: "nobody-here@x.com" });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.body, { ok: true });
  // Give any (erroneous) background write a chance to land before asserting none.
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(resetMessages().length, before, "no reset email for unknown address");

  // (b) Known email → 200 and exactly one new reset email.
  const r2 = await org.owner.post("/api/auth/forgot", { email: ownerEmail });
  assert.equal(r2.status, 200);
  await waitForResetCount(before + 1);
  const msgs = resetMessages();
  assert.equal(msgs.length, before + 1, "one reset email for the owner");
  const msg = msgs[msgs.length - 1];
  assert.equal(msg.to, ownerEmail);
  const token = tokenFrom(msg);
  assert.ok(token, "token parsed from email");

  // Reset succeeds; new password works, old one no longer does.
  const fresh = makeClient(base);
  const r3 = await fresh.post("/api/auth/reset", { token, password: "newpass1" });
  assert.equal(r3.status, 200);
  assert.deepEqual(r3.body, { ok: true });

  const goodLogin = await makeClient(base).post("/api/auth/login", {
    email: ownerEmail,
    password: "newpass1",
  });
  assert.equal(goodLogin.status, 200, "login with new password");

  const badLogin = await makeClient(base).post("/api/auth/login", {
    email: ownerEmail,
    password: "pass1234",
  });
  assert.equal(badLogin.status, 401, "old password rejected");

  // (c) Reusing the same (now used) token → 400.
  const reuse = await makeClient(base).post("/api/auth/reset", {
    token,
    password: "another1",
  });
  assert.equal(reuse.status, 400);

  // (d) A bogus token → 400.
  const bogus = await makeClient(base).post("/api/auth/reset", {
    token: "totally-made-up-token",
    password: "another1",
  });
  assert.equal(bogus.status, 400);

  // Short password with a valid (fresh) token is rejected.
  const priorCount = resetMessages().length;
  await org.owner.post("/api/auth/forgot", { email: ownerEmail });
  await waitForResetCount(priorCount + 1);
  const freshToken = tokenFrom(resetMessages().pop());
  const tooShort = await makeClient(base).post("/api/auth/reset", {
    token: freshToken,
    password: "123",
  });
  assert.equal(tooShort.status, 400);
});
