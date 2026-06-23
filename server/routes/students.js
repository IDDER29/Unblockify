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

  return router;
};
