"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("default transport is outbox and writes one JSON file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ubx-email-"));
  process.env.EMAIL_OUTBOX_DIR = dir;
  delete process.env.RESEND_API_KEY;
  // require AFTER env so the module reads the dir lazily (it does via outboxDir()).
  const { sendEmail, currentTransport } = require("../lib/email");
  assert.equal(currentTransport(), "outbox");
  const r = await sendEmail({ to: "a@x.com", subject: "Hi", text: "body" });
  assert.equal(r.transport, "outbox");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1);
  const msg = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
  assert.equal(msg.to, "a@x.com");
  assert.equal(msg.subject, "Hi");
});

test("http transport is used when RESEND_API_KEY is set", async () => {
  const { sendEmail, currentTransport } = require("../lib/email");
  const realFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "test";
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: "http_123" }) });
  try {
    assert.equal(currentTransport(), "http");
    const r = await sendEmail({ to: "a@x.com", subject: "Hi", text: "b" });
    assert.equal(r.transport, "http");
    assert.equal(r.id, "http_123");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
});
