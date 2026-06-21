"use strict";

const express = require("express");
const { requireAuth, requireRole, requireStaff } = require("../auth");
const { canSeeBlockage } = require("../lib/helpers");
const { tooLong } = require("../lib/validate");

module.exports = function tagsRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  const tagsFor = (blockageId) =>
    db
      .prepare(
        `SELECT t.id, t.name, t.color FROM tags t
           JOIN blockage_tags bt ON bt.tag_id = t.id
          WHERE bt.blockage_id = ? ORDER BY t.name`
      )
      .all(blockageId);

  // GET /api/tags — org taxonomy (any member)
  router.get("/tags", (req, res) => {
    const tags = db
      .prepare("SELECT id, name, color FROM tags WHERE org_id = ? ORDER BY name")
      .all(req.user.orgId);
    res.json({ tags });
  });

  // POST /api/tags { name, color? } — owner
  router.post("/tags", requireRole("owner"), (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Tag name is required." });
    const lenErr = tooLong(name, 60, "Tag name");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const color = (req.body.color || "").trim() || null;
    const exists = db
      .prepare("SELECT id FROM tags WHERE org_id = ? AND name = ?")
      .get(req.user.orgId, name);
    if (exists) return res.status(409).json({ error: "That tag already exists." });
    const info = db
      .prepare("INSERT INTO tags (org_id, name, color) VALUES (?, ?, ?)")
      .run(req.user.orgId, name, color);
    res.status(201).json({ tag: { id: info.lastInsertRowid, name, color } });
  });

  // DELETE /api/tags/:id — owner
  router.delete("/tags/:id", requireRole("owner"), (req, res) => {
    const tag = db
      .prepare("SELECT * FROM tags WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!tag) return res.status(404).json({ error: "Tag not found." });
    db.prepare("DELETE FROM tags WHERE id = ?").run(tag.id);
    res.json({ ok: true });
  });

  const visibleBlockage = (req) => {
    const row = db
      .prepare("SELECT * FROM blockages WHERE id = ?")
      .get(Number(req.params.id));
    return canSeeBlockage(db, req.user, row) ? row : null;
  };

  // POST /api/blockages/:id/tags { tagId } — staff attach
  router.post("/blockages/:id/tags", requireStaff, (req, res) => {
    const row = visibleBlockage(req);
    if (!row) return res.status(404).json({ error: "Blockage not found." });
    const tag = db
      .prepare("SELECT * FROM tags WHERE id = ? AND org_id = ?")
      .get(Number(req.body.tagId), req.user.orgId);
    if (!tag) return res.status(400).json({ error: "Unknown tag." });
    db.prepare(
      "INSERT OR IGNORE INTO blockage_tags (blockage_id, tag_id) VALUES (?, ?)"
    ).run(row.id, tag.id);
    res.json({ tags: tagsFor(row.id) });
  });

  // DELETE /api/blockages/:id/tags/:tagId — staff detach
  router.delete("/blockages/:id/tags/:tagId", requireStaff, (req, res) => {
    const row = visibleBlockage(req);
    if (!row) return res.status(404).json({ error: "Blockage not found." });
    db.prepare("DELETE FROM blockage_tags WHERE blockage_id = ? AND tag_id = ?").run(
      row.id,
      Number(req.params.tagId)
    );
    res.json({ tags: tagsFor(row.id) });
  });

  return router;
};
