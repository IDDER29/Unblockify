# Phase 2: Reach & Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Each task is TDD: write the failing test, run it and watch it fail, write the *minimal real* code, run it and watch it pass, then commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Unblockify promise *outside the open tab* — people come back and can recover their accounts. Ship (1) **transactional email**, local-first (every message written to `server/outbox/` by default; a real provider only when `SMTP_URL`/`RESEND_API_KEY`/HTTP-email env is set) wired to **password reset**, optional **email verification**, **invite emails**, and a **notification digest**; and (2) **real-time updates via SSE** — a `GET /api/stream` per-user EventSource feed driven by an in-memory per-process pub/sub, with a client `subscribe()` that live-updates the notification bell and re-renders the open thread / board / queue, with reconnect handling.

**Architecture:** One Express app serves the vanilla-JS front-end and a JSON API. SQLite (`node:sqlite`) holds every tenant's data in one DB, isolated by `org_id` on every row. Auth is bcrypt + a JWT httpOnly cookie carrying `{ userId, orgId, role }`. Phase 2 adds two cross-cutting libraries that follow the existing **AI pattern** (a deterministic local-first default that always works offline, upgraded to a real provider only when an env var is present): `server/lib/email.js` (transport abstraction → outbox files by default) and `server/lib/bus.js` (an in-process `EventEmitter` pub/sub). Email is wired into the auth/members/notifications routes plus two new DB tables (`password_resets`, plus `email_verified`/`verify_token` columns on `users`). SSE is a single long-lived `GET /api/stream` route that subscribes a cookie-authenticated client to its own per-user channel on the bus; the existing `notify()` helper publishes to the bus so every current notification call-site lights up live with zero call-site edits. The front-end keeps its shared `functions/api.js` runtime; `subscribe()` wraps the browser `EventSource` with auto-reconnect and named-event dispatch, and `renderShell` opens one stream per page to live-update the bell.

**Tech Stack:** Node 22+ (`node:sqlite`, `node:test`, `node:nodemailer`-free — SMTP via a tiny pure-JS `net`/`tls` client only if `SMTP_URL` is set; HTTP email via built-in `fetch`), Express, bcryptjs, jsonwebtoken, cookie-parser; vanilla HTML/CSS/JS with the browser `EventSource` API; "Signal" design tokens. No new npm dependencies, no native build, no external broker.

## Global Constraints
- Runs entirely LOCAL; no cloud. Node ≥22 built-in node:sqlite (--experimental-sqlite); pure-JS deps only.
- External features follow the AI pattern: local-first default (email → outbox files) that works offline; real provider only when an env var is set.
- Backend: Express; factories `(db)=>router` mounted in server/index.js under /api; JWT httpOnly cookie {userId,orgId,role}; requireAuth/requireRole/requireStaff.
- Multi-tenant: every row org_id; every query filters by caller org; cross-tenant → 404. New tables via migrate() in server/db.js.
- Front-end: vanilla HTML/CSS/JS; renderShell + shared helpers; ALWAYS escapeHtml; "Signal" tokens.
- Tests: node:test, in-memory DB via test/helpers.js (buildOrg/joinMember); npm test auto-discovers; gate AI with AI_AUTORESPOND.
- Commit messages end with: Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## File Structure

