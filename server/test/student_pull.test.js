"use strict";

// Student-pull surface: the blockage list now exposes resolutionType (for the
// student "momentum" scorecard), and GET /blockages/similar powers the
// pre-submit "you're not alone" social proof. Real data, org-scoped.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg: buildOrgH } = require("./helpers");

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv.close();
});

const buildOrg = (orgName, prefix) => buildOrgH(srv.base, orgName, prefix);

test("blockage list exposes resolutionType for the momentum scorecard", async () => {
  const org = await buildOrg("Momentum", "mom");

  // One the student deflects via AI ("this unblocked me").
  const a = await org.student.post("/api/blockages", {
    title: "AI one", cohortId: org.cohortId, details: "details a",
  });
  await org.student.post(`/api/blockages/${a.body.blockage.id}/ai-resolve`);

  // One an instructor resolves directly.
  const b = await org.student.post("/api/blockages", {
    title: "Human one", cohortId: org.cohortId, details: "details b",
  });
  await org.instructor.post(`/api/blockages/${b.body.blockage.id}/claim`);
  await org.instructor.post(`/api/blockages/${b.body.blockage.id}/resolve`, {
    type: "directIntervention", note: "walked through it",
  });

  // One still open.
  await org.student.post("/api/blockages", {
    title: "Open one", cohortId: org.cohortId, details: "details c",
  });

  const list = await org.student.get("/api/blockages");
  assert.equal(list.status, 200);
  const byTitle = Object.fromEntries(list.body.blockages.map((x) => [x.title, x]));
  assert.equal(byTitle["AI one"].resolutionType, "ai");
  assert.equal(byTitle["Human one"].resolutionType, "directIntervention");
  assert.equal(byTitle["Open one"].resolutionType, null);
  // resolvedAt is present for resolved, absent for open.
  assert.ok(byTitle["AI one"].resolvedAt);
  assert.equal(byTitle["Open one"].resolvedAt, null);
});

test("GET /blockages/similar surfaces resolved look-alikes in the same workspace", async () => {
  const org = await buildOrg("Similar", "sim");

  // A resolved blockage with distinctive keywords becomes knowledge-base fodder.
  const rep = await org.student.post("/api/blockages", {
    title: "fetch returns 401 unauthorized even with my bearer token",
    cohortId: org.cohortId,
    details: "the authorization header is set but every request is rejected",
  });
  await org.instructor.post(`/api/blockages/${rep.body.blockage.id}/claim`);
  await org.instructor.post(`/api/blockages/${rep.body.blockage.id}/resolve`, {
    type: "guidedSupport", note: "the token needed the Bearer prefix",
  });

  // The student starts typing a similar problem → we surface the match.
  const hit = await org.student.get(
    "/api/blockages/similar?text=" + encodeURIComponent("why does fetch give me a 401 with my token")
  );
  assert.equal(hit.status, 200);
  assert.ok(hit.body.count >= 1, "found at least one look-alike");
  assert.ok(
    hit.body.matches.some((m) => /401/.test(m.title)),
    "the 401 blockage is among the matches"
  );

  // Too-short queries return nothing (no noise as the box is first focused).
  const tiny = await org.student.get("/api/blockages/similar?text=ab");
  assert.equal(tiny.body.count, 0);
  assert.equal(tiny.body.matches.length, 0);
});

test("similar look-alikes never cross the tenant boundary", async () => {
  const orgA = await buildOrg("SimA", "sima");
  const orgB = await buildOrg("SimB", "simb");

  const rep = await orgA.student.post("/api/blockages", {
    title: "webpack config breaks on css modules import",
    cohortId: orgA.cohortId,
    details: "the loader order seems wrong and the build fails",
  });
  await orgA.instructor.post(`/api/blockages/${rep.body.blockage.id}/claim`);
  await orgA.instructor.post(`/api/blockages/${rep.body.blockage.id}/resolve`, {
    type: "guidedSupport", note: "reorder the loaders",
  });

  // Org B's student typing the very same words sees nothing from org A.
  const cross = await orgB.student.get(
    "/api/blockages/similar?text=" + encodeURIComponent("webpack config css modules import loader")
  );
  assert.equal(cross.status, 200);
  assert.equal(cross.body.count, 0, "no cross-tenant knowledge leakage");
});
