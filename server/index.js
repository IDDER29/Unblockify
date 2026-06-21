"use strict";

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const { openDb } = require("./db");
const authRoutes = require("./routes/auth");
const memberRoutes = require("./routes/members");
const cohortRoutes = require("./routes/cohorts");
const blockageRoutes = require("./routes/blockages");
const notificationRoutes = require("./routes/notifications");
const analyticsRoutes = require("./routes/analytics");
const attachmentRoutes = require("./routes/attachments");
const streamRoutes = require("./routes/stream");
const profileRoutes = require("./routes/profile");
const tagRoutes = require("./routes/tags");
const viewRoutes = require("./routes/views");
const csatRoutes = require("./routes/csat");
const nudgeRoutes = require("./routes/nudges");
const cannedRoutes = require("./routes/canned");
const auditRoutes = require("./routes/audit");
const gdprRoutes = require("./routes/gdpr");
const slaRoutes = require("./routes/sla");
const { requestLogger, errorHandler, healthz } = require("./lib/logger");

const ROOT = path.join(__dirname, "..");

function createApp(db) {
  const app = express();
  app.use(requestLogger()); // structured access log + counters (first, times everything)
  app.get("/healthz", healthz); // liveness probe (no auth, not under /api)
  // Basic hardening: cap request bodies + send conservative security headers.
  // The attachments route parses its own (larger) base64 body, so skip it here —
  // otherwise the global 100kb cap would 413 uploads before they reach it.
  const smallJson = express.json({ limit: "100kb" });
  app.use((req, res, next) => {
    if (req.path === "/api/attachments") return next();
    smallJson(req, res, next);
  });
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.use("/api/auth", authRoutes(db));
  app.use("/api", memberRoutes(db));
  app.use("/api", cohortRoutes(db));
  app.use("/api", blockageRoutes(db));
  app.use("/api", attachmentRoutes(db));
  app.use("/api", streamRoutes(db));
  app.use("/api", profileRoutes(db));
  app.use("/api", tagRoutes(db));
  app.use("/api", viewRoutes(db));
  app.use("/api", csatRoutes(db));
  app.use("/api", nudgeRoutes(db));
  app.use("/api", cannedRoutes(db));
  app.use("/api", auditRoutes(db));
  app.use("/api", gdprRoutes(db));
  app.use("/api", slaRoutes(db));
  app.use("/api", notificationRoutes(db));
  app.use("/api", analyticsRoutes(db));

  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
  app.use(express.static(ROOT, { index: "index.html", extensions: ["html"] }));
  app.use(errorHandler()); // central error capture (last)
  return app;
}

module.exports = { createApp };

// Start the server when run directly.
if (require.main === module) {
  const db = openDb(process.env.DB_PATH || path.join(__dirname, "data.db"));
  const PORT = process.env.PORT || 5050;
  createApp(db).listen(PORT, () =>
    console.log(`Unblockify running at http://localhost:${PORT}`)
  );
}
