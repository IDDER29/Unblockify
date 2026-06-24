"use strict";

const express = require("express");
const { requireAuth, requireRole, issueToken } = require("../auth");
const { randomCode } = require("../lib/helpers");
const { sendEmail } = require("../lib/email");
const { audit, AUDIT } = require("../lib/audit");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function memberRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/members — owner: everyone in the org
  router.get("/members", requireRole("owner"), (req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.cohort_id, c.name AS cohort_name, u.created_at
           FROM users u LEFT JOIN cohorts c ON c.id = u.cohort_id
          WHERE u.org_id = ? ORDER BY u.created_at`
      )
      .all(req.user.orgId);
    res.json({ members: rows });
  });

  // POST /api/invites { role, cohortId?, email? } — owner only
  router.post("/invites", requireRole("owner"), async (req, res) => {
    const role = req.body.role;
    if (role !== "instructor" && role !== "student")
      return res.status(400).json({ error: "Role must be instructor or student." });
    const cohortId = req.body.cohortId || null;
    if (cohortId) {
      const c = db.prepare("SELECT id FROM cohorts WHERE id = ? AND org_id = ?").get(cohortId, req.user.orgId);
      if (!c) return res.status(400).json({ error: "Unknown cohort." });
    }
    const code = randomCode();
    const info = db
      .prepare(
        "INSERT INTO invites (org_id, role, cohort_id, code, created_by) VALUES (?, ?, ?, ?, ?)"
      )
      .run(req.user.orgId, role, cohortId, code, req.user.userId);
    audit(db, {
      orgId: req.user.orgId,
      actorId: req.user.userId,
      action: AUDIT.INVITE_CREATE,
      targetType: "invite",
      targetId: info.lastInsertRowid,
      ip: req.ip,
      meta: { role, cohortId },
    });

    // Optionally email the join link. A send failure must not fail the request.
    const email = (req.body.email || "").trim();
    let emailed = false;
    if (email && EMAIL_RE.test(email)) {
      const origin = req.headers.origin || ("http://localhost:" + (process.env.PORT || 5050));
      const org = db
        .prepare("SELECT name FROM organizations WHERE id = ?")
        .get(req.user.orgId);
      const orgName = org ? org.name : "your organization";
      try {
        await sendEmail({
          to: email,
          subject: "You're invited to " + orgName + " on Unblockify",
          text: origin + "/join.html?code=" + code,
        });
        emailed = true;
      } catch (_) {
        emailed = false;
      }
    }

    res.status(201).json({
      invite: { id: info.lastInsertRowid, code, role, cohortId, url: "/join.html?code=" + code },
      emailed,
    });
  });

  // GET /api/invites — owner: pending invites
  router.get("/invites", requireRole("owner"), (req, res) => {
    const rows = db
      .prepare(
        `SELECT i.id, i.role, i.code, i.cohort_id, c.name AS cohort_name, i.used_by, i.revoked, i.created_at
           FROM invites i LEFT JOIN cohorts c ON c.id = i.cohort_id
          WHERE i.org_id = ? AND i.revoked = 0 AND i.used_by IS NULL
          ORDER BY i.created_at DESC`
      )
      .all(req.user.orgId);
    res.json({ invites: rows.map((r) => ({ ...r, url: "/join.html?code=" + r.code })) });
  });

  // DELETE /api/invites/:id — revoke
  router.delete("/invites/:id", requireRole("owner"), (req, res) => {
    const inv = db
      .prepare("SELECT * FROM invites WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!inv) return res.status(404).json({ error: "Invite not found." });
    db.prepare("UPDATE invites SET revoked = 1 WHERE id = ?").run(inv.id);
    audit(db, {
      orgId: req.user.orgId,
      actorId: req.user.userId,
      action: AUDIT.INVITE_REVOKE,
      targetType: "invite",
      targetId: inv.id,
      ip: req.ip,
    });
    res.json({ ok: true });
  });

  const memberRow = (id) =>
    db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.cohort_id, c.name AS cohort_name, u.created_at
           FROM users u LEFT JOIN cohorts c ON c.id = u.cohort_id WHERE u.id = ?`
      )
      .get(id);

  // PUT /api/members/:id  { cohortId?, role? } — owner updates a member
  router.put("/members/:id", requireRole("owner"), (req, res) => {
    const target = db
      .prepare("SELECT * FROM users WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!target) return res.status(404).json({ error: "Member not found." });

    // Role change
    if (req.body.role && req.body.role !== target.role) {
      const role = req.body.role;
      if (!["owner", "instructor", "student"].includes(role))
        return res.status(400).json({ error: "Invalid role." });
      if (target.id === req.user.userId)
        return res.status(400).json({ error: "You can't change your own role." });
      if (target.role === "owner") {
        const owners = db
          .prepare("SELECT COUNT(*) n FROM users WHERE org_id = ? AND role = 'owner'")
          .get(req.user.orgId).n;
        if (owners <= 1)
          return res.status(400).json({ error: "Your organization needs at least one owner." });
      }
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, target.id);
      target.role = role;
      // home cohort only applies to students
      if (role !== "student")
        db.prepare("UPDATE users SET cohort_id = NULL WHERE id = ?").run(target.id);
    }

    // Cohort change (the home cohort — meaningful for students)
    if (Object.prototype.hasOwnProperty.call(req.body, "cohortId")) {
      const cid = req.body.cohortId;
      if (cid === null || cid === "" || cid === undefined) {
        db.prepare("UPDATE users SET cohort_id = NULL WHERE id = ?").run(target.id);
      } else {
        const c = db
          .prepare("SELECT id FROM cohorts WHERE id = ? AND org_id = ?")
          .get(Number(cid), req.user.orgId);
        if (!c) return res.status(400).json({ error: "Unknown cohort." });
        db.prepare("UPDATE users SET cohort_id = ? WHERE id = ?").run(c.id, target.id);
      }
    }

    const updated = memberRow(target.id);
    audit(db, {
      orgId: req.user.orgId,
      actorId: req.user.userId,
      action: AUDIT.MEMBER_UPDATE,
      targetType: "user",
      targetId: target.id,
      ip: req.ip,
      meta: { role: updated.role, cohortId: updated.cohort_id },
    });
    res.json({ member: updated });
  });

  // DELETE /api/members/:id — owner removes a member
  router.delete("/members/:id", requireRole("owner"), (req, res) => {
    const target = db
      .prepare("SELECT * FROM users WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!target) return res.status(404).json({ error: "Member not found." });
    if (target.id === req.user.userId)
      return res.status(400).json({ error: "You can't remove yourself." });
    db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
    audit(db, {
      orgId: req.user.orgId,
      actorId: req.user.userId,
      action: AUDIT.MEMBER_REMOVE,
      targetType: "user",
      targetId: target.id,
      ip: req.ip,
    });
    res.json({ ok: true });
  });

  // PUT /api/org { name } — owner renames their organization
  router.put("/org", requireRole("owner"), (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Organization name can't be empty." });
    db.prepare("UPDATE organizations SET name = ? WHERE id = ?").run(name, req.user.orgId);
    audit(db, {
      orgId: req.user.orgId,
      actorId: req.user.userId,
      action: AUDIT.ORG_RENAME,
      targetType: "org",
      targetId: req.user.orgId,
      ip: req.ip,
      meta: { name },
    });
    const org = db
      .prepare("SELECT id, name, slug FROM organizations WHERE id = ?")
      .get(req.user.orgId);
    res.json({ org });
  });

  // GET /api/org/integrations — return org integration settings (owner only).
  router.get("/org/integrations", requireRole("owner"), (req, res) => {
    const org = db.prepare("SELECT slack_webhook_url FROM organizations WHERE id = ?").get(req.user.orgId);
    res.json({ slackWebhookUrl: org ? org.slack_webhook_url || "" : "" });
  });

  // PUT /api/org/integrations/slack — save/clear Slack webhook URL (owner only).
  router.put("/org/integrations/slack", requireRole("owner"), (req, res) => {
    const url = (req.body.url || "").trim();
    if (url && !url.startsWith("https://hooks.slack.com/")) {
      return res.status(400).json({ error: "Must be a valid Slack incoming webhook URL (https://hooks.slack.com/…)." });
    }
    db.prepare("UPDATE organizations SET slack_webhook_url = ? WHERE id = ?").run(url || null, req.user.orgId);
    res.json({ ok: true });
  });

  // POST /api/members/:id/transfer-ownership — owner hands ownership to another member
  router.post("/members/:id/transfer-ownership", requireRole("owner"), (req, res) => {
    const target = db
      .prepare("SELECT * FROM users WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!target) return res.status(404).json({ error: "Member not found." });
    if (target.id === req.user.userId)
      return res.status(400).json({ error: "Pick another member." });
    db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(target.id);
    db.prepare("UPDATE users SET role = 'instructor' WHERE id = ?").run(req.user.userId);
    audit(db, {
      orgId: req.user.orgId,
      actorId: req.user.userId,
      action: AUDIT.OWNERSHIP_TRANSFER,
      targetType: "user",
      targetId: target.id,
      ip: req.ip,
    });
    // Refresh the caller's session so their cookie reflects their new (demoted) role.
    const caller = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userId);
    if (caller) issueToken(res, caller);
    res.json({ ok: true });
  });

  return router;
};
