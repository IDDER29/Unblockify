"use strict";

// AI Teaching Assistant. Uses the real Claude API when ANTHROPIC_API_KEY is set,
// and a deterministic local fallback otherwise — so the product always works in a
// demo. Model is configurable; defaults to a fast, low-cost model for tutoring.

const Anthropic = require("@anthropic-ai/sdk");
const { tokenize } = require("./retrieval");

const MODEL = process.env.AI_MODEL || "claude-haiku-4-5";
const AI_NAME = "Unblockify AI";
const AI_FOLLOWUP_MAX = 2; // at most 1 first response + 2 follow-ups

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return client;
}
function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function knowledgeText(similar) {
  if (!similar || !similar.length) return "No similar past blockages were found in this workspace.";
  return similar
    .map(
      (s, i) =>
        `${i + 1}. "${s.title}" — resolved via ${s.resolutionType || "support"}: ${s.resolutionNote}`
    )
    .join("\n");
}

const SYSTEM = `You are ${AI_NAME}, a Socratic teaching assistant for a coding bootcamp.
A student has reported a blockage. Your job is to get them unblocked WITHOUT handing them the
finished answer — guide them to it.

Rules:
- Be warm, concise, and encouraging. 120 words max.
- Lead with one or two pointed diagnostic questions that move them forward.
- Suggest the next concrete thing to check or try; reference the relevant concept.
- If the provided "Knowledge base" contains a closely related past resolution, draw on it.
- Never paste a full solution or complete code file. Nudge, don't solve.
- End with: "If this doesn't unblock you, an instructor will pick it up." `;

/**
 * Produce a first-response tutoring message for a freshly reported blockage.
 * Returns a markdown string. Never throws — falls back locally on any error.
 */
async function unblock({ title, details, difficulty, cohortName, briefName, similar }) {
  const c = getClient();
  if (!c) return fallbackUnblock({ title, details, similar });

  const user = `Cohort: ${cohortName || "—"}
Brief: ${briefName || "—"}
Blockage title: ${title}
Difficulty (student's words): ${difficulty || "—"}
Details from the student:
${details || "—"}

Knowledge base (past resolved blockages in this workspace):
${knowledgeText(similar)}`;

  try {
    const msg = await c.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    const text = (msg.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || fallbackUnblock({ title, details, similar });
  } catch (e) {
    return fallbackUnblock({ title, details, similar });
  }
}

/**
 * Draft a reply for an instructor from the thread + knowledge base (copilot).
 */
async function draftReply({ title, details, studentName, thread, similar }) {
  const c = getClient();
  if (!c) return fallbackDraft({ title, similar });

  const convo = (thread || [])
    .map((m) => `${m.author} (${m.author_role}): ${m.body}`)
    .join("\n");

  const user = `You are helping an instructor reply to a student's blockage. Draft a short,
kind, specific reply (under 100 words) that moves the student forward. Use the knowledge base
if relevant. Don't dump a full solution.

Student: ${studentName}
Title: ${title}
Details: ${details || "—"}
Conversation so far:
${convo || "(no replies yet)"}

Knowledge base:
${knowledgeText(similar)}`;

  try {
    const msg = await c.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: "You draft concise, supportive instructor replies for a coding bootcamp.",
      messages: [{ role: "user", content: user }],
    });
    const text = (msg.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || fallbackDraft({ title, similar });
  } catch (e) {
    return fallbackDraft({ title, similar });
  }
}

// --- Deterministic local fallbacks (no API key needed) ----------------
function fallbackUnblock({ title, details, similar }) {
  const lines = [];
  lines.push(
    `Let's get you moving on "${title}". A couple of questions to narrow it down:`
  );
  lines.push(
    `• What's the exact error or behavior you're seeing, and what did you expect instead?`
  );
  lines.push(
    `• What's the smallest piece you can test in isolation to confirm where it breaks?`
  );
  if (similar && similar.length) {
    lines.push(
      `\nA teammate hit something similar — "${similar[0].title}" — and it came down to: ${similar[0].resolutionNote}`
    );
  } else {
    lines.push(
      `\nTry logging the value right before it fails, and re-read the relevant docs for that one function.`
    );
  }
  lines.push(`\nIf this doesn't unblock you, an instructor will pick it up.`);
  return lines.join("\n");
}

function fallbackDraft({ title, similar }) {
  if (similar && similar.length) {
    return `Take a look at how "${similar[0].title}" was solved: ${similar[0].resolutionNote}. Try that on your case and tell me what you see — happy to pair if it's still stuck.`;
  }
  return `Can you share the exact error and the smallest snippet that reproduces it? Let's isolate where "${title}" breaks, then take it one step at a time.`;
}

