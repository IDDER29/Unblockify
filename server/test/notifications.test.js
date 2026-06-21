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

test("notifications: list, unread filter, mark-read, dismiss, clear-all", async () => {
  const org = await buildOrg(srv.base, "Notif", "notif");

  // Student reports two blockages → the instructor gets two notifications.
  for (const title of ["First problem", "Second problem"]) {
    const rep = await org.student.post("/api/blockages", {
      title,
      cohortId: org.cohortId,
      briefId: org.briefId,
      difficulty: "auth",
      details: "stuck",
    });
    assert.equal(rep.status, 201, "report ok");
  }

  // (1) instructor sees notifications + unread count
  const all = await org.instructor.get("/api/notifications");
  assert.equal(all.status, 200);
  assert.ok(all.body.notifications.length >= 1, "has notifications");
  assert.ok(all.body.unread >= 1, "has unread");
  const total = all.body.notifications.length;
  const unreadCount = all.body.unread;

  // (2) unread filter returns only unread rows (count of ALL unread unchanged)
  const unreadOnly = await org.instructor.get("/api/notifications?unread=1");
  assert.equal(unreadOnly.status, 200);
  assert.ok(unreadOnly.body.notifications.every((n) => !n.read), "all returned are unread");
  assert.equal(unreadOnly.body.notifications.length, unreadCount, "unread rows match unread count");
  assert.equal(unreadOnly.body.unread, unreadCount, "unread total still reported");

  // (3) mark one read → unread filter has fewer
  const firstId = all.body.notifications[0].id;
  const markRead = await org.instructor.post(`/api/notifications/${firstId}/read`);
  assert.equal(markRead.status, 200);
  const afterRead = await org.instructor.get("/api/notifications?unread=1");
  assert.equal(afterRead.body.notifications.length, unreadCount - 1, "one fewer unread");
  assert.equal(afterRead.body.unread, unreadCount - 1, "unread count decremented");

  // (4) DELETE a single notification (own)
  const delOne = await org.instructor.del(`/api/notifications/${firstId}`);
  assert.equal(delOne.status, 200);
  assert.equal(delOne.body.ok, true);
  const afterDel = await org.instructor.get("/api/notifications");
  assert.equal(afterDel.body.notifications.length, total - 1, "one fewer total");

  // deleting again → 404 (not theirs / gone)
  const delGone = await org.instructor.del(`/api/notifications/${firstId}`);
  assert.equal(delGone.status, 404, "404 when not found");

  // (5) DELETE all → list empty
  const clear = await org.instructor.del("/api/notifications");
  assert.equal(clear.status, 200);
  assert.equal(clear.body.ok, true);
  const empty = await org.instructor.get("/api/notifications");
  assert.equal(empty.body.notifications.length, 0, "list empty after clear all");
  assert.equal(empty.body.unread, 0, "unread zero after clear all");
});
