"use strict";

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

test("recent activity feed reflects the blockage lifecycle", async () => {
  const org = await buildOrg("Pulse", "pulse");

  // student reports
  const rep = await org.student.post("/api/blockages", {
    title: "Server crashes on boot",
    cohortId: org.cohortId,
    briefId: org.briefId,
    details: "Throws ENOENT immediately.",
  });
  assert.equal(rep.status, 201);
  const blkId = rep.body.blockage.id;

  // instructor claims + resolves
  await org.instructor.post(`/api/blockages/${blkId}/claim`);
  await org.instructor.post(`/api/blockages/${blkId}/resolve`, {
    type: "guidedSupport",
    note: "Create the missing config file.",
  });

  // owner sees the full feed, newest first
  const ownerFeed = await org.owner.get("/api/activity");
  assert.equal(ownerFeed.status, 200);
  assert.ok(Array.isArray(ownerFeed.body.activity), "activity is an array");

  const created = ownerFeed.body.activity.find((e) => e.type === "created");
  const resolved = ownerFeed.body.activity.find((e) => e.type === "resolved");
  assert.ok(created, "feed includes a created event");
  assert.ok(resolved, "feed includes a resolved event");
  assert.equal(created.blockageTitle, "Server crashes on boot");
  assert.equal(resolved.blockageTitle, "Server crashes on boot");
  assert.equal(resolved.blockageId, blkId);

  // newest first: resolved comes before created
  const types = ownerFeed.body.activity.map((e) => e.type);
  assert.ok(types.indexOf("resolved") < types.indexOf("created"), "newest first");
});

test("instructor only sees activity for their own cohort", async () => {
  const org = await buildOrg("Scope", "scope");

  // a blockage in the instructor's cohort
  const mine = await org.student.post("/api/blockages", {
    title: "Mine cohort blockage",
    cohortId: org.cohortId,
    details: "d",
  });
  assert.equal(mine.status, 201);

  // a second cohort + student the instructor is NOT assigned to
  const c2 = await org.owner.post("/api/cohorts", { name: "Cohort B" });
  const cohort2 = c2.body.cohort.id;
  const inv = await org.owner.post("/api/invites", { role: "student", cohortId: cohort2 });
  const { makeClient } = require("./helpers");
  const other = makeClient(srv.base);
  await other.post("/api/auth/join", {
    code: inv.body.invite.code, name: "Other Stu", email: "scope-other@x.com", password: "pass1234",
  });
  const otherBlk = await other.post("/api/blockages", {
    title: "Other cohort blockage",
    cohortId: cohort2,
    details: "d",
  });
  assert.equal(otherBlk.status, 201);

  const feed = await org.instructor.get("/api/activity");
  assert.equal(feed.status, 200);
  const titles = feed.body.activity.map((e) => e.blockageTitle);
  assert.ok(titles.includes("Mine cohort blockage"), "instructor sees own cohort");
  assert.ok(!titles.includes("Other cohort blockage"), "instructor does not see other cohort");
});