```
server/
  lib/
    email.js            # NEW  transport abstraction; outbox-file default; SMTP/HTTP provider when env set
    bus.js              # NEW  in-process per-user pub/sub (EventEmitter); publish()/subscribe()
    helpers.js          # MOD  notify() also publishes a 'notification' event on the bus
  routes/
    auth.js             # MOD  POST /forgot, POST /reset; verify-email on signup/join; GET /verify, POST /resend-verify
    members.js          # MOD  invite create also emails the join link when an email is supplied
    notifications.js    # MOD  POST /notifications/digest (email a user's unread notifications)
    stream.js           # NEW  GET /api/stream  (SSE; cookie auth; subscribes caller to its bus channel)
  db.js                 # MOD  migrate(): password_resets table; users.email_verified + users.verify_token
  index.js              # MOD  mount streamRoutes(db); pass the shared bus where needed
  outbox/               # NEW  (gitignored) one JSON file per sent email when using the default transport
  test/
    email.test.js       # NEW  outbox-file assertions for the default transport
    auth_reset.test.js  # NEW  forgot/reset lifecycle + token expiry/single-use + tenant isolation
    verify.test.js      # NEW  signup/join sets verify token; GET /verify flips email_verified
    invite_email.test.js# NEW  invite-with-email writes a join-link email to the outbox
    digest.test.js      # NEW  digest endpoint batches unread notifications into one email
    stream.test.js      # NEW  open the SSE stream, trigger a notify, assert the event arrives
functions/
  api.js                # MOD  subscribe(handlers) EventSource wrapper + reconnect; shell opens a bell stream
  notifications.js      # MOD  live-prepend new notifications via subscribe()
  blockage.js           # MOD  live-append comments / status changes on the open thread
  dashbord.js           # MOD  student board re-renders on board-change events
  instructor.js         # MOD  instructor queue re-renders on queue-change events
forgot.html             # NEW  request a reset link (email field)
forgot.js               # NEW  POST /api/auth/forgot
reset.html              # NEW  set a new password from a token in the URL
reset.js                # NEW  POST /api/auth/reset
verify.html             # NEW  landing page for the email-verification link
verify.js               # NEW  GET /api/auth/verify?token=…
.gitignore              # MOD  add server/outbox/
docs/
  EXPECTATIONS-AND-ROADMAP.md  # MOD  flip Phase 2 gaps to ✅ when done (final task)
```

---

## Task 1: Email transport library (local-first outbox)

**Files:** Create `server/lib/email.js`; create dir `server/outbox/` (with a `.gitkeep`); create `server/test/email.test.js`; modify `.gitignore`.

**Interfaces (exact names + types):**
- `sendEmail({ to: string, subject: string, text: string, html?: string }) -> Promise<{ transport: "outbox"|"smtp"|"http", id: string }>` — picks the transport from env; never throws on the default path; returns the message id (the outbox filename stem, or the provider id).
- `outboxDir() -> string` — absolute path of the outbox dir (honors `EMAIL_OUTBOX_DIR`, default `server/outbox`).
- `currentTransport() -> "outbox"|"smtp"|"http"` — `"smtp"` if `SMTP_URL` set, `"http"` if `RESEND_API_KEY` set, else `"outbox"`.
- `_writeOutbox(msg) -> Promise<{ transport: "outbox", id: string }>` — internal; writes `outboxDir()/<ISO-timestamp>-<rand>.json` containing `{ to, subject, text, html, sentAt }`.

**TDD steps:**
- [ ] Write `server/test/email.test.js`: `const { sendEmail, outboxDir } = require("../lib/email")`; set `process.env.EMAIL_OUTBOX_DIR` to an `fs.mkdtempSync` temp dir; `await sendEmail({ to:"a@x.com", subject:"Hi", text:"body" })`; assert exactly one `.json` file exists in `outboxDir()` and that `JSON.parse` of it has `to === "a@x.com"` and `subject === "Hi"`. Add a second test: with no provider env, `currentTransport()` returns `"outbox"`.
- [ ] Run `npm test`; expect FAIL (module missing).
- [ ] Write `server/lib/email.js`: implement `outboxDir`/`currentTransport`/`_writeOutbox` with `node:fs/promises` + `node:crypto.randomBytes`; `sendEmail` dispatches on `currentTransport()` — default writes a file via `_writeOutbox` (create the dir with `mkdir({recursive:true})`). Leave `smtp`/`http` branches as small real functions (`_sendSmtp`, `_sendHttp`) that are only reached when the env var is set (covered in Task 7).
- [ ] Run `npm test`; expect PASS.
- [ ] Add `server/outbox/` to `.gitignore`; `git add server/outbox/.gitkeep server/lib/email.js server/test/email.test.js .gitignore`; commit.

---

## Task 2: `password_resets` table + verify columns (migration)

**Files:** Modify `server/db.js`; create `server/test/auth_reset.test.js` (schema portion only here — endpoints land in Task 3).

**Interfaces (exact names + types):**
- New table `password_resets( id INTEGER PK, org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')) )` plus `CREATE INDEX idx_pwreset_token ON password_resets(token)`.
- New columns on `users`: `email_verified INTEGER NOT NULL DEFAULT 0`, `verify_token TEXT`. Add via idempotent `ALTER TABLE … ADD COLUMN` guarded by a `PRAGMA table_info(users)` check inside `migrate()` so it is safe on existing `data.db`.

