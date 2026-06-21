"use strict";

const express = require("express");
const { requireAuth } = require("../auth");
const { sendEmail } = require("../lib/email");

module.exports = function notificationRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/notifications  (?unread=1 → only unread; `unread` count is always total unread)
  router.get("/notifications", (req, res) => {
    const onlyUnread = req.query.unread === "1" || req.query.unread === "true";
    const rows = db
      .prepare(
        `SELECT id, type, blockage_id AS blockageId, body, read, created_at AS createdAt
           FROM notifications
          WHERE user_id = ?${onlyUnread ? " AND read = 0" : ""}
          ORDER BY created_at DESC LIMIT 100`
      )
      .all(req.user.userId);
    const unread = db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0")
      .get(req.user.userId).n;
    res.json({ notifications: rows, unread });
  });

  // POST /api/notifications/:id/read
  router.post("/notifications/:id/read", (req, res) => {
    db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").run(
      Number(req.params.id),
      req.user.userId
    );
    res.json({ ok: true });
  });

  // POST /api/notifications/read-all
  router.post("/notifications/read-all", (req, res) => {
    db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(req.user.userId);
    res.json({ ok: true });
  });

  // DELETE /api/notifications/:id  (own → 404 if not theirs)
  router.delete("/notifications/:id", (req, res) => {
    const info = db
      .prepare("DELETE FROM notifications WHERE id = ? AND user_id = ?")
      .run(Number(req.params.id), req.user.userId);
    if (!info.changes) return res.status(404).json({ message: "Not found." });
    res.json({ ok: true });
  });

  // DELETE /api/notifications  (own → clear all)
  router.delete("/notifications", (req, res) => {
    db.prepare("DELETE FROM notifications WHERE user_id = ?").run(req.user.userId);
    res.json({ ok: true });
  });

  // POST /api/notifications/digest — email the caller their unread notifications.
  // Does not mark them read; only sends if there's at least one unread.
  router.post("/notifications/digest", async (req, res) => {
    const rows = db
      .prepare(
        `SELECT body FROM notifications
          WHERE user_id = ? AND read = 0
          ORDER BY created_at DESC LIMIT 50`
      )
      .all(req.user.userId);
    const count = rows.length;
    if (count === 0) return res.json({ ok: true, count: 0, emailed: false });

    const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.userId);
    const text = rows.map((r) => "• " + r.body).join("\n");
    let emailed = false;
    try {
      await sendEmail({ to: user.email, subject: count + " updates on Unblockify", text });
      emailed = true;
    } catch (_) {
      emailed = false; // degrade gracefully — never 500 the request
    }
    res.json({ ok: true, count, emailed });
  });

  return router;
};
