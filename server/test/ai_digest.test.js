"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
process.env.EMAIL_OUTBOX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ubx-dg-"));
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("owner weekly digest clusters resolved blockages and can email", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "DG", "dg");
    const b = await buildOrg(srv.base, "DG2", "dg2");
    const titles = [
      "async promise await alpha", "async promise await beta", "async promise await gamma",
      "css flexbox layout delta", "css flexbox layout epsilon",
    ];
    for (const t of titles) {
      const r = await a.student.post("/api/blockages", { title: t, cohortId: a.cohortId, details: t });
      await a.instructor.post("/api/blockages/" + r.body.blockage.id + "/resolve", { type: "guidedSupport", note: "fixed " + t });
    }
    const dg = await a.owner.get("/api/analytics/digest");
    assert.equal(dg.status, 200);
    assert.equal(dg.body.resolvedCount, 5);
    assert.ok(dg.body.themes.length >= 1);
    assert.equal(dg.body.themes.reduce((s, t) => s + t.count, 0), 5);
    assert.ok(typeof dg.body.summary === "string" && dg.body.summary.length > 10);
    assert.equal(dg.body.emailable, true);
    assert.equal((await a.owner.get("/api/analytics/digest?email=1")).body.emailSent, true);
    const stu = await a.student.get("/api/analytics/digest");
    assert.ok(stu.status === 403 || stu.status === 404);
    assert.equal((await b.owner.get("/api/analytics/digest")).body.resolvedCount, 0);
  } finally { await srv.close(); }
});