**TDD steps:**
- [ ] Write a schema test in `server/test/auth_reset.test.js`: `const db = openDb(":memory:")`; insert an org+user; `db.prepare("INSERT INTO password_resets (org_id,user_id,token,expires_at) VALUES (?,?,?,?)").run(...)` succeeds; a duplicate `token` throws (UNIQUE). Assert `PRAGMA table_info(users)` includes `email_verified` and `verify_token`.
- [ ] Run `npm test`; expect FAIL.
- [ ] In `db.js` `migrate()`, add the `CREATE TABLE IF NOT EXISTS password_resets` + index to the `exec` block, and add a small `addColumnIfMissing(db, "users", "email_verified", "INTEGER NOT NULL DEFAULT 0")` / `verify_token TEXT` helper run after the main `exec`.
- [ ] Run `npm test`; expect PASS.
- [ ] Commit.

---

## Task 3: Password reset endpoints (`/forgot`, `/reset`)

**Files:** Modify `server/routes/auth.js`; extend `server/test/auth_reset.test.js`.

**Interfaces (exact names + types):**
- `POST /api/auth/forgot { email: string } -> 200 { ok: true }` — ALWAYS returns `{ ok: true }` (never reveals whether the email exists). When a user matches: create a `password_resets` row with `token = randomCode()` (reuse `lib/helpers.randomCode`), `expires_at = datetime('now','+1 hour')`, and `await sendEmail(...)` with a `reset.html?token=<token>` link. Rate-limited by the existing `authLimiter`.
- `POST /api/auth/reset { token: string, password: string } -> 200 { ok: true }` — looks up an unused, unexpired reset (`used = 0 AND expires_at > datetime('now')`); on miss → `400 { error: "This reset link is invalid or has expired." }`; on hit → `bcrypt.hashSync(password, 10)`, update `users.password_hash`, set `used = 1`, and (for convenience) `clearToken(res)` so stale sessions don't linger. Enforces `password.length >= 6`.

**TDD steps:**
- [ ] Extend `auth_reset.test.js` (uses `startServer`, `buildOrg`, `makeClient`): point `EMAIL_OUTBOX_DIR` at a temp dir. (a) `POST /forgot` for a nonexistent email → 200 `{ok:true}` and **no** outbox file. (b) `POST /forgot` for the org owner's email → 200 and exactly one outbox file whose `text` contains `reset.html?token=`; read the token back from the DB; `POST /reset {token, password:"newpass1"}` → 200; then `POST /api/auth/login` with the new password → 200, old password → 401. (c) reusing the same token → 400. (d) a token row with `expires_at` in the past → 400.
- [ ] Run `npm test`; expect FAIL.
- [ ] Implement both routes in `routes/auth.js` (require `sendEmail` from `../lib/email`, `randomCode` already imported via helpers). Build the reset URL from `req.headers.origin || ("http://localhost:" + (process.env.PORT||5050))`.
- [ ] Run `npm test`; expect PASS.
- [ ] Commit.

---

## Task 4: Reset & forgot front-end pages

**Files:** Create `forgot.html`, `forgot.js`, `reset.html`, `reset.js`; modify `login.html` (add a "Forgot password?" link — locate the password field via the existing `#password` input).

**Interfaces (exact names + types):**
- `forgot.js`: on submit, `await API.post("/api/auth/forgot", { email })`; always show the same success state ("If that email exists, a reset link is on its way.") regardless of response; no role redirect.
- `reset.js`: read `token` from `new URLSearchParams(location.search)`; on submit `await API.post("/api/auth/reset", { token, password })`; on success → `toast` + redirect to `login.html`; on error → inline message via the same `showError` pattern as `login.js`.

**TDD steps:**
- [ ] Build `forgot.html`/`reset.html` mirroring `login.html`'s auth-card markup and the "Signal" tokens (load `functions/api.js` first, inline pulse `#mark`, JetBrains-mono eyebrow). Use `escapeHtml` for any echoed values. These are static; verification is the manual/Playwright flow below (no node:test).
- [ ] Add the "Forgot password?" link in `login.html` pointing to `forgot.html`.
- [ ] Manual/Playwright check against a running server: signup → log out → `forgot.html` (enter email) → open the newest file in `server/outbox/` → copy the `reset.html?token=…` link → set a new password → log in with it. Screenshot both pages.
- [ ] Commit.

