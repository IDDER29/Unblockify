"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth");

// Owner-only audit log viewer + CSV export. Read-only; the log is append-only.
module.exports = function auditRoutes(db) {
  const router = express.Router();

  router.get("/audit", requireAuth, requireRole("owner"), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const rows = db
      .prepare(
        `SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId,
                a.ip, a.meta, a.created_at AS createdAt, u.name AS actor
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.org_id = ? ORDER BY a.id DESC LIMIT ? OFFSET ?`
      )
      .all(req.user.orgId, limit, offset);
    const total = db
      .prepare("SELECT COUNT(*) n FROM audit_log WHERE org_id = ?")
      .get(req.user.orgId).n;
    res.json({ entries: rows, total });
  });

  router.get("/audit/export.csv", requireAuth, requireRole("owner"), (req, res) => {
    const rows = db
      .prepare(
        `SELECT a.created_at, a.action, u.name AS actor, a.target_type, a.target_id, a.ip
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.org_id = ? ORDER BY a.id DESC`
      )
      .all(req.user.orgId);
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [["createdAt", "action", "actor", "targetType", "targetId", "ip"].map(esc).join(",")];
    for (const r of rows) {
      lines.push([r.created_at, r.action, r.actor, r.target_type, r.target_id, r.ip].map(esc).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="audit-log.csv"');
    res.send(lines.join("\r\n"));
  });

  return router;
};