function extractText(msg) {
  return (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

// --- Multi-turn follow-up with progressive scaffold levels (Phase 3.1) ---
// scaffoldLevel: 1=hint, 2=question+hint, 3=example, 4=worked solution
function fallbackFollowup({ title, turn, scaffoldLevel }) {
  const level = scaffoldLevel || (turn || 1);
  if (level <= 1) {
    return `Still stuck on "${title}"? What's the smallest input that triggers the problem? Try isolating one variable at a time.\n\nIf this doesn't unblock you, click "I'm still stuck" to get an instructor.`;
  }
  if (level === 2) {
    return `Let's go deeper on "${title}". Can you paste the exact error and the two lines of code around where it fails? What value do you expect vs what do you get?\n\nIf this doesn't unblock you, click "I'm still stuck" to get an instructor.`;
  }
  if (level === 3) {
    return `Here's an example that might help with "${title}": think about a simpler version of the same problem. Break it into: (1) what input do you have, (2) what transformation is needed, (3) what output do you want. Write each step out before coding it.\n\nIf this still doesn't click, click "I'm still stuck" to get an instructor.`;
  }
  return `For "${title}", here's the full approach: read the error message top to bottom, find the line number, add a console.log before that line to see the actual value. Compare to what the docs say it should be. That gap is your bug.\n\nAn instructor can pair on the next step — click "I'm still stuck" to bring one in.`;
}

async function followup({ title, details, thread, similar, turn, scaffoldLevel }) {
  const c = getClient();
  if (!c) return fallbackFollowup({ title, turn, scaffoldLevel });
  const level = scaffoldLevel || (turn || 1);
  const convo = (thread || []).map((m) => `${m.author} (${m.author_role}): ${m.body}`).join("\n");

  // Scaffold level controls how much the AI reveals
  const levelInstruction = {
    1: "Give only a short hint — one leading question or one direction, no solution.",
    2: "Give a diagnostic question and one concrete debugging step. Still no solution.",
    3: "Give a worked example (analogous, not identical) and walk through the reasoning.",
    4: "Give the full worked solution with explanation. This is the final scaffold level.",
  }[Math.min(level, 4)] || "Ask one or two sharper diagnostic questions and suggest the next concrete thing to try. Don't hand over a full solution.";

  const user = `${levelInstruction}

Title: ${title}
Details: ${details || "—"}
Scaffold level: ${level}/4
Conversation so far:
${convo || "(none)"}

Knowledge base:
${knowledgeText(similar)}

End your response with: "If this doesn't unblock you, ${level >= 4 ? "an instructor will take over" : "click Show me more for the next hint"}."`

  try {
    const msg = await c.messages.create({ model: MODEL, max_tokens: 500, system: SYSTEM, messages: [{ role: "user", content: user }] });
    return extractText(msg) || fallbackFollowup({ title, turn, scaffoldLevel });
  } catch (_) {
    return fallbackFollowup({ title, turn, scaffoldLevel });
  }
}

// --- Triage -----------------------------------------------------------
const DIFFS = ["low", "medium", "high", "blocker"];
const URGS = ["low", "normal", "high"];
function fallbackTriage({ title, details, brief }) {
  const text = `${title || ""} ${details || ""}`.toLowerCase();
  const blocker = /(blocker|urgent|deadline|asap|completely stuck|can'?t continue|cannot continue)/.test(text);
  const hard = /(error|crash|exception|fail|broken|can'?t|cannot|won'?t|undefined|null|stuck)/.test(text);
  let difficulty = "low";
  if (hard) difficulty = "medium";
  if ((details || "").length > 300) difficulty = "high";
  if (blocker) difficulty = "blocker";
  let urgency = "normal";
  if (blocker) urgency = "high";
  else if (!hard && (details || "").length < 40) urgency = "low";
  const topics = Array.from(new Set(tokenize(`${title || ""} ${details || ""} ${brief || ""}`))).slice(0, 3);
  return { difficulty, topics: topics.length ? topics : ["general"], urgency };
}
function clampTriage(p, ctx) {
  const fb = fallbackTriage(ctx);
  const difficulty = p && DIFFS.includes(p.difficulty) ? p.difficulty : fb.difficulty;
  const urgency = p && URGS.includes(p.urgency) ? p.urgency : fb.urgency;
  let topics = p && Array.isArray(p.topics) ? p.topics.filter((t) => typeof t === "string" && t).map((t) => t.toLowerCase().slice(0, 24)).slice(0, 3) : [];
  if (!topics.length) topics = fb.topics;
  return { difficulty, topics, urgency };
}
async function triage({ title, details, brief }) {
  const c = getClient();
  if (!c) return fallbackTriage({ title, details, brief });
  const user = `Triage this coding-bootcamp blockage. Return ONLY JSON:
{"difficulty":"low|medium|high|blocker","topics":["1-3 lowercase keywords"],"urgency":"low|normal|high"}
Title: ${title}
Brief: ${brief || "—"}
Details: ${details || "—"}`;
  try {
    const msg = await c.messages.create({ model: MODEL, max_tokens: 200, system: "You are a precise triage classifier. Output only valid JSON.", messages: [{ role: "user", content: user }] });
    const parsed = JSON.parse(extractText(msg));
    return clampTriage(parsed, { title, details, brief });
  } catch (_) {
    return fallbackTriage({ title, details, brief });
  }
}

// --- Thread summary ---------------------------------------------------
function fallbackSummarize({ title, thread }) {
  const msgs = thread || [];
  const n = msgs.length;
  const last = msgs[n - 1];
  const lastAuthor = last ? last.author : "—";
  const lastBody = last ? String(last.body || "").slice(0, 140) : "";
  const next = last && last.author_role === "student" ? "reply or claim it" : "await the student's response";
  return `${n} message${n === 1 ? "" : "s"}. Student reported: ${title}. Latest from ${lastAuthor}: ${lastBody}. Suggested next step: ${next}.`;
}
async function summarize({ title, details, thread }) {
  const c = getClient();
  if (!c) return fallbackSummarize({ title, thread });
  const convo = (thread || []).map((m) => `${m.author} (${m.author_role}): ${m.body}`).join("\n");
  const user = `Summarize this support thread for a busy instructor in <=80 words: the gist, what's been tried, and the recommended next step.
Title: ${title}
Details: ${details || "—"}
Thread:
${convo || "(no replies yet)"}`;
  try {
    const msg = await c.messages.create({ model: MODEL, max_tokens: 250, system: "You summarize a support thread for a busy instructor.", messages: [{ role: "user", content: user }] });
    return extractText(msg) || fallbackSummarize({ title, thread });
  } catch (_) {
    return fallbackSummarize({ title, thread });
  }
}

// --- Weekly digest summary -------------------------------------------
function fallbackDigest({ orgName, periodDays, clusters, totals }) {
  const n = (totals && totals.resolved) != null ? totals.resolved : (clusters || []).reduce((a, c) => a + c.count, 0);
  const top = (clusters || []).slice(0, 3).map((c) => `${c.theme} (${c.count})`).join(", ");
  const first = (clusters && clusters[0] && clusters[0].theme) || "the fundamentals";
  return `This week (${periodDays}d) ${orgName} resolved ${n} blockage${n === 1 ? "" : "s"}. The biggest themes were ${top || "—"}. Keep an eye on ${first}.`;
}
async function digestSummary({ orgName, periodDays, clusters, totals }) {
  const c = getClient();
  if (!c) return fallbackDigest({ orgName, periodDays, clusters, totals });
  const themes = (clusters || []).map((cl) => `${cl.theme}: ${cl.count} (${(cl.sampleTitles || []).join("; ")})`).join("\n");
  const user = `Write one short paragraph (<=100 words) for an owner: what did "${orgName}" struggle with in the last ${periodDays} days? Name the top themes and one thing to watch.
Themes:\n${themes || "(none)"}`;
  try {
    const msg = await c.messages.create({ model: MODEL, max_tokens: 250, system: "You write a crisp weekly digest for a bootcamp owner.", messages: [{ role: "user", content: user }] });
    return extractText(msg) || fallbackDigest({ orgName, periodDays, clusters, totals });
  } catch (_) {
    return fallbackDigest({ orgName, periodDays, clusters, totals });
  }
}

// --- Resolution summary (Phase 2.1) ----------------------------------
// Called on blockage resolve. Returns 1-2 sentence "what finally worked" summary.
async function resolutionSummary({ title, thread, resolutionNote }) {
  const c = getClient();
  if (!c) return fallbackResolutionSummary({ title, thread, resolutionNote });
  const convo = (thread || []).map((m) => `${m.author} (${m.author_role}): ${m.body}`).join("\n");
  const user = `Write 1–2 sentences summarizing what finally unblocked the student. Be concrete and actionable — focus on the fix, not the problem.
Title: ${title}
Resolution note: ${resolutionNote || "—"}
Thread:
${convo || "(no thread)"}`;
  try {
    const msg = await c.messages.create({
      model: MODEL, max_tokens: 120,
      system: "You write concise resolution summaries for a student knowledge base.",
      messages: [{ role: "user", content: user }],
    });
    return extractText(msg) || fallbackResolutionSummary({ title, thread, resolutionNote });
  } catch (_) {
    return fallbackResolutionSummary({ title, thread, resolutionNote });
  }
}

function fallbackResolutionSummary({ title, thread, resolutionNote }) {
  if (resolutionNote && resolutionNote.trim().length > 10) {
    return resolutionNote.trim().slice(0, 300);
  }
  const lastInstructor = [...(thread || [])].reverse().find((m) => m.author_role === "instructor" || m.author_role === "owner");
  if (lastInstructor) return lastInstructor.body.slice(0, 300);
  return `Resolved: ${title}`.slice(0, 300);
}

module.exports = {
  unblock, draftReply, followup, triage, summarize, digestSummary, resolutionSummary,
  aiConfigured, AI_NAME, MODEL, AI_FOLLOWUP_MAX,
};
