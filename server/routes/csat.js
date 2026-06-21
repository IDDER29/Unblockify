"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth");
const { canSeeBlockage } = require("../lib/helpers");
const { tooLong } = require("../lib/validate");

module.exports = function csatRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  const csatFor = (blockageId) => {
    const r = db
      .prepare("SELECT rating, comment FROM csat WHERE blockage_id = ?")
      .get(blockageId);
    return r ? { rating: r.rating, comment: r.comment || "" } : null;
  };

  // POST /api/blockages/:id/csat { rating, comment? } — student rates own, resolved only
  router.post("/blockages/:id/csat", requireRole("student"), (req, res) => {
    const row = db
      .prepare("SELECT * FROM blockages WHERE id = ?")
      .get(Number(req.params.id));
    if (!row || row.user_id !== req.user.userId)
      return res.status(404).json({ error: "Blockage not found." });
    if (row.status !== "resolved")
      return res.status(409).json({ error: "You can rate it once it's resolved." });
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ error: "Pick a rating from 1 to 5." });
    const comment = (req.body.comment || "").trim() || null;
    const lenErr = tooLong(comment, 1000, "Comment");
    if (lenErr) return res.status(400).json({ error: lenErr });
    db.prepare(
      `INSERT INTO csat (org_id, blockage_id, user_id, rating, comment)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(blockage_id) DO UPDATE SET rating = excluded.rating,
            comment = excluded.comment, created_at = datetime('now')`
    ).run(row.org_id, row.id, req.user.userId, rating, comment);
    res.json({ csat: csatFor(row.id) });
  });

  // GET /api/blockages/:id/csat — student-own or any staff who can see it
  router.get("/blockages/:id/csat", (req, res) => {
    const row = db
      .prepare("SELECT * FROM blockages WHERE id = ?")
      .get(Number(req.params.id));
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    res.json({ csat: csatFor(row.id) });
  });

  return router;
};
