"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient, buildOrg: buildOrgH, joinMember: joinMemberH } = require("./helpers");

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv.close();
});

// Thin wrappers over the shared helpers (keep existing call sites unchanged).
const buildOrg = (orgName, prefix) => buildOrgH(srv.base, orgName, prefix);
const joinMember = (owner, role, cohortId, email) => joinMemberH(srv.base, owner, role, cohortId, email);

test("signup rejects duplicate email", async () => {
  const a = makeClient(srv.base);
  await a.post("/api/auth/signup", { orgName: "Dup", name: "A", email: "dup@x.com", password: "pass1234" });
  const b = makeClient(srv.base);
  const r = await b.post("/api/auth/signup", { orgName: "Dup2", name: "B", email: "dup@x.com", password: "pass1234" });
  assert.equal(r.status, 409);
});

test("full blockage lifecycle with thread + notifications", async () => {
  const org = await buildOrg("Acme", "acme");

  // student reports
  const rep = await org.student.post("/api/blockages", {
    title: "API returns 401",
    cohortId: org.cohortId,
    briefId: org.briefId,
    difficulty: "auth",
    details: "401 on login",
  });
  assert.equal(rep.status, 201);
  const blkId = rep.body.blockage.id;
  assert.equal(rep.body.blockage.status, "open");

  // instructor was notified
  const insNotifs = await org.instructor.get("/api/notifications");
  assert.equal(insNotifs.body.unread, 1, "instructor notified of report");

  // instructor sees it; claims it
  const queue = await org.instructor.get("/api/blockages");
  assert.equal(queue.body.blockages.length, 1);
  const claim = await org.instructor.post(`/api/blockages/${blkId}/claim`);
  assert.equal(claim.body.blockage.status, "in_support");

  // student notified of claim
  const stuNotifs = await org.student.get("/api/notifications");
  assert.ok(stuNotifs.body.unread >= 1);

  // thread: student comments
  const cm = await org.student.post(`/api/blockages/${blkId}/comments`, { body: "Tried adding a header" });
  assert.equal(cm.status, 201);

  // resolve
  const res = await org.instructor.post(`/api/blockages/${blkId}/resolve`, {
    type: "guidedSupport",
    note: "Attach the Bearer token",
  });
  assert.equal(res.body.blockage.status, "resolved");

  // detail has ordered timeline + comment
  const detail = await org.student.get(`/api/blockages/${blkId}`);
  const types = detail.body.blockage.events.map((e) => e.type);
  assert.deepEqual(types, ["created", "claimed", "comment", "resolved"]);
  assert.equal(detail.body.blockage.comments.length, 1);

  // student can no longer edit/delete a resolved blockage
  const edit = await org.student.put(`/api/blockages/${blkId}`, { title: "x", details: "y" });
  assert.equal(edit.status, 423);
});

test("student cannot report into a cohort they're not in", async () => {
  const org = await buildOrg("Beta", "beta");
  const r = await org.student.post("/api/blockages", {
    title: "x",
    cohortId: 99999,
    details: "y",
  });
  assert.equal(r.status, 400);
});

test("role enforcement: student cannot resolve or invite", async () => {
  const org = await buildOrg("Gamma", "gamma");
  const rep = await org.student.post("/api/blockages", {
    title: "t", cohortId: org.cohortId, details: "d",
  });
  const blkId = rep.body.blockage.id;
  const resolve = await org.student.post(`/api/blockages/${blkId}/resolve`, { type: "x", note: "y" });
  assert.equal(resolve.status, 403);
  const inv = await org.student.post("/api/invites", { role: "student" });
  assert.equal(inv.status, 403);
});

