"use strict";

const crypto = require("node:crypto");
const { publish } = require("./bus");

function slugify(name) {
  const base = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "org";
  return base + "-" + crypto.randomBytes(3).toString("hex");
}

function randomCode() {
  return crypto.randomBytes(9).toString("base64url"); // ~12 url-safe chars
}

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, cohortId: u.cohort_id,
    emailVerified: !!u.email_verified,
  };
}
function publicOrg(o) {
  return { id: o.id, name: o.name, slug: o.slug };
}

function addEvent(db, { orgId, blockageId, type, actorId, meta = null }) {
  db.prepare(
    `INSERT INTO status_events (org_id, blockage_id, type, actor_id, meta)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orgId, blockageId, type, actorId, meta);
}

function notify(db, { orgId, userId, type, blockageId = null, body }) {
  db.prepare(
    `INSERT INTO notifications (org_id, user_id, type, blockage_id, body)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orgId, userId, type, blockageId, body);
  // Push it live to any open SSE stream for this user (best-effort).
  try { publish(userId, "notification", { type, blockageId, body, orgId }); } catch (_) {}
}

// Instructor user-ids assigned to a cohort.
function cohortInstructorIds(db, cohortId) {
  return db
    .prepare("SELECT user_id FROM cohort_instructors WHERE cohort_id = ?")
    .all(cohortId)
    .map((r) => r.user_id);
}

// Can this token-user see this blockage row?
function canSeeBlockage(db, user, blk) {
  if (!blk || blk.org_id !== user.orgId) return false;
  if (user.role === "owner") return true;
  if (user.role === "student") return blk.user_id === user.userId;
  // instructor: assignee or assigned to the cohort
  if (blk.assignee_id === user.userId) return true;
  return cohortInstructorIds(db, blk.cohort_id).includes(user.userId);
}

module.exports = {
  slugify,
  randomCode,
  publicUser,
  publicOrg,
  addEvent,
  notify,
  cohortInstructorIds,
  canSeeBlockage,
};
