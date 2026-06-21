"use strict";

// The single writer for the immutable audit log. Every security/admin event
// goes through audit(); nothing else inserts into audit_log.
const AUDIT = {
  SIGNUP: "org.signup",
  LOGIN: "auth.login",
  LOGOUT: "auth.logout",
  JOIN: "member.join",
  INVITE_CREATE: "invite.create",
  INVITE_REVOKE: "invite.revoke",
  MEMBER_UPDATE: "member.update",
  MEMBER_REMOVE: "member.remove",
  OWNERSHIP_TRANSFER: "org.transfer_ownership",
  ORG_RENAME: "org.rename",
  USER_DATA_DELETE: "gdpr.user_delete",
  DATA_EXPORT: "gdpr.export",
  ESCALATE: "escalate",
  SLA_UPDATE: "sla.update",
};

function audit(db, { orgId, actorId = null, action, targetType = null, targetId = null, ip = null, meta = null }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (org_id, actor_id, action, target_type, target_id, ip, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orgId,
      actorId,
      action,
      targetType,
      targetId,
      ip,
      meta == null ? null : typeof meta === "string" ? meta : JSON.stringify(meta)
    );
  } catch (_) {
    // Audit must never break the request it records.
  }
}

module.exports = { audit, AUDIT };
