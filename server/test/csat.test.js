"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("student rates a resolved blockage; surfaces in analytics", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");
    const b = await a.student.post("/api/blockages", {
      title: "deploy fails", cohortId: a.cohortId, details: "build error",
    });
    const bid = b.body.blockage.id;

    // cannot rate while still open
    const early = await a.student.post(`/api/blockages/${bid}/csat`, { rating: 5 });
    assert.equal(early.status, 409);

    await a.owner.post(`/api/blockages/${bid}/resolve`, {
      type: "guidedSupport", note: "deployed",
    });

    // invalid rating rejected
    const bad = await a.student.post(`/api/blockages/${bid}/csat`, { rating: 9 });
    assert.equal(bad.status, 400);

    const ok = await a.student.post(`/api/blockages/${bid}/csat`, {
      rating: 4, comment: "helpful",
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.csat.rating, 4);

    // re-submit updates, not duplicates
    const again = await a.student.post(`/api/blockages/${bid}/csat`, { rating: 5 });
    assert.equal(again.body.csat.rating, 5);

    // detail echoes csat
    const detail = await a.student.get(`/api/blockages/${bid}`);
    assert.equal(detail.body.blockage.csat.rating, 5);

    // analytics shows the average
    const an = await a.owner.get("/api/analytics");
    assert.equal(an.body.csatCount, 1);
    assert.equal(an.body.avgCsat, 5);
  } finally {
    await srv.close();
  }
});