test("tenant isolation: org B cannot see org A's blockage", async () => {
  const a = await buildOrg("OrgA", "oa");
  const b = await buildOrg("OrgB", "ob");
  const rep = await a.student.post("/api/blockages", {
    title: "secret", cohortId: a.cohortId, details: "d",
  });
  const blkId = rep.body.blockage.id;

  // B's instructor list is empty of A's blockage
  const bQueue = await b.instructor.get("/api/blockages");
  assert.equal(bQueue.body.blockages.length, 0);
  // B's owner cannot fetch A's blockage by id
  const cross = await b.owner.get(`/api/blockages/${blkId}`);
  assert.equal(cross.status, 404);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("AI TA responds, deflects, and feeds analytics", async () => {
  process.env.AI_AUTORESPOND = "1"; // enable background AI for this test (uses local fallback, no API key)
  try {
    const org = await buildOrg("Nova", "nova");
    const rep = await org.student.post("/api/blockages", {
      title: "Webpack build hangs at 92%",
      cohortId: org.cohortId,
      details: "Build stalls at 92% chunk asset optimization and never finishes.",
    });
    const blkId = rep.body.blockage.id;

    // The AI Teaching Assistant posts a first response in the background.
    let detail, aiComment;
    for (let i = 0; i < 40; i++) {
      detail = await org.student.get(`/api/blockages/${blkId}`);
      aiComment = detail.body.blockage.comments.find((c) => c.is_ai);
      if (aiComment) break;
      await sleep(50);
    }
    assert.ok(aiComment, "AI posted a first response");
    assert.equal(aiComment.author_role, "ai");
    assert.ok(detail.body.blockage.events.some((e) => e.type === "ai_reply"));

    // Student clicks "this unblocked me" → AI deflection
    const deflect = await org.student.post(`/api/blockages/${blkId}/ai-resolve`);
    assert.equal(deflect.body.blockage.status, "resolved");

    // Instructor copilot drafts a reply
    const sugg = await org.instructor.get(`/api/blockages/${blkId}/suggest`);
    assert.ok(typeof sugg.body.draft === "string" && sugg.body.draft.length > 0);

    // Analytics report the deflection
    const a = await org.owner.get("/api/analytics");
    assert.equal(a.body.aiResolved, 1);
    assert.ok(a.body.deflectionRate >= 1);
  } finally {
    process.env.AI_AUTORESPOND = "0";
  }
});

test("knowledge base surfaces similar resolved blockages", async () => {
  const org = await buildOrg("Orbit", "orbit");
  // resolve one blockage to seed the knowledge base
  const first = await org.student.post("/api/blockages", {
    title: "CORS error calling the API", cohortId: org.cohortId,
    details: "Browser blocks fetch with a CORS preflight failure.",
  });
  await org.instructor.post(`/api/blockages/${first.body.blockage.id}/resolve`, {
    type: "guidedSupport", note: "Add the Access-Control-Allow-Origin header on the server.",
  });
  // a new, similar blockage should retrieve it
  const second = await org.student.post("/api/blockages", {
    title: "CORS preflight blocked", cohortId: org.cohortId,
    details: "Another CORS error on my fetch call to the API.",
  });
  const detail = await org.student.get(`/api/blockages/${second.body.blockage.id}`);
  assert.ok(detail.body.blockage.similar.length >= 1, "found a similar resolved blockage");
  assert.match(detail.body.blockage.similar[0].title, /CORS/);
});

test("analytics totals reflect resolved blockages", async () => {
  const org = await buildOrg("Delta", "delta");
  const rep = await org.student.post("/api/blockages", {
    title: "t", cohortId: org.cohortId, details: "d",
  });
  const blkId = rep.body.blockage.id;
  await org.instructor.post(`/api/blockages/${blkId}/resolve`, { type: "guidedSupport", note: "n" });
  const a = await org.owner.get("/api/analytics");
  assert.equal(a.body.totals.resolved, 1);
  assert.equal(a.body.resolveRate, 100);
});

test("owner can assign a cohort to a cohort-less student (the dead-end)", async () => {
  const org = await buildOrg("Mgmt", "mgmt");
  const stu2 = await joinMember(org.owner, "student", null, "mgmt-stu2");
  // With no cohort, the student cannot report a blockage anywhere
  let r = await stu2.client.post("/api/blockages", { title: "x", cohortId: org.cohortId, details: "d" });
  assert.equal(r.status, 400);
  // Owner assigns them to a cohort
  const put = await org.owner.put(`/api/members/${stu2.user.id}`, { cohortId: org.cohortId });
  assert.equal(put.body.member.cohort_id, org.cohortId);
  // Now they can report
  r = await stu2.client.post("/api/blockages", { title: "x", cohortId: org.cohortId, details: "d" });
  assert.equal(r.status, 201);
});

test("owner can change roles and remove members, with guards", async () => {
  const org = await buildOrg("Roles", "roles");
  const s = await joinMember(org.owner, "student", org.cohortId, "roles-s");
  const promote = await org.owner.put(`/api/members/${s.user.id}`, { role: "instructor" });
  assert.equal(promote.body.member.role, "instructor");

  const me = await org.owner.get("/api/auth/me");
  const self = await org.owner.put(`/api/members/${me.body.user.id}`, { role: "student" });
  assert.equal(self.status, 400, "can't change own role");
  const delSelf = await org.owner.del(`/api/members/${me.body.user.id}`);
  assert.equal(delSelf.status, 400, "can't remove self");

  const del = await org.owner.del(`/api/members/${s.user.id}`);
  assert.equal(del.status, 200);
});

test("cohort deletion is blocked while it has students/blockages", async () => {
  const org = await buildOrg("Del", "del");
  const r = await org.owner.del(`/api/cohorts/${org.cohortId}`);
  assert.equal(r.status, 409);
});

test("instructor invite with a cohort auto-assigns the instructor", async () => {
  const org = await buildOrg("Auto", "auto");
  const ins2 = await joinMember(org.owner, "instructor", org.cohortId, "auto-ins2");
  await org.student.post("/api/blockages", { title: "auto blk", cohortId: org.cohortId, details: "d" });
  const q = await ins2.client.get("/api/blockages");
  assert.ok(q.body.blockages.length >= 1, "auto-assigned instructor sees the cohort's blockage");
});

test("staff can reopen a resolved blockage", async () => {
  const org = await buildOrg("Reopen", "reopen");
  const rep = await org.student.post("/api/blockages", { title: "t", cohortId: org.cohortId, details: "d" });
  const id = rep.body.blockage.id;
  await org.instructor.post(`/api/blockages/${id}/resolve`, { type: "guidedSupport", note: "n" });
  const re = await org.instructor.post(`/api/blockages/${id}/reopen`);
  assert.equal(re.body.blockage.status, "open");
});
