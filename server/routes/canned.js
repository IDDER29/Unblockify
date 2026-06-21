"use strict";

const express = require("express");
const { requireAuth, requireStaff } = require("../auth");
const { tooLong } = require("../lib/validate");

module.exports = function cannedRoutes(db) {
  const router = express.Router();
  // Guard per-route (not via router.use) so this /api-mounted router never
  // short-circuits unrelated requests that fall through to later routers.
  router.use("/canned", requireAuth, requireStaff);

  // GET /api/canned — per-org snippets
  router.get("/canned", (req, res) => {
    const canned = db
      .prepare("SELECT id, title, body FROM canned_responses WHERE org_id = ? ORDER BY title")
      .all(req.user.orgId);
    res.json({ canned });
  });

  // POST /api/canned { title, body }
  router.post("/canned", (req, res) => {
    const title = (req.body.title || "").trim();
    const body = (req.body.body || "").trim();
    if (!title) return res.status(400).json({ error: "Give the snippet a title." });
    if (!body) return res.status(400).json({ error: "Write the snippet body." });
    const lenErr = tooLong(title, 100, "Title") || tooLong(body, 5000, "Body");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const info = db
      .prepare(
        "INSERT INTO canned_responses (org_id, title, body, created_by) VALUES (?, ?, ?, ?)"
      )
      .run(req.user.orgId, title, body, req.user.userId);
    res.status(201).json({ canned: { id: info.lastInsertRowid, title, body } });
  });

  // DELETE /api/canned/:id
  router.delete("/canned/:id", (req, res) => {
    const row = db
      .prepare("SELECT * FROM canned_responses WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!row) return res.status(404).json({ error: "Snippet not found." });
    db.prepare("DELETE FROM canned_responses WHERE id = ?").run(row.id);
    res.json({ ok: true });
  });

  return router;
};