---

## Task 5: Email verification (optional, env-gated soft gate)

**Files:** Modify `server/routes/auth.js`; create `verify.html`, `verify.js`; create `server/test/verify.test.js`.

**Interfaces (exact names + types):**
- On `signup` and `join`: set `verify_token = randomCode()`, `email_verified = 0`, and `await sendEmail(...)` with a `verify.html?token=<token>` link. Verification is a **soft gate** — login still works; the UI nudges. (Hard gate is out of scope for Phase 2.)
- `GET /api/auth/verify?token=string -> 200 { ok: true, email: string }` on a matching token (sets `email_verified = 1`, clears `verify_token`); unknown token → `400 { error: "This verification link is invalid." }`.
- `POST /api/auth/resend-verify -> 200 { ok: true }` (requireAuth) — regenerates the token and re-emails it for the current user; no-op `{ ok: true }` if already verified.
- `publicUser(u)` (in `lib/helpers.js`) gains `emailVerified: !!u.email_verified` so the front-end can show the nudge.

**TDD steps:**
- [ ] Write `verify.test.js`: signup with `EMAIL_OUTBOX_DIR` set → exactly one outbox file containing `verify.html?token=`; read the token from the DB; `GET /api/auth/verify?token=<token>` → 200 and `users.email_verified` is now 1; a bogus token → 400. Also assert `GET /api/auth/me` returns `user.emailVerified === true` after verifying.
- [ ] Run `npm test`; expect FAIL.
- [ ] Implement: add the token+email to `signup`/`join`, add `GET /verify` and `POST /resend-verify`, extend `publicUser`. Send the verify email after the response is issued (synchronously building the message, but do not block the cookie issue on the file write failing — wrap in `.catch(()=>{})`).
- [ ] Run `npm test`; expect PASS.
- [ ] Build `verify.html`/`verify.js`: on load, take `token` from the query, call `GET /api/auth/verify`, show success/failure. Commit.

---

## Task 6: Invite emails (email the join link)

**Files:** Modify `server/routes/members.js`; create `server/test/invite_email.test.js`.

**Interfaces (exact names + types):**
- `POST /api/invites { role, cohortId?, email? } -> 201 { invite: {...}, emailed: boolean }` — unchanged behavior plus: when `email` is a valid address, `await sendEmail({ to: email, subject: "You're invited to <org> on Unblockify", text: <join.html?code=…> })` and return `emailed: true`; otherwise `emailed: false`. Email send failures degrade gracefully (still 201, `emailed:false`).

**TDD steps:**
- [ ] Write `invite_email.test.js`: `buildOrg`, set `EMAIL_OUTBOX_DIR`; owner `POST /api/invites { role:"student", email:"newstu@x.com" }` → 201 `emailed:true` and one outbox file whose `text` contains `join.html?code=` and the invite's `code`. A second call **without** `email` → 201 `emailed:false` and no new outbox file.
- [ ] Run `npm test`; expect FAIL.
- [ ] Implement in `members.js` (require `sendEmail`, reuse the `EMAIL_RE` validation pattern from `auth.js`, build the URL the same way as Task 3).
- [ ] Run `npm test`; expect PASS.
- [ ] Commit.

---

## Task 7: Real provider transports (SMTP + HTTP) — env-gated

**Files:** Modify `server/lib/email.js`; extend `server/test/email.test.js`.

**Interfaces (exact names + types):**
- `_sendHttp(msg) -> Promise<{ transport:"http", id:string }>` — when `RESEND_API_KEY` is set, `fetch("https://api.resend.com/emails", { method:"POST", headers:{ Authorization:"Bearer "+key, "content-type":"application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM||"Unblockify <onboarding@resend.dev>", to:[msg.to], subject:msg.subject, text:msg.text, html:msg.html }) })`; returns the provider id from the JSON.
- `_sendSmtp(msg) -> Promise<{ transport:"smtp", id:string }>` — when `SMTP_URL` is set, a minimal pure-JS SMTP client over `node:net`/`node:tls` (EHLO → AUTH LOGIN if creds in the URL → MAIL FROM → RCPT TO → DATA). Keep it small; this path is opt-in and not exercised by default tests.
- `sendEmail` already dispatches via `currentTransport()`; this task fills the two non-default branches and makes a provider failure **fall back to the outbox** (so the app never loses a message offline).

