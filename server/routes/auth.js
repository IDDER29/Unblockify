"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { issueToken, clearToken, requireAuth, currentUser } = require("../auth");
const { audit, AUDIT } = require("../lib/audit");
const { slugify, publicUser, publicOrg, randomCode } = require("../lib/helpers");
const { tooLong } = require("../lib/validate");
const { rateLimit } = require("../lib/ratelimit");
const { sendEmail } = require("../lib/email");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function authRoutes(db) {
  const router = express.Router();

  const userById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  const orgById = (id) => db.prepare("SELECT * FROM organizations WHERE id = ?").get(id);

  const originOf = (req) =>
    req.headers.origin || "http://localhost:" + (process.env.PORT || 5050);

  // Send a verification email for a freshly-created user (best-effort).
  function sendVerifyEmail(req, user, token) {
    const link = originOf(req) + "/verify.html?token=" + token;
    return sendEmail({
      to: user.email,
      subject: "Verify your Unblockify email",
      text:
        `Hi ${user.name},\n\nConfirm your email to finish setting up your Unblockify ` +
        `account:\n\n${link}\n\nIf you didn't sign up, you can ignore this message.`,
      html:
        `<p>Hi ${user.name},</p><p>Confirm your email to finish setting up your ` +
        `Unblockify account:</p><p><a href="${link}">${link}</a></p>`,
    });
  }

  const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: Number(process.env.AUTH_RATELIMIT_MAX) || 50,
  });

  // POST /api/auth/signup — creates an organization + its owner.
  router.post("/signup", authLimiter, (req, res) => {
    const orgName = (req.body.orgName || "").trim();
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!orgName || !name || !email || !password)
      return res.status(400).json({ error: "Organization, name, email and password are required." });
    const lenErr = tooLong(orgName, 120, "Organization name") || tooLong(name, 100, "Name");
    if (lenErr) return res.status(400).json({ error: lenErr });
    if (!EMAIL_RE.test(email))
      return res.status(400).json({ error: "Please enter a valid email address." });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email))
      return res.status(409).json({ error: "This email is already registered." });

    const org = db
      .prepare("INSERT INTO organizations (name, slug) VALUES (?, ?)")
      .run(orgName, slugify(orgName));
    const hash = bcrypt.hashSync(password, 10);
    const verifyToken = randomCode();
    const info = db
      .prepare(
        "INSERT INTO users (org_id, name, email, password_hash, role, email_verified, verify_token) VALUES (?, ?, ?, ?, 'owner', 0, ?)"
      )
      .run(org.lastInsertRowid, name, email, hash, verifyToken);

    const user = userById(info.lastInsertRowid);
    audit(db, {
      orgId: org.lastInsertRowid,
      actorId: user.id,
      action: AUDIT.SIGNUP,
      targetType: "org",
      targetId: org.lastInsertRowid,
      ip: req.ip,
    });
    issueToken(res, user);
    res.status(201).json({ user: publicUser(user), org: publicOrg(orgById(org.lastInsertRowid)) });
    sendVerifyEmail(req, user, verifyToken).catch(() => {});
  });

  // POST /api/auth/login
  router.post("/login", authLimiter, (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: "Incorrect email or password." });
    issueToken(res, user);
    audit(db, {
      orgId: user.org_id,
      actorId: user.id,
      action: AUDIT.LOGIN,
      ip: req.ip,
    });
    res.json({ user: publicUser(user), org: publicOrg(orgById(user.org_id)) });
  });

  // POST /api/auth/logout
  router.post("/logout", (req, res) => {
    const u = currentUser(req);
    if (u) {
      audit(db, {
        orgId: u.orgId,
        actorId: u.userId,
        action: AUDIT.LOGOUT,
        ip: req.ip,
      });
    }
    clearToken(res);
    res.json({ ok: true });
  });

  // GET /api/auth/me
  router.get("/me", requireAuth, (req, res) => {
    const user = userById(req.user.userId);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    res.json({ user: publicUser(user), org: publicOrg(orgById(user.org_id)) });
  });

  // GET /api/auth/invite/:code — public preview of an invite
  router.get("/invite/:code", (req, res) => {
    const inv = db.prepare("SELECT * FROM invites WHERE code = ?").get(req.params.code);
    if (!inv || inv.revoked || inv.used_by)
      return res.status(410).json({ valid: false, error: "This invite is no longer valid." });
    const org = orgById(inv.org_id);
    res.json({ valid: true, orgName: org.name, role: inv.role });
  });

  // POST /api/auth/join — accept an invite
  router.post("/join", authLimiter, (req, res) => {
    const code = (req.body.code || "").trim();
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    const inv = db.prepare("SELECT * FROM invites WHERE code = ?").get(code);
    if (!inv || inv.revoked || inv.used_by)
      return res.status(410).json({ error: "This invite is no longer valid." });
    if (!name || !email || !password)
      return res.status(400).json({ error: "Name, email and password are required." });
    const lenErr = tooLong(name, 100, "Name");
    if (lenErr) return res.status(400).json({ error: lenErr });
    if (!EMAIL_RE.test(email))
      return res.status(400).json({ error: "Please enter a valid email address." });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email))
      return res.status(409).json({ error: "This email is already registered." });

    const hash = bcrypt.hashSync(password, 10);
    // A "home cohort" only applies to students; instructors get assigned to the
    // cohort's queue instead.
    const homeCohort = inv.role === "student" ? inv.cohort_id : null;
    const verifyToken = randomCode();
    const info = db
      .prepare(
        "INSERT INTO users (org_id, name, email, password_hash, role, cohort_id, email_verified, verify_token) VALUES (?, ?, ?, ?, ?, ?, 0, ?)"
      )
      .run(inv.org_id, name, email, hash, inv.role, homeCohort, verifyToken);
    if (inv.role === "instructor" && inv.cohort_id) {
      db.prepare(
        "INSERT OR IGNORE INTO cohort_instructors (cohort_id, user_id) VALUES (?, ?)"
      ).run(inv.cohort_id, info.lastInsertRowid);
    }
    db.prepare("UPDATE invites SET used_by = ? WHERE id = ?").run(info.lastInsertRowid, inv.id);

    const user = userById(info.lastInsertRowid);
    audit(db, {
      orgId: inv.org_id,
      actorId: user.id,
      action: AUDIT.JOIN,
      targetType: "user",
      targetId: user.id,
      ip: req.ip,
    });
    issueToken(res, user);
    res.status(201).json({ user: publicUser(user), org: publicOrg(orgById(user.org_id)) });
    sendVerifyEmail(req, user, verifyToken).catch(() => {});
  });

  // PUT /api/auth/me — edit own profile (name) and/or change password.
  router.put("/me", requireAuth, (req, res) => {
    const user = userById(req.user.userId);
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const hasName = req.body.name !== undefined;
    const hasNewPassword = req.body.newPassword !== undefined && req.body.newPassword !== "";

    if (hasName) {
      const name = (req.body.name || "").trim();
      if (!name) return res.status(400).json({ error: "Name can't be empty." });
      const lenErr = tooLong(name, 100, "Name");
      if (lenErr) return res.status(400).json({ error: lenErr });
      db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, user.id);
    }

    if (hasNewPassword) {
      const currentPassword = req.body.currentPassword || "";
      const newPassword = req.body.newPassword || "";
      if (!bcrypt.compareSync(currentPassword, user.password_hash))
        return res.status(400).json({ error: "Current password is incorrect." });
      if (newPassword.length < 6)
        return res.status(400).json({ error: "Password must be at least 6 characters." });
      const hash = bcrypt.hashSync(newPassword, 10);
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
    }

    const updated = userById(user.id);
    res.json({ user: publicUser(updated), org: publicOrg(orgById(updated.org_id)) });
  });

  // GET /api/me/export.json — student portfolio export.
  router.get("/me/export.json", requireAuth, (req, res) => {
    const { userId, orgId, role } = req.user;
    const user = userById(userId);
    if (!user) return res.status(401).json({ error: "Not authenticated." });

    const blockages = db.prepare(
      `SELECT b.id, b.title, b.details, b.status, b.created_at,
              b.resolution_note, b.resolution_type,
              c.name AS cohort, br.name AS brief
         FROM blockages b
         JOIN cohorts c ON c.id = b.cohort_id
         LEFT JOIN briefs br ON br.id = b.brief_id
        WHERE b.user_id = ? AND b.org_id = ?
        ORDER BY b.created_at`
    ).all(userId, orgId);

    const timeline = db.prepare(
      `SELECT e.type, e.created_at
         FROM status_events e
         JOIN blockages b ON b.id = e.blockage_id
        WHERE b.user_id = ? AND b.org_id = ?
        ORDER BY e.created_at`
    ).all(userId, orgId);

    const stats = db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
         SUM(CASE WHEN resolution_type = 'ai' THEN 1 ELSE 0 END) AS self_resolved,
         AVG(CASE WHEN resolved_at IS NOT NULL THEN
           (julianday(resolved_at) - julianday(created_at)) * 24 ELSE NULL END) AS avg_hours
         FROM blockages WHERE user_id = ? AND org_id = ?`
    ).get(userId, orgId);

    res.setHeader("Content-Disposition", 'attachment; filename="unblockify-portfolio.json"');
    res.json({
      exported_at: new Date().toISOString(),
      student: { name: user.name, email: user.email },
      stats,
      blockages,
      activity_timeline: timeline,
    });
  });

  // POST /api/auth/forgot — start a password reset. Always 200 (never reveal
  // whether the email exists).
  router.post("/forgot", authLimiter, (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const user = email ? db.prepare("SELECT * FROM users WHERE email = ?").get(email) : null;
    if (user) {
      const token = randomCode();
      db.prepare(
        "INSERT INTO password_resets (org_id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now','+1 hour'))"
      ).run(user.org_id, user.id, token);
      const link = originOf(req) + "/reset.html?token=" + token;
      sendEmail({
        to: user.email,
        subject: "Reset your Unblockify password",
        text:
          `Hi ${user.name},\n\nWe got a request to reset your Unblockify password. ` +
          `Use the link below within the next hour:\n\n${link}\n\n` +
          `If you didn't ask for this, you can safely ignore this email.`,
        html:
          `<p>Hi ${user.name},</p><p>We got a request to reset your Unblockify ` +
          `password. Use the link below within the next hour:</p>` +
          `<p><a href="${link}">${link}</a></p>`,
      }).catch(() => {});
    }
    res.json({ ok: true });
  });

  // POST /api/auth/reset — complete a password reset with a valid token.
  router.post("/reset", authLimiter, (req, res) => {
    const token = (req.body.token || "").trim();
    const password = req.body.password || "";
    const row = token
      ? db
          .prepare(
            "SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')"
          )
          .get(token)
      : null;
    if (!row)
      return res.status(400).json({ error: "This reset link is invalid or has expired." });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters." });

    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, row.user_id);
    db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").run(row.id);
    clearToken(res);
    res.json({ ok: true });
  });

  // GET /api/auth/verify — confirm an email address via its token.
  router.get("/verify", (req, res) => {
    const token = (req.query.token || "").trim();
    const user = token
      ? db.prepare("SELECT * FROM users WHERE verify_token = ?").get(token)
      : null;
    if (!user)
      return res.status(400).json({ error: "This verification link is invalid." });
    db.prepare(
      "UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?"
    ).run(user.id);
    res.json({ ok: true, email: user.email });
  });

  // POST /api/auth/resend-verify — re-send the verification email (no-op if
  // already verified).
  router.post("/resend-verify", requireAuth, (req, res) => {
    const user = userById(req.user.userId);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (user.email_verified) return res.json({ ok: true });
    const token = randomCode();
    db.prepare("UPDATE users SET verify_token = ? WHERE id = ?").run(token, user.id);
    sendVerifyEmail(req, user, token).catch(() => {});
    res.json({ ok: true });
  });

  return router;
};
