"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv, org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "SuggestOrg", "suggest");
});

after(() => srv.close());

test("POST /api/briefs/:id/suggestions generates a suggestion", async () => {
  const r = await org.owner.post(`/api/briefs/${org.briefId}/suggestions`, {
    topic: "async/await",
    rationale: "3 students blocked on this topic this week",
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.suggestion, "should return suggestion");
  assert.equal(r.body.suggestion.topic, "async/await");
  assert.ok(r.body.suggestion.content, "should have generated content");
  assert.equal(r.body.suggestion.status, "pending");
});

test("GET /api/briefs/:id/suggestions lists pending suggestions", async () => {
  // Create another suggestion
  await org.owner.post(`/api/briefs/${org.briefId}/suggestions`, {
    topic: "promises",
    rationale: "Common confusion",
  });

  const r = await org.owner.get(`/api/briefs/${org.briefId}/suggestions`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.suggestions), "should return array");
  assert.ok(r.body.suggestions.length >= 2, "should have at least 2 suggestions");
});

test("PATCH /api/briefs/:id/suggestions/:sid accepts/dismisses a suggestion", async () => {
  const createRes = await org.owner.post(`/api/briefs/${org.briefId}/suggestions`, {
    topic: "closures",
    rationale: "Complex topic",
  });
  const sid = createRes.body.suggestion.id;

  // Accept it
  const acceptRes = await org.owner.patch(`/api/briefs/${org.briefId}/suggestions/${sid}`, {
    status: "accepted",
  });
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.body.suggestion.status, "accepted");

  // Dismiss another
  const createRes2 = await org.owner.post(`/api/briefs/${org.briefId}/suggestions`, {
    topic: "scope",
    rationale: "Also complex",
  });
  const sid2 = createRes2.body.suggestion.id;
  const dismissRes = await org.owner.patch(`/api/briefs/${org.briefId}/suggestions/${sid2}`, {
    status: "dismissed",
  });
  assert.equal(dismissRes.status, 200);
  assert.equal(dismissRes.body.suggestion.status, "dismissed");
});

test("GET /api/briefs/:id/suggestions 404 for unknown brief", async () => {
  const r = await org.owner.get("/api/briefs/99999/suggestions");
  assert.equal(r.status, 404);
});