**TDD steps:**
- [ ] Extend `email.test.js`: with a stubbed `fetch` (set `globalThis.fetch` to a fake returning `{ id:"http_123" }`) and `RESEND_API_KEY="test"`, `currentTransport()` is `"http"` and `sendEmail(...)` resolves `{ transport:"http", id:"http_123" }`; restore `fetch` after. (SMTP path: assert `currentTransport()==="smtp"` when only `SMTP_URL` is set — no live socket in tests.)
- [ ] Run `npm test`; expect FAIL.
- [ ] Implement `_sendHttp` and the `_sendSmtp` skeleton + the outbox fallback-on-error in `sendEmail`.
- [ ] Run `npm test`; expect PASS.
- [ ] Commit.

---

## Task 8: Notification email digest

**Files:** Modify `server/routes/notifications.js`; create `server/test/digest.test.js`.

**Interfaces (exact names + types):**
- `POST /api/notifications/digest -> 200 { ok: true, count: number, emailed: boolean }` (requireAuth) — gathers the caller's unread notifications (`read = 0`, newest first, cap 50), and if `count > 0` sends ONE email batching them (`subject: "<n> updates on Unblockify"`, `text` = a bulleted list of `body` + relative time). `count === 0` → `{ ok:true, count:0, emailed:false }` and no email. Does **not** mark them read (digest is a reminder, not a clear).

**TDD steps:**
- [ ] Write `digest.test.js` (`buildOrg`, `EMAIL_OUTBOX_DIR` set, gate `AI_AUTORESPOND=0`): have the student report a blockage so the instructor gets a notification; instructor `POST /api/notifications/digest` → 200 `count>=1, emailed:true` and one outbox file whose `text` contains the notification body. A user with no unread → `count:0, emailed:false`, no new file.
- [ ] Run `npm test`; expect FAIL.
- [ ] Implement the route (require `sendEmail`, reuse `fmtRelative`-style server-side formatting inline or a tiny local helper).
- [ ] Run `npm test`; expect PASS.
- [ ] Commit.

---

## Task 9: In-process pub/sub bus

**Files:** Create `server/lib/bus.js`; modify `server/lib/helpers.js` (`notify` publishes); create `server/test/stream.test.js` (bus-unit portion only here).

**Interfaces (exact names + types):**
- `bus` — a module-level singleton `EventEmitter` (one per process; SSE is in-memory by design).
- `publish(userId: number, event: string, data: object) -> void` — emits on channel `"u:"+userId` a payload `{ event, data }`.
- `subscribe(userId: number, listener: (payload:{event:string,data:object}) => void) -> () => void` — registers the listener on `"u:"+userId` and returns an unsubscribe function (`bus.off`). Raises the per-channel max-listener cap to avoid warnings.
- `notify(db, { orgId, userId, type, blockageId, body })` in `helpers.js` keeps its DB insert AND calls `publish(userId, "notification", { type, blockageId, body, orgId })` so every existing notify call-site (report, claim, resolve, comment, reopen, ai_reply) streams live with no call-site changes.

**TDD steps:**
- [ ] In `stream.test.js`, add a pure bus unit test: `const { publish, subscribe } = require("../lib/bus")`; subscribe a listener for user 7; `publish(7, "ping", { x:1 })`; assert the listener received `{ event:"ping", data:{ x:1 } }`; call the returned unsubscribe; publish again; assert it is NOT received.
- [ ] Run `npm test`; expect FAIL.
- [ ] Implement `bus.js`; wire `publish` into `helpers.notify` (import is intra-`lib`, no cycle: `bus.js` requires nothing from `helpers.js`).
- [ ] Run `npm test`; expect PASS.
- [ ] Commit.

---

## Task 10: SSE stream endpoint (`GET /api/stream`)

**Files:** Create `server/routes/stream.js`; modify `server/index.js` (mount it under `/api`); extend `server/test/stream.test.js`.

