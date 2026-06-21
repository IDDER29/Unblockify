"use strict";

const express = require("express");
const { requireAuth, requireStaff } = require("../auth");

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

module.exports = function profileRoutes(db) {
  const router = express.Router();

  // GET /api/members/:id/profile — one student's full history + stats.
  // Guard is per-route (NOT router.use) so this /api-mounted router never
  // 403s unrelated student requests that fall through it.
  router.get("/members/:id/profile", requireAuth, requireStaff, (req, res) => {
    const { orgId } = req.user;
    const student = db
      .prepare(
        `SELECT u.id, u.name, u.email, c.name AS cohort_name
           FROM users u LEFT JOIN cohorts c ON c.id = u.cohort_id
          WHERE u.id = ? AND u.org_id = ? AND u.role = 'student'`
      )
      .get(Number(req.params.id), orgId);
    if (!student) return res.status(404).json({ error: "Student not found." });

    const blks = db
      .prepare(
        `SELECT id, title, status, resolution_type, created_at, resolved_at,
                (julianday(resolved_at) - julianday(created_at)) * 24 AS hours,
                (julianday('now') - julianday(created_at)) * 24 AS open_hours,
                (julianday('now') - julianday(created_at)) AS age_days
           FROM blockages WHERE org_id = ? AND user_id = ? ORDER BY created_at DESC`
      )
      .all(orgId, student.id);

    const totals = { open: 0, in_support: 0, resolved: 0 };
    blks.forEach((b) => (totals[b.status] = (totals[b.status] || 0) + 1));
    const resolvedHours = blks.filter((b) => b.resolved_at).map((b) => b.hours);
    const aiResolved = blks.filter((b) => b.resolution_type === "ai").length;

    const csatRows = db
      .prepare(
        `SELECT cs.rating FROM csat cs JOIN blockages b ON b.id = cs.blockage_id
          WHERE cs.org_id = ? AND b.user_id = ?`
      )
      .all(orgId, student.id);
    const avgCsat = csatRows.length
      ? Math.round((csatRows.reduce((a, r) => a + r.rating, 0) / csatRows.length) * 10) / 10
      : 0;

    // At-risk reasoning (mirrors analytics radar)
    const open = blks.filter((b) => b.status !== "resolved");
    const last7 = blks.filter((b) => b.age_days <= 7).length;
    const maxOpenHours = open.length ? Math.max(...open.map((b) => b.open_hours)) : 0;
    const reasons = [];
    if (open.length) reasons.push(`${open.length} open`);
    if (maxOpenHours > 24) reasons.push(`stuck ${Math.round(maxOpenHours)}h`);
    if (last7 >= 3) reasons.push(`${last7} this week`);

    // 14-day trend
    const byDate = {};
    blks.forEach((b) => {
      const d = (b.created_at || "").slice(0, 10);
      byDate[d] = (byDate[d] || 0) + 1;
    });
    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      trend.push({ date: d, count: byDate[d] || 0 });
    }

    res.json({
      student: {
        id: student.id, name: student.name, email: student.email,
        cohortName: student.cohort_name,
      },
      stats: {
        total: blks.length,
        open: totals.open, in_support: totals.in_support, resolved: totals.resolved,
        medianHours: Math.round(median(resolvedHours) * 10) / 10,
        aiResolved, humanResolved: totals.resolved - aiResolved,
        avgCsat, csatCount: csatRows.length,
      },
      atRisk: { open: open.length, reasons },
      recent: blks.slice(0, 20).map((b) => ({
        id: b.id, title: b.title, status: b.status,
        createdAt: b.created_at, resolvedAt: b.resolved_at,
      })),
      trend,
    });
  });

  return router;
};
