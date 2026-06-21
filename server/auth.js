"use strict";

const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "unblockify-local-dev-secret";
const COOKIE = "unblockify_token";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function issueToken(res, user) {
  const token = jwt.sign(
    { userId: user.id, orgId: user.org_id, role: user.role },
    SECRET,
    { expiresIn: "7d" }
  );
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: MAX_AGE });
}

function clearToken(res) {
  res.clearCookie(COOKIE);
}

function currentUser(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET); // { userId, orgId, role }
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "Not authenticated" });
  req.user = u;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

// Owner can do anything an instructor can.
function requireStaff(req, res, next) {
  if (!req.user || (req.user.role !== "owner" && req.user.role !== "instructor")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

module.exports = {
  issueToken,
  clearToken,
  currentUser,
  requireAuth,
  requireRole,
  requireStaff,
  COOKIE,
};
