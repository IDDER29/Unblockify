"use strict";

const express = require("express");
const { requireAuth, requireStaff, requireRole } = require("../auth");

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

  // POST /api/me/peer-mentor-opt-in — student opts in to be a peer mentor (T2-4)
  router.post("/me/peer-mentor-opt-in", requireAuth, requireRole("student"), (req, res) => {
    const { orgId, userId } = req.user;
    db.prepare("INSERT OR REPLACE INTO peer_mentor_opt_ins (org_id, user_id) VALUES (?, ?)").run(orgId, userId);
    res.json({ ok: true, optedIn: true });
  });

  // DELETE /api/me/peer-mentor-opt-in — student opts out
  router.delete("/me/peer-mentor-opt-in", requireAuth, requireRole("student"), (req, res) => {
    const { userId } = req.user;
    db.prepare("DELETE FROM peer_mentor_opt_ins WHERE user_id = ?").run(userId);
    res.json({ ok: true, optedIn: false });
  });

  // GET /api/me/peer-mentor-opt-in — check own opt-in status
  router.get("/me/peer-mentor-opt-in", requireAuth, requireRole("student"), (req, res) => {
    const { userId } = req.user;
    const row = db.prepare("SELECT 1 FROM peer_mentor_opt_ins WHERE user_id = ?").get(userId);
    res.json({ optedIn: !!row });
  });

  // GET /api/blockages/:id/peer-mentors — find students who resolved a similar blockage (T2-4)
  // Returns opt-in students who hit same AI topics — student can initiate a connection.
  router.get("/blockages/:id/peer-mentors", requireAuth, requireRole("student"), (req, res) => {
    const { orgId, userId } = req.user;
    const blk = db.prepare("SELECT * FROM blockages WHERE id = ? AND org_id = ? AND user_id = ?").get(Number(req.params.id), orgId, userId);
    if (!blk) return res.status(404).json({ error: "Blockage not found." });

    let topics = [];
    try { topics = JSON.parse(blk.ai_topics) || []; } catch (_) {}
    if (!topics.length) return res.json({ mentors: [] });

    // Find opted-in students (not yourself) in same cohort who resolved a blockage on these topics
    const placeholders = topics.map(() => "?").join(",");
    const mentors = db.prepare(
      `SELECT DISTINCT u.id, u.name, b.title AS resolved_title, b.resolution_type,
              b.resolution_summary, b.resolved_at
         FROM blockages b
         JOIN users u ON u.id = b.user_id
         JOIN peer_mentor_opt_ins p ON p.user_id = u.id
        WHERE b.org_id = ? AND b.cohort_id = ? AND b.status = 'resolved'
          AND b.user_id != ?
          AND b.ai_topics IS NOT NULL
          AND (${topics.map(() => "b.ai_topics LIKE ?").join(" OR ")})
        ORDER BY b.resolved_at DESC LIMIT 5`
    ).all(orgId, blk.cohort_id, userId, ...topics.map((t) => `%${t}%`));

    res.json({
      mentors: mentors.map((m) => ({
        id: m.id,
        name: m.name,
        resolvedTitle: m.resolved_title,
        resolutionType: m.resolution_type,
        resolutionSummary: m.resolution_summary,
        resolvedAt: m.resolved_at,
      })),
    });
  });

  // GET /api/me/momentum — student's own unblocking trajectory (Phase 2.4)
  // Personal only — no cross-student data, no rankings.
  router.get("/me/momentum", requireAuth, (req, res) => {
    const { orgId, userId } = req.user;

    const blks = db.prepare(
      `SELECT id, title, status, resolution_type, ai_topics, created_at, resolved_at,
              (julianday(resolved_at) - julianday(created_at)) * 24 AS hours
         FROM blockages WHERE org_id = ? AND user_id = ? ORDER BY created_at DESC`
    ).all(orgId, userId);

    const resolved = blks.filter((b) => b.resolved_at);
    const resolvedHours = resolved.map((b) => b.hours).filter((h) => h != null);
    const fastestHours = resolvedHours.length ? Math.min(...resolvedHours) : null;

    // Active days: days with at least one resolve in the last 30 days
    const activeDays = new Set(
      resolved
        .filter((b) => {
          const d = new Date(b.resolved_at);
          return (Date.now() - d.getTime()) < 30 * 86400000;
        })
        .map((b) => b.resolved_at.slice(0, 10))
    ).size;

    // Top stuck topics from AI triage
    const topicMap = {};
    blks.forEach((b) => {
      let topics = [];
      try { topics = JSON.parse(b.ai_topics) || []; } catch (_) {}
      topics.forEach((t) => { topicMap[t] = (topicMap[t] || 0) + 1; });
    });
    const topTopics = Object.entries(topicMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic, count]) => ({ topic, count }));

    // Recent history (last 10)
    const history = blks.slice(0, 10).map((b) => ({
      id: b.id, title: b.title, status: b.status,
      createdAt: b.created_at, resolvedAt: b.resolved_at,
    }));

    res.json({
      totalCleared: resolved.length,
      fastestResolveHours: fastestHours != null ? Math.round(fastestHours * 10) / 10 : null,
      activeDaysLast30: activeDays,
      topStuckTopics: topTopics,
      history,
    });
  });

  // GET /api/me/teaching — instructor's personal teaching intelligence (Phase 4.4)
  // Private to the calling instructor/owner. No cross-instructor rankings.
  router.get("/me/teaching", requireRole("instructor", "owner"), (req, res) => {
    const { orgId, userId } = req.user;

    const blks = db.prepare(
      `SELECT b.id, b.title, b.status, b.ai_topics, b.created_at, b.resolved_at, b.resolution_type,
              (julianday(b.resolved_at) - julianday(b.created_at)) * 24 AS hours
         FROM blockages b
        WHERE b.org_id = ? AND b.assignee_id = ? AND b.status = 'resolved'
        ORDER BY b.resolved_at DESC`
    ).all(orgId, userId);

    const resolveHours = blks.map((b) => b.hours).filter((h) => h != null);
    const avgHours = resolveHours.length
      ? Math.round((resolveHours.reduce((a, h) => a + h, 0) / resolveHours.length) * 10) / 10
      : null;

    // Per-topic breakdown from AI triage
    const topicMap = {};
    blks.forEach((b) => {
      let topics = [];
      try { topics = JSON.parse(b.ai_topics) || []; } catch (_) {}
      topics.forEach((t) => { topicMap[t] = (topicMap[t] || 0) + 1; });
    });
    const byTopic = Object.entries(topicMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count }));

    res.json({
      teaching: {
        totalResolved: blks.length,
        avgResolveHours: avgHours,
        byTopic,
      },
    });
  });

  return router;
};
