"use strict";

const express = require("express");
const { requireAuth, requireRole, requireStaff } = require("../auth");
const { readSla, slaState } = require("../lib/sla");
const { audit, AUDIT } = require("../lib/audit");
const { notify, cohortInstructorIds } = require("../lib/helpers");

module.exports = function slaRoutes(db) {
  const router = express.Router();

  // GET /api/sla — current config (staff)
  router.get("/sla", requireAuth, requireStaff, (req, res) => {
    res.json({ sla: readSla(db, req.user.orgId) });
  });

  // PUT /api/sla — update config (owner)
  router.put("/sla", requireAuth, requireRole("owner"), (req, res) => {
    const b = req.body || {};
    const cur = readSla(db, req.user.orgId);
    const responseHours = Number(b.responseHours ?? cur.responseHours);
    const resolveHours = Number(b.resolveHours ?? cur.resolveHours);
    const bhStart = Number(b.bhStart ?? cur.bhStart);
    const bhEnd = Number(b.bhEnd ?? cur.bhEnd);
    const bhDays = Array.isArray(b.bhDays) ? b.bhDays.join(",") : (b.bhDays ?? cur.bhDays.join(","));
    const tzOffsetMin = Number(b.tzOffsetMin ?? cur.tzOffsetMin);
    db.prepare(
      `INSERT INTO sla_config (org_id, response_hours, resolve_hours, bh_start, bh_end, bh_days, tz_offset_min, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(org_id) DO UPDATE SET response_hours=excluded.response_hours,
         resolve_hours=excluded.resolve_hours, bh_start=excluded.bh_start, bh_end=excluded.bh_end,
         bh_days=excluded.bh_days, tz_offset_min=excluded.tz_offset_min, updated_at=datetime('now')`
    ).run(req.user.orgId, responseHours, resolveHours, bhStart, bhEnd, bhDays, tzOffsetMin);
    audit(db, { orgId: req.user.orgId, actorId: req.user.userId, action: AUDIT.SLA_UPDATE, ip: req.ip });
    res.json({ sla: readSla(db, req.user.orgId) });
  });

  // POST /api/sla/escalate — notify on breached open blockages in scope (staff)
  router.post("/sla/escalate", requireAuth, requireStaff, (req, res) => {
    const { orgId, role, userId } = req.user;
    const sla = readSla(db, orgId);
    let rows;
    if (role === "instructor") {
      rows = db
        .prepare(
          `SELECT * FROM blockages WHERE org_id = ? AND status != 'resolved'
             AND (assignee_id = ? OR cohort_id IN (SELECT cohort_id FROM cohort_instructors WHERE user_id = ?))`
        )
        .all(orgId, userId, userId);
    } else {
      rows = db.prepare("SELECT * FROM blockages WHERE org_id = ? AND status != 'resolved'").all(orgId);
    }
    let escalated = 0, breached = 0, atRisk = 0;
    const owners = db.prepare("SELECT id FROM users WHERE org_id = ? AND role = 'owner'").all(orgId).map((r) => r.id);
    for (const row of rows) {
      const st = slaState(row, sla);
      if (st.atRisk) atRisk++;
      if (!st.breached) continue;
      breached++;
      // Idempotency: skip if escalated within the last responseHours hours.
      const recent = db
        .prepare(
          `SELECT 1 FROM audit_log WHERE org_id = ? AND action = ? AND target_id = ?
             AND created_at > datetime('now', '-' || ? || ' hours') LIMIT 1`
        )
        .get(orgId, AUDIT.ESCALATE, row.id, sla.responseHours);
      if (recent) continue;
      const recipients = new Set(owners);
      if (row.assignee_id) recipients.add(row.assignee_id);
      else cohortInstructorIds(db, row.cohort_id).forEach((i) => recipients.add(i));
      for (const uid of recipients) {
        notify(db, { orgId, userId: uid, type: "escalation", blockageId: row.id, body: `SLA breached: "${row.title}" needs attention` });
      }
      audit(db, { orgId, actorId: userId, action: AUDIT.ESCALATE, targetType: "blockage", targetId: row.id, ip: req.ip });
      escalated++;
    }
    res.json({ escalated, breached, atRisk });
  });

  return router;
};