**Interfaces (exact names + types):**
- `streamRoutes(db) -> Router` — factory like the others. `GET /api/stream` is `requireAuth`-guarded (cookie auth works because the browser sends the httpOnly cookie on the EventSource request — same-origin). Sets headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`; calls `res.flushHeaders()`.
- On connect: writes an initial `event: ready\ndata: {}\n\n`; calls `subscribe(req.user.userId, payload => write(payload))` where `write` emits `event: <payload.event>\ndata: <JSON.stringify(payload.data)>\n\n`.
- Heartbeat: `setInterval` writes a `:ping\n\n` comment every 25s to keep proxies/browsers from timing out; cleared on close.
- On `req.on("close")`: clear the interval and call the unsubscribe returned by `subscribe`. Never writes after close.

**TDD steps:**
- [ ] Extend `stream.test.js` with an end-to-end SSE test: `buildOrg` (gate `AI_AUTORESPOND=0`); using the instructor's saved cookie, open `fetch(base + "/api/stream", { headers:{ cookie } })` and read `res.body` as a stream (`for await (const chunk of res.body)`), accumulating decoded text; in parallel, have the student `POST /api/blockages` (which notifies the cohort instructor). Assert that within a short timeout the accumulated SSE text contains `event: notification` and the blockage title. Abort the fetch via an `AbortController` to end the test cleanly. (Helper: a small `readUntil(stream, predicate, timeoutMs)` inside the test file.)
- [ ] Run `npm test`; expect FAIL (route missing → 404, no `event: notification`).
- [ ] Implement `routes/stream.js`; mount `app.use("/api", streamRoutes(db))` in `index.js` **before** the `/api` 404 catch-all.
- [ ] Run `npm test`; expect PASS.
- [ ] Commit.

---

## Task 11: Client `subscribe()` + live notification bell

**Files:** Modify `functions/api.js`.

**Interfaces (exact names + types):**
- `subscribe(handlers: Record<string, (data:object)=>void>) -> { close: () => void }` — opens `new EventSource("/api/stream", { withCredentials: true })`; for each key in `handlers` registers `es.addEventListener(key, e => handlers[key](JSON.parse(e.data)))`. Reconnect: on `es.onerror`, the browser auto-reconnects; additionally guard with a backoff that re-creates the `EventSource` if it stays `CLOSED` (cap ~30s). `close()` stops reconnection and closes the stream.
- `renderShell(...)` opens ONE shared stream per page that updates the bell: on a `notification` event it shows the `.notif-dot` (no full refetch needed) and calls the existing `refreshNotifDot()` as a fallback. Stores the handle on `window.__unblockifyStream` so pages can add their own handlers without opening a second connection (a `onStreamEvent(event, fn)` registry helper).

**TDD steps:**
- [ ] (Front-end; verified via the running server + Playwright, not node:test.) Add `subscribe()` + the bell wiring + an `onStreamEvent(event, handler)` registry to `api.js`. Ensure `escapeHtml` is used for any DOM text built from event data.
- [ ] Manual/Playwright: open the owner dashboard in tab A and a student session in tab B; in B report a blockage; assert the bell dot appears in A **without reload**. Kill the server and restart it; assert the client reconnects (stream re-opens) within ~30s. Screenshot.
- [ ] Commit.

---

## Task 12: Live thread / board / queue re-render

**Files:** Modify `functions/notifications.js`, `functions/blockage.js`, `functions/dashbord.js`, `functions/instructor.js`. (If the bus needs richer events than `notification`, add `publish(userId,"comment",…)` / `publish(userId,"board",…)` at the relevant blockages-route call-sites — keep them additive to the existing `notify`.)

**Interfaces (exact names + types):**
- `notifications.js`: `onStreamEvent("notification", n => { /* prepend the new item to the list, bump unread */ })` so the page updates without polling.
- `blockage.js`: `onStreamEvent("comment", c => { if (c.blockageId === currentId) appendComment(c) })` and `onStreamEvent("notification", …)` to refresh the timeline when the open blockage changes status.
- `dashbord.js` / `instructor.js`: `onStreamEvent("board"|"notification", () => debouncedReload())` — re-fetch and re-render the board/queue when a relevant change lands (debounced to coalesce bursts).

**TDD steps:**
- [ ] (Optional backend) If new event names are introduced, add a node:test in `stream.test.js` asserting a `comment` event arrives when a comment is posted (same pattern as Task 10). Run → fail → implement the additional `publish` calls in `routes/blockages.js` → pass → commit.
- [ ] Front-end: wire `onStreamEvent` handlers in each page. Use `escapeHtml` on all event-derived DOM; debounce board/queue reloads.
- [ ] Manual/Playwright: instructor has `blockage.html` open; student posts a reply → the new comment appears live. Student has the board open; instructor resolves a blockage → the card moves to Resolved live. Screenshot each.
- [ ] Commit.

---

## Task 13: Wire-up, docs, and roadmap update

**Files:** Modify `server/index.js` (confirm `streamRoutes` mounted, outbox dir creation on boot is lazy/safe); modify `docs/EXPECTATIONS-AND-ROADMAP.md`; verify `.gitignore` covers `server/outbox/`.

**TDD steps:**
- [ ] Run the FULL suite `npm test` from `server/`; expect ALL green (email, reset, verify, invite-email, digest, bus, stream).
- [ ] Manual end-to-end against a running server with NO provider env: signup (verify email lands in outbox) → forgot/reset round-trip → invite-with-email → digest → live bell + live thread. Then set `RESEND_API_KEY` to a stub and confirm `currentTransport()` flips (no live send needed).
- [ ] In `EXPECTATIONS-AND-ROADMAP.md`, flip the Phase 2 promise-break bullets ("can't recover a forgotten password", "no notifications outside the tab / no live updates", "no email") to ✅ delivered.
- [ ] Commit.

---

## Self-review checklist

- [ ] **Local-first / offline:** With zero email/provider env vars, every email path writes a file to `server/outbox/` and the app fully works; `currentTransport()` returns `"outbox"`. A provider is used ONLY when `SMTP_URL` or `RESEND_API_KEY` is set, and a provider failure falls back to the outbox.
- [ ] **No new deps / pure-JS:** No npm packages added; SMTP uses `node:net`/`node:tls`, HTTP email uses built-in `fetch`. Runs on `node --experimental-sqlite`, Node ≥22.
- [ ] **Multi-tenant safety:** `password_resets` carries `org_id`; reset/verify lookups are by single-use token (no cross-org leakage); `/forgot` never reveals whether an email exists; the SSE bus is keyed per `userId` so a client only ever receives its own events.
- [ ] **Auth & factories:** `streamRoutes`/digest/reset/verify use `requireAuth`/`requireRole`/`requireStaff` appropriately; all routes are `(db)=>router` factories mounted under `/api` in `index.js`, before the `/api` 404 catch-all.
- [ ] **Schema migration is safe:** `password_resets` via `CREATE TABLE IF NOT EXISTS`; `users.email_verified`/`verify_token` added with a guarded `ALTER TABLE … ADD COLUMN` so existing `data.db` migrates without loss.
- [ ] **Tokens:** reset tokens expire (1h) and are single-use (`used=1`); verify tokens are cleared on use; both use `randomCode()` (url-safe, unguessable).
- [ ] **SSE robustness:** initial `ready` event, 25s heartbeat comment, interval + unsubscribe cleared on `req.on("close")`, no writes after close; client `subscribe()` reconnects with backoff (≤30s) and `close()` stops it; one stream per page (shared handle), no leaked connections.
- [ ] **Front-end conventions:** new pages load `functions/api.js` first, use `renderShell` where applicable, "Signal" tokens, inline pulse `#mark`; ALL event/echoed data rendered through `escapeHtml`.
- [ ] **Tests:** every backend task has a `node:test` that imports `{ startServer, buildOrg, joinMember, makeClient }` from `./helpers`; email tests assert files land in the outbox dir; the SSE test opens the stream and asserts a `notification` event arrives; `AI_AUTORESPOND` gated where blockages are reported.
- [ ] **TDD discipline:** each backend task = failing test → run/expect-fail → minimal real code → run/expect-pass → commit; no placeholder/stub implementations shipped.
- [ ] **Commits:** each ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- [ ] **Docs:** `EXPECTATIONS-AND-ROADMAP.md` Phase 2 bullets flipped to ✅; `server/outbox/` gitignored.
