"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "VersionOrg", "version");
});

after(() => srv.close());

test("PUT /api/briefs/:id accepts content field", async () => {
  const r = await org.owner.put(`/api/briefs/${org.briefId}`, {
    name: "Brief v2",
    content: "# Week 1\nBuild a calculator.",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.brief.name, "Brief v2");
  assert.equal(r.body.brief.content, "# Week 1\nBuild a calculator.");
});

test("PUT /api/briefs/:id snapshots prior version into brief_versions", async () => {
  // First update creates a snapshot of the previous state
  await org.owner.put(`/api/briefs/${org.briefId}`, {
    name: "Brief v3",
    content: "# Week 2\nBuild a todo app.",
  });

  const hist = await org.owner.get(`/api/briefs/${org.briefId}/history`);
  assert.equal(hist.status, 200);
  assert.ok(Array.isArray(hist.body.versions), "should have versions array");
  assert.ok(hist.body.versions.length >= 1, "should have at least one version snapshot");
});

test("GET /api/briefs/:id/history returns versions in descending order", async () => {
  // Create a few more updates
  await org.owner.put(`/api/briefs/${org.briefId}`, { name: "Brief v4", content: "Content v4" });
  await org.owner.put(`/api/briefs/${org.briefId}`, { name: "Brief v5", content: "Content v5" });

  const hist = await org.owner.get(`/api/briefs/${org.briefId}/history`);
  assert.equal(hist.status, 200);
  assert.ok(hist.body.versions.length >= 3, "should have accumulated versions");
  // Versions should be newest first
  const dates = hist.body.versions.map((v) => v.createdAt);
  for (let i = 1; i < dates.length; i++) {
    assert.ok(dates[i - 1] >= dates[i], "versions should be newest-first");
  }
});

test("GET /api/briefs/:id returns content field", async () => {
  const r = await org.owner.get(`/api/briefs/${org.briefId}`);
  assert.equal(r.status, 200);
  assert.ok("content" in r.body.brief, "brief should have content field");
});

test("GET /api/briefs/:id/history 404 for unknown brief", async () => {
  const r = await org.owner.get("/api/briefs/99999/history");
  assert.equal(r.status, 404);
});
