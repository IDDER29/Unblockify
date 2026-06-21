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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helper: report a blockage + post a comment as the student. Returns ids.
async function reportWithComment(org, body) {
  const rep = await org.student.post("/api/blockages", {
    title: "Stuck on auth",
    cohortId: org.cohortId,
    details: "Login returns 401",
  });
  assert.equal(rep.status, 201);
  const blkId = rep.body.blockage.id;
  const cm = await org.student.post(`/api/blockages/${blkId}/comments`, { body });
  assert.equal(cm.status, 201);
  const detail = await org.student.get(`/api/blockages/${blkId}`);
  const comment = detail.body.blockage.comments.find((c) => !c.is_ai && c.body === body);
  assert.ok(comment, "student's comment is present in detail");
  return { blkId, commentId: comment.id };
}

test("author can edit their own comment", async () => {
  const org = await buildOrg("CmtEdit", "cmtedit");
  const { blkId, commentId } = await reportWithComment(org, "Original message");

  const put = await org.student.put(
    `/api/blockages/${blkId}/comments/${commentId}`,
    { body: "Edited message" }
  );
  assert.equal(put.status, 200);
  assert.equal(put.body.ok, true);

  const detail = await org.student.get(`/api/blockages/${blkId}`);
  const c = detail.body.blockage.comments.find((x) => x.id === commentId);
  assert.ok(c, "comment still exists");
  assert.equal(c.body, "Edited message");
});

test("a different user cannot edit someone else's comment", async () => {
  const org = await buildOrg("CmtAuthz", "cmtauthz");
  const { blkId, commentId } = await reportWithComment(org, "My private note");

  // The instructor can see the blockage but is not the author.
  const put = await org.instructor.put(
    `/api/blockages/${blkId}/comments/${commentId}`,
    { body: "Hijacked" }
  );
  assert.ok(put.status >= 400 && put.status < 500, "rejected with a 4xx");

  // Body is unchanged.
  const detail = await org.student.get(`/api/blockages/${blkId}`);
  const c = detail.body.blockage.comments.find((x) => x.id === commentId);
  assert.equal(c.body, "My private note");
});

test("author can delete their own comment", async () => {
  const org = await buildOrg("CmtDel", "cmtdel");
  const { blkId, commentId } = await reportWithComment(org, "Delete me");

  const del = await org.student.del(`/api/blockages/${blkId}/comments/${commentId}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.ok, true);

  const detail = await org.student.get(`/api/blockages/${blkId}`);
  const gone = detail.body.blockage.comments.find((x) => x.id === commentId);
  assert.equal(gone, undefined, "comment is gone from detail");
});

test("AI comments cannot be edited by anyone", async () => {
  process.env.AI_AUTORESPOND = "1"; // enable background AI (local fallback, no API key)
  try {
    const org = await buildOrg("CmtAi", "cmtai");
    const rep = await org.student.post("/api/blockages", {
      title: "Webpack build hangs at 92%",
      cohortId: org.cohortId,
      details: "Build stalls at 92% chunk asset optimization and never finishes.",
    });
    const blkId = rep.body.blockage.id;

    // Poll until the AI Teaching Assistant has posted a comment.
    let aiComment;
    for (let i = 0; i < 40; i++) {
      const detail = await org.student.get(`/api/blockages/${blkId}`);
      aiComment = detail.body.blockage.comments.find((c) => c.is_ai);
      if (aiComment) break;
      await sleep(50);
    }
    assert.ok(aiComment, "AI posted a comment");

    const put = await org.student.put(
      `/api/blockages/${blkId}/comments/${aiComment.id}`,
      { body: "Tampering with the AI reply" }
    );
    assert.ok(put.status >= 400 && put.status < 500, "editing an AI comment is rejected");
  } finally {
    process.env.AI_AUTORESPOND = "0";
  }
});
