"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollAi(client, id, want) {
  let d;
  for (let i = 0; i < 50; i++) {
    d = await client.get("/api/blockages/" + id);
    if ((d.body.blockage.comments || []).filter((c) => c.is_ai).length >= want) return d;
    await sleep(40);
  }
  return d;
}
const aiCount = (d) => d.body.blockage.comments.filter((c) => c.is_ai).length;

test("multi-turn AI follow-up is capped and student-owned", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.AI_AUTORESPOND = "1";
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "FU", "fu");
    const id = (await a.student.post("/api/blockages", { title: "loop test", cohortId: a.cohortId, details: "err" })).body.blockage.id;
    await pollAi(a.student, id, 1);
    await a.student.post("/api/blockages/" + id + "/comments", { body: "still stuck" });
    let r = await a.student.post("/api/blockages/" + id + "/ai-followup");
    assert.equal(r.body.posted, true);
    assert.equal(aiCount(await a.student.get("/api/blockages/" + id)), 2);
    await a.student.post("/api/blockages/" + id + "/comments", { body: "more info" });
    r = await a.student.post("/api/blockages/" + id + "/ai-followup");
    assert.equal(r.body.posted, true);
    assert.equal(aiCount(await a.student.get("/api/blockages/" + id)), 3);
    await a.student.post("/api/blockages/" + id + "/comments", { body: "again" });
    r = await a.student.post("/api/blockages/" + id + "/ai-followup");
    assert.equal(r.body.posted, false, "cap reached");
    assert.equal(aiCount(await a.student.get("/api/blockages/" + id)), 3, "never exceeds cap");
  } finally { process.env.AI_AUTORESPOND = "0"; await srv.close(); }
});

test("ai-followup blocked on resolved + cross-tenant", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.AI_AUTORESPOND = "1";
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "FU2", "fu2");
    const b = await buildOrg(srv.base, "FU3", "fu3");
    const id = (await a.student.post("/api/blockages", { title: "x", cohortId: a.cohortId, details: "d" })).body.blockage.id;
    await pollAi(a.student, id, 1);
    await a.instructor.post("/api/blockages/" + id + "/resolve", { type: "guidedSupport", note: "done" });
    assert.equal((await a.student.post("/api/blockages/" + id + "/ai-followup")).body.posted, false);
    assert.equal((await b.student.post("/api/blockages/" + id + "/ai-followup")).status, 404);
  } finally { process.env.AI_AUTORESPOND = "0"; await srv.close(); }
});
