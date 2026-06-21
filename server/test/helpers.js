"use strict";

const { openDb } = require("../db");
const { createApp } = require("../index");

function startServer() {
  if (process.env.AI_AUTORESPOND === undefined) process.env.AI_AUTORESPOND = "0";
  if (process.env.AUTH_RATELIMIT === undefined) process.env.AUTH_RATELIMIT = "off";
  // Keep test emails out of the real outbox unless a test opts in.
  if (process.env.EMAIL_OUTBOX_DIR === undefined) {
    process.env.EMAIL_OUTBOX_DIR = require("node:path").join(
      require("node:os").tmpdir(), "unblockify-test-outbox"
    );
  }
  const db = openDb(":memory:");
  const app = createApp(db);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        db,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// A cookie-tracking client (one per simulated user/agent).
function makeClient(base) {
  let cookie = "";
  async function req(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, body: data };
  }
  return {
    get: (p) => req("GET", p),
    post: (p, b) => req("POST", p, b),
    put: (p, b) => req("PUT", p, b),
    del: (p) => req("DELETE", p),
    getCookie: () => cookie, // for raw fetch (e.g. opening the SSE stream)
  };
}

const assert = require("node:assert/strict");

// Build a full organization (owner + instructor in a cohort + student in the cohort).
async function buildOrg(base, orgName, emailPrefix) {
  const owner = makeClient(base);
  const r = await owner.post("/api/auth/signup", {
    orgName, name: "Owner " + orgName, email: `${emailPrefix}-owner@x.com`, password: "pass1234",
  });
  assert.equal(r.status, 201, "signup ok");
  const c = await owner.post("/api/cohorts", { name: "Cohort A" });
  const cohortId = c.body.cohort.id;
  const b = await owner.post(`/api/cohorts/${cohortId}/briefs`, { name: "Brief 1" });
  const briefId = b.body.brief.id;

  const insInv = await owner.post("/api/invites", { role: "instructor" });
  const instructor = makeClient(base);
  const insJoin = await instructor.post("/api/auth/join", {
    code: insInv.body.invite.code, name: "Ins " + orgName, email: `${emailPrefix}-ins@x.com`, password: "pass1234",
  });
  await owner.post(`/api/cohorts/${cohortId}/instructors`, { userId: insJoin.body.user.id });

  const stuInv = await owner.post("/api/invites", { role: "student", cohortId });
  const student = makeClient(base);
  const stuJoin = await student.post("/api/auth/join", {
    code: stuInv.body.invite.code, name: "Stu " + orgName, email: `${emailPrefix}-stu@x.com`, password: "pass1234",
  });

  return {
    owner, instructor, student, cohortId, briefId,
    instructorId: insJoin.body.user.id, studentId: stuJoin.body.user.id,
  };
}

// Join a brand-new member (optionally with a cohort); returns its client + user.
async function joinMember(base, owner, role, cohortId, email) {
  const inv = await owner.post("/api/invites", cohortId ? { role, cohortId } : { role });
  const client = makeClient(base);
  const j = await client.post("/api/auth/join", {
    code: inv.body.invite.code, name: email, email: `${email}@x.com`, password: "pass1234",
  });
  return { client, user: j.body.user };
}

module.exports = { startServer, makeClient, buildOrg, joinMember };
