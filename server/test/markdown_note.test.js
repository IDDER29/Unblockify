"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("comment markdown is stored and returned raw (no server-side render)", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Org MD", "md");
    const rep = await a.student.post("/api/blockages", {
      title: "T", details: "**not rendered**", cohortId: a.cohortId,
    });
    const blkId = rep.body.blockage.id;
    const raw = "Try `npm test` and **bold** and:\n```js\nconst x = 1;\n```";
    await a.student.post("/api/blockages/" + blkId + "/comments", { body: raw });
    const detail = await a.student.get("/api/blockages/" + blkId);
    const mine = detail.body.blockage.comments.find((c) => c.body === raw);
    assert.ok(mine, "comment body is byte-for-byte the raw markdown");
    assert.equal(detail.body.blockage.details, "**not rendered**");
  } finally {
    await srv.close();
  }
});
