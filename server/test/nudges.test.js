"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("owner nudges a cohort; students get an in-app notification", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");

    // empty message rejected
    const bad = await a.owner.post("/api/nudges", {
      message: "  ", target: `cohort:${a.cohortId}`,
    });
    assert.equal(bad.status, 400);

    // non-owner forbidden
    const ins = await a.instructor.post("/api/nudges", {
      message: "hi", target: "all-students",
    });
    assert.equal(ins.status, 403);

    const r = await a.owner.post("/api/nudges", {
      message: "Office hours at 3pm — bring your blockers!",
      target: `cohort:${a.cohortId}`,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.sent, 1);

    // the cohort student now has an unread nudge
    const n = await a.student.get("/api/notifications");
    assert.ok(n.body.unread >= 1);
    assert.ok(
      n.body.notifications.some((x) => x.type === "nudge")
    );
  } finally {
    await srv.close();
  }
});
