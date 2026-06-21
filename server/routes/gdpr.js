"use strict";

const express = require("express");
const crypto = require("node:crypto");
const { requireAuth, requireRole } = require("../auth");
const { audit, AUDIT } = require("../lib/audit");

module.exports = function gdprRoutes(db) {
  const router = express.Router();

  // GET /api/export/org.json — owner: a JSON dump of the org's data.
  router.get("/export/org.json", requireAuth, requireRole("owner"), (req, res) => {
    const orgId = req.user.orgId;
    const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId);
    if (!org) return res.status(404).json({ error: "Organization not found." });

    const users = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.cohort_id AS cohort
           FROM users u WHERE u.org_id = ? ORDER BY u.id`
      )
      .all(orgId);
    const cohorts = db.prepare("SELECT * FROM cohorts WHERE org_id = ? ORDER BY id").all(orgId);
    const briefs = db.prepare("SELECT * FROM briefs WHERE org_id = ? ORDER BY id").all(orgId);
    const blockages = db.prepare("SELECT * FROM blockages WHERE org_id = ? ORDER BY id").all(orgId);
    const comments = db.prepare("SELECT * FROM comments WHERE org_id = ? ORDER BY id").all(orgId);

    audit(db, {
      orgId,
      actorId: req.user.userId,
      action: AUDIT.DATA_EXPORT,
      targetType: "org",
      targetId: orgId,
      ip: req.ip,
    });

    res.setHeader("Content-Disposition", 'attachment; filename="org-export.json"');
    res.json({ org, users, cohorts, briefs, blockages, comments });
  });

  // GET /api/export/users/:id.json — owner: one user's data (org-scoped).
  router.get("/export/users/:id.json", requireAuth, requireRole("owner"), (req, res) => {
    const orgId = req.user.orgId;
    const user = db
      .prepare("SELECT id, name, email, role, cohort_id FROM users WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), orgId);
    if (!user) return res.status(404).json({ error: "User not found." });

    const blockages = db
      .prepare("SELECT * FROM blockages WHERE org_id = ? AND user_id = ? ORDER BY id")
      .all(orgId, user.id);
    const comments = db
      .prepare("SELECT * FROM comments WHERE org_id = ? AND user_id = ? ORDER BY id")
      .all(orgId, user.id);

    audit(db, {
      orgId,
      actorId: req.user.userId,
      action: AUDIT.DATA_EXPORT,
      targetType: "user",
      targetId: user.id,
      ip: req.ip,
    });

    res.setHeader("Content-Disposition", `attachment; filename="user-${user.id}-export.json"`);
    res.json({ user, blockages, comments });
  });

  // DELETE /api/users/:id/data — right-to-erasure for one user in the caller's org.
  router.delete("/users/:id/data", requireAuth, requireRole("owner"), (req, res) => {
    const orgId = req.user.orgId;
    const user = db
      .prepare("SELECT * FROM users WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), orgId);
    if (!user) return res.status(404).json({ error: "User not found." });

    if (user.id === req.user.userId)
      return res.status(400).json({ error: "You can't erase yourself." });

    if (user.role === "owner") {
      const owners = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND role = 'owner'")
        .get(orgId).n;
      if (owners <= 1)
        return res.status(400).json({ error: "Your organization needs at least one owner." });
    }

    // Delete the user's reported blockages (cascades comments/attachments/csat),
    // then their comments elsewhere, then anonymize the user row.
    db.prepare("DELETE FROM blockages WHERE org_id = ? AND user_id = ?").run(orgId, user.id);
    db.prepare("DELETE FROM comments WHERE org_id = ? AND user_id = ?").run(orgId, user.id);
    db.prepare(
      "UPDATE users SET name = 'Deleted user', email = ?, password_hash = ? WHERE id = ?"
    ).run(`deleted+${user.id}@removed.invalid`, crypto.randomBytes(24).toString("hex"), user.id);

    audit(db, {
      orgId,
      actorId: req.user.userId,
      action: AUDIT.USER_DATA_DELETE,
      targetType: "user",
      targetId: user.id,
      ip: req.ip,
    });

    res.json({ ok: true });
  });

  return router;
};
