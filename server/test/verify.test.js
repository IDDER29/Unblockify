"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Isolate the email outbox BEFORE startServer reads EMAIL_OUTBOX_DIR.
const OUTBOX = fs.mkdtempSync(path.join(os.tmpdir(), "ubx-"));
process.env.EMAIL_OUTBOX_DIR = OUTBOX;

const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient } = require("./helpers");

function verifyMessages() {
  return fs
    .readdirSync(OUTBOX)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), "utf8")))
    .filter((m) => (m.text || "").includes("verify.html?token="));
}
function tokenFrom(msg) {
  const m = /verify\.html\?token=([A-Za-z0-9_-]+)/.exec(msg.text || "");
  return m && m[1];
}

test("email verification flow", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const base = srv.base;

  const client = makeClient(base);
  const signup = await client.post("/api/auth/signup", {
    orgName: "VerifyCo",
    name: "Vera",
    email: "vera@x.com",
    password: "pass1234",
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.user.emailVerified, false, "starts unverified");

  // The signup wrote a verify email in the background; wait for it to land.
  let msg;
  for (let i = 0; i < 50 && !msg; i++) {
    msg = verifyMessages().find((m) => m.to === "vera@x.com");
    if (!msg) await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(msg, "verify email written to outbox");
  const token = tokenFrom(msg);
  assert.ok(token, "token parsed from email");

  // Verify the token.
  const v = await makeClient(base).get("/api/auth/verify?token=" + token);
  assert.equal(v.status, 200);
  assert.deepEqual(v.body, { ok: true, email: "vera@x.com" });

  // The session now reports the user as verified.
  const me = await client.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.user.emailVerified, true, "verified after confirm");

  // A bogus token → 400.
  const bogus = await makeClient(base).get("/api/auth/verify?token=nope-not-real");
  assert.equal(bogus.status, 400);
});
