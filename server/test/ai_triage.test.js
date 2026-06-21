"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("AI triage tags a new blockage and feeds analytics", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.AI_AUTORESPOND = "1";
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "TR", "tr");
    const id = (await a.student.post("/api/blockages", {
      title: "Deploy blocker", cohortId: a.cohortId,
      details: "Critical error crashes the build, urgent deadline today, completely stuck.",
    })).body.blockage.id;
    let d;
    for (let i = 0; i < 50; i++) { d = await a.student.get("/api/blockages/" + id); if (d.body.blockage.aiDifficulty) break; await sleep(40); }
    assert.ok(d.body.blockage.aiDifficulty);
    assert.equal(d.body.blockage.aiUrgency, "high");
    assert.ok(["low", "medium", "high", "blocker"].includes(d.body.blockage.aiDifficulty));
    assert.ok(Array.isArray(d.body.blockage.aiTopics) && d.body.blockage.aiTopics.length >= 1);
    const an = await a.owner.get("/api/analytics");
    assert.ok(an.body.byUrgency.high >= 1);
    assert.ok(an.body.byTopic.length >= 1);
  } finally { process.env.AI_AUTORESPOND = "0"; await srv.close(); }
});
