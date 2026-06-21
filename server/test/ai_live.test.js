"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("AI offline path is total (every fn returns its fallback shape)", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const ai = require("../lib/ai");
  assert.equal(ai.aiConfigured(), false);
  assert.equal(typeof (await ai.unblock({ title: "t", details: "d", similar: [] })), "string");
  assert.equal(typeof (await ai.followup({ title: "t", thread: [], turn: 1 })), "string");
  const tr = await ai.triage({ title: "t", details: "d" });
  assert.ok(["low", "medium", "high", "blocker"].includes(tr.difficulty));
  assert.ok(["low", "normal", "high"].includes(tr.urgency));
  assert.ok(Array.isArray(tr.topics) && tr.topics.length >= 1);
  assert.equal(typeof (await ai.summarize({ title: "t", thread: [] })), "string");
  assert.equal(typeof (await ai.digestSummary({ orgName: "O", periodDays: 7, clusters: [], totals: { resolved: 0 } })), "string");
  const adv = await ai.triage({ title: "", details: "x".repeat(2000) });
  assert.ok(["low", "medium", "high", "blocker"].includes(adv.difficulty));
  assert.ok(["low", "normal", "high"].includes(adv.urgency));
});

test("MODEL honors AI_MODEL", () => {
  const old = process.env.AI_MODEL;
  process.env.AI_MODEL = "claude-test-xyz";
  delete require.cache[require.resolve("../lib/ai")];
  const ai2 = require("../lib/ai");
  assert.equal(ai2.MODEL, "claude-test-xyz");
  if (old === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = old;
  delete require.cache[require.resolve("../lib/ai")];
});
