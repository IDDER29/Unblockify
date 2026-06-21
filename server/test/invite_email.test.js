"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Point the email outbox at a fresh temp dir BEFORE startServer (which only
// sets EMAIL_OUTBOX_DIR if it's still undefined).
const OUTBOX = fs.mkdtempSync(path.join(os.tmpdir(), "ubx-"));
process.env.EMAIL_OUTBOX_DIR = OUTBOX;

const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient } = require("./helpers");

// Find outbox files whose JSON `text` contains a join link (signup also writes
// verification emails into the same dir, so filter by content).
function joinLinkFiles() {
  return fs
    .readdirSync(OUTBOX)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), "utf8")))
    .filter((m) => typeof m.text === "string" && m.text.includes("join.html?code="));
}

test("invite create emails the join link when given an email", async () => {
  const srv = await startServer();
  try {
    const owner = makeClient(srv.base);
    const s = await owner.post("/api/auth/signup", {
      orgName: "Acme", name: "Owner", email: "owner@x.com", password: "pass1234",
    });
    assert.equal(s.status, 201);

    const before = joinLinkFiles().length;

    // Invite WITH an email → emailed:true + one new join-link file containing the code.
    const r1 = await owner.post("/api/invites", { role: "student", email: "newstu@x.com" });
    assert.equal(r1.status, 201);
    assert.equal(r1.body.emailed, true);
    const code = r1.body.invite.code;

    const afterEmail = joinLinkFiles();
    assert.equal(afterEmail.length, before + 1, "one new join-link email written");
    const sent = afterEmail.find((m) => m.text.includes(code));
    assert.ok(sent, "an email contains the invite code");
    assert.ok(sent.text.includes("join.html?code="), "email text has the join link");

    // Invite WITHOUT an email → emailed:false + no new join-link file.
    const r2 = await owner.post("/api/invites", { role: "student" });
    assert.equal(r2.status, 201);
    assert.equal(r2.body.emailed, false);
    assert.equal(joinLinkFiles().length, before + 1, "no new join-link email written");
  } finally {
    await srv.close();
  }
});
