"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv.close();
});

// Capture a session cookie by logging in as the owner, then fetch the CSV directly
// (the shared makeClient parses JSON only, so we use raw fetch here).
async function loginCookie(base, email, password) {
  const res = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, "login ok");
  const sc = res.headers.get("set-cookie");
  assert.ok(sc, "got a session cookie");
  return sc.split(";")[0];
}

test("staff can export blockages as CSV", async () => {
  const org = await buildOrg(srv.base, "ExportCo", "export");

  const title = "Stuck on the CSV case";
  const reported = await org.student.post("/api/blockages", {
    title,
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "details here",
    difficulty: "medium",
  });
  assert.equal(reported.status, 201, "blockage reported");

  const cookie = await loginCookie(srv.base, "export-owner@x.com", "pass1234");
  const res = await fetch(srv.base + "/api/blockages/export.csv", {
    headers: { cookie },
  });

  assert.equal(res.status, 200, "export ok");
  assert.match(res.headers.get("content-type") || "", /text\/csv/, "content-type is csv");

  const body = await res.text();
  assert.equal(typeof body, "string", "body is a string");

  const firstLine = body.split(/\r?\n/)[0];
  assert.equal(
    firstLine,
    '"id","title","status","difficulty","cohort","student","assignee","createdAt","resolvedAt","resolutionType"',
    "first line is the header row"
  );
  assert.ok(body.includes(title), "body contains the blockage title");
});
