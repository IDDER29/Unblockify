"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv;
let org;

before(async () => {
  srv = await startServer();
  org = await buildOrg(srv.base, "Val", "val");
});

after(async () => {
  await srv.close();
});

test("rejects a blockage title over 200 chars, accepts a normal one", async () => {
  const longTitle = "a".repeat(201);
  const bad = await org.student.post("/api/blockages", {
    title: longTitle,
    cohortId: org.cohortId,
    details: "some details",
  });
  assert.equal(bad.status, 400);

  const ok = await org.student.post("/api/blockages", {
    title: "A normal title",
    cohortId: org.cohortId,
    details: "some details",
  });
  assert.equal(ok.status, 201);
});

test("rejects a comment body over 5000 chars", async () => {
  const created = await org.student.post("/api/blockages", {
    title: "Commentable",
    cohortId: org.cohortId,
    details: "details",
  });
  assert.equal(created.status, 201);
  const id = created.body.blockage.id;

  const bad = await org.student.post(`/api/blockages/${id}/comments`, {
    body: "a".repeat(5001),
  });
  assert.equal(bad.status, 400);
});

test("rejects a cohort name over 100 chars", async () => {
  const bad = await org.owner.post("/api/cohorts", { name: "a".repeat(101) });
  assert.equal(bad.status, 400);
});

test("rejects PUT /api/auth/me with a name over 100 chars", async () => {
  const bad = await org.owner.put("/api/auth/me", { name: "a".repeat(101) });
  assert.equal(bad.status, 400);
});
