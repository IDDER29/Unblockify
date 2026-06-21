"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth");
const { notify } = require("../lib/helpers");
const { tooLong } = require("../lib/validate");

module.exports = function nudgeRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  // POST /api/nudges { message, target } — owner sends an in-app nudge
  // target: "cohort:<id>" | "at-risk" | "all-students"
  router.post("/nudges", requireRole("owner"), (req, res) => {
    const { orgId } = req.user;
    const message = (req.body.message || "").trim();
    if (!message) return res.status(400).json({ error: "Write a message to send." });
    const lenErr = tooLong(message, 1000, "Message");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const target = (req.body.target || "").trim();

    let recipients = [];
    if (target.startsWith("cohort:")) {
      const cohortId = Number(target.slice("cohort:".length));
      const c = db
        .prepare("SELECT id FROM cohorts WHERE id = ? AND org_id = ?")
        .get(cohortId, orgId);
      if (!c) return res.status(400).json({ error: "Unknown cohort." });
      recipients = db
        .prepare(
          "SELECT id FROM users WHERE org_id = ? AND role = 'student' AND cohort_id = ?"
        )
        .all(orgId, cohortId)
        .map((r) => r.id);
    } else if (target === "all-students") {
      recipients = db
        .prepare("SELECT id FROM users WHERE org_id = ? AND role = 'student'")
        .all(orgId)
        .map((r) => r.id);
    } else if (target === "at-risk") {
      // Students with at least one open blockage in the org.
      recipients = db
        .prepare(
          `SELECT DISTINCT u.id FROM users u
             JOIN blockages b ON b.user_id = u.id AND b.status != 'resolved'
            WHERE u.org_id = ? AND u.role = 'student'`
        )
        .all(orgId)
        .map((r) => r.id);
    } else {
      return res.status(400).json({ error: "Pick who to send to." });
    }

    let sent = 0;
    for (const uid of recipients) {
      notify(db, {
        orgId, userId: uid, type: "nudge", blockageId: null, body: message,
      });
      sent++;
    }
    res.json({ ok: true, sent });
  });

  return router;
};
