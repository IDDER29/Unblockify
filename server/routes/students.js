"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth");
const { notify } = require("../lib/helpers");

module.exports = function studentsRoutes(db) {
  const router = express.Router();

  // POST /students/:id/nudge — send a nudge notification to a student (owner only)
  router.post(
    "/students/:id/nudge",
    requireAuth,
    requireRole("owner"),
    (req, res) => {
      const { orgId, userId } = req.user;
      const studentId = Number(req.params.id);

      const student = db
        .prepare(
          "SELECT id, name FROM users WHERE id = ? AND org_id = ? AND role = 'student'"
        )
        .get(studentId, orgId);

      if (!student) return res.status(404).json({ error: "Student not found" });

      notify(db, {
        orgId,
        userId: studentId,
        type: "nudge",
        body: "Your instructor wants to check in with you. Keep going — you've got this!",
      });

      res.json({ ok: true });
    }
  );

  // POST /students/:id/flag — flag a student for a check-in (owner only)
  router.post(
    "/students/:id/flag",
    requireAuth,
    requireRole("owner"),
    (req, res) => {
      const { orgId, userId } = req.user;
      const studentId = Number(req.params.id);

      const student = db
        .prepare(
          "SELECT id, name FROM users WHERE id = ? AND org_id = ? AND role = 'student'"
        )
        .get(studentId, orgId);

      if (!student) return res.status(404).json({ error: "Student not found" });

      const result = db
        .prepare(
          `INSERT INTO check_ins (org_id, student_id, instructor_id, note, status)
           VALUES (?, ?, ?, ?, 'open')`
        )
        .run(orgId, studentId, userId, req.body.note || null);

      const checkIn = db
        .prepare("SELECT * FROM check_ins WHERE id = ?")
        .get(result.lastInsertRowid);

      res.status(201).json({ checkIn });
    }
  );

  return router;
};
