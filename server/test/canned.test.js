"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("staff manage per-org canned responses; tenant-scoped", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");
    const c = await a.instructor.post("/api/canned", {
      title: "Centering", body: "Use flexbox: display:flex; align-items:center;",
    });
    assert.equal(c.status, 201);
    const id = c.body.canned.id;

    const list = await a.owner.get("/api/canned");
    assert.equal(list.body.canned.length, 1);
    assert.equal(list.body.canned[0].title, "Centering");

    // students cannot read/write canned responses
    const sd = await a.student.get("/api/canned");
    assert.equal(sd.status, 403);

    // another org cannot delete this one
    const b = await buildOrg(srv.base, "Beta", "b");
    const cross = await b.owner.del(`/api/canned/${id}`);
    assert.equal(cross.status, 404);

    const ok = await a.instructor.del(`/api/canned/${id}`);
    assert.equal(ok.status, 200);
    const after = await a.owner.get("/api/canned");
    assert.equal(after.body.canned.length, 0);
  } finally {
    await srv.close();
  }
});
