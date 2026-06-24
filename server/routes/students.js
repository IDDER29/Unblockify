"use strict";

const express = require("express");
const { requireAuth, requireStaff } = require("../auth");
const { notify } = require("../lib/helpers");

module.exports = function studentsRoutes(db) {
  const router = express.Router();

  // POST /api/students/:id/nudge — send a nudge notification to a specific student.
  router.post("/students/:id/nudge", requireAuth, requireStaff, (req, res) => {
    const { orgId, userId } = req.user;
    const studentId = Number(req.params.id);
    const message = (req.body.message || "").trim() || "Your instructor has nudged you.";

    const student = db
      .prepare("SELECT id, org_id FROM users WHERE id = ? AND role = 'student'")
      .get(studentId);
    if (!student || student.org_id !== orgId) {
      return res.status(404).json({ error: "Student not found." });
    }

    notify(db, { orgId, userId: studentId, type: "nudge", blockageId: null, body: message });
    res.json({ ok: true });
  });

  // POST /api/students/:id/flag — create a check_in row for the student.
  router.post("/students/:id/flag", requireAuth, requireStaff, (req, res) => {
    const { orgId, userId } = req.user;
    const studentId = Number(req.params.id);
    const note = (req.body.note || "").trim() || null;

    const student = db
      .prepare("SELECT id, org_id FROM users WHERE id = ? AND role = 'student'")
      .get(studentId);
    if (!student || student.org_id !== orgId) {
      return res.status(404).json({ error: "Student not found." });
    }

    const info = db
      .prepare(
        `INSERT INTO check_ins (org_id, student_id, instructor_id, note)
         VALUES (?, ?, ?, ?)`
      )
      .run(orgId, studentId, userId, note);

    const checkIn = db
      .prepare("SELECT * FROM check_ins WHERE id = ?")
      .get(info.lastInsertRowid);

    res.json({ ok: true, checkIn });
  });

  // GET /api/check-ins — list check-ins for the org (staff only).
  router.get("/check-ins", requireAuth, requireStaff, (req, res) => {
    const { orgId } = req.user;
    const status = req.query.status || "open";
    const rows = db.prepare(
      `SELECT ci.id, ci.note, ci.status, ci.created_at, ci.resolved_at,
              s.id AS student_id, s.name AS student_name,
              i.id AS instructor_id, i.name AS instructor_name
         FROM check_ins ci
         JOIN users s ON s.id = ci.student_id
         JOIN users i ON i.id = ci.instructor_id
        WHERE ci.org_id = ? AND ci.status = ?
        ORDER BY ci.created_at DESC`
    ).all(orgId, status);
    res.json({ checkIns: rows });
  });

  // POST /api/check-ins/:id/resolve — mark a check-in resolved.
  router.post("/check-ins/:id/resolve", requireAuth, requireStaff, (req, res) => {
    const { orgId } = req.user;
    const ci = db
      .prepare("SELECT * FROM check_ins WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), orgId);
    if (!ci) return res.status(404).json({ error: "Check-in not found." });

    db.prepare(
      `UPDATE check_ins SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?`
    ).run(ci.id);

    // notify student
    notify(db, {
      orgId,
      userId: ci.student_id,
      type: "check_in_resolved",
      blockageId: null,
      body: "An instructor has marked your check-in as resolved.",
    });

    res.json({ ok: true });
  });

  return router;
};
