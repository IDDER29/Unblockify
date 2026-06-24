"use strict";

const express = require("express");
const { requireAuth, requireStaff, requireRole } = require("../auth");
const {
  addEvent,
  notify,
  canSeeBlockage,
  cohortInstructorIds,
} = require("../lib/helpers");
const ai = require("../lib/ai");
const { similarResolved } = require("../lib/retrieval");
const { tooLong } = require("../lib/validate");
const { pickAssignee } = require("../lib/assign");
const { readSla, slaState } = require("../lib/sla");

const BASE = `
  SELECT b.*, su.name AS student_name, au.name AS assignee_name,
         c.name AS cohort_name, br.name AS brief_name,
         (SELECT COUNT(*) FROM comments cm WHERE cm.blockage_id = b.id) AS comment_count
    FROM blockages b
    JOIN users su ON su.id = b.user_id
    LEFT JOIN users au ON au.id = b.assignee_id
    JOIN cohorts c ON c.id = b.cohort_id
    LEFT JOIN briefs br ON br.id = b.brief_id
`;

function parseTopics(s) {
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

module.exports = function blockageRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  const rowById = (id) => db.prepare("SELECT * FROM blockages WHERE id = ?").get(Number(id));
  const joinedById = (id) => db.prepare(BASE + " WHERE b.id = ?").get(Number(id));

  const tagsFor = (blockageId) =>
    db.prepare(
      `SELECT t.id, t.name, t.color FROM tags t
         JOIN blockage_tags bt ON bt.tag_id = t.id
        WHERE bt.blockage_id = ? ORDER BY t.name`
    ).all(blockageId);

  function needsBackupFlag(blockageId, status, openHours) {
    if (status !== "open") return false;
    if (!openHours || openHours < 0.5) return false; // < 30 min
    const comments = db.prepare(
      `SELECT cm.is_ai, cm.user_id, u.role, cm.created_at
         FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
        WHERE cm.blockage_id = ? ORDER BY cm.created_at`
    ).all(blockageId);
    const hasAiComment = comments.some((c) => c.is_ai);
    if (!hasAiComment) return false;
    const lastAiIdx = comments.map((c) => c.is_ai).lastIndexOf(1);
    if (lastAiIdx === -1) return false;
    const afterAi = comments.slice(lastAiIdx + 1);
    const studentRepliedAfterAi = afterAi.some((c) => c.role === "student");
    const instructorReplied = comments.some((c) => c.role === "instructor" || c.role === "owner");
    return studentRepliedAfterAi && !instructorReplied;
  }

  function summary(r) {
    const openHours = r.resolved_at ? 0 : (Date.now() - new Date(r.created_at).getTime()) / 3600000;
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      difficulty: r.difficulty,
      cohortId: r.cohort_id,
      cohortName: r.cohort_name,
      briefName: r.brief_name,
      studentName: r.student_name,
      assigneeName: r.assignee_name,
      commentCount: r.comment_count,
      tags: tagsFor(r.id),
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolutionType: r.resolution_type || null,
      aiDifficulty: r.ai_difficulty || null,
      aiTopics: parseTopics(r.ai_topics),
      aiUrgency: r.ai_urgency || null,
      needsBackup: needsBackupFlag(r.id, r.status, openHours),
      resolutionSummary: r.resolution_summary || null,
    };
  }

  // Bind caller-owned, still-unbound attachments to a blockage (report-level).
  function bindAttachments(user, ids, blockageId) {
    if (!Array.isArray(ids) || !ids.length) return;
    const upd = db.prepare(
      `UPDATE attachments SET blockage_id = ?, comment_id = NULL
         WHERE id = ? AND org_id = ? AND uploader_id = ? AND blockage_id IS NULL`
    );
    for (const raw of ids.slice(0, 10)) {
      const aid = Number(raw);
      if (aid) upd.run(blockageId, aid, user.orgId, user.userId);
    }
  }

  // Bind caller-owned attachments to a comment (uploaded with blockageId set, or unbound).
  function bindToComment(user, ids, blockageId, commentId) {
    if (!Array.isArray(ids) || !ids.length) return;
    const setBlk = db.prepare(
      `UPDATE attachments SET blockage_id = ?
         WHERE id = ? AND org_id = ? AND uploader_id = ? AND blockage_id IS NULL`
    );
    const upd = db.prepare(
      `UPDATE attachments SET comment_id = ?
         WHERE id = ? AND org_id = ? AND uploader_id = ?
           AND comment_id IS NULL AND blockage_id = ?`
    );
    for (const raw of ids.slice(0, 10)) {
      const aid = Number(raw);
      if (!aid) continue;
      setBlk.run(blockageId, aid, user.orgId, user.userId);
      upd.run(commentId, aid, user.orgId, user.userId, blockageId);
    }
  }

  // GET /api/blockages?status=&cohortId=
  router.get("/blockages", (req, res) => {
    const { orgId, role, userId } = req.user;
    let sql = BASE + " WHERE b.org_id = ?";
    const args = [orgId];
    if (role === "student") {
      sql += " AND b.user_id = ?";
      args.push(userId);
    } else if (role === "instructor") {
      sql += " AND (b.assignee_id = ? OR b.cohort_id IN (SELECT cohort_id FROM cohort_instructors WHERE user_id = ?))";
      args.push(userId, userId);
    }
    if (req.query.status) {
      sql += " AND b.status = ?";
      args.push(req.query.status);
    }
    if (req.query.cohortId) {
      sql += " AND b.cohort_id = ?";
      args.push(Number(req.query.cohortId));
    }
    if (req.query.tag) {
      sql += " AND b.id IN (SELECT blockage_id FROM blockage_tags WHERE tag_id = ?)";
      args.push(Number(req.query.tag));
    }
    sql += " ORDER BY b.created_at DESC";
    res.json({ blockages: db.prepare(sql).all(...args).map(summary) });
  });

  // GET /api/blockages/similar?text=...&cohortId=... — "you're not alone":
  // resolved blockages in THIS workspace that look like what the caller is about
  // to report. Powers pre-submit deflection on the student report form. Real data
  // only (reuses the knowledge-base retrieval); org-scoped, so never cross-tenant.
  // Registered before "/blockages/:id" so the literal path wins.
  router.get("/blockages/similar", (req, res) => {
    const { orgId, userId } = req.user;
    const text = String(req.query.text || "").trim();
    if (text.length < 4) return res.json({ matches: [], count: 0 });
    let cohortId = req.query.cohortId ? Number(req.query.cohortId) || null : null;
    if (!cohortId) {
      const u = db.prepare("SELECT cohort_id FROM users WHERE id = ?").get(userId);
      cohortId = u && u.cohort_id ? u.cohort_id : null;
    }
    // Pull a wide set for an honest count, surface only the top few.
    const all = similarResolved(db, { orgId, cohortId, text, limit: 20 });
    res.json({
      matches: all.slice(0, 3).map((m) => ({
        id: m.id,
        title: m.title,
        resolutionType: m.resolutionType,
        resolutionSummary: m.resolution_summary || m.resolutionSummary || null,
      })),
      count: all.length,
    });
  });

  // GET /api/blockages/export.csv — staff download all visible blockages as CSV
  router.get("/blockages/export.csv", requireStaff, (req, res) => {
    const { orgId, role, userId } = req.user;
    let sql = BASE + " WHERE b.org_id = ?";
    const args = [orgId];
    if (role === "instructor") {
      sql += " AND (b.assignee_id = ? OR b.cohort_id IN (SELECT cohort_id FROM cohort_instructors WHERE user_id = ?))";
      args.push(userId, userId);
    }
    sql += " ORDER BY b.created_at DESC";
    const rows = db.prepare(sql).all(...args);

    const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const header = ["id", "title", "status", "difficulty", "cohort", "student", "assignee", "createdAt", "resolvedAt", "resolutionType"];
    const lines = [header.map(esc).join(",")];
    for (const r of rows) {
      lines.push([
        r.id, r.title, r.status, r.difficulty, r.cohort_name,
        r.student_name, r.assignee_name, r.created_at, r.resolved_at, r.resolution_type,
      ].map(esc).join(","));
    }
    const csv = lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="blockages.csv"');
    res.send(csv);
  });

  // POST /api/blockages — student reports
  router.post("/blockages", requireRole("student"), (req, res) => {
    const title = (req.body.title || "").trim();
    const cohortId = Number(req.body.cohortId);
    const briefId = req.body.briefId ? Number(req.body.briefId) : null;
    const details = (req.body.details || "").trim();
    const difficulty = (req.body.difficulty || "").trim() || null;

    if (!title) return res.status(400).json({ error: "Title is required." });
    if (!details) return res.status(400).json({ error: "Details are required." });
    let lenErr =
      tooLong(title, 200, "Title") ||
      tooLong(difficulty, 200, "Difficulty") ||
      tooLong(details, 5000, "Details");
    if (lenErr) return res.status(400).json({ error: lenErr });

    const me = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userId);
    if (!cohortId || me.cohort_id !== cohortId)
      return res.status(400).json({ error: "You can only report blockages in your own cohort." });

    const info = db
      .prepare(
        `INSERT INTO blockages (org_id, cohort_id, brief_id, user_id, title, difficulty, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(req.user.orgId, cohortId, briefId, req.user.userId, title, difficulty, details);
    const id = info.lastInsertRowid;
    addEvent(db, { orgId: req.user.orgId, blockageId: id, type: "created", actorId: req.user.userId });
    // Auto-assignment per the cohort's strategy (round-robin / least-loaded).
    const cohortRow = db.prepare("SELECT assign_strategy FROM cohorts WHERE id = ?").get(cohortId);
    const autoAssignee = pickAssignee(db, { cohortId, strategy: cohortRow && cohortRow.assign_strategy });
    if (autoAssignee) db.prepare("UPDATE blockages SET assignee_id = ? WHERE id = ?").run(autoAssignee, id);
    bindAttachments(req.user, req.body.attachmentIds, id);
    for (const insId of cohortInstructorIds(db, cohortId)) {
      notify(db, {
        orgId: req.user.orgId,
        userId: insId,
        type: "reported",
        blockageId: id,
        body: `${me.name} reported "${title}"`,
      });
    }
    res.status(201).json({ blockage: summary(joinedById(id)) });
    // Fire AI triage + the first tutoring response in the background.
    if (process.env.AI_AUTORESPOND !== "0") {
      setImmediate(async () => {
        await aiTriage(id).catch(() => {});
        await aiRespond(id).catch(() => {});
      });
    }
  });

  // POST /api/blockages/:id/self-resolve { note } — student marks "I figured it out" (F2)
  // Distinct from ai-resolve (AI deflection). Student writes one sentence what worked.
  // Note enters the knowledge base under their name — Stack Overflow psychology.
  router.post("/blockages/:id/self-resolve", requireRole("student"), (req, res) => {
    const row = rowById(req.params.id);
    if (!row || row.user_id !== req.user.userId)
      return res.status(404).json({ error: "Blockage not found." });
    if (row.status === "resolved")
      return res.status(409).json({ error: "Already resolved." });
    const note = (req.body.note || "").trim();
    if (!note) return res.status(400).json({ error: "Write one sentence about what worked." });
    const lenErr = tooLong(note, 1000, "Resolution note");
    if (lenErr) return res.status(400).json({ error: lenErr });

    db.prepare(
      `UPDATE blockages SET status = 'resolved', resolution_type = 'self',
            resolution_note = ?, resolved_at = datetime('now') WHERE id = ?`
    ).run(note, row.id);
    addEvent(db, { orgId: row.org_id, blockageId: row.id, type: "resolved", actorId: req.user.userId, meta: "self" });
    notify(db, {
      orgId: row.org_id,
      userId: row.user_id,
      type: "resolved",
      blockageId: row.id,
      body: `You figured it out — "${row.title}" is resolved. Your note was saved to the knowledge base.`,
    });
    // Generate resolution summary in background (same as instructor resolve)
    const blockageId = row.id;
    setImmediate(async () => {
      try {
        const existing = db.prepare("SELECT resolution_summary FROM blockages WHERE id = ?").get(blockageId);
        if (existing && existing.resolution_summary) return;
        const thread = db.prepare(
          `SELECT cm.body, COALESCE(u.name, cm.ai_author) AS author,
                  CASE WHEN cm.is_ai=1 THEN 'ai' ELSE u.role END AS author_role
             FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
            WHERE cm.blockage_id = ? ORDER BY cm.created_at`
        ).all(blockageId);
        const updated = db.prepare("SELECT * FROM blockages WHERE id = ?").get(blockageId);
        const text = await ai.resolutionSummary({ title: updated.title, thread, resolutionNote: updated.resolution_note });
        if (text) db.prepare("UPDATE blockages SET resolution_summary = ? WHERE id = ?").run(text, blockageId);
      } catch (_) {}
    });
    res.json({ blockage: summary(joinedById(row.id)) });
  });

  // GET /api/blockages/cohort-stats — cohort social proof for "I'm stuck" modal warmup (F1)
  // Returns aggregate stats for the student's cohort: total blockages this term,
  // avg resolve hours, self-resolve rate. Shown before the student types anything.
  router.get("/blockages/cohort-stats", requireRole("student"), (req, res) => {
    const { orgId, userId } = req.user;
    const user = db.prepare("SELECT cohort_id FROM users WHERE id = ?").get(userId);
    if (!user || !user.cohort_id) return res.json({ cohortStats: null });
    const cohortId = user.cohort_id;

    const total = db.prepare("SELECT COUNT(*) n FROM blockages WHERE org_id = ? AND cohort_id = ?").get(orgId, cohortId).n;
    const resolved = db.prepare("SELECT COUNT(*) n FROM blockages WHERE org_id = ? AND cohort_id = ? AND status = 'resolved'").get(orgId, cohortId).n;
    const selfResolved = db.prepare("SELECT COUNT(*) n FROM blockages WHERE org_id = ? AND cohort_id = ? AND resolution_type = 'self'").get(orgId, cohortId).n;
    const avgRow = db.prepare(
      `SELECT AVG(julianday(resolved_at) - julianday(created_at)) * 24 AS avg_h
         FROM blockages WHERE org_id = ? AND cohort_id = ? AND status = 'resolved' AND resolved_at IS NOT NULL`
    ).get(orgId, cohortId);
    const avgHours = avgRow && avgRow.avg_h != null ? Math.round(avgRow.avg_h * 10) / 10 : null;

    // Student's own total (to detect first-ever submission)
    const studentTotal = db.prepare("SELECT COUNT(*) n FROM blockages WHERE org_id = ? AND user_id = ?").get(orgId, userId).n;

    res.json({
      cohortStats: {
        total,
        resolved,
        selfResolved,
        avgResolveHours: avgHours,
        isFirstEver: studentTotal === 0,
      },
    });
  });

  // POST /api/blockages/:id/ai-resolve — student marks "this unblocked me" (AI deflection)
  router.post("/blockages/:id/ai-resolve", requireRole("student"), (req, res) => {
    const row = rowById(req.params.id);
    if (!row || row.user_id !== req.user.userId)
      return res.status(404).json({ error: "Blockage not found." });
    if (row.status === "resolved")
      return res.status(409).json({ error: "Already resolved." });
    db.prepare(
      `UPDATE blockages SET status = 'resolved', resolution_type = 'ai',
            resolution_note = ?, resolved_at = datetime('now') WHERE id = ?`
    ).run(`Resolved by ${ai.AI_NAME}`, row.id);
    addEvent(db, { orgId: row.org_id, blockageId: row.id, type: "resolved", actorId: req.user.userId, meta: "ai" });
    res.json({ blockage: summary(joinedById(row.id)) });
  });

  // POST /api/blockages/:id/ai-followup — student asks the AI for another turn
  router.post("/blockages/:id/ai-followup", requireRole("student"), async (req, res) => {
    const row = rowById(req.params.id);
    if (!row || row.user_id !== req.user.userId)
      return res.status(404).json({ error: "Blockage not found." });
    let posted = false;
    try { posted = await aiFollowup(row.id); } catch (_) { posted = false; }
    res.json({ ok: true, posted });
  });

  // GET /api/blockages/:id/summary — instructor 5-second AI catch-up (read-only)
  router.get("/blockages/:id/summary", requireStaff, async (req, res) => {
    const row = rowById(req.params.id);
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    const thread = db
      .prepare(
        `SELECT cm.body, COALESCE(u.name, cm.ai_author) AS author,
                CASE WHEN cm.is_ai=1 THEN 'ai' ELSE u.role END AS author_role
           FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
          WHERE cm.blockage_id = ? ORDER BY cm.created_at`
      )
      .all(row.id);
    const text = await ai.summarize({ title: row.title, details: row.details, thread });
    res.json({ summary: text });
  });

  // GET /api/blockages/:id/suggest — instructor copilot: AI-drafted reply
  router.get("/blockages/:id/suggest", requireStaff, async (req, res) => {
    const row = rowById(req.params.id);
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    const student = db.prepare("SELECT name FROM users WHERE id = ?").get(row.user_id);
    const thread = db
      .prepare(
        `SELECT cm.body, COALESCE(u.name, cm.ai_author) AS author,
                CASE WHEN cm.is_ai=1 THEN 'ai' ELSE u.role END AS author_role
           FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
          WHERE cm.blockage_id = ? ORDER BY cm.created_at`
      )
      .all(row.id);
    const similar = similarResolved(db, {
      orgId: row.org_id,
      cohortId: row.cohort_id,
      text: row.title + " " + (row.details || ""),
      excludeId: row.id,
    });
    const draft = await ai.draftReply({
      title: row.title,
      details: row.details,
      studentName: student && student.name,
      thread,
      similar,
    });
    res.json({ draft });
  });

  // GET /api/blockages/:id — full detail
  router.get("/blockages/:id", (req, res) => {
    const row = rowById(req.params.id);
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    const j = joinedById(row.id);
    const comments = db
      .prepare(
        `SELECT cm.id, cm.body, cm.created_at, cm.is_ai, cm.user_id AS authorId,
                COALESCE(u.name, cm.ai_author) AS author,
                CASE WHEN cm.is_ai = 1 THEN 'ai' ELSE u.role END AS author_role,
                cm.scaffold_level, cm.ai_confidence
           FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
          WHERE cm.blockage_id = ? ORDER BY cm.created_at`
      )
      .all(row.id);
    // Attach files to their comment (or the report itself when comment_id is null).
    const atts = db
      .prepare(
        `SELECT id, filename, mime, size, comment_id AS commentId
           FROM attachments WHERE blockage_id = ? AND org_id = ? ORDER BY created_at`
      )
      .all(row.id, row.org_id);
    const byComment = new Map();
    const reportAtts = [];
    for (const at of atts) {
      const slim = { id: at.id, filename: at.filename, mime: at.mime, size: at.size };
      if (at.commentId == null) reportAtts.push(slim);
      else {
        if (!byComment.has(at.commentId)) byComment.set(at.commentId, []);
        byComment.get(at.commentId).push(slim);
      }
    }
    for (const c of comments) c.attachments = byComment.get(c.id) || [];
    const similar = similarResolved(db, {
      orgId: row.org_id,
      cohortId: row.cohort_id,
      text: row.title + " " + (row.details || ""),
      excludeId: row.id,
      limit: 3,
    });
    const events = db
      .prepare(
        `SELECT e.type, e.meta, e.created_at, u.name AS actor
           FROM status_events e LEFT JOIN users u ON u.id = e.actor_id
          WHERE e.blockage_id = ? ORDER BY e.created_at`
      )
      .all(row.id);
    res.json({
      blockage: {
        ...summary(j),
        details: row.details,
        briefId: row.brief_id,
        assigneeId: row.assignee_id,
        resolutionType: row.resolution_type,
        resolutionNote: row.resolution_note,
        canEdit: req.user.role === "student" && row.user_id === req.user.userId && row.status === "open",
        attachments: reportAtts,
        csat: (() => {
          const cs = db.prepare("SELECT rating, comment FROM csat WHERE blockage_id = ?").get(row.id);
          return cs ? { rating: cs.rating, comment: cs.comment || "" } : null;
        })(),
        sla: slaState(row, readSla(db, row.org_id)),
        comments,
        events,
        similar,
        aiName: ai.AI_NAME,
        aiLive: ai.aiConfigured(),
      },
    });
  });

  // Background: AI triage — infer difficulty/topics/urgency and store on the row.
  async function aiTriage(blockageId) {
    const row = rowById(blockageId);
    if (!row) return;
    const brief = row.brief_id
      ? db.prepare("SELECT name FROM briefs WHERE id = ?").get(row.brief_id)
      : null;
    const t = await ai.triage({ title: row.title, details: row.details, brief: brief && brief.name });
    db.prepare(
      "UPDATE blockages SET ai_difficulty = ?, ai_topics = ?, ai_urgency = ? WHERE id = ?"
    ).run(t.difficulty, JSON.stringify(t.topics), t.urgency, row.id);
  }

  // Background: post a bounded multi-turn AI follow-up (student pressed "Ask AI again").
  async function aiFollowup(blockageId) {
    const row = rowById(blockageId);
    if (!row || row.status !== "open") return false;
    if (row.ai_followup_count >= ai.AI_FOLLOWUP_MAX) return false;
    const comments = db
      .prepare("SELECT user_id, is_ai FROM comments WHERE blockage_id = ? ORDER BY created_at")
      .all(row.id);
    if (!comments.some((c) => c.is_ai)) return false; // need a prior AI message
    const last = comments[comments.length - 1];
    if (!last || last.is_ai) return false; // only respond when the student spoke last
    const thread = db
      .prepare(
        `SELECT cm.body, COALESCE(u.name, cm.ai_author) AS author,
                CASE WHEN cm.is_ai=1 THEN 'ai' ELSE u.role END AS author_role
           FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
          WHERE cm.blockage_id = ? ORDER BY cm.created_at`
      )
      .all(row.id);
    const similar = similarResolved(db, {
      orgId: row.org_id, cohortId: row.cohort_id,
      text: row.title + " " + (row.details || ""), excludeId: row.id,
    });
    // Determine scaffold level (monotonically increasing, capped by brief max_scaffold)
    const lastAiScaffold = db.prepare(
      `SELECT MAX(COALESCE(scaffold_level, 1)) AS level FROM comments WHERE blockage_id = ? AND is_ai = 1`
    ).get(row.id);
    const currentLevel = (lastAiScaffold && lastAiScaffold.level) || 1;
    const brief = row.brief_id ? db.prepare("SELECT max_scaffold FROM briefs WHERE id = ?").get(row.brief_id) : null;
    const maxScaffold = (brief && brief.max_scaffold) || 4;
    const nextLevel = Math.min(currentLevel + 1, maxScaffold);

    const body = await ai.followup({
      title: row.title, details: row.details, thread, similar,
      turn: row.ai_followup_count + 1, scaffoldLevel: nextLevel,
    });
    const followupConfidence = ai.aiConfigured() ? (body.length < 100 ? 0.6 : 0.85) : 0.5;
    db.prepare(
      "INSERT INTO comments (org_id, blockage_id, user_id, is_ai, ai_author, body, scaffold_level, ai_confidence) VALUES (?, ?, NULL, 1, ?, ?, ?, ?)"
    ).run(row.org_id, row.id, ai.AI_NAME, body, nextLevel, followupConfidence);
    db.prepare("UPDATE blockages SET ai_followup_count = ai_followup_count + 1 WHERE id = ?").run(row.id);
    addEvent(db, { orgId: row.org_id, blockageId: row.id, type: "ai_reply", actorId: null });
    notify(db, { orgId: row.org_id, userId: row.user_id, type: "ai_reply", blockageId: row.id, body: `${ai.AI_NAME} replied on "${row.title}"` });
    return true;
  }

  // Background: AI Teaching Assistant posts a first response to a new blockage.
  async function aiRespond(blockageId) {
    const row = rowById(blockageId);
    if (!row) return;
    const cohort = db.prepare("SELECT name FROM cohorts WHERE id = ?").get(row.cohort_id);
    const brief = row.brief_id
      ? db.prepare("SELECT name FROM briefs WHERE id = ?").get(row.brief_id)
      : null;
    const similar = similarResolved(db, {
      orgId: row.org_id,
      cohortId: row.cohort_id,
      text: row.title + " " + (row.details || ""),
      excludeId: row.id,
    });
    let body;
    try {
      body = await ai.unblock({
        title: row.title,
        details: row.details,
        difficulty: row.difficulty,
        cohortName: cohort && cohort.name,
        briefName: brief && brief.name,
        similar,
      });
    } catch (_) {
      return;
    }
    if (!body) return;
    // Confidence heuristic (Phase 3.2): real API = 0.85, fallback = 0.5, short = 0.6
    const confidence = ai.aiConfigured()
      ? (body.length < 100 ? 0.6 : 0.85)
      : 0.5;
    db.prepare(
      "INSERT INTO comments (org_id, blockage_id, user_id, is_ai, ai_author, body, ai_confidence) VALUES (?, ?, NULL, 1, ?, ?, ?)"
    ).run(row.org_id, row.id, ai.AI_NAME, body, confidence);
    addEvent(db, { orgId: row.org_id, blockageId: row.id, type: "ai_reply", actorId: null });
    notify(db, {
      orgId: row.org_id,
      userId: row.user_id,
      type: "ai_reply",
      blockageId: row.id,
      body: `${ai.AI_NAME} responded to "${row.title}"`,
    });
  }

  // POST /api/blockages/:id/claim — staff picks it up
  router.post("/blockages/:id/claim", requireStaff, (req, res) => {
    const row = rowById(req.params.id);
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    if (row.status !== "open")
      return res.status(409).json({ error: "Only open blockages can be claimed." });
    db.prepare("UPDATE blockages SET status = 'in_support', assignee_id = ? WHERE id = ?").run(
      req.user.userId,
      row.id
    );
    addEvent(db, { orgId: row.org_id, blockageId: row.id, type: "claimed", actorId: req.user.userId });
    const me = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.userId);
    notify(db, {
      orgId: row.org_id,
      userId: row.user_id,
      type: "claimed",
      blockageId: row.id,
      body: `${me.name} is helping with "${row.title}"`,
    });
    res.json({ blockage: summary(joinedById(row.id)) });
  });

  // GET /api/blockages/:id/assignees — staff: who can this be reassigned to?
  router.get("/blockages/:id/assignees", requireStaff, (req, res) => {
    const row = rowById(req.params.id);
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    // Org owners + any instructor/owner assigned to this blockage's cohort. De-duped.
    const rows = db
      .prepare(
        `SELECT u.id, u.name FROM users u
          WHERE u.org_id = ? AND u.role IN ('instructor','owner')
            AND (u.role = 'owner'
                 OR u.id IN (SELECT user_id FROM cohort_instructors WHERE cohort_id = ?))
          ORDER BY u.name`
      )
      .all(row.org_id, row.cohort_id);
    res.json({ assignees: rows.map((r) => ({ id: r.id, name: r.name })) });
  });

  // POST /api/blockages/:id/assign { assigneeId } — staff reassigns to an instructor/owner
  router.post("/blockages/:id/assign", requireStaff, (req, res) => {
    const row = rowById(req.params.id);
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    const assigneeId = Number(req.body.assigneeId);
    const assignee = assigneeId
      ? db.prepare("SELECT * FROM users WHERE id = ?").get(assigneeId)
      : null;
    if (
      !assignee ||
      assignee.org_id !== row.org_id ||
      (assignee.role !== "instructor" && assignee.role !== "owner")
    )
      return res.status(400).json({ error: "Pick an instructor to assign." });

    db.prepare(
      `UPDATE blockages SET assignee_id = ?,
            status = CASE WHEN status = 'open' THEN 'in_support' ELSE status END
        WHERE id = ?`
    ).run(assignee.id, row.id);
    addEvent(db, {
      orgId: row.org_id,
      blockageId: row.id,
      type: "claimed",
      actorId: req.user.userId,
      meta: "reassigned",
    });
    notify(db, {
      orgId: row.org_id,
      userId: assignee.id,
      type: "claimed",
      blockageId: row.id,
      body: `You were assigned "${row.title}"`,
    });
    notify(db, {
      orgId: row.org_id,
      userId: row.user_id,
      type: "claimed",
      blockageId: row.id,
      body: `${assignee.name} is now helping with "${row.title}"`,
    });
    res.json({ blockage: summary(joinedById(row.id)) });
  });

  // POST /api/blockages/:id/student-reopen — student reopens their own AI-resolved blockage
  router.post("/blockages/:id/student-reopen", requireRole("student"), (req, res) => {
    const row = rowById(req.params.id);
    if (!row || row.user_id !== req.user.userId)
      return res.status(404).json({ error: "Blockage not found." });
    if (row.status !== "resolved" || row.resolution_type !== "ai")
      return res.status(409).json({
        error: "Only an AI-resolved blockage can be reopened by you.",
      });
    db.prepare(
      `UPDATE blockages SET status = 'open', assignee_id = NULL,
            resolution_type = NULL, resolution_note = NULL, resolved_at = NULL WHERE id = ?`
    ).run(row.id);
    addEvent(db, {
      orgId: row.org_id,
      blockageId: row.id,
      type: "reopened",
      actorId: req.user.userId,
    });
    res.json({ blockage: summary(joinedById(row.id)) });
  });

  // POST /api/blockages/:id/reopen — staff reopens a resolved blockage
  router.post("/blockages/:id/reopen", requireStaff, (req, res) => {
    const row = rowById(req.params.id);
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    if (row.status !== "resolved")
      return res.status(409).json({ error: "Only resolved blockages can be reopened." });
    db.prepare(
      `UPDATE blockages SET status = 'open', assignee_id = NULL,
            resolution_type = NULL, resolution_note = NULL, resolved_at = NULL WHERE id = ?`
    ).run(row.id);
    addEvent(db, { orgId: row.org_id, blockageId: row.id, type: "reopened", actorId: req.user.userId });
    const me = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.userId);
    notify(db, {
      orgId: row.org_id,
      userId: row.user_id,
      type: "reopened",
      blockageId: row.id,
      body: `${me.name} reopened "${row.title}"`,
    });
    res.json({ blockage: summary(joinedById(row.id)) });
  });

  // POST /api/blockages/:id/resolve { type, note }
  router.post("/blockages/:id/resolve", requireStaff, (req, res) => {
    const row = rowById(req.params.id);
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    const type = (req.body.type || "").trim();
    const note = (req.body.note || "").trim();
    if (!type) return res.status(400).json({ error: "Choose a support method." });
    db.prepare(
      `UPDATE blockages SET status = 'resolved', assignee_id = COALESCE(assignee_id, ?),
            resolution_type = ?, resolution_note = ?, resolved_at = datetime('now') WHERE id = ?`
    ).run(req.user.userId, type, note, row.id);
    addEvent(db, {
      orgId: row.org_id,
      blockageId: row.id,
      type: "resolved",
      actorId: req.user.userId,
      meta: type,
    });
    notify(db, {
      orgId: row.org_id,
      userId: row.user_id,
      type: "resolved",
      blockageId: row.id,
      body: `Your blockage "${row.title}" was resolved`,
    });
    // Generate resolution summary in background (Phase 2.1)
    const blockageId = row.id;
    setImmediate(async () => {
      try {
        const thread = db.prepare(
          `SELECT cm.body, COALESCE(u.name, cm.ai_author) AS author,
                  CASE WHEN cm.is_ai=1 THEN 'ai' ELSE u.role END AS author_role
             FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
            WHERE cm.blockage_id = ? ORDER BY cm.created_at`
        ).all(blockageId);
        // Skip if already has a summary (not overwritten on reopen→resolve)
        const existing = db.prepare("SELECT resolution_summary FROM blockages WHERE id = ?").get(blockageId);
        if (existing && existing.resolution_summary) return;
        const s = await ai.resolutionSummary({ title: row.title, thread, resolutionNote: note });
        if (s) db.prepare("UPDATE blockages SET resolution_summary = ? WHERE id = ?").run(s, blockageId);
      } catch (_) {}
    });
    res.json({ blockage: summary(joinedById(row.id)) });
  });

  // PUT /api/blockages/:id — student edits own, open only
  router.put("/blockages/:id", requireRole("student"), (req, res) => {
    const row = rowById(req.params.id);
    if (!row || row.user_id !== req.user.userId)
      return res.status(404).json({ error: "Blockage not found." });
    if (row.status !== "open")
      return res.status(423).json({ error: "Only open blockages can be edited." });
    const title = (req.body.title || "").trim();
    if (!title) return res.status(400).json({ error: "Title is required." });
    const difficulty = (req.body.difficulty || "").trim();
    const details = (req.body.details || "").trim();
    if (!details) return res.status(400).json({ error: "Details are required." });
    const lenErr =
      tooLong(title, 200, "Title") ||
      tooLong(difficulty, 200, "Difficulty") ||
      tooLong(details, 5000, "Details");
    if (lenErr) return res.status(400).json({ error: lenErr });
    let briefId = row.brief_id;
    if (req.body.briefId !== undefined) {
      const bid = req.body.briefId ? Number(req.body.briefId) : null;
      if (bid) {
        const brief = db
          .prepare("SELECT id FROM briefs WHERE id = ? AND org_id = ? AND cohort_id = ?")
          .get(bid, req.user.orgId, row.cohort_id);
        if (!brief) return res.status(400).json({ error: "Unknown brief." });
        briefId = bid;
      } else {
        briefId = null;
      }
    }
    db.prepare(
      "UPDATE blockages SET title = ?, brief_id = ?, difficulty = ?, details = ? WHERE id = ?"
    ).run(title, briefId, difficulty || null, details, row.id);
    res.json({ blockage: summary(joinedById(row.id)) });
  });

  // DELETE /api/blockages/:id — student deletes own, open only
  router.delete("/blockages/:id", requireRole("student"), (req, res) => {
    const row = rowById(req.params.id);
    if (!row || row.user_id !== req.user.userId)
      return res.status(404).json({ error: "Blockage not found." });
    if (row.status !== "open")
      return res.status(423).json({ error: "Only open blockages can be deleted." });
    db.prepare("DELETE FROM blockages WHERE id = ?").run(row.id);
    res.json({ ok: true });
  });

  // POST /api/blockages/:id/comments — thread
  router.post("/blockages/:id/comments", (req, res) => {
    const row = rowById(req.params.id);
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    const body = (req.body.body || "").trim();
    if (!body) return res.status(400).json({ error: "Write a message first." });
    const lenErr = tooLong(body, 5000, "Comment");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const cmtInfo = db.prepare(
      "INSERT INTO comments (org_id, blockage_id, user_id, body) VALUES (?, ?, ?, ?)"
    ).run(row.org_id, row.id, req.user.userId, body);
    bindToComment(req.user, req.body.attachmentIds, row.id, cmtInfo.lastInsertRowid);
    addEvent(db, { orgId: row.org_id, blockageId: row.id, type: "comment", actorId: req.user.userId });

    const me = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.userId);
    const recipients = new Set();
    if (req.user.role === "student") {
      if (row.assignee_id) recipients.add(row.assignee_id);
      else cohortInstructorIds(db, row.cohort_id).forEach((i) => recipients.add(i));
    } else {
      recipients.add(row.user_id);
    }
    recipients.delete(req.user.userId);
    for (const uid of recipients) {
      notify(db, {
        orgId: row.org_id,
        userId: uid,
        type: "comment",
        blockageId: row.id,
        body: `${me.name} replied on "${row.title}"`,
      });
    }
    res.status(201).json({ ok: true });
  });

  // Load a non-AI comment owned by the current user on a visible blockage, else null.
  function ownComment(req) {
    const row = rowById(req.params.id);
    if (!canSeeBlockage(db, req.user, row)) return null;
    const comment = db
      .prepare("SELECT * FROM comments WHERE id = ?")
      .get(Number(req.params.commentId));
    if (!comment || comment.blockage_id !== row.id) return null;
    if (comment.is_ai || comment.user_id !== req.user.userId) return null;
    return comment;
  }

  // PUT /api/blockages/:id/comments/:commentId — author edits their own message
  router.put("/blockages/:id/comments/:commentId", (req, res) => {
    const comment = ownComment(req);
    if (!comment)
      return res.status(404).json({ error: "Comment not found." });
    const body = (req.body.body || "").trim();
    if (!body) return res.status(400).json({ error: "Write a message first." });
    const lenErr = tooLong(body, 5000, "Message");
    if (lenErr) return res.status(400).json({ error: lenErr });
    db.prepare("UPDATE comments SET body = ? WHERE id = ?").run(body, comment.id);
    res.json({ ok: true });
  });

  // DELETE /api/blockages/:id/comments/:commentId — author deletes their own message
  router.delete("/blockages/:id/comments/:commentId", (req, res) => {
    const comment = ownComment(req);
    if (!comment)
      return res.status(404).json({ error: "Comment not found." });
    db.prepare("DELETE FROM comments WHERE id = ? AND user_id = ?").run(
      comment.id,
      req.user.userId
    );
    res.json({ ok: true });
  });

  // POST /api/blockages/:id/proactive-prompt — student requests a "what to watch next" prompt (Phase 5.2)
  router.post("/blockages/:id/proactive-prompt", requireRole("student"), (req, res) => {
    const row = rowById(req.params.id);
    if (!row || row.org_id !== req.user.orgId || row.user_id !== req.user.userId)
      return res.status(404).json({ error: "Blockage not found." });

    // Look for co-occurrence patterns: topics in this blockage → commonly-following topics
    let currentTopics = [];
    try { currentTopics = JSON.parse(row.ai_topics) || []; } catch (_) {}

    if (!currentTopics.length) return res.json({ ok: true, prompt: null });

    // Find top predicted next topics from progression_patterns
    const placeholders = currentTopics.map(() => "?").join(",");
    const patterns = db.prepare(
      `SELECT topic_b, SUM(count) as total FROM progression_patterns
        WHERE org_id = ? AND topic_a IN (${placeholders})
        GROUP BY topic_b ORDER BY total DESC LIMIT 3`
    ).all(req.user.orgId, ...currentTopics);

    if (!patterns.length) return res.json({ ok: true, prompt: null });

    const nextTopics = patterns.map((p) => p.topic_b);
    const prompt = `Based on what students typically encounter after **${currentTopics[0]}**, you may want to review: **${nextTopics.join(", ")}**. Getting ahead on these could save you time later.`;

    // Create a dismissible notification
    notify(db, {
      orgId: req.user.orgId,
      userId: req.user.userId,
      type: "proactive_prompt",
      blockageId: row.id,
      body: prompt,
    });

    res.json({ ok: true, prompt, nextTopics });
  });

  return router;
};
