"use strict";

// Local-first transactional email. By default every message is written to
// server/outbox/ as a JSON file (works fully offline, easy to inspect/test).
// A real provider (Resend HTTP API) is used only when RESEND_API_KEY is set;
// any provider failure falls back to the outbox so a message is never lost.

const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function outboxDir() {
  return process.env.EMAIL_OUTBOX_DIR || path.join(__dirname, "..", "outbox");
}

function currentTransport() {
  if (process.env.RESEND_API_KEY) return "http";
  return "outbox";
}

async function _writeOutbox(msg) {
  const dir = outboxDir();
  await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = stamp + "-" + crypto.randomBytes(4).toString("hex");
  await fsp.writeFile(
    path.join(dir, id + ".json"),
    JSON.stringify({ to: msg.to, subject: msg.subject, text: msg.text, html: msg.html || null, sentAt: new Date().toISOString() }, null, 2)
  );
  return { transport: "outbox", id };
}

async function _sendHttp(msg) {
  const key = process.env.RESEND_API_KEY;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Unblockify <onboarding@resend.dev>",
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("email provider failed");
  return { transport: "http", id: data.id || "http" };
}

async function sendEmail(msg) {
  const t = currentTransport();
  if (t === "http") {
    try {
      return await _sendHttp(msg);
    } catch (_) {
      return _writeOutbox(msg); // never lose a message
    }
  }
  return _writeOutbox(msg);
}

module.exports = { sendEmail, outboxDir, currentTransport, _writeOutbox, _sendHttp };
