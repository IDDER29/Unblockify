"use strict";

const express = require("express");
const { requireAuth } = require("../auth");
const { tooLong } = require("../lib/validate");

module.exports = function viewsRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  const publicView = (r) => ({
    id: r.id, name: r.name, status: r.status || "",
    cohortId: r.cohort_id, tagId: r.tag_id, search: r.search || "",
  });

  // GET /api/views — the caller's own saved views
  router.get("/views", (req, res) => {
    const rows = db
      .prepare(
        "SELECT * FROM saved_views WHERE org_id = ? AND user_id = ? ORDER BY created_at"
      )
      .all(req.user.orgId, req.user.userId);
    res.json({ views: rows.map(publicView) });
  });

  // POST /api/views { name, status?, cohortId?, tagId?, search? }
  router.post("/views", (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name your view." });
    const lenErr = tooLong(name, 100, "View name");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const status = (req.body.status || "").trim() || null;
    const cohortId = req.body.cohortId ? Number(req.body.cohortId) : null;
    const tagId = req.body.tagId ? Number(req.body.tagId) : null;
    const search = (req.body.search || "").trim() || null;
    const info = db
      .prepare(
        `INSERT INTO saved_views (org_id, user_id, name, status, cohort_id, tag_id, search)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(req.user.orgId, req.user.userId, name, status, cohortId, tagId, search);
    res.status(201).json({
      view: publicView({
        id: info.lastInsertRowid, name, status, cohort_id: cohortId, tag_id: tagId, search,
      }),
    });
  });

  // DELETE /api/views/:id — owner of the view only
  router.delete("/views/:id", (req, res) => {
    const row = db
      .prepare("SELECT * FROM saved_views WHERE id = ? AND org_id = ? AND user_id = ?")
      .get(Number(req.params.id), req.user.orgId, req.user.userId);
    if (!row) return res.status(404).json({ error: "View not found." });
    db.prepare("DELETE FROM saved_views WHERE id = ?").run(row.id);
    res.json({ ok: true });
  });

  return router;
};
