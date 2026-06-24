"use strict";

/* Super-admin routes — only callable with ADMIN_SECRET env var in Authorization header.
   These routes are NEVER org-scoped — they see all orgs. Not exposed to any org user.
   Mount at /admin/api (not /api) so normal auth middleware never touches them. */

const express = require("express");

function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(503).json({ error: "Admin API not configured." });
  const auth = req.headers["authorization"] || "";
  if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized." });
  next();
}

module.exports = function adminRoutes(db) {
  const router = express.Router();
  router.use(requireAdmin);

  // GET /admin/api/orgs — list all organizations with high-level stats
  router.get("/orgs", (req, res) => {
    const orgs = db.prepare(
      `SELECT o.id, o.name, o.slug,
              COUNT(DISTINCT u.id) AS members,
              COUNT(DISTINCT c.id) AS cohorts,
              COUNT(DISTINCT b.id) AS blockages,
              MAX(b.created_at) AS last_blockage_at,
              o.created_at
         FROM organizations o
         LEFT JOIN users u ON u.org_id = o.id
         LEFT JOIN cohorts c ON c.id = u.cohort_id
         LEFT JOIN blockages b ON b.org_id = o.id
         GROUP BY o.id ORDER BY o.created_at DESC`
    ).all();
    res.json({ orgs });
  });

  // GET /admin/api/orgs/:id — one org in detail
  router.get("/orgs/:id", (req, res) => {
    const id = Number(req.params.id);
    const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(id);
    if (!org) return res.status(404).json({ error: "Not found." });

    const members = db.prepare(
      "SELECT id, name, email, role, cohort_id, created_at FROM users WHERE org_id = ? ORDER BY created_at"
    ).all(id);

    const cohorts = db.prepare(
      "SELECT id, name, created_at FROM cohorts WHERE org_id = ? ORDER BY name"
    ).all(id);

    const stats = db.prepare(
      `SELECT COUNT(*) total,
              SUM(status='open') open,
              SUM(status='in_support') in_support,
              SUM(status='resolved') resolved,
              SUM(resolution_type='ai') ai_resolved
         FROM blockages WHERE org_id = ?`
    ).get(id);

    res.json({ org, members, cohorts, stats });
  });

  // GET /admin/api/metrics — platform-wide KPIs
  router.get("/metrics", (req, res) => {
    const orgs = db.prepare("SELECT COUNT(*) n FROM organizations").get().n;
    const users = db.prepare("SELECT COUNT(*) n FROM users").get().n;
    const blockages = db.prepare("SELECT COUNT(*) n FROM blockages").get().n;
    const resolved = db.prepare("SELECT COUNT(*) n FROM blockages WHERE status='resolved'").get().n;
    const aiResolved = db.prepare("SELECT COUNT(*) n FROM blockages WHERE resolution_type='ai'").get().n;
    const last24h = db.prepare(
      "SELECT COUNT(*) n FROM blockages WHERE created_at >= datetime('now','-1 day')"
    ).get().n;
    const last7d = db.prepare(
      "SELECT COUNT(*) n FROM blockages WHERE created_at >= datetime('now','-7 days')"
    ).get().n;

    // Org growth over last 30 days (one row per day)
    const orgGrowth = db.prepare(
      `SELECT date(created_at) day, COUNT(*) n FROM organizations
       WHERE created_at >= datetime('now','-30 days')
       GROUP BY day ORDER BY day`
    ).all();

    res.json({
      orgs, users, blockages, resolved, aiResolved,
      aiDeflectionRate: blockages ? Math.round(aiResolved / blockages * 100) : 0,
      resolveRate: blockages ? Math.round(resolved / blockages * 100) : 0,
      last24h, last7d, orgGrowth,
    });
  });

  // GET /admin/api/flags — ops flags from org-level ops pages
  router.get("/flags", (req, res) => {
    const flags = db.prepare(
      `SELECT f.*, o.name AS org_name, u.name AS reporter_name
         FROM ops_flags f
         JOIN organizations o ON o.id = f.org_id
         LEFT JOIN users u ON u.id = f.reporter_id
        ORDER BY f.created_at DESC LIMIT 200`
    ).all();
    res.json({ flags });
  });

  // POST /admin/api/orgs/:id/suspend — suspend an org
  router.post("/orgs/:id/suspend", (req, res) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE organizations SET suspended = 1 WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  // POST /admin/api/orgs/:id/unsuspend
  router.post("/orgs/:id/unsuspend", (req, res) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE organizations SET suspended = 0 WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  return router;
};
