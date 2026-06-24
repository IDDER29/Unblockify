"use strict";

const express = require("express");
const { requireAuth } = require("../auth");
const { canSeeBlockage } = require("../lib/helpers");
const { tokenize } = require("../lib/retrieval");

module.exports = function knowledgeRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/knowledge?q=&topic= — search resolved blockages by keyword over resolution_summary
  // Org-scoped. Students see only their cohort's resolutions. Staff see all.
  router.get("/knowledge", (req, res) => {
    const { orgId, role, userId } = req.user;
    const q = String(req.query.q || "").trim();
    const topic = String(req.query.topic || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 20;

    // Determine cohort scope for students
    let cohortFilter = "";
    const args = [orgId];
    if (role === "student") {
      const u = db.prepare("SELECT cohort_id FROM users WHERE id = ?").get(userId);
      if (u && u.cohort_id) {
        cohortFilter = " AND b.cohort_id = ?";
        args.push(u.cohort_id);
      }
    }

    let topicFilter = "";
    if (topic) {
      topicFilter = " AND b.ai_topics LIKE ?";
      args.push(`%${topic}%`);
    }

    const rows = db.prepare(
      `SELECT b.id, b.title, b.resolution_type, b.resolution_summary, b.resolved_at,
              b.ai_topics, c.name AS cohort_name
         FROM blockages b JOIN cohorts c ON c.id = b.cohort_id
        WHERE b.org_id = ? AND b.status = 'resolved'
          AND (b.resolution_summary IS NOT NULL OR b.resolution_note IS NOT NULL)
          ${cohortFilter}${topicFilter}
        ORDER BY b.resolved_at DESC`
    ).all(...args);

    // Filter by keyword if provided
    let filtered = rows;
    if (q.length >= 2) {
      const qTokens = new Set(tokenize(q));
      filtered = rows
        .map((r) => {
          const haystack = tokenize([r.title, r.resolution_summary, r.ai_topics].filter(Boolean).join(" "));
          const overlap = haystack.filter((t) => qTokens.has(t)).length;
          return { r, overlap };
        })
        .filter((x) => x.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap)
        .map((x) => x.r);
    }

    const total = filtered.length;
    const page_data = filtered.slice((page - 1) * perPage, page * perPage).map((r) => {
      let topics = [];
      try { topics = JSON.parse(r.ai_topics) || []; } catch (_) {}
      return {
        id: r.id,
        title: r.title,
        resolutionType: r.resolution_type,
        resolutionSummary: r.resolution_summary,
        resolvedAt: r.resolved_at,
        cohortName: r.cohort_name,
        topics,
      };
    });

    res.json({ results: page_data, total, page, perPage });
  });

  // GET /api/knowledge/browse?topic=&page= — paginated browse (same as /knowledge without q)
  router.get("/knowledge/browse", (req, res) => {
    // Re-use same logic as /knowledge but without keyword search
    const { orgId, role, userId } = req.user;
    const topic = String(req.query.topic || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 20;

    let cohortFilter = "";
    const args = [orgId];
    if (role === "student") {
      const u = db.prepare("SELECT cohort_id FROM users WHERE id = ?").get(userId);
      if (u && u.cohort_id) { cohortFilter = " AND b.cohort_id = ?"; args.push(u.cohort_id); }
    }

    let topicFilter = "";
    if (topic) { topicFilter = " AND b.ai_topics LIKE ?"; args.push(`%${topic}%`); }

    const rows = db.prepare(
      `SELECT b.id, b.title, b.resolution_type, b.resolution_summary, b.resolved_at,
              b.ai_topics, c.name AS cohort_name
         FROM blockages b JOIN cohorts c ON c.id = b.cohort_id
        WHERE b.org_id = ? AND b.status = 'resolved'
          AND (b.resolution_summary IS NOT NULL OR b.resolution_note IS NOT NULL)
          ${cohortFilter}${topicFilter}
        ORDER BY b.resolved_at DESC LIMIT ? OFFSET ?`
    ).all(...args, perPage, (page - 1) * perPage);

    const total = db.prepare(
      `SELECT COUNT(*) AS cnt FROM blockages b
        WHERE b.org_id = ? AND b.status = 'resolved'
          AND (b.resolution_summary IS NOT NULL OR b.resolution_note IS NOT NULL)
          ${cohortFilter.replace("b.cohort_id", "cohort_id")}${topicFilter.replace("b.ai_topics", "ai_topics")}`
    ).get(...args.slice(0, args.length - (topic ? 1 : 0) + (topic ? 1 : 0)));

    const results = rows.map((r) => {
      let topics = [];
      try { topics = JSON.parse(r.ai_topics) || []; } catch (_) {}
      return { id: r.id, title: r.title, resolutionType: r.resolution_type, resolutionSummary: r.resolution_summary, resolvedAt: r.resolved_at, cohortName: r.cohort_name, topics };
    });

    res.json({ results, total: total ? total.cnt : rows.length, page, perPage });
  });

  return router;
};
