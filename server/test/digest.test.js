"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Fresh outbox BEFORE startServer.
const OUTBOX = fs.mkdtempSync(path.join(os.tmpdir(), "ubx-"));
process.env.EMAIL_OUTBOX_DIR = OUTBOX;

const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

function digestFiles() {
  return fs
    .readdirSync(OUTBOX)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(OUTBOX, f), "utf8")); } catch (_) { return null; } })
    .filter((m) => m && typeof m.subject === "string" && m.subject.includes("updates on Unblockify"));
}

test("notification digest emails unread notifications", async () => {
  const srv = await startServer();
  try {
    const org = await buildOrg(srv.base, "Acme", "acme");

    // Student reports a blockage → notifies the cohort instructor.
    const rep = await org.student.post("/api/blockages", {
      cohortId: org.cohortId,
      briefId: org.briefId,
      title: "Stuck on routing",
      details: "Routes 404",
    });
    assert.equal(rep.status, 201);

    const before = digestFiles().length;

    // Instructor has at least one unread → digest sends.
    const d = await org.instructor.post("/api/notifications/digest");
    assert.equal(d.status, 200);
    assert.ok(d.body.count >= 1, "instructor has unread");
    assert.equal(d.body.emailed, true);

    const sent = digestFiles();
    assert.equal(sent.length, before + 1, "one digest email written");
    const last = sent[sent.length - 1];
    assert.ok(last.text.includes("reported"), "digest body includes the notification text");

    // Owner has no unread → no email.
    const before2 = digestFiles().length;
    const d2 = await org.owner.post("/api/notifications/digest");
    assert.equal(d2.status, 200);
    assert.equal(d2.body.count, 0);
    assert.equal(d2.body.emailed, false);
    assert.equal(digestFiles().length, before2, "no digest email for empty inbox");
  } finally {
    await srv.close();
  }
});
