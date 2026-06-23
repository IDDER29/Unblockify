"use strict";

const express = require("express");
const { requireAuth, requireStaff } = require("../auth");
const { clusterResolved } = require("../lib/retrieval");
const ai = require("../lib/ai");
const { sendEmail } = require("../lib/email");

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

module.exports = function analyticsRoutes(db) {
  const router = express.Router();
  router.use(requireAuth, requireStaff);

  router.get("/analytics", (req, res) => {
    const { orgId, role, userId } = req.user;

    // Cohort scope
    let cohortFilter = "";
    const scopeArgs = [orgId];
    if (role === "instructor") {
      cohortFilter =
        " AND b.cohort_id IN (SELECT cohort_id FROM cohort_instructors WHERE user_id = ?)";
      scopeArgs.push(userId);
    }
    const where = "WHERE b.org_id = ?" + cohortFilter;

    const all = db
      .prepare(
        `SELECT b.id, b.status, b.cohort_id, b.assignee_id, b.user_id,
                b.resolution_type, b.created_at, b.resolved_at,
                b.ai_topics, b.ai_urgency,
                (julianday(b.resolved_at) - julianday(b.created_at)) * 24 AS hours,
                (julianday('now') - julianday(b.created_at)) * 24 AS open_hours,
                (julianday('now') - julianday(b.created_at)) AS age_days
           FROM blockages b ${where}`
      )
      .all(...scopeArgs);

    const totals = { open: 0, in_support: 0, resolved: 0 };
    all.forEach((b) => (totals[b.status] = (totals[b.status] || 0) + 1));
    const total = all.length;
    const resolveRate = total ? Math.round((totals.resolved / total) * 100) : 0;
    const medianHours = Math.round(
      median(all.filter((b) => b.resolved_at).map((b) => b.hours)) * 10
    ) / 10;

    // Volume last 14 days
    const byDate = {};
    all.forEach((b) => {
      const d = (b.created_at || "").slice(0, 10);
      byDate[d] = (byDate[d] || 0) + 1;
    });
    const volumeByDay = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      volumeByDay.push({ date: d, count: byDate[d] || 0 });
    }

    // By cohort
    const cohorts = db.prepare("SELECT id, name FROM cohorts WHERE org_id = ?").all(orgId);
    const byCohort = cohorts
      .map((c) => {
        const rows = all.filter((b) => b.cohort_id === c.id);
        return {
          cohort: c.name,
          open: rows.filter((b) => b.status !== "resolved").length,
          resolved: rows.filter((b) => b.status === "resolved").length,
        };
      })
      .filter((c) => c.open + c.resolved > 0);

    // By instructor
    const staff = db
      .prepare("SELECT id, name FROM users WHERE org_id = ? AND role IN ('instructor','owner')")
      .all(orgId);
    const byInstructor = staff
      .map((s) => {
        const rows = all.filter((b) => b.assignee_id === s.id && b.resolved_at);
        return {
          name: s.name,
          resolved: rows.length,
          medianHours: Math.round(median(rows.map((b) => b.hours)) * 10) / 10,
        };
      })
      .filter((s) => s.resolved > 0);

    // AI triage rollups
    const topicCounts = {};
    const byUrgency = { low: 0, normal: 0, high: 0 };
    all.forEach((b) => {
      if (b.ai_urgency && byUrgency[b.ai_urgency] != null) byUrgency[b.ai_urgency]++;
      let topics = [];
      try { topics = JSON.parse(b.ai_topics) || []; } catch (_) {}
      topics.forEach((t) => { topicCounts[t] = (topicCounts[t] || 0) + 1; });
    });
    const byTopic = Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // AI deflection
    const aiResolved = all.filter((b) => b.resolution_type === "ai").length;
    const deflectionRate = total ? Math.round((aiResolved / total) * 100) : 0;
    const perBlocker = medianHours || 2; // hours an instructor would have spent
    const hoursSaved = Math.round(aiResolved * perBlocker * 10) / 10;

    // At-risk students: cluster of open blockages, long waits, recent volume
    const students = db
      .prepare("SELECT id, name FROM users WHERE org_id = ? AND role = 'student'")
      .all(orgId);
    const atRisk = students
      .map((s) => {
        const mine = all.filter((b) => b.user_id === s.id);
        if (!mine.length) return null;
        const open = mine.filter((b) => b.status !== "resolved");
        const last7 = mine.filter((b) => b.age_days <= 7).length;
        const maxOpenHours = open.length ? Math.max(...open.map((b) => b.open_hours)) : 0;
        let score = open.length * 2 + last7;
        if (maxOpenHours > 24) score += 3;
        if (open.length >= 3) score += 2;
        const reasons = [];
        if (open.length) reasons.push(`${open.length} open`);
        if (maxOpenHours > 24) reasons.push(`stuck ${Math.round(maxOpenHours)}h`);
        if (last7 >= 3) reasons.push(`${last7} this week`);

        // Last intervention (nudge or flag)
        const lastCheckIn = db
          .prepare(
            `SELECT MAX(created_at) AS last_at FROM check_ins
              WHERE student_id = ? AND org_id = ?`
          )
          .get(s.id, orgId);
        const lastInterventionAt = lastCheckIn ? lastCheckIn.last_at : null;

        // Recovered: resolved a blockage within 7 days after first check-in
        let recovered = false;
        if (lastInterventionAt) {
          const firstCheckIn = db
            .prepare(
              `SELECT MIN(created_at) AS first_at FROM check_ins
                WHERE student_id = ? AND org_id = ?`
            )
            .get(s.id, orgId);
          if (firstCheckIn && firstCheckIn.first_at) {
            const resolvedAfter = db
              .prepare(
                `SELECT COUNT(*) AS cnt FROM blockages
                  WHERE user_id = ? AND org_id = ? AND status = 'resolved'
                    AND resolved_at >= ?
                    AND resolved_at <= datetime(?, '+7 days')`
              )
              .get(s.id, orgId, firstCheckIn.first_at, firstCheckIn.first_at);
            recovered = resolvedAfter && resolvedAfter.cnt > 0;
          }
        }

        return { id: s.id, name: s.name, open: open.length, score, reasons, lastInterventionAt, recovered };
      })
      .filter((s) => s && s.score >= 3);

    // Cohort-less students (owner scope): the most stuck — they can't even
    // report a blockage. Give them a high score and a clear reason.
    if (role === "owner") {
      const orphans = db
        .prepare(
          "SELECT id, name FROM users WHERE org_id = ? AND role = 'student' AND cohort_id IS NULL"
        )
        .all(orgId);
      const seen = new Set(atRisk.map((s) => `${s.id}|${s.name}`));
      orphans.forEach((o) => {
        const key = `${o.id}|${o.name}`;
        if (seen.has(key)) return;
        seen.add(key);
        atRisk.push({ id: o.id, name: o.name, open: 0, score: 99, reasons: ["no cohort"] });
      });
    }

    const atRiskTop = atRisk
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    const csatRows = db
      .prepare(
        `SELECT cs.rating FROM csat cs JOIN blockages b ON b.id = cs.blockage_id
          WHERE b.org_id = ?${cohortFilter}`
      )
      .all(...scopeArgs);
    const avgCsat = csatRows.length
      ? Math.round((csatRows.reduce((s, r) => s + r.rating, 0) / csatRows.length) * 10) / 10
      : 0;

    res.json({
      totals,
      total,
      resolveRate,
      avgCsat,
      csatCount: csatRows.length,
      medianHoursToUnblock: medianHours,
      aiResolved,
      deflectionRate,
      hoursSaved,
      atRisk: atRiskTop,
      volumeByDay,
      byCohort,
      byInstructor,
      byTopic,
      byUrgency,
    });
  });

  // GET /api/analytics/hotspots?cohortId=&windowDays= — curriculum hot-spots
  router.get("/analytics/hotspots", (req, res) => {
    const { orgId, role, userId } = req.user;
    const windowDays = Math.min(Number(req.query.windowDays) || 7, 90);
    const cohortId = req.query.cohortId ? Number(req.query.cohortId) : null;

    // Scope to instructor's cohorts if needed
    let cohortFilter = "";
    const args = [orgId, windowDays];
    if (cohortId) {
      cohortFilter = " AND b.cohort_id = ?";
      args.push(cohortId);
    } else if (role === "instructor") {
      cohortFilter = " AND b.cohort_id IN (SELECT cohort_id FROM cohort_instructors WHERE user_id = ?)";
      args.push(userId);
    }

    const rows = db.prepare(
      `SELECT b.id, b.status, b.ai_topics, b.created_at, b.resolved_at,
              (julianday(b.resolved_at) - julianday(b.created_at)) * 24 AS hours
         FROM blockages b
        WHERE b.org_id = ?
          AND b.created_at >= datetime('now', '-' || ? || ' days')
          ${cohortFilter}`
    ).all(...args);

    // Aggregate by topic
    const topicMap = {};
    rows.forEach((b) => {
      let topics = [];
      try { topics = JSON.parse(b.ai_topics) || []; } catch (_) {}
      topics.forEach((t) => {
        if (!topicMap[t]) topicMap[t] = { topic: t, count: 0, resolvedHours: [], reopenCount: 0 };
        topicMap[t].count++;
        if (b.resolved_at && b.hours != null) topicMap[t].resolvedHours.push(b.hours);
      });
    });

    // Build trend: daily counts per topic over the window
    const today = new Date();
    const hotspots = Object.values(topicMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((t) => ({
        topic: t.topic,
        count: t.count,
        medianResolveHours: t.resolvedHours.length ? Math.round(median(t.resolvedHours) * 10) / 10 : null,
        trend: Array.from({ length: Math.min(windowDays, 7) }, (_, i) => {
          const day = new Date(today);
          day.setDate(day.getDate() - (Math.min(windowDays, 7) - 1 - i));
          const ds = day.toISOString().slice(0, 10);
          return { date: ds, count: 0 }; // simplified — real impl would count per day
        }),
      }));

    // Fire threshold alerts: 3+ blockages on one topic in 7 days → create hotspot_alert (dedup per topic/week)
    const week = today.toISOString().slice(0, 10).replace(/-\d\d$/, (m) => {
      const d = new Date(today);
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      return "-W" + String(Math.ceil((((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1) / 7)).padStart(2, "0");
    });
    hotspots.filter((h) => h.count >= 3).forEach((h) => {
      try {
        db.prepare(
          `INSERT OR IGNORE INTO hotspot_alerts (org_id, cohort_id, topic, week)
           VALUES (?, ?, ?, ?)`
        ).run(orgId, cohortId || null, h.topic, week);
      } catch (_) {}
    });

    res.json({ hotspots, windowDays });
  });

  // Recent activity feed: the 30 most recent status events in scope.
  router.get("/activity", (req, res) => {
    const { orgId, role, userId } = req.user;

    let scopeFilter = "";
    const args = [orgId];
    if (role === "instructor") {
      scopeFilter =
        " AND b.cohort_id IN (SELECT cohort_id FROM cohort_instructors WHERE user_id = ?)";
      args.push(userId);
    }

    const rows = db
      .prepare(
        `SELECT e.type, e.blockage_id, e.meta, e.created_at,
                b.title AS blockage_title, u.name AS actor
           FROM status_events e
           JOIN blockages b ON b.id = e.blockage_id
           LEFT JOIN users u ON u.id = e.actor_id
          WHERE e.org_id = ?${scopeFilter}
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT 30`
      )
      .all(...args);

    const activity = rows.map((r) => ({
      type: r.type,
      actor: r.actor || null,
      blockageId: r.blockage_id,
      blockageTitle: r.blockage_title,
      meta: r.meta,
      createdAt: r.created_at,
    }));

    res.json({ activity });
  });

  // GET /api/analytics/digest — "what did your cohort struggle with this week?"
  router.get("/analytics/digest", async (req, res) => {
    const { orgId, role, userId } = req.user;
    const periodDays = 7;
    let cohortIds = null;
    if (role === "instructor") {
      cohortIds = db
        .prepare("SELECT cohort_id FROM cohort_instructors WHERE user_id = ?")
        .all(userId)
        .map((r) => r.cohort_id);
    }
    const clusters = clusterResolved(db, { orgId, sinceDays: periodDays, maxThemes: 4, cohortIds });
    const resolvedCount = clusters.reduce((a, c) => a + c.count, 0);
    const org = db.prepare("SELECT name FROM organizations WHERE id = ?").get(orgId);
    const summary = await ai.digestSummary({
      orgName: org.name, periodDays, clusters, totals: { resolved: resolvedCount },
    });
    const emailable = true; // Phase 2 transactional email is live
    let emailSent = false;
    if (req.query.email === "1" && resolvedCount > 0) {
      try {
        const me = db.prepare("SELECT email FROM users WHERE id = ?").get(userId);
        await sendEmail({
          to: me.email,
          subject: "Your Unblockify weekly digest",
          text: summary + "\n\nThemes:\n" + clusters.map((t) => `• ${t.theme} (${t.count})`).join("\n"),
        });
        emailSent = true;
      } catch (_) {
        emailSent = false;
      }
    }
    res.json({
      periodDays,
      resolvedCount,
      themes: clusters.map((t) => ({ theme: t.theme, count: t.count, sampleTitles: t.sampleTitles })),
      summary,
      emailable,
      emailSent,
    });
  });

  return router;
};
