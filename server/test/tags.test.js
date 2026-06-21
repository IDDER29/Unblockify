"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("owner creates tags, staff tags a blockage, list filters by tag", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");
    const t = await a.owner.post("/api/tags", { name: "react", color: "#12B886" });
    assert.equal(t.status, 201);
    const tagId = t.body.tag.id;

    // duplicate name rejected
    const dup = await a.owner.post("/api/tags", { name: "react" });
    assert.equal(dup.status, 409);

    // students may not create tags
    const st = await a.student.post("/api/tags", { name: "css" });
    assert.equal(st.status, 403);

    const b = await a.student.post("/api/blockages", {
      title: "hooks", cohortId: a.cohortId, details: "useEffect loop",
    });
    const bid = b.body.blockage.id;

    const tag = await a.owner.post(`/api/blockages/${bid}/tags`, { tagId });
    assert.equal(tag.status, 200);
    assert.equal(tag.body.tags[0].name, "react");

    // list filtered by tag returns it
    const filtered = await a.owner.get(`/api/blockages?tag=${tagId}`);
    assert.equal(filtered.body.blockages.length, 1);
    assert.equal(filtered.body.blockages[0].tags[0].name, "react");

    // detach
    const off = await a.owner.del(`/api/blockages/${bid}/tags/${tagId}`);
    assert.equal(off.body.tags.length, 0);

    const empty = await a.owner.get(`/api/blockages?tag=${tagId}`);
    assert.equal(empty.body.blockages.length, 0);
  } finally {
    await srv.close();
  }
});
