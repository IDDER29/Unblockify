"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");
const { businessHoursBetween } = require("../lib/sla");
const SLA = { responseHours: 4, resolveHours: 48, bhStart: 9, bhEnd: 17, bhDays: [1, 2, 3, 4, 5], tzOffsetMin: 0 };

test("businessHoursBetween counts in-window weekday hours, skips weekends", () => {
  assert.equal(Math.round(businessHoursBetween("2026-06-15 10:00:00", "2026-06-15 14:00:00", SLA)), 4);
  assert.equal(Math.round(businessHoursBetween("2026-06-19 16:00:00", "2026-06-22 10:00:00", SLA)), 2);
});

test("SLA config default/update, breach detection, escalate (notify+audit+idempotent)", async () => {
  const srv = await startServer();
  try {
    const org = await buildOrg(srv.base, "SLA", "sla");
    assert.equal((await org.owner.get("/api/sla")).body.sla.responseHours, 4);
    // owner-only update
    assert.equal((await org.instructor.put("/api/sla", { responseHours: 5 })).status, 403);
    const p = await org.owner.put("/api/sla", { responseHours: 1, resolveHours: 2, bhStart: 0, bhEnd: 24, bhDays: [0, 1, 2, 3, 4, 5, 6] });
    assert.equal(p.body.sla.responseHours, 1);

    const id = (await org.student.post("/api/blockages", { title: "old one", cohortId: org.cohortId, details: "d" })).body.blockage.id;
    srv.db.prepare("UPDATE blockages SET created_at = datetime('now','-10 hours') WHERE id = ?").run(id);
    const detail = await org.owner.get("/api/blockages/" + id);
    assert.equal(detail.body.blockage.sla.breached, true);

    const esc = await org.owner.post("/api/sla/escalate", {});
    assert.ok(esc.body.escalated >= 1, "breached blockage escalated");
    assert.equal((await org.student.post("/api/sla/escalate", {})).status, 403, "escalate is staff-only");
    assert.equal((await org.owner.post("/api/sla/escalate", {})).body.escalated, 0, "idempotent within responseHours");
  } finally {
    await srv.close();
  }
});
