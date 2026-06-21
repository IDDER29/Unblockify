# Phase 3: AI Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each backend task is TDD: write the failing test, run it, see it fail for the right reason, write the **minimal real** code, run it, see it pass, commit.

**Goal:** Go 10x deeper on the product wedge — the AI Teaching Assistant — without breaking the "runs and demos entirely offline" guarantee. Ship five capabilities, each with a deterministic local fallback that tests assert against: (1) **multi-turn AI** that holds a bounded back-and-forth on an open blockage; (2) **AI triage** that tags every new blockage with difficulty + topics + urgency and feeds analytics; (3) an **instructor thread summary** for a 5-second catch-up; (4) an **owner weekly digest** that clusters recently-resolved blockages into "what your cohort struggled with"; (5) **live Claude key** wiring proven end-to-end with graceful fallback.

**Architecture:** Unchanged shape. One Express app (`createApp(db)`) serves a vanilla-JS front-end and a JSON API over SQLite (`node:sqlite`), every row scoped by `org_id`. All AI lives in `server/lib/ai.js` — each function calls the real Claude API via `@anthropic-ai/sdk` when `ANTHROPIC_API_KEY` is set, else returns a deterministic local fallback computed from the same inputs; functions never throw (they catch API errors and fall back). The retrieval knowledge base (`server/lib/retrieval.js`, keyword overlap over the org's resolved blockages) is reused for the digest clustering. New columns land via `migrate()` in `db.js` (idempotent `ALTER TABLE ... ADD COLUMN` guarded by a column-existence check, since the schema uses `CREATE TABLE IF NOT EXISTS`). Front-end consumes new fields through `renderShell` + shared helpers, escaping all user data with `escapeHtml`.

**Tech Stack:** Node 22+ (`node:sqlite` via `--experimental-sqlite`, `node:test`), Express factories `(db)=>router`, JWT httpOnly cookie (`requireAuth`/`requireRole`/`requireStaff`), `@anthropic-ai/sdk` (already a dependency); vanilla HTML/CSS/JS sharing the "Signal" design system. Tests: `node:test` with the in-memory harness in `server/test/helpers.js` (`startServer`, `buildOrg`, `joinMember`, `makeClient`), auto-discovered by `npm test`.

## Global Constraints
- Runs entirely LOCAL; no cloud. Node ≥22 node:sqlite (--experimental-sqlite); pure-JS deps only.
- AI uses the real Claude API only when ANTHROPIC_API_KEY is set, else a deterministic local fallback; the app + tests always run offline. Model via AI_MODEL (default claude-haiku-4-5). Background AI gated by AI_AUTORESPOND. Use the official @anthropic-ai/sdk (already a dependency); no thinking/effort params on Haiku.
- Backend: Express factories `(db)=>router`; JWT cookie; requireAuth/requireRole/requireStaff. Multi-tenant org_id everywhere; cross-tenant → 404; migrate() in db.js for new columns/tables.
- Front-end: vanilla HTML/CSS/JS; renderShell + helpers; escapeHtml; "Signal" tokens.
- Tests: node:test, in-memory DB via test/helpers.js; npm test auto-discovers.
- Commit messages end with: Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## File Structure

```
server/
  db.js                         (MODIFY) migrate(): add columns to blockages + comments; new ai_followup_count
  lib/
    ai.js                       (MODIFY) add followup(), triage(), summarize(), digestSummary(); export them
    retrieval.js                (MODIFY) add clusterResolved() for digest theming (reuses tokenize)
  routes/
    blockages.js                (MODIFY) ai-followup endpoint + auto-followup on student comment; triage on report; summary endpoint; surface triage fields
    analytics.js                (MODIFY) /analytics adds triage breakdowns; new GET /analytics/digest
  test/
    ai_followup.test.js         (NEW) Task 1
    ai_triage.test.js           (NEW) Task 2
    ai_summary.test.js          (NEW) Task 3
    ai_digest.test.js           (NEW) Task 4
    ai_live.test.js             (NEW) Task 5 (fallback-path proof; no real key)
functions/
  blockage.js                   (MODIFY) render triage badges; "Ask AI again" button; instructor "Summarize" button
  owner.js                      (MODIFY) render the weekly digest panel
dashboard.css                   (MODIFY) tokens for triage tags, urgency dot, digest panel, summary card
docs/
  LIVE-AI.md                    (NEW, Task 5) how to enable the real Claude API + verify the path
README.md                       (MODIFY, Task 5) one paragraph: ANTHROPIC_API_KEY + AI_MODEL + AI_AUTORESPOND
```

Notes that hold for every task:
- `migrate()` already runs `CREATE TABLE IF NOT EXISTS`. New columns use a helper `addColumn(db, table, col, ddl)` that checks `PRAGMA table_info(table)` and only runs `ALTER TABLE` when the column is missing — safe to re-run on an existing `data.db`.
- Tests set `process.env.AI_AUTORESPOND` per case **before** `startServer()` (the harness reads it at boot and defaults it to `"0"`). To exercise background AI, set it to `"1"`; to suppress, leave it (defaults `"0"`).
- No real `ANTHROPIC_API_KEY` in any test. Tests assert against deterministic fallback strings only. If `ANTHROPIC_API_KEY` happens to be set in the dev shell, tests must still pass — so each test that touches AI **deletes** `process.env.ANTHROPIC_API_KEY` at the top to force the fallback path.
- Background work uses `setImmediate`; tests that depend on it poll with a short bounded loop (re-GET up to ~10×, 30ms apart) rather than a fixed sleep.

---

## Task 1: Multi-turn AI follow-up

**Goal:** When a student replies on a still-open blockage that the AI was already involved in, the AI can post one more bounded, Socratic follow-up — capped per blockage so it can never loop. Exposed two ways: an explicit `POST /api/blockages/:id/ai-followup` (student presses "Ask AI again"), and an automatic follow-up fired in the background after a student comment when the cap allows.

**Files:** `server/lib/ai.js`, `server/db.js`, `server/routes/blockages.js`, `server/test/ai_followup.test.js`, `functions/blockage.js`, `dashboard.css`.

**Interfaces:**
- `ai.followup({ title, details, thread, similar, turn }) -> Promise<string>` — `thread` is `[{ author, author_role, body }]` (oldest→newest, includes prior AI + student messages); `turn` is the 1-based follow-up index (for fallback variety). Returns a markdown string ≤120 words; never throws.
- DB: `blockages.ai_followup_count INTEGER NOT NULL DEFAULT 0`. Cap constant `AI_FOLLOWUP_MAX = 2` (so at most 1 first response + 2 follow-ups = 3 AI messages).
- `POST /api/blockages/:id/ai-followup` (requireRole `student`, must own blockage) → 200 `{ ok:true, posted:boolean }`. Posts a follow-up only if: status `open`, an AI comment already exists, the last comment is the student's (i.e. there is something to respond to), and `ai_followup_count < AI_FOLLOWUP_MAX`. On post: inserts an AI comment (`is_ai=1`, `user_id NULL`, `ai_author=ai.AI_NAME`), increments `ai_followup_count`, writes an `ai_reply` status-event, notifies the student. If conditions fail → 200 `{ ok:true, posted:false }` (idempotent, no error).
- Auto path: inside `POST /api/blockages/:id/comments`, when the commenter is a student and conditions above hold and `AI_AUTORESPOND !== "0"`, fire `setImmediate(() => aiFollowup(id))` after responding.

**Steps:**
- [ ] Add the fallback first. In `server/lib/ai.js` add `fallbackFollowup({ title, thread, turn })`: a deterministic string that varies by `turn` (turn 1 asks the student to narrow the failing input + show the smallest reproducing snippet; turn 2 nudges toward checking docs / a teammate's past fix from `similar`). Include the blockage `title`. Add `async function followup({ title, details, thread, similar, turn })` mirroring `unblock`: build a user prompt from the thread + knowledge base, call `getClient()`, fall back on no client / empty / error. Export `followup` and a constant `AI_FOLLOWUP_MAX = 2`.
- [ ] Write `server/test/ai_followup.test.js` (failing). `delete process.env.ANTHROPIC_API_KEY`. Import `{ startServer, buildOrg }`. Boot with `AI_AUTORESPOND="1"`. Build an org, student reports a blockage, poll the detail until the first AI comment lands (background `unblock`). Student posts a comment. Call `POST /api/blockages/:id/ai-followup`. Assert 200 `{ posted:true }` and that detail now has 2 AI comments, the second containing the fallback text. Then call ai-followup again twice; assert the count never exceeds 3 AI comments and a later call returns `{ posted:false }` once `ai_followup_count` hits `AI_FOLLOWUP_MAX`.
- [ ] Run `npm test`; expect FAIL (route + column missing).
- [ ] In `server/db.js`: add `addColumn(db, "blockages", "ai_followup_count", "INTEGER NOT NULL DEFAULT 0")` inside `migrate()` (using the existence-checked helper). Implement the helper.
- [ ] In `server/routes/blockages.js`: add `async function aiFollowup(blockageId)` (loads row, builds thread + `similarResolved`, calls `ai.followup`, inserts AI comment, increments `ai_followup_count`, `addEvent` type `ai_reply`, `notify` student); guard on the conditions above. Add the `POST /api/blockages/:id/ai-followup` route. In the existing `/comments` route, after `res.status(201)`, add the student-comment auto-fire `setImmediate`.
- [ ] Run `npm test`; expect PASS.
- [ ] Add a second test case to the same file: explicit ai-followup on a **resolved** blockage returns `{ posted:false }`; cross-tenant student (build a second org) hitting another org's blockage id → 404. Run; PASS.
- [ ] Front-end: in `functions/blockage.js`, when `role === "student"`, `blk.status !== "resolved"`, and the thread already contains an AI comment, render an "✦ Ask AI again" button under the composer that POSTs ai-followup then re-`load()`s (and re-uses the existing background-poll loop to surface the reply). Disable it while pending; toast on error. Add minimal styling in `dashboard.css`.
- [ ] Run `npm test`; expect PASS. Commit.

---

## Task 2: AI triage on report

**Goal:** Every newly reported blockage is auto-triaged — inferred difficulty, 1–3 topic tags, and an urgency level — stored on the blockage, surfaced in the detail UI, and rolled up in analytics. Deterministic fallback derives all three from keyword heuristics over title/details/brief so it works offline.

**Files:** `server/lib/ai.js`, `server/db.js`, `server/routes/blockages.js`, `server/routes/analytics.js`, `server/test/ai_triage.test.js`, `functions/blockage.js`, `functions/owner.js`, `dashboard.css`.

**Interfaces:**
- `ai.triage({ title, details, brief }) -> Promise<{ difficulty, topics, urgency }>` — `difficulty ∈ {low,medium,high,blocker}`, `topics` is a `string[]` (1–3 lowercase keywords), `urgency ∈ {low,normal,high}`. Always returns a valid object (validates/clamps the API result; fully deterministic fallback otherwise). Never throws.
- DB: `blockages.ai_difficulty TEXT`, `blockages.ai_topics TEXT` (JSON array string), `blockages.ai_urgency TEXT`.
- On `POST /api/blockages`: triage runs **synchronously enough to store before responding** is not required — keep the response fast. Run triage in the same background `setImmediate` block as the first AI response (compute triage first, persist columns, then `unblock`). Gate with `AI_AUTORESPOND` so tests can control it; when gated off, columns stay null (acceptable).
- Blockage `summary()`/detail JSON gains `aiDifficulty`, `aiTopics` (parsed array), `aiUrgency`.
- `/analytics` response gains `byTopic` (`[{ topic, count }]`, top ~8 by frequency over the scope) and `byUrgency` (`{ low, normal, high }`).

**Steps:**
- [ ] In `server/lib/ai.js`: add `fallbackTriage({ title, details, brief })` — deterministic: difficulty from signal words (`error/crash/blocked/can't` → higher; length of details bumps it), topics = top non-stopword keywords reused from `retrieval.tokenize` (import it) limited to 3, urgency `high` when blocker/`urgent`/`deadline` words present else `normal`, `low` for trivially short reports. Add `async function triage(...)` that, with a client, asks Claude to return strict JSON (`max_tokens` ~200, no thinking params), parses + validates against the enums, and falls back on any parse/validation/error. Export `triage`.
- [ ] Write `server/test/ai_triage.test.js` (failing). `delete process.env.ANTHROPIC_API_KEY`. Boot with `AI_AUTORESPOND="1"`. Report a blockage whose details contain an obvious "blocker / error / deadline" phrasing; poll detail until `aiDifficulty` is non-null. Assert `aiUrgency === "high"`, `aiDifficulty` is one of the enums, `aiTopics` is a non-empty array of strings. Then GET `/api/analytics` as owner and assert `byUrgency.high >= 1` and `byTopic` contains at least one entry.
- [ ] Run `npm test`; expect FAIL.
- [ ] `server/db.js`: add the three columns via `addColumn`.
- [ ] `server/routes/blockages.js`: in the report handler's background block, call `ai.triage(...)`, persist `ai_difficulty/ai_topics(JSON.stringify)/ai_urgency`, then run `unblock`. Extend `summary()` and the detail JSON to expose parsed `aiTopics` + `aiDifficulty` + `aiUrgency` (parse JSON defensively; `[]` on bad data).
- [ ] `server/routes/analytics.js`: select the new columns into `all`, compute `byTopic` (flatten JSON arrays, count, sort desc, slice 8) and `byUrgency`. Add both to the response.
- [ ] Run `npm test`; expect PASS.
- [ ] Front-end: `functions/blockage.js` — render AI topic tags + an urgency dot in the detail meta panel (only when present), distinct from the existing student-set `difficulty` badge (label it "AI triage"). `functions/owner.js` — add a small "Top topics" bar list (reuse `bars`) and an urgency mini-breakdown to the dashboard. Style tags/dot in `dashboard.css` with Signal tokens (coral = blocker/high, amber = medium/normal, muted = low).
- [ ] Run `npm test`; expect PASS. Commit.

---

## Task 3: Instructor thread summary

**Goal:** A staff member opening a long thread gets a 5-second AI catch-up — the gist, what's been tried, and the recommended next step — on demand, without polluting the thread.

**Files:** `server/lib/ai.js`, `server/routes/blockages.js`, `server/test/ai_summary.test.js`, `functions/blockage.js`, `dashboard.css`.

**Interfaces:**
- `ai.summarize({ title, details, thread }) -> Promise<string>` — `thread` is `[{ author, author_role, body }]`. Returns a short plain-text summary (≤80 words), never throws. Fallback: a deterministic template — "N messages. Student reported: <title>. Latest from <lastAuthor>: <first ~140 chars of last message>. Suggested next step: <heuristic>." where the heuristic keys off whether the last message is from the student (→ "reply or claim") vs. staff (→ "await student").
- `GET /api/blockages/:id/summary` (requireStaff, `canSeeBlockage` else 404) → 200 `{ summary: string }`. Read-only: writes no comment, no event, no notification.

**Steps:**
- [ ] In `server/lib/ai.js`: add `fallbackSummarize({ title, details, thread })` and `async function summarize(...)` (client path: system "You summarize a support thread for a busy instructor", `max_tokens` ~250; fall back on empty/error). Export `summarize`.
- [ ] Write `server/test/ai_summary.test.js` (failing). `delete process.env.ANTHROPIC_API_KEY`. Build org; student reports + comments a couple of times; instructor (the cohort's instructor from `buildOrg`) GETs `/summary`. Assert 200 and the fallback summary string mentions the message count and the blockage title. Assert the **student** GETting `/summary` → 403/404 (requireStaff). Assert a second-org instructor → 404 (tenant isolation). Assert the thread still has the same comment count (summary wrote nothing).
- [ ] Run `npm test`; expect FAIL.
- [ ] `server/routes/blockages.js`: add `GET /api/blockages/:id/summary` (`requireStaff`), load row, `canSeeBlockage` else 404, build the thread (reuse the `/suggest` thread query), call `ai.summarize`, return `{ summary }`.
- [ ] Run `npm test`; expect PASS.
- [ ] Front-end: in `functions/blockage.js`, for staff add a "✦ Summarize thread" button near the Conversation panel header; on click GET `/summary`, render the result in a dismissible card above the thread (with an AI badge), disable while pending, toast on error. Style the summary card in `dashboard.css`.
- [ ] Run `npm test`; expect PASS. Commit.

---

## Task 4: Owner weekly digest

**Goal:** The owner dashboard answers "what did your cohort struggle with this week?" — cluster the org's recently-resolved blockages into top themes (by keyword overlap, reusing retrieval), attach an AI-written summary paragraph, and make it emailable (degrading gracefully because Phase 2 email is not yet built).

**Files:** `server/lib/retrieval.js`, `server/lib/ai.js`, `server/routes/analytics.js`, `server/test/ai_digest.test.js`, `functions/owner.js`, `dashboard.css`.

**Interfaces:**
- `retrieval.clusterResolved(db, { orgId, sinceDays = 7, maxThemes = 4 }) -> [{ theme, count, blockageIds, sampleTitles }]` — groups resolved blockages (resolved within `sinceDays`, `org_id` scoped) by greedy keyword-overlap clustering over `tokenize(title + " " + details)`; `theme` is the top shared keyword(s) of the cluster. Deterministic; no AI.
- `ai.digestSummary({ orgName, periodDays, clusters, totals }) -> Promise<string>` — one short paragraph (≤100 words) naming the top themes. Fallback: deterministic template — "This week (<periodDays>d) <orgName> resolved <N> blockages. The biggest themes were <theme1> (<c1>), <theme2> (<c2>)... Keep an eye on <theme1>." Never throws.
- `GET /api/analytics/digest` (requireAuth + requireStaff, owner scope; instructor scoped to assigned cohorts) → 200 `{ periodDays, resolvedCount, themes:[{theme,count,sampleTitles}], summary, emailable:boolean, emailSent:boolean }`. `emailable` is `false` while no email transport exists (no `lib/email.js`); when Phase 2 lands, set `emailable` true and accept `?email=1` to send. For now `?email=1` returns `emailable:false, emailSent:false` (no error) — graceful degradation.

**Steps:**
- [ ] In `server/lib/retrieval.js`: add `clusterResolved(db, { orgId, sinceDays, maxThemes })`. Query resolved blockages with `resolved_at >= datetime('now', '-N days')` scoped by `org_id`. Greedy cluster: tokenize each, seed clusters by most-frequent token, assign each blockage to the cluster whose seed token it contains (fallback "other"); produce `theme`, `count`, `blockageIds`, `sampleTitles` (up to 3). Export it.
- [ ] In `server/lib/ai.js`: add `fallbackDigest(...)` + `async function digestSummary(...)`; export `digestSummary`.
- [ ] Write `server/test/ai_digest.test.js` (failing). `delete process.env.ANTHROPIC_API_KEY`. Build org. Have the student report several blockages with overlapping keywords (e.g. three about "async promise await", two about "css flexbox layout"); instructor resolves them (`/resolve` with type+note). Owner GETs `/api/analytics/digest`. Assert 200, `resolvedCount === 5`, `themes` length ≥ 1 with counts summing to the resolved set, `summary` is a non-empty string mentioning a theme, `emailable === false`. Then GET `/api/analytics/digest?email=1` and assert `emailSent === false` (no throw). Assert a **student** → 403/404, and a second-org owner sees `resolvedCount === 0` (isolation).
- [ ] Run `npm test`; expect FAIL.
- [ ] `server/routes/analytics.js`: add `GET /analytics/digest`. Scope cohorts for instructors (reuse the existing `cohortFilter` pattern). Build `clusters` via `retrieval.clusterResolved`, totals over the period, `summary` via `ai.digestSummary`. Set `emailable=false`, `emailSent=false` (with a `// TODO: Phase 2 email` note describing the future `?email=1` path).
- [ ] Run `npm test`; expect PASS.
- [ ] Front-end: in `functions/owner.js`, add a "This week" digest panel near the top — render `summary` (escaped) and the theme bars (reuse `bars` on `themes` mapped to `{label:theme, count}`), with sample titles linking to `blockage.html?id=`. Add an "Email me this" button that is disabled with a "Email coming in Phase 2" tooltip while `!emailable`. Style the digest panel in `dashboard.css`.
- [ ] Run `npm test`; expect PASS. Commit.

---

## Task 5: Live Claude key (verify + document the real path)

**Goal:** Prove the real Claude API path is correctly wired (model from `AI_MODEL`, key from `ANTHROPIC_API_KEY`, no Haiku-incompatible params) and that the app degrades to the deterministic fallback when the key is absent or the API errors. Document how to flip it on. No real key is used in tests.

**Files:** `server/lib/ai.js`, `server/test/ai_live.test.js`, `docs/LIVE-AI.md` (NEW), `README.md`.

**Interfaces:**
- Confirm `ai.aiConfigured()` reflects `!!process.env.ANTHROPIC_API_KEY`, and that `getClient()` returns `null` without a key. Confirm `MODEL` defaults to `claude-haiku-4-5` and honors `AI_MODEL`. Ensure no `thinking`/`effort`/reasoning params are passed on any `messages.create` call (Haiku-incompatible).
- Each AI function must remain total: catch API errors and return the fallback. (Spot-check this is already true for `unblock`/`draftReply`; ensure the new `followup`/`triage`/`summarize`/`digestSummary` do the same.)

**Steps:**
- [ ] Write `server/test/ai_live.test.js` (failing if anything regressed). Require `../lib/ai` directly (unit-style, no server needed for the config asserts). Case A: `delete process.env.ANTHROPIC_API_KEY`; assert `ai.aiConfigured() === false`; assert each of `unblock/followup/triage/summarize/digestSummary` resolves to its deterministic fallback shape (string, or for triage the validated object) — i.e. the offline path is total. Case B: set `process.env.AI_MODEL = "claude-test-xyz"`, re-require the module fresh (`delete require.cache[require.resolve("../lib/ai")]`) and assert `ai.MODEL === "claude-test-xyz"`; restore. Case C (no network): with no key set, assert `triage(...)` returns an object whose `difficulty`/`urgency` are within the allowed enums for adversarial input (empty strings, very long details) — proving validation/clamping.
- [ ] Run `npm test`; expect FAIL (or PASS for any already-correct assertions — add asserts until at least one meaningfully fails, then make it pass).
- [ ] In `server/lib/ai.js`: ensure every `messages.create` passes only `model/max_tokens/system/messages` (audit `followup/triage/summarize/digestSummary`); no thinking params. Confirm `aiConfigured`/`MODEL`/`getClient` behave as asserted.
- [ ] Run `npm test`; expect PASS.
- [ ] Write `docs/LIVE-AI.md`: how to enable — `export ANTHROPIC_API_KEY=sk-...`, optional `AI_MODEL`, `AI_AUTORESPOND=1` (default on outside tests), then `npm start`; report a blockage and watch the AI reply; the manual smoke check to confirm a real call (e.g. set the key, start the server, report a blockage, observe a non-templated reply). Note that absent/invalid key silently falls back. Update `README.md` with one paragraph pointing at `docs/LIVE-AI.md` and the three env vars.
- [ ] Run `npm test`; expect PASS. Commit.

---

## Self-review checklist

- [ ] `npm test` is green; every new test asserts against the **deterministic fallback** with `ANTHROPIC_API_KEY` deleted, and passes whether or not a key exists in the dev shell.
- [ ] No test sends a real API call; `AI_AUTORESPOND` is set per-test before `startServer()`; background AI is awaited via bounded polling, not fixed sleeps.
- [ ] New AI functions (`followup`, `triage`, `summarize`, `digestSummary`) never throw — each catches API errors and returns the fallback; `triage` validates/clamps to the enums.
- [ ] `migrate()` is idempotent: `addColumn` checks `PRAGMA table_info` before `ALTER TABLE`; re-running against an existing `data.db` adds nothing twice and loses no data.
- [ ] Every new query filters by `org_id`; cross-tenant access on each new endpoint (`ai-followup`, `summary`, `digest`) returns 404 (or 403 for role), proven by a second-org test case.
- [ ] Role guards correct: `ai-followup` = student-owner-only; `summary` + `digest` = `requireStaff`; auto-followup only fires for student comments and respects `AI_FOLLOWUP_MAX`.
- [ ] The follow-up cap (`AI_FOLLOWUP_MAX`) makes an infinite AI loop impossible; a resolved blockage never gets a follow-up.
- [ ] No Haiku-incompatible params (no `thinking`/`effort`) on any `messages.create`; `MODEL` honors `AI_MODEL` and defaults to `claude-haiku-4-5`.
- [ ] Owner digest degrades gracefully with no email transport (`emailable:false`, `?email=1` returns `emailSent:false` without error) and has a clear Phase 2 TODO for the real send path.
- [ ] Front-end: all AI/user values rendered through `escapeHtml`; new UI uses `renderShell` + shared helpers + Signal tokens; new buttons disable while pending and toast on error.
- [ ] Commits are bite-sized (one per task), and each commit message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
