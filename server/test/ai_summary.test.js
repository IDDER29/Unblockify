"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("instructor thread summary is staff-only, tenant-scoped, read-only", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "SM", "sm");
    const b = await buildOrg(srv.base, "SM2", "sm2");
    const id = (await a.student.post("/api/blockages", { title: "summary test", cohortId: a.cohortId, details: "d" })).body.blockage.id;
    await a.student.post("/api/blockages/" + id + "/comments", { body: "tried X" });
    await a.student.post("/api/blockages/" + id + "/comments", { body: "tried Y" });
    const before = (await a.instructor.get("/api/blockages/" + id)).body.blockage.comments.length;
    const s = await a.instructor.get("/api/blockages/" + id + "/summary");
    assert.equal(s.status, 200);
    assert.match(s.body.summary, /summary test/);
    assert.match(s.body.summary, /message/);
    const stu = await a.student.get("/api/blockages/" + id + "/summary");
    assert.ok(stu.status === 403 || stu.status === 404);
    assert.equal((await b.instructor.get("/api/blockages/" + id + "/summary")).status, 404);
    const after = (await a.instructor.get("/api/blockages/" + id)).body.blockage.comments.length;
    assert.equal(after, before, "summary writes nothing");
  } finally { await srv.close(); }
});
