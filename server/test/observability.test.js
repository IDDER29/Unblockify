"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("./helpers");

test("healthz returns ok with counters", async () => {
  const srv = await startServer();
  try {
    const r = await fetch(srv.base + "/healthz").then((x) => x.json());
    assert.equal(r.status, "ok");
    assert.ok(typeof r.counters.requests === "number");
    assert.ok(typeof r.uptime === "number");
  } finally {
    await srv.close();
  }
});
