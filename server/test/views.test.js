"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg, joinMember } = require("./helpers");

test("a user saves, lists, and deletes their own views; isolated per user", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");
    const v = await a.instructor.post("/api/views", {
      name: "Open in A", status: "open", cohortId: a.cohortId, search: "css",
    });
    assert.equal(v.status, 201);

    const mine = await a.instructor.get("/api/views");
    assert.equal(mine.body.views.length, 1);
    assert.equal(mine.body.views[0].name, "Open in A");
    assert.equal(mine.body.views[0].status, "open");

    // another staff member sees none of the first user's views
    const other = await joinMember(srv.base, a.owner, "instructor", null, "a-ins2");
    const otherViews = await other.client.get("/api/views");
    assert.equal(otherViews.body.views.length, 0);

    // cannot delete a view they don't own
    const del = await other.client.del(`/api/views/${v.body.view.id}`);
    assert.equal(del.status, 404);

    const ok = await a.instructor.del(`/api/views/${v.body.view.id}`);
    assert.equal(ok.status, 200);
    const after = await a.instructor.get("/api/views");
    assert.equal(after.body.views.length, 0);
  } finally {
    await srv.close();
  }
});
