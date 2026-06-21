"use strict";

function rateLimit({ windowMs = 5 * 60 * 1000, max = 30 } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }
  return function (req, res, next) {
    if (process.env.AUTH_RATELIMIT === "off") return next();
    const now = Date.now();
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
    let h = hits.get(ip);
    if (!h || now > h.resetAt) {
      h = { count: 0, resetAt: now + windowMs };
      hits.set(ip, h);
    }
    h.count++;
    if (h.count > max) {
      const retry = Math.ceil((h.resetAt - now) / 1000);
      res.set("Retry-After", String(retry));
      return res.status(429).json({ error: "Too many attempts. Please try again in a moment." });
    }
    next();
  };
}

module.exports = { rateLimit };
