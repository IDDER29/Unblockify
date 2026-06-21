"use strict";

const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { requireAuth } = require("../auth");
const { canSeeBlockage } = require("../lib/helpers");
const {
  decodeBase64,
  extForMime,
  storedPathFor,
  uploadsDir,
} = require("../lib/uploads");

module.exports = function attachmentRoutes(db) {
  const router = express.Router();
  // Allow base64 payloads up to ~8MB JSON for a 5MB binary; this router only.
  router.use(express.json({ limit: "8mb" }));
  router.use(requireAuth);

  const blockageById = (id) =>
    db.prepare("SELECT * FROM blockages WHERE id = ?").get(Number(id));

  // POST /api/attachments — JSON+base64 upload
  router.post("/attachments", (req, res) => {
    const filename = String(req.body.filename || "").trim().slice(0, 200) || "file";
    const mime = String(req.body.mime || "").toLowerCase();
    const blockageId = req.body.blockageId ? Number(req.body.blockageId) : null;

    const decoded = decodeBase64({ dataB64: req.body.dataB64, mime });
    if (decoded.error) return res.status(400).json({ error: decoded.error });

    if (blockageId) {
      const row = blockageById(blockageId);
      if (!canSeeBlockage(db, req.user, row))
        return res.status(404).json({ error: "Blockage not found." });
    }

    const { abs, rel } = storedPathFor(extForMime(mime));
    try {
      fs.writeFileSync(abs, decoded.buffer);
    } catch (_) {
      return res.status(500).json({ error: "Couldn't save the file." });
    }
    const info = db
      .prepare(
        `INSERT INTO attachments (org_id, blockage_id, comment_id, uploader_id, filename, mime, size, stored_path)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`
      )
      .run(req.user.orgId, blockageId, req.user.userId, filename, mime, decoded.size, rel);
    res.status(201).json({
      attachment: {
        id: info.lastInsertRowid,
        filename,
        mime,
        size: decoded.size,
        blockageId,
      },
    });
  });

  // GET /api/attachments/:id — tenant-guarded stream
  router.get("/attachments/:id", (req, res) => {
    const att = db
      .prepare("SELECT * FROM attachments WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!att) return res.status(404).json({ error: "Not found." });
    if (att.blockage_id) {
      const row = blockageById(att.blockage_id);
      if (!canSeeBlockage(db, req.user, row))
        return res.status(404).json({ error: "Not found." });
    }
    const abs = path.join(uploadsDir(), att.stored_path);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found." });

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", att.mime);
    // SVG can carry script; never render it inline.
    const disp = att.mime === "image/svg+xml" ? "attachment" : "inline";
    res.setHeader(
      "Content-Disposition",
      `${disp}; filename="${att.filename.replace(/"/g, "")}"`
    );
    fs.createReadStream(abs).pipe(res);
  });

  // GET /api/blockages/:id/attachments — list for a visible blockage
  router.get("/blockages/:id/attachments", (req, res) => {
    const row = blockageById(req.params.id);
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    const rows = db
      .prepare(
        `SELECT id, filename, mime, size, comment_id AS commentId, created_at AS createdAt
           FROM attachments WHERE blockage_id = ? AND org_id = ? ORDER BY created_at`
      )
      .all(row.id, req.user.orgId);
    res.json({ attachments: rows });
  });

  return router;
};
