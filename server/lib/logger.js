"use strict";

// Structured observability: request logging, central error capture, counters,
// and a /healthz handler. Writes JSON lines to server/logs/ (created lazily).
// Optional error webhook fires only when ERROR_WEBHOOK_URL is set.

const fs = require("node:fs");
const path = require("node:path");

const counters = { requests: 0, errors: 0, byStatus: {} };
const startedAt = Date.now();

function logsDir() {
  const dir = path.join(__dirname, "..", "logs");
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}
function writeLine(file, obj) {
  try { fs.appendFileSync(path.join(logsDir(), file), JSON.stringify(obj) + "\n"); } catch (_) {}
}

function requestLogger() {
  return function (req, res, next) {
    const t0 = Date.now();
    res.on("finish", () => {
      counters.requests++;
      counters.byStatus[res.statusCode] = (counters.byStatus[res.statusCode] || 0) + 1;
      const line = {
        t: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        ms: Date.now() - t0,
        ip: req.ip,
      };
      writeLine("access.log", line);
      if (process.env.LOG_STDOUT) console.log(JSON.stringify(line));
    });
    next();
  };
}

function errorHandler() {
  return function (err, req, res, next) {
    counters.errors++;
    const line = {
      t: new Date().toISOString(), level: "error",
      method: req.method, path: req.originalUrl || req.url,
      message: err && err.message, stack: err && err.stack,
    };
    writeLine("error.log", line);
    if (process.env.ERROR_WEBHOOK_URL) {
      try {
        fetch(process.env.ERROR_WEBHOOK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: line.message, path: line.path }),
        }).catch(() => {});
      } catch (_) {}
    }
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    else next(err);
  };
}

function healthz(req, res) {
  res.json({ status: "ok", uptime: Math.round((Date.now() - startedAt) / 1000), counters });
}

module.exports = { requestLogger, errorHandler, healthz, counters };
