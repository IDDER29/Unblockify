# Phase 5: Ops & Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Unblockify pass an org's security/ops review — SLA + business-hours + escalation, auto-assignment rules, an immutable audit log, GDPR export/erasure tools, structured observability, accessible modals/nav, paginated lists, and CI — all local, all tenant-scoped.

**Architecture:** Same one-process Express + `node:sqlite` app. New behavior arrives as new Express route factories `(db) => router` mounted under `/api` in `server/index.js`, new tables/columns added in `migrate()` (`server/db.js`), and reusable backend logic in `server/lib/*`. Cross-cutting concerns (request logging, error capture, audit writes) are middleware/helpers, not per-route copy-paste. Front-end changes extend `functions/api.js` (focus trap, paginated list helper, ARIA on the shell) plus a focus-styles block in `dashboard.css`; new owner-only pages follow the `renderShell` pattern. Optional integrations (error webhook) are gated behind env vars and no-op offline.

**Tech Stack:** Node 22+ (`node:sqlite` via `--experimental-sqlite`, `node:test`, `node:crypto`, `node:fs`), Express 4, bcryptjs, jsonwebtoken, cookie-parser (all already present — pure-JS, no new deps); vanilla HTML/CSS/JS front-end; GitHub Actions for CI.

## Global Constraints
- Runs entirely LOCAL; no cloud. Node ≥22 node:sqlite (--experimental-sqlite); pure-JS deps only.
- App always runs offline; optional integrations gated behind env vars.
- Backend: Express factories `(db)=>router` mounted under /api in server/index.js; JWT cookie; requireAuth/requireRole/requireStaff; existing helpers in lib/helpers.js + lib/ratelimit.js.
- Multi-tenant: every row org_id; every query filters by caller org; cross-tenant → 404; migrate() in server/db.js for new tables/columns.
- Front-end: vanilla HTML/CSS/JS; renderShell + helpers; escapeHtml; "Signal" tokens (focus styles go in dashboard.css).
- Tests: node:test, in-memory DB via test/helpers.js; npm test auto-discovers; gate AI with AI_AUTORESPOND.
- Commit messages end with: Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## File Structure

New backend modules (each focused, one responsibility):

- `server/lib/sla.js` — pure SLA math: business-hours elapsed time, breach/at-risk classification for a blockage given an org SLA config. No DB, no Express → unit-testable in isolation.
- `server/lib/audit.js` — `audit(db, {...})` writer + a constant of action names. The only thing that inserts into `audit_log`.
- `server/lib/assign.js` — `pickAssignee(db, {orgId, cohortId, strategy})` round-robin / least-loaded selection among a cohort's instructors. Pure-ish (reads DB, returns an id).
- `server/lib/logger.js` — structured request-logging middleware, central error-capture middleware, counters, and the optional error-webhook fire. Reads env; writes to a log file under `server/logs/`.
- `server/routes/ops.js` — owner-only SLA config read/write (`GET/PUT /api/sla`), audit-log viewer + export (`GET /api/audit`, `GET /api/audit/export.csv`), escalation trigger (`POST /api/sla/escalate`), health (`GET /healthz` is mounted in index.js, not here).
- `server/routes/gdpr.js` — owner-only data tools: `GET /api/export/org.json`, `GET /api/export/users/:id.json`, `DELETE /api/users/:id/data`.

Modified backend files:

- `server/db.js` — `migrate()` gains: `audit_log` table; `sla_config` table; `assign_strategy` column on `cohorts`; a `rr_cursor` column on `cohorts` (round-robin pointer); indexes.
- `server/index.js` — mount `logger` middleware first, `ops`/`gdpr` routers, `/healthz` endpoint, central error handler last; audit-log auth events by wrapping nothing (auth routes call `audit()` directly — see Task 3).
- `server/routes/blockages.js` — list endpoint gains cursor pagination; report endpoint runs auto-assign; SLA fields added to `summary()`/detail; mutating actions write audit rows.
- `server/routes/auth.js`, `server/routes/members.js` — write audit rows on login/logout/join/signup, invite create/revoke, member role/cohort change, member delete, ownership transfer, org rename.
- `server/test/helpers.js` — no change required (re-exported as-is); new tests import `{ startServer, buildOrg, joinMember, makeClient }`.

Modified front-end files:

- `functions/api.js` — add `trapFocus(el)` / `releaseFocus()` focus-trap utility; add `openModal(overlay)` / `closeModal(overlay)` that wire Esc + focus trap + ARIA; add `loadMore({path, cursor, render})` cursor pagination helper; add ARIA roles/labels to `renderShell` markup.
- `dashboard.css` — visible focus-ring styles, `.sr-only`, modal `role=dialog` styling tweaks (Task 13).
- `owner_blockages.html` / `functions/owner_blockages.js`, `student_dashbord.html` / `functions/dashbord.js`, `instructor_queue.html` / `functions/instructor.js` — "Load more" button wired to the cursor helper.
- New page `ops.html` + `functions/ops.js` — owner SLA config, audit log viewer, data tools; linked in the owner nav (`functions/api.js` `NAV.owner`).

New CI file:

- `.github/workflows/ci.yml` — `npm ci` + `npm test` + `node --check` on front-end JS, matrix Node 22 & 24.

---

## Task 1: SLA config schema + storage

**Files:**
- Modify: `server/db.js` (add `sla_config` table to `migrate()`)
- Modify: `server/routes/ops.js` (Create in this task)
- Modify: `server/index.js` (mount ops router)
- Test: `server/test/sla.test.js` (Create)

**Interfaces:**
- Consumes: `openDb`, `createApp` (via `startServer`); `requireAuth`, `requireRole` from `../auth`.
- Produces: table `sla_config(id, org_id UNIQUE, response_hours INTEGER, resolve_hours INTEGER, bh_start INTEGER, bh_end INTEGER, bh_days TEXT, tz_offset_min INTEGER, updated_at)`. Routes `GET /api/sla` → `{ sla: { responseHours, resolveHours, bhStart, bhEnd, bhDays, tzOffsetMin } }` (owner|instructor read), `PUT /api/sla {responseHours, resolveHours, bhStart, bhEnd, bhDays, tzOffsetMin}` → `{ sla }` (owner only). Defaults when no row exists: `responseHours=4, resolveHours=48, bhStart=9, bhEnd=17, bhDays="1,2,3,4,5", tzOffsetMin=0`. `bhDays` is a comma list of weekday numbers (0=Sun..6=Sat).

- [ ] **Step 1: Write the failing test**

```js
// server/test/sla.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("SLA config: default then update", async () => {
  const { base, close } = await startServer();
  try {
    const org = await buildOrg(base, "Acme", "acme");

    const def = await org.owner.get("/api/sla");
    assert.equal(def.status, 200);
    assert.equal(def.body.sla.responseHours, 4);
    assert.equal(def.body.sla.resolveHours, 48);
    assert.equal(def.body.sla.bhStart, 9);
    assert.equal(def.body.sla.bhDays, "1,2,3,4,5");

    const put = await org.owner.put("/api/sla", {
      responseHours: 2, resolveHours: 24, bhStart: 8, bhEnd: 18,
      bhDays: "1,2,3,4,5,6", tzOffsetMin: 60,
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.sla.responseHours, 2);

    const after = await org.owner.get("/api/sla");
    assert.equal(after.body.sla.resolveHours, 24);
    assert.equal(after.body.sla.bhEnd, 18);

    // student cannot edit
    const stu = await org.student.put("/api/sla", { responseHours: 1 });
    assert.equal(stu.status, 403);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- --test-name-pattern="SLA config"`
Expected: FAIL — `GET /api/sla` returns 404 (route not mounted).

- [ ] **Step 3: Add the table**

In `server/db.js`, inside the `migrate()` template string (after the `notifications` table, before the index block), add:

```sql
    CREATE TABLE IF NOT EXISTS sla_config (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id        INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      response_hours INTEGER NOT NULL DEFAULT 4,
      resolve_hours  INTEGER NOT NULL DEFAULT 48,
      bh_start       INTEGER NOT NULL DEFAULT 9,
      bh_end         INTEGER NOT NULL DEFAULT 17,
      bh_days        TEXT    NOT NULL DEFAULT '1,2,3,4,5',
      tz_offset_min  INTEGER NOT NULL DEFAULT 0,
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
```

- [ ] **Step 4: Create the ops router**

Create `server/routes/ops.js`:

```js
"use strict";

const express = require("express");
const { requireAuth, requireStaff, requireRole } = require("../auth");

const SLA_DEFAULTS = {
  responseHours: 4, resolveHours: 48,
  bhStart: 9, bhEnd: 17, bhDays: "1,2,3,4,5", tzOffsetMin: 0,
};

function readSla(db, orgId) {
  const row = db.prepare("SELECT * FROM sla_config WHERE org_id = ?").get(orgId);
  if (!row) return { ...SLA_DEFAULTS };
  return {
    responseHours: row.response_hours,
    resolveHours: row.resolve_hours,
    bhStart: row.bh_start,
    bhEnd: row.bh_end,
    bhDays: row.bh_days,
    tzOffsetMin: row.tz_offset_min,
  };
}

module.exports = function opsRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/sla", requireStaff, (req, res) => {
    res.json({ sla: readSla(db, req.user.orgId) });
  });

  router.put("/sla", requireRole("owner"), (req, res) => {
    const clampInt = (v, def, min, max) => {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n)) return def;
      return Math.min(max, Math.max(min, n));
    };
    const cur = readSla(db, req.user.orgId);
    const next = {
      responseHours: clampInt(req.body.responseHours, cur.responseHours, 1, 720),
      resolveHours: clampInt(req.body.resolveHours, cur.resolveHours, 1, 8760),
      bhStart: clampInt(req.body.bhStart, cur.bhStart, 0, 23),
      bhEnd: clampInt(req.body.bhEnd, cur.bhEnd, 1, 24),
      bhDays: typeof req.body.bhDays === "string" && /^[0-6](,[0-6])*$/.test(req.body.bhDays)
        ? req.body.bhDays : cur.bhDays,
      tzOffsetMin: clampInt(req.body.tzOffsetMin, cur.tzOffsetMin, -840, 840),
    };
    if (next.bhEnd <= next.bhStart) next.bhEnd = next.bhStart + 1;
    db.prepare(
      `INSERT INTO sla_config (org_id, response_hours, resolve_hours, bh_start, bh_end, bh_days, tz_offset_min, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(org_id) DO UPDATE SET
         response_hours = excluded.response_hours,
         resolve_hours  = excluded.resolve_hours,
         bh_start       = excluded.bh_start,
         bh_end         = excluded.bh_end,
         bh_days        = excluded.bh_days,
         tz_offset_min  = excluded.tz_offset_min,
         updated_at     = datetime('now')`
    ).run(req.user.orgId, next.responseHours, next.resolveHours,
      next.bhStart, next.bhEnd, next.bhDays, next.tzOffsetMin);
    res.json({ sla: next });
  });

  return router;
};

module.exports.readSla = readSla;
module.exports.SLA_DEFAULTS = SLA_DEFAULTS;
```

In `server/index.js`, add the require near the other route requires:

```js
const opsRoutes = require("./routes/ops");
```

and mount it alongside the others (before the `/api` 404):

```js
  app.use("/api", opsRoutes(db));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npm test -- --test-name-pattern="SLA config"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/routes/ops.js server/index.js server/test/sla.test.js
git commit -m "feat(ops): per-org SLA + business-hours config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: SLA breach math (business hours)

**Files:**
- Create: `server/lib/sla.js`
- Test: `server/test/sla_math.test.js` (Create)

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces:
  - `businessHoursBetween(startISO, endISO, sla)` → `number` (hours of business time between two timestamps; `sla` is the object from `readSla`).
  - `slaState(blockage, sla, nowISO)` → `{ responseDueIn, resolveDueIn, breached, atRisk, label }` where `responseDueIn`/`resolveDueIn` are remaining business hours (negative = overdue), `breached`/`atRisk` are booleans, `label` ∈ `"ok" | "at_risk" | "breached" | null` (null for resolved). `blockage` needs `{ created_at, status, assignee_id, resolved_at }`. "Response" clock runs while `status='open'` (until first claim/assign); "resolve" clock runs until `resolved`. `atRisk` when remaining ≤ 25% of the target and not yet breached.
  - Timestamps are SQLite `datetime('now')` strings (`"YYYY-MM-DD HH:MM:SS"`, UTC). Treat them as UTC, then shift by `sla.tzOffsetMin` for weekday/hour checks.

- [ ] **Step 1: Write the failing test**

```js
// server/test/sla_math.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { businessHoursBetween, slaState } = require("../lib/sla");

const SLA = { responseHours: 4, resolveHours: 48, bhStart: 9, bhEnd: 17, bhDays: "1,2,3,4,5", tzOffsetMin: 0 };

test("businessHoursBetween: counts only in-window weekday hours", () => {
  // Mon 2026-06-15 10:00 -> Mon 14:00 = 4 business hours
  const h = businessHoursBetween("2026-06-15 10:00:00", "2026-06-15 14:00:00", SLA);
  assert.equal(Math.round(h), 4);
});

test("businessHoursBetween: skips the weekend", () => {
  // Fri 16:00 -> Mon 10:00. Fri 16->17 = 1h, Mon 9->10 = 1h => 2h
  const h = businessHoursBetween("2026-06-19 16:00:00", "2026-06-22 10:00:00", SLA);
  assert.equal(Math.round(h), 2);
});

test("slaState: open + within target = ok", () => {
  const blk = { created_at: "2026-06-15 10:00:00", status: "open", assignee_id: null, resolved_at: null };
  const s = slaState(blk, SLA, "2026-06-15 11:00:00"); // 1 business hour in
  assert.equal(s.breached, false);
  assert.equal(s.label, "ok");
  assert.ok(s.responseDueIn > 0);
});

test("slaState: open past response target = breached", () => {
  const blk = { created_at: "2026-06-15 09:00:00", status: "open", assignee_id: null, resolved_at: null };
  const s = slaState(blk, SLA, "2026-06-15 15:00:00"); // 6 business hours, target 4
  assert.equal(s.breached, true);
  assert.equal(s.label, "breached");
  assert.ok(s.responseDueIn < 0);
});

test("slaState: resolved = no label", () => {
  const blk = { created_at: "2026-06-15 09:00:00", status: "resolved", assignee_id: 2, resolved_at: "2026-06-15 10:00:00" };
  const s = slaState(blk, SLA, "2026-06-20 10:00:00");
  assert.equal(s.label, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/sla_math.test.js`
Expected: FAIL — `Cannot find module '../lib/sla'`.

- [ ] **Step 3: Write the implementation**

Create `server/lib/sla.js`:

```js
"use strict";

// Parse a SQLite UTC timestamp string into epoch ms (UTC).
function parseUtc(s) {
  if (!s) return NaN;
  return Date.parse(String(s).replace(" ", "T") + "Z");
}

// Local (org-tz) Date parts for an epoch, given tz offset in minutes.
function localParts(epochMs, tzOffsetMin) {
  const d = new Date(epochMs + tzOffsetMin * 60000);
  return { day: d.getUTCDay(), hour: d.getUTCHours(), min: d.getUTCMinutes() };
}

function businessHoursBetween(startISO, endISO, sla) {
  let start = parseUtc(startISO);
  const end = parseUtc(endISO);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const days = new Set(String(sla.bhDays).split(",").map(Number));
  const STEP = 60000; // 1-minute resolution
  let minutes = 0;
  for (let t = start; t < end; t += STEP) {
    const { day, hour } = localParts(t, sla.tzOffsetMin);
    if (days.has(day) && hour >= sla.bhStart && hour < sla.bhEnd) minutes++;
  }
  return minutes / 60;
}

function slaState(blockage, sla, nowISO) {
  if (blockage.status === "resolved") {
    return { responseDueIn: 0, resolveDueIn: 0, breached: false, atRisk: false, label: null };
  }
  const now = nowISO || new Date().toISOString().slice(0, 19).replace("T", " ");
  // Response clock: while still open (un-claimed). Once in_support, response is met.
  const responded = blockage.status !== "open" || blockage.assignee_id != null;
  const elapsedResponse = responded ? 0 : businessHoursBetween(blockage.created_at, now, sla);
  const responseDueIn = responded ? Infinity : sla.responseHours - elapsedResponse;

  const elapsedResolve = businessHoursBetween(blockage.created_at, now, sla);
  const resolveDueIn = sla.resolveHours - elapsedResolve;

  const breached = (!responded && responseDueIn < 0) || resolveDueIn < 0;
  const atRiskResp = !responded && responseDueIn >= 0 && responseDueIn <= sla.responseHours * 0.25;
  const atRiskRes = resolveDueIn >= 0 && resolveDueIn <= sla.resolveHours * 0.25;
  const atRisk = !breached && (atRiskResp || atRiskRes);

  let label = "ok";
  if (breached) label = "breached";
  else if (atRisk) label = "at_risk";

  return {
    responseDueIn: responded ? null : Math.round(responseDueIn * 10) / 10,
    resolveDueIn: Math.round(resolveDueIn * 10) / 10,
    breached, atRisk, label,
  };
}

module.exports = { businessHoursBetween, slaState };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- server/test/sla_math.test.js`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add server/lib/sla.js server/test/sla_math.test.js
git commit -m "feat(ops): business-hours SLA breach/at-risk math

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Audit log table + writer + auth/admin events

**Files:**
- Modify: `server/db.js` (add `audit_log` table + index)
- Create: `server/lib/audit.js`
- Modify: `server/routes/auth.js` (audit signup/login/logout/join)
- Modify: `server/routes/members.js` (audit invite/member/org changes)
- Test: `server/test/audit.test.js` (Create)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - Table `audit_log(id, org_id, actor_id, action TEXT, target_type TEXT, target_id INTEGER, ip TEXT, meta TEXT, created_at)`.
  - `audit(db, { orgId, actorId, action, targetType, targetId, ip, meta })` → inserts a row. `actorId`/`targetId`/`targetType`/`ip`/`meta` are nullable. `meta` is stringified to JSON if an object.
  - `AUDIT` — frozen object of action-name constants: `LOGIN`, `LOGOUT`, `SIGNUP`, `JOIN`, `INVITE_CREATE`, `INVITE_REVOKE`, `MEMBER_UPDATE`, `MEMBER_DELETE`, `ORG_RENAME`, `OWNERSHIP_TRANSFER`, `SLA_UPDATE`, `BLOCKAGE_RESOLVE`, `BLOCKAGE_DELETE`, `BLOCKAGE_REASSIGN`, `USER_DATA_DELETE`, `ESCALATE`.
  - Audit rows are never updated or deleted by app code (immutable; only org CASCADE delete removes them).
- A request's IP: use `req.ip` (Express).

- [ ] **Step 1: Write the failing test**

```js
// server/test/audit.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg, makeClient } = require("./helpers");

test("audit: login + invite create are recorded, org-scoped", async () => {
  const { base, db, close } = await startServer();
  try {
    const org = await buildOrg(base, "Acme", "acme");

    // a fresh login by the owner
    const login = await org.owner.post("/api/auth/login", {
      email: "acme-owner@x.com", password: "pass1234",
    });
    assert.equal(login.status, 200);

    const rows = db.prepare("SELECT action FROM audit_log WHERE action = 'login'").all();
    assert.ok(rows.length >= 1, "login audited");

    const inv = db.prepare("SELECT action FROM audit_log WHERE action = 'invite_create'").all();
    assert.ok(inv.length >= 1, "invite create audited");

    // second org cannot see acme audit rows via the API (Task 4 covers API; here check scoping in DB)
    const orgRow = db.prepare("SELECT id FROM organizations WHERE slug LIKE 'acme%'").get();
    const all = db.prepare("SELECT DISTINCT org_id FROM audit_log").all();
    assert.ok(all.every((r) => r.org_id === orgRow.id), "all audit rows belong to acme org");
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/audit.test.js`
Expected: FAIL — `no such table: audit_log`.

- [ ] **Step 3: Add the table + writer**

In `server/db.js` `migrate()`, after `sla_config`, add:

```sql
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action      TEXT NOT NULL,
      target_type TEXT,
      target_id   INTEGER,
      ip          TEXT,
      meta        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
```

and in the index block add:

```sql
    CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id, id DESC);
```

Create `server/lib/audit.js`:

```js
"use strict";

const AUDIT = Object.freeze({
  LOGIN: "login",
  LOGOUT: "logout",
  SIGNUP: "signup",
  JOIN: "join",
  INVITE_CREATE: "invite_create",
  INVITE_REVOKE: "invite_revoke",
  MEMBER_UPDATE: "member_update",
  MEMBER_DELETE: "member_delete",
  ORG_RENAME: "org_rename",
  OWNERSHIP_TRANSFER: "ownership_transfer",
  SLA_UPDATE: "sla_update",
  BLOCKAGE_RESOLVE: "blockage_resolve",
  BLOCKAGE_DELETE: "blockage_delete",
  BLOCKAGE_REASSIGN: "blockage_reassign",
  USER_DATA_DELETE: "user_data_delete",
  ESCALATE: "escalate",
});

function audit(db, { orgId, actorId = null, action, targetType = null, targetId = null, ip = null, meta = null }) {
  const metaStr = meta == null ? null : (typeof meta === "string" ? meta : JSON.stringify(meta));
  db.prepare(
    `INSERT INTO audit_log (org_id, actor_id, action, target_type, target_id, ip, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(orgId, actorId, action, targetType, targetId, ip, metaStr);
}

module.exports = { audit, AUDIT };
```

- [ ] **Step 4: Wire audit into auth + members routes**

In `server/routes/auth.js`, add at top:

```js
const { audit, AUDIT } = require("../lib/audit");
```

After a successful **signup** (right after the owner user + org are created and the token issued, before the response), call:

```js
audit(db, { orgId: org.id, actorId: user.id, action: AUDIT.SIGNUP, targetType: "org", targetId: org.id, ip: req.ip });
```

After a successful **login** (after `issueToken`):

```js
audit(db, { orgId: user.org_id, actorId: user.id, action: AUDIT.LOGIN, ip: req.ip });
```

In **logout**, if a valid `currentUser(req)` exists, before clearing:

```js
const u = currentUser(req);
if (u) audit(db, { orgId: u.orgId, actorId: u.userId, action: AUDIT.LOGOUT, ip: req.ip });
```

After a successful **join** (after the new member + token):

```js
audit(db, { orgId: user.org_id, actorId: user.id, action: AUDIT.JOIN, targetType: "invite", targetId: invite.id, ip: req.ip });
```

(Use whatever the existing local variable names are for the created user / org / invite; the field names above are the contract.)

In `server/routes/members.js`, add the same require and call `audit(db, …)`:
- after creating an invite → `AUDIT.INVITE_CREATE`, `targetType:"invite"`, `targetId: invite.id`.
- after revoking → `AUDIT.INVITE_REVOKE`, `targetId: <invite id>`.
- after `PUT /members/:id` → `AUDIT.MEMBER_UPDATE`, `targetType:"user"`, `targetId:<id>`, `meta:{ role, cohortId }`.
- after `DELETE /members/:id` → `AUDIT.MEMBER_DELETE`, `targetType:"user"`, `targetId:<id>`.
- after `PUT /org` → `AUDIT.ORG_RENAME`, `meta:{ name }`.
- after `POST /members/:id/transfer-ownership` → `AUDIT.OWNERSHIP_TRANSFER`, `targetType:"user"`, `targetId:<new owner id>`.

Each call uses `actorId: req.user.userId`, `orgId: req.user.orgId`, `ip: req.ip`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npm test -- server/test/audit.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite (regression — audit calls must not break existing routes)**

Run: `cd server && npm test`
Expected: PASS (all existing + new).

- [ ] **Step 7: Commit**

```bash
git add server/db.js server/lib/audit.js server/routes/auth.js server/routes/members.js server/test/audit.test.js
git commit -m "feat(trust): immutable audit_log + auth/admin event capture

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Audit log viewer + CSV export (owner)

**Files:**
- Modify: `server/routes/ops.js` (add audit endpoints)
- Test: `server/test/audit_view.test.js` (Create)

**Interfaces:**
- Consumes: `audit_log` table; `requireRole`.
- Produces:
  - `GET /api/audit?action=&cursor=&limit=` (owner only) → `{ entries: [{ id, action, actorName, targetType, targetId, ip, meta, createdAt }], nextCursor }`. Newest first, default `limit=50` (cap 100), keyset on `id < cursor`. `actorName` is the actor's current name or `null`.
  - `GET /api/audit/export.csv` (owner only) → CSV of all the org's audit rows, columns `id,createdAt,action,actor,targetType,targetId,ip,meta`. Content-Disposition attachment.
  - Cross-tenant: only the caller's `org_id` rows are ever returned.

- [ ] **Step 1: Write the failing test**

```js
// server/test/audit_view.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("audit viewer: owner sees own rows, paginates, exports; tenant isolated", async () => {
  const { base, close } = await startServer();
  try {
    const a = await buildOrg(base, "Acme", "acme");
    const b = await buildOrg(base, "Beta", "beta");

    const list = await a.owner.get("/api/audit?limit=50");
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.entries));
    assert.ok(list.body.entries.length > 0);
    // every entry must be from Acme's actions only (e.g. acme owner/instructor names)
    assert.ok(list.body.entries.every((e) => e.action && typeof e.action === "string"));

    // beta's owner must not see acme's signup actor
    const blist = await b.owner.get("/api/audit?limit=50");
    const acmeOwnerSeen = blist.body.entries.some((e) => e.actorName === "Owner Acme");
    assert.equal(acmeOwnerSeen, false);

    // student forbidden
    const stu = await a.student.get("/api/audit");
    assert.equal(stu.status, 403);

    // export csv
    const exp = await a.owner.get("/api/audit/export.csv");
    assert.equal(exp.status, 200);
  } finally {
    await close();
  }
});
```

(Note: `makeClient` parses JSON; for the CSV endpoint `exp.body` will be `null` but `exp.status` is 200 — assert on status only.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/audit_view.test.js`
Expected: FAIL — `GET /api/audit` 404.

- [ ] **Step 3: Add the endpoints**

In `server/routes/ops.js`, add `requireRole` is already imported. Add inside the factory before `return router;`:

```js
  router.get("/audit", requireRole("owner"), (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;
    const args = [req.user.orgId];
    let sql = `SELECT a.id, a.action, a.target_type, a.target_id, a.ip, a.meta, a.created_at,
                      u.name AS actor_name
                 FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
                WHERE a.org_id = ?`;
    if (cursor) { sql += " AND a.id < ?"; args.push(cursor); }
    if (req.query.action) { sql += " AND a.action = ?"; args.push(String(req.query.action)); }
    sql += " ORDER BY a.id DESC LIMIT ?";
    args.push(limit + 1);
    const rows = db.prepare(sql).all(...args);
    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? page[page.length - 1].id : null;
    res.json({
      entries: page.map((r) => ({
        id: r.id, action: r.action, actorName: r.actor_name || null,
        targetType: r.target_type, targetId: r.target_id, ip: r.ip,
        meta: r.meta, createdAt: r.created_at,
      })),
      nextCursor,
    });
  });

  router.get("/audit/export.csv", requireRole("owner"), (req, res) => {
    const rows = db.prepare(
      `SELECT a.id, a.created_at, a.action, COALESCE(u.name,'') AS actor,
              a.target_type, a.target_id, a.ip, a.meta
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.org_id = ? ORDER BY a.id DESC`
    ).all(req.user.orgId);
    const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const header = ["id", "createdAt", "action", "actor", "targetType", "targetId", "ip", "meta"];
    const lines = [header.map(esc).join(",")];
    for (const r of rows) {
      lines.push([r.id, r.created_at, r.action, r.actor, r.target_type, r.target_id, r.ip, r.meta]
        .map(esc).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="audit.csv"');
    res.send(lines.join("\r\n"));
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- server/test/audit_view.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/ops.js server/test/audit_view.test.js
git commit -m "feat(trust): owner audit-log viewer + CSV export (paginated, tenant-scoped)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Auto-assignment rules (round-robin / least-loaded)

**Files:**
- Modify: `server/db.js` (add `assign_strategy` + `rr_cursor` columns to `cohorts`)
- Create: `server/lib/assign.js`
- Modify: `server/routes/blockages.js` (run auto-assign on report)
- Modify: `server/routes/cohorts.js` (allow setting strategy via cohort update — owner)
- Test: `server/test/assign.test.js` (Create)

**Interfaces:**
- Consumes: `cohort_instructors`, `blockages`, `addEvent`, `notify`.
- Produces:
  - New columns: `cohorts.assign_strategy TEXT NOT NULL DEFAULT 'none'` (`'none'|'round_robin'|'least_loaded'`), `cohorts.rr_cursor INTEGER NOT NULL DEFAULT 0`.
  - `pickAssignee(db, { orgId, cohortId, strategy })` → instructor `userId` or `null` (null when strategy `'none'` or no instructors). `round_robin` advances `rr_cursor`; `least_loaded` picks the cohort instructor with the fewest non-resolved assigned blockages (ties → lowest id).
  - On `POST /api/blockages` report, when the cohort's strategy ≠ `'none'`, the new blockage is auto-claimed: `assignee_id` set, `status='in_support'`, a `claimed` status-event (`meta:"auto"`), and a notify to the assignee.

- [ ] **Step 1: Write the failing test**

```js
// server/test/assign.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg, joinMember } = require("./helpers");

test("auto-assign: round-robin distributes new blockages across cohort instructors", async () => {
  const { base, close } = await startServer();
  try {
    const org = await buildOrg(base, "Acme", "acme");
    // add a second instructor to the cohort
    const ins2 = await joinMember(base, org.owner, "instructor", null, "acme-ins2");
    await org.owner.post(`/api/cohorts/${org.cohortId}/instructors`, { userId: ins2.user.id });

    // turn on round-robin for the cohort
    const upd = await org.owner.put(`/api/cohorts/${org.cohortId}`, {
      name: "Cohort A", assignStrategy: "round_robin",
    });
    assert.equal(upd.status, 200);

    // student reports two blockages
    const r1 = await org.student.post("/api/blockages", {
      title: "B1", cohortId: org.cohortId, details: "help one",
    });
    const r2 = await org.student.post("/api/blockages", {
      title: "B2", cohortId: org.cohortId, details: "help two",
    });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);

    // both should be in_support and assigned to different instructors
    const d1 = await org.owner.get(`/api/blockages/${r1.body.blockage.id}`);
    const d2 = await org.owner.get(`/api/blockages/${r2.body.blockage.id}`);
    assert.equal(d1.body.blockage.status, "in_support");
    assert.equal(d2.body.blockage.status, "in_support");
    assert.notEqual(d1.body.blockage.assigneeId, null);
    assert.notEqual(d2.body.blockage.assigneeId, null);
    assert.notEqual(d1.body.blockage.assigneeId, d2.body.blockage.assigneeId);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/assign.test.js`
Expected: FAIL — `assignStrategy` ignored; blockages stay `open`.

- [ ] **Step 3: Add columns**

In `server/db.js`, the `cohorts` table currently has `id, org_id, name, created_at`. Because `CREATE TABLE IF NOT EXISTS` won't alter an existing table, add an idempotent column migration. After the `migrate()` `db.exec(...)` template literal block, add:

```js
  // Additive column migrations (idempotent — SQLite has no IF NOT EXISTS for columns).
  function addColumn(table, col, ddl) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
  addColumn("cohorts", "assign_strategy", "assign_strategy TEXT NOT NULL DEFAULT 'none'");
  addColumn("cohorts", "rr_cursor", "rr_cursor INTEGER NOT NULL DEFAULT 0");
```

(Place this inside `migrate(db)`, after the existing `db.exec(\`...\`)` call.)

- [ ] **Step 4: Write the assignment lib**

Create `server/lib/assign.js`:

```js
"use strict";

const { cohortInstructorIds } = require("./helpers");

// Returns an instructor userId to assign, or null.
function pickAssignee(db, { cohortId, strategy }) {
  if (!strategy || strategy === "none") return null;
  const ids = cohortInstructorIds(db, cohortId).slice().sort((a, b) => a - b);
  if (!ids.length) return null;

  if (strategy === "least_loaded") {
    let best = null, bestLoad = Infinity;
    for (const id of ids) {
      const { n } = db.prepare(
        "SELECT COUNT(*) AS n FROM blockages WHERE assignee_id = ? AND status != 'resolved'"
      ).get(id);
      if (n < bestLoad) { bestLoad = n; best = id; }
    }
    return best;
  }

  // round_robin: use + advance the cohort's cursor
  const cohort = db.prepare("SELECT rr_cursor FROM cohorts WHERE id = ?").get(cohortId);
  const cursor = (cohort && cohort.rr_cursor) || 0;
  const chosen = ids[cursor % ids.length];
  db.prepare("UPDATE cohorts SET rr_cursor = ? WHERE id = ?").run((cursor + 1) % ids.length, cohortId);
  return chosen;
}

module.exports = { pickAssignee };
```

- [ ] **Step 5: Run auto-assign on report**

In `server/routes/blockages.js`, add the require:

```js
const { pickAssignee } = require("../lib/assign");
```

In `POST /api/blockages`, after the blockage `INSERT` + the `created` event + the instructor notifications, but **before** `res.status(201).json(...)`, insert:

```js
    const cohort = db.prepare("SELECT assign_strategy FROM cohorts WHERE id = ?").get(cohortId);
    const autoId = pickAssignee(db, { cohortId, strategy: cohort && cohort.assign_strategy });
    if (autoId) {
      db.prepare(
        "UPDATE blockages SET status = 'in_support', assignee_id = ? WHERE id = ?"
      ).run(autoId, id);
      addEvent(db, { orgId: req.user.orgId, blockageId: id, type: "claimed", actorId: autoId, meta: "auto" });
      notify(db, {
        orgId: req.user.orgId, userId: autoId, type: "claimed", blockageId: id,
        body: `Auto-assigned: "${title}"`,
      });
    }
```

(The `res.status(201).json({ blockage: summary(joinedById(id)) })` line then reflects the new status/assignee.)

- [ ] **Step 6: Accept the strategy in cohort update**

In `server/routes/cohorts.js`, find the `PUT /cohorts/:id` handler. After it updates the name, persist the strategy when provided:

```js
    const strategy = ["none", "round_robin", "least_loaded"].includes(req.body.assignStrategy)
      ? req.body.assignStrategy : null;
    if (strategy) db.prepare("UPDATE cohorts SET assign_strategy = ? WHERE id = ? AND org_id = ?")
      .run(strategy, Number(req.params.id), req.user.orgId);
```

(Adapt variable names to the existing handler; the contract is: body field `assignStrategy`, org-scoped update.)

- [ ] **Step 7: Run test to verify it passes**

Run: `cd server && npm test -- server/test/assign.test.js`
Expected: PASS.

- [ ] **Step 8: Run the full suite**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/db.js server/lib/assign.js server/routes/blockages.js server/routes/cohorts.js server/test/assign.test.js
git commit -m "feat(ops): per-cohort auto-assignment (round-robin / least-loaded)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: SLA fields on blockages + escalation

**Files:**
- Modify: `server/routes/blockages.js` (add SLA to summary + detail)
- Modify: `server/routes/ops.js` (add `POST /api/sla/escalate`)
- Modify: `server/routes/blockages.js` (audit resolve/delete/reassign — see Interfaces)
- Test: `server/test/escalate.test.js` (Create)

**Interfaces:**
- Consumes: `slaState` from `../lib/sla`; `readSla` from `./ops`; `audit`/`AUDIT`; `notify`, `addEvent`.
- Produces:
  - `summary(r)` (and detail) gains `sla: { label, breached, atRisk, responseDueIn, resolveDueIn }` for non-resolved rows (`label:null` when resolved). Computed from the org SLA.
  - `POST /api/sla/escalate` (owner|instructor via `requireStaff`) → scans the caller's in-scope open/in_support blockages, and for each **breached** one with no recent escalation, notifies the assignee (or cohort instructors if unassigned) and the org owners, writes an `audit` row `AUDIT.ESCALATE` per blockage, and returns `{ escalated: <count>, breached: <count>, atRisk: <count> }`. Idempotency: skip a blockage that already has an `ESCALATE` audit row in the last `sla.responseHours` hours.
  - Blockage mutations now audit: resolve → `AUDIT.BLOCKAGE_RESOLVE`; delete → `AUDIT.BLOCKAGE_DELETE`; assign → `AUDIT.BLOCKAGE_REASSIGN` (`targetType:"blockage"`, `targetId: row.id`, `ip: req.ip`).

- [ ] **Step 1: Write the failing test**

```js
// server/test/escalate.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("escalation: breached open blockage notifies + audits; sla fields exposed", async () => {
  const { base, db, close } = await startServer();
  try {
    const org = await buildOrg(base, "Acme", "acme");
    // tight SLA + 24h business days so a backdated blockage is breached
    await org.owner.put("/api/sla", {
      responseHours: 1, resolveHours: 2,
      bhStart: 0, bhEnd: 24, bhDays: "0,1,2,3,4,5,6", tzOffsetMin: 0,
    });

    const r = await org.student.post("/api/blockages", {
      title: "Stuck", cohortId: org.cohortId, details: "long stuck",
    });
    const id = r.body.blockage.id;
    // backdate it 10 hours so it is past both targets
    db.prepare("UPDATE blockages SET created_at = datetime('now','-10 hours') WHERE id = ?").run(id);

    const detail = await org.owner.get(`/api/blockages/${id}`);
    assert.equal(detail.body.blockage.sla.breached, true);

    const esc = await org.owner.post("/api/sla/escalate", {});
    assert.equal(esc.status, 200);
    assert.ok(esc.body.escalated >= 1);

    const audited = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='escalate'").get();
    assert.ok(audited.n >= 1);

    // second call within the window is idempotent (no new escalation)
    const esc2 = await org.owner.post("/api/sla/escalate", {});
    assert.equal(esc2.body.escalated, 0);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/escalate.test.js`
Expected: FAIL — `sla` field undefined / `/api/sla/escalate` 404.

- [ ] **Step 3: Add SLA to blockage summary/detail**

In `server/routes/blockages.js`, add requires:

```js
const { slaState } = require("../lib/sla");
const { readSla } = require("./ops");
const { audit, AUDIT } = require("../lib/audit");
```

Change `summary` to accept the SLA. Replace the current `function summary(r)` with one that takes the sla and appends the field:

```js
  function summary(r, sla) {
    const out = {
      id: r.id, title: r.title, status: r.status, difficulty: r.difficulty,
      cohortId: r.cohort_id, cohortName: r.cohort_name, briefName: r.brief_name,
      studentName: r.student_name, assigneeName: r.assignee_name,
      assigneeId: r.assignee_id != null ? r.assignee_id : undefined,
      commentCount: r.comment_count, createdAt: r.created_at, resolvedAt: r.resolved_at,
    };
    if (sla) {
      const s = slaState(r, sla);
      out.sla = { label: s.label, breached: s.breached, atRisk: s.atRisk,
        responseDueIn: s.responseDueIn, resolveDueIn: s.resolveDueIn };
    }
    return out;
  }
```

> Note: `summary` is module-level today; move it inside the factory (it now needs no db, but reads sla passed in). Update every `summary(joinedById(...))` call site to `summary(joinedById(...), sla)` where `sla = readSla(db, req.user.orgId)` is computed once at the top of each handler that returns blockages. In the list handler, compute `const sla = readSla(db, req.user.orgId);` once and map `.map((r) => summary(r, sla))`.

- [ ] **Step 4: Add escalation endpoint**

In `server/routes/ops.js`, add requires:

```js
const { slaState } = require("../lib/sla");
const { audit, AUDIT } = require("../lib/audit");
const { notify, cohortInstructorIds } = require("../lib/helpers");
```

Add before `return router;`:

```js
  router.post("/sla/escalate", requireStaff, (req, res) => {
    const { orgId, role, userId } = req.user;
    const sla = readSla(db, orgId);
    let sql = "SELECT * FROM blockages WHERE org_id = ? AND status != 'resolved'";
    const args = [orgId];
    if (role === "instructor") {
      sql += " AND (assignee_id = ? OR cohort_id IN (SELECT cohort_id FROM cohort_instructors WHERE user_id = ?))";
      args.push(userId, userId);
    }
    const rows = db.prepare(sql).all(...args);
    let escalated = 0, breached = 0, atRisk = 0;
    const owners = db.prepare("SELECT id FROM users WHERE org_id = ? AND role = 'owner'").all(orgId);
    for (const b of rows) {
      const s = slaState(b, sla);
      if (s.atRisk) atRisk++;
      if (!s.breached) continue;
      breached++;
      const recent = db.prepare(
        `SELECT COUNT(*) AS n FROM audit_log
          WHERE org_id = ? AND action = ? AND target_id = ?
            AND created_at > datetime('now', ?)`
      ).get(orgId, AUDIT.ESCALATE, b.id, `-${sla.responseHours} hours`);
      if (recent.n > 0) continue;
      const targets = new Set();
      if (b.assignee_id) targets.add(b.assignee_id);
      else cohortInstructorIds(db, b.cohort_id).forEach((i) => targets.add(i));
      owners.forEach((o) => targets.add(o.id));
      for (const uid of targets) {
        notify(db, { orgId, userId: uid, type: "escalation", blockageId: b.id,
          body: `SLA breached: "${b.title}"` });
      }
      audit(db, { orgId, actorId: userId, action: AUDIT.ESCALATE,
        targetType: "blockage", targetId: b.id, ip: req.ip, meta: { resolveDueIn: s.resolveDueIn } });
      escalated++;
    }
    res.json({ escalated, breached, atRisk });
  });
```

- [ ] **Step 5: Audit blockage mutations**

In `server/routes/blockages.js`, inside the resolve handler (after the DB update + notify), add:

```js
    audit(db, { orgId: row.org_id, actorId: req.user.userId, action: AUDIT.BLOCKAGE_RESOLVE,
      targetType: "blockage", targetId: row.id, ip: req.ip, meta: { type } });
```

In the delete handler (after `DELETE FROM blockages`):

```js
    audit(db, { orgId: row.org_id, actorId: req.user.userId, action: AUDIT.BLOCKAGE_DELETE,
      targetType: "blockage", targetId: row.id, ip: req.ip });
```

In the assign handler (after update + notifies):

```js
    audit(db, { orgId: row.org_id, actorId: req.user.userId, action: AUDIT.BLOCKAGE_REASSIGN,
      targetType: "blockage", targetId: row.id, ip: req.ip, meta: { assigneeId: assignee.id } });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd server && npm test -- server/test/escalate.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite (summary signature changed — regression check)**

Run: `cd server && npm test`
Expected: PASS. If any blockage test fails on a missing field, it is a call-site that still calls `summary(x)` without `sla` — fix by passing `sla`.

- [ ] **Step 8: Commit**

```bash
git add server/routes/blockages.js server/routes/ops.js server/test/escalate.test.js
git commit -m "feat(ops): SLA status on blockages + escalation + mutation auditing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: GDPR — org + user export, right to erasure

**Files:**
- Create: `server/routes/gdpr.js`
- Modify: `server/index.js` (mount gdpr router)
- Test: `server/test/gdpr.test.js` (Create)

**Interfaces:**
- Consumes: `requireRole`; `audit`/`AUDIT`.
- Produces:
  - `GET /api/export/org.json` (owner) → JSON of the org's full data: `{ org, users, cohorts, briefs, blockages, comments, status_events, notifications, invites, audit_log, sla_config }`, each an array scoped to `org_id`. Content-Disposition attachment `unblockify-org.json`.
  - `GET /api/export/users/:id.json` (owner) → `{ user, blockages, comments, notifications, audit_actions }` for that one user (must be same org, else 404).
  - `DELETE /api/users/:id/data` (owner) → right to erasure: anonymize the user. Sets `users.name='Deleted user'`, `email='deleted+<id>@example.invalid'`, `password_hash=''`; nulls `comments.user_id` is **not** done (FK is `ON DELETE CASCADE` for comments→users, but we keep the thread by reassigning authorship to null is impossible — instead set comment bodies to `'[deleted]'` and keep `user_id`), deletes the user's notifications, and writes `AUDIT.USER_DATA_DELETE`. The owner cannot erase themselves or another owner (400). Returns `{ ok: true }`. Cross-org target → 404.
  - Tenant guard: every query filters `org_id = req.user.orgId`; a target user from another org is 404.

- [ ] **Step 1: Write the failing test**

```js
// server/test/gdpr.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("gdpr: org export, user export, erasure with tenant guard", async () => {
  const { base, db, close } = await startServer();
  try {
    const a = await buildOrg(base, "Acme", "acme");
    const b = await buildOrg(base, "Beta", "beta");
    await a.student.post("/api/blockages", { title: "X", cohortId: a.cohortId, details: "d" });

    const orgExp = await a.owner.get("/api/export/org.json");
    assert.equal(orgExp.status, 200);
    assert.ok(Array.isArray(orgExp.body.users));
    assert.ok(Array.isArray(orgExp.body.blockages));
    // export must not leak Beta
    assert.ok(orgExp.body.users.every((u) => u.email.includes("acme")));

    const userExp = await a.owner.get(`/api/export/users/${a.studentId}.json`);
    assert.equal(userExp.status, 200);
    assert.equal(userExp.body.user.id, a.studentId);

    // cross-org target → 404
    const cross = await a.owner.get(`/api/export/users/${b.studentId}.json`);
    assert.equal(cross.status, 404);

    // erasure
    const del = await a.owner.del(`/api/users/${a.studentId}/data`);
    assert.equal(del.status, 200);
    const erased = db.prepare("SELECT name, email FROM users WHERE id = ?").get(a.studentId);
    assert.equal(erased.name, "Deleted user");
    assert.match(erased.email, /deleted\+/);

    // cannot erase an owner
    const self = await a.owner.del(`/api/users/${a.studentId}/data`); // already erased student → still ok? erase owner instead:
    const ownerId = db.prepare("SELECT id FROM users WHERE org_id = (SELECT org_id FROM users WHERE id = ?) AND role='owner'").get(a.studentId).id;
    const delOwner = await a.owner.del(`/api/users/${ownerId}/data`);
    assert.equal(delOwner.status, 400);

    const audited = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='user_data_delete'").get();
    assert.ok(audited.n >= 1);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/gdpr.test.js`
Expected: FAIL — `/api/export/org.json` 404.

- [ ] **Step 3: Write the router**

Create `server/routes/gdpr.js`:

```js
"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth");
const { audit, AUDIT } = require("../lib/audit");

const ORG_TABLES = [
  "users", "cohorts", "briefs", "blockages", "comments",
  "status_events", "notifications", "invites", "audit_log", "sla_config",
];

module.exports = function gdprRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/export/org.json", requireRole("owner"), (req, res) => {
    const orgId = req.user.orgId;
    const out = { org: db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) };
    for (const t of ORG_TABLES) {
      out[t] = db.prepare(`SELECT * FROM ${t} WHERE org_id = ?`).all(orgId);
    }
    res.setHeader("Content-Disposition", 'attachment; filename="unblockify-org.json"');
    res.json(out);
  });

  router.get("/export/users/:id.json", requireRole("owner"), (req, res) => {
    const orgId = req.user.orgId;
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), orgId);
    if (!user) return res.status(404).json({ error: "User not found." });
    res.setHeader("Content-Disposition", `attachment; filename="user-${user.id}.json"`);
    res.json({
      user,
      blockages: db.prepare("SELECT * FROM blockages WHERE org_id = ? AND user_id = ?").all(orgId, user.id),
      comments: db.prepare("SELECT * FROM comments WHERE org_id = ? AND user_id = ?").all(orgId, user.id),
      notifications: db.prepare("SELECT * FROM notifications WHERE org_id = ? AND user_id = ?").all(orgId, user.id),
      audit_actions: db.prepare("SELECT * FROM audit_log WHERE org_id = ? AND actor_id = ?").all(orgId, user.id),
    });
  });

  router.delete("/users/:id/data", requireRole("owner"), (req, res) => {
    const orgId = req.user.orgId;
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), orgId);
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.role === "owner") return res.status(400).json({ error: "Cannot erase an owner." });

    db.prepare(
      "UPDATE users SET name = 'Deleted user', email = ?, password_hash = '' WHERE id = ?"
    ).run(`deleted+${user.id}@example.invalid`, user.id);
    db.prepare("UPDATE comments SET body = '[deleted]' WHERE org_id = ? AND user_id = ?").run(orgId, user.id);
    db.prepare("DELETE FROM notifications WHERE org_id = ? AND user_id = ?").run(orgId, user.id);
    audit(db, { orgId, actorId: req.user.userId, action: AUDIT.USER_DATA_DELETE,
      targetType: "user", targetId: user.id, ip: req.ip });
    res.json({ ok: true });
  });

  return router;
};
```

In `server/index.js`:

```js
const gdprRoutes = require("./routes/gdpr");
```

and mount it (before the `/api` 404):

```js
  app.use("/api", gdprRoutes(db));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- server/test/gdpr.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/gdpr.js server/index.js server/test/gdpr.test.js
git commit -m "feat(trust): GDPR org/user export + right-to-erasure (tenant-guarded)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Observability — request logging, error capture, /healthz, counters

**Files:**
- Create: `server/lib/logger.js`
- Modify: `server/index.js` (mount logging first, `/healthz`, error handler last)
- Test: `server/test/observability.test.js` (Create)

**Interfaces:**
- Consumes: nothing new (uses `node:fs`, env).
- Produces:
  - `requestLogger()` → Express middleware: on each response `finish`, writes one structured JSON line `{ t, method, path, status, ms, ip }` to `server/logs/access.log` (created if missing) and bumps `counters.requests` + `counters.byStatus[status]`. When `LOG_STDOUT` is set, also `console.log` the line.
  - `errorHandler()` → Express 4 error middleware `(err, req, res, next)`: logs `{ t, level:'error', method, path, message, stack }` to `server/logs/error.log`, bumps `counters.errors`, fires the webhook when `ERROR_WEBHOOK_URL` is set (best-effort `fetch`, never throws), and responds `500 {error:'Internal error'}` if headers not sent.
  - `counters` → `{ requests, errors, byStatus }` object (mutated in place); exported for `/healthz`.
  - `LOG_DIR` defaults to `server/logs`; override via `LOG_DIR` env. In tests, set `LOG_DIR` to an OS temp dir (the test does this) to avoid polluting the repo.
  - `/healthz` (mounted in `index.js`, **not** under `/api`, no auth) → `200 { status:'ok', uptime, counters }`.

- [ ] **Step 1: Write the failing test**

```js
// server/test/observability.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { startServer, buildOrg } = require("./helpers");

test("observability: healthz + access log + counters", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unblk-log-"));
  process.env.LOG_DIR = dir;
  const { base, close } = await startServer();
  try {
    const health = await fetch(base + "/healthz").then((r) => r.json());
    assert.equal(health.status, "ok");
    assert.ok(typeof health.counters.requests === "number");

    await buildOrg(base, "Acme", "acme"); // generates traffic
    const after = await fetch(base + "/healthz").then((r) => r.json());
    assert.ok(after.counters.requests >= 1);

    const log = fs.readFileSync(path.join(dir, "access.log"), "utf8");
    assert.ok(log.split("\n").filter(Boolean).length >= 1);
    const first = JSON.parse(log.split("\n").filter(Boolean)[0]);
    assert.ok(first.method && typeof first.status === "number");
  } finally {
    await close();
    delete process.env.LOG_DIR;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/observability.test.js`
Expected: FAIL — `/healthz` 404.

- [ ] **Step 3: Write the logger lib**

Create `server/lib/logger.js`:

```js
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const counters = { requests: 0, errors: 0, byStatus: {} };

function logDir() {
  return process.env.LOG_DIR || path.join(__dirname, "..", "logs");
}
function append(file, obj) {
  try {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, file), JSON.stringify(obj) + "\n");
  } catch (_) {}
}

function requestLogger() {
  return function (req, res, next) {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const line = {
        t: new Date().toISOString(),
        method: req.method, path: req.originalUrl || req.url,
        status: res.statusCode, ms: Math.round(ms * 10) / 10, ip: req.ip,
      };
      counters.requests++;
      counters.byStatus[res.statusCode] = (counters.byStatus[res.statusCode] || 0) + 1;
      append("access.log", line);
      if (process.env.LOG_STDOUT) console.log(JSON.stringify(line));
    });
    next();
  };
}

function errorHandler() {
  return function (err, req, res, next) {
    counters.errors++;
    const entry = {
      t: new Date().toISOString(), level: "error",
      method: req.method, path: req.originalUrl || req.url,
      message: err && err.message, stack: err && err.stack,
    };
    append("error.log", entry);
    if (process.env.ERROR_WEBHOOK_URL) {
      try {
        fetch(process.env.ERROR_WEBHOOK_URL, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(entry),
        }).catch(() => {});
      } catch (_) {}
    }
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    else next(err);
  };
}

module.exports = { requestLogger, errorHandler, counters };
```

- [ ] **Step 4: Wire into index.js**

In `server/index.js`, require it and place the request logger **first** (right after `express.json` is fine, but earliest so it times everything), add `/healthz`, and the error handler **last** (after the static handler):

```js
const { requestLogger, errorHandler, counters } = require("./lib/logger");
```

Inside `createApp(db)`, immediately after `const app = express();`:

```js
  app.use(requestLogger());
  app.get("/healthz", (req, res) =>
    res.json({ status: "ok", uptime: process.uptime(), counters })
  );
```

At the very end of `createApp`, after `app.use(express.static(...))` and before `return app;`:

```js
  app.use(errorHandler());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npm test -- server/test/observability.test.js`
Expected: PASS.

- [ ] **Step 6: Ignore the logs dir**

Append `server/logs/` to the repo `.gitignore` (create the line if absent). Verify `server/logs/` is not staged.

- [ ] **Step 7: Run the full suite**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/lib/logger.js server/index.js server/test/observability.test.js .gitignore
git commit -m "feat(ops): structured request/error logging, /healthz, counters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Cursor pagination on GET /api/blockages

**Files:**
- Modify: `server/routes/blockages.js` (list handler)
- Test: `server/test/pagination.test.js` (Create)

**Interfaces:**
- Consumes: existing list query.
- Produces: `GET /api/blockages?status=&cohortId=&cursor=&limit=` → `{ blockages: [...], nextCursor }`. Default `limit=20` (cap 100). Keyset pagination on `b.id < cursor` (ordered `b.created_at DESC, b.id DESC`; since ids are monotonic, `id <` is a stable cursor). `nextCursor` is the last row's `id`, or `null` when the page is the last. Backward compatible: when no `cursor`/`limit` given, returns the first page (≤20) — existing tests that read `.blockages` still pass because the field name is unchanged.

> Backward-compat note: existing tests assert on `body.blockages` length for small datasets (< 20) — those still pass. Only add pagination params; do not break the shape.

- [ ] **Step 1: Write the failing test**

```js
// server/test/pagination.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("pagination: GET /api/blockages pages by cursor", async () => {
  const { base, close } = await startServer();
  try {
    const org = await buildOrg(base, "Acme", "acme");
    for (let i = 0; i < 25; i++) {
      await org.student.post("/api/blockages", {
        title: "B" + i, cohortId: org.cohortId, details: "d" + i,
      });
    }
    const p1 = await org.student.get("/api/blockages?limit=10");
    assert.equal(p1.status, 200);
    assert.equal(p1.body.blockages.length, 10);
    assert.ok(p1.body.nextCursor);

    const p2 = await org.student.get(`/api/blockages?limit=10&cursor=${p1.body.nextCursor}`);
    assert.equal(p2.body.blockages.length, 10);
    // pages must not overlap
    const ids1 = new Set(p1.body.blockages.map((b) => b.id));
    assert.ok(p2.body.blockages.every((b) => !ids1.has(b.id)));

    const p3 = await org.student.get(`/api/blockages?limit=10&cursor=${p2.body.nextCursor}`);
    assert.equal(p3.body.blockages.length, 5);
    assert.equal(p3.body.nextCursor, null);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/pagination.test.js`
Expected: FAIL — `nextCursor` undefined, all 25 returned.

- [ ] **Step 3: Add pagination to the list handler**

In `server/routes/blockages.js`, in `router.get("/blockages", ...)`, replace the tail (the `sql += " ORDER BY..."` and the `res.json(...)`) with:

```js
    if (req.query.cursor) {
      sql += " AND b.id < ?";
      args.push(Number(req.query.cursor));
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    sql += " ORDER BY b.created_at DESC, b.id DESC LIMIT ?";
    args.push(limit + 1);
    const sla = readSla(db, orgId);
    const rows = db.prepare(sql).all(...args);
    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? page[page.length - 1].id : null;
    res.json({ blockages: page.map((r) => summary(r, sla)), nextCursor });
```

(`readSla` + `summary(r, sla)` were introduced in Task 6.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- server/test/pagination.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite (shape regression)**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/blockages.js server/test/pagination.test.js
git commit -m "feat(ops): cursor pagination on GET /api/blockages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Front-end — focus trap + accessible modal helpers

**Files:**
- Modify: `functions/api.js` (add `trapFocus`, `releaseFocus`, `openModal`, `closeModal`)
- Test: `server/test/frontend_syntax.test.js` (Create — `node --check` guard)

**Interfaces:**
- Consumes: DOM only (browser runtime).
- Produces (global functions in `functions/api.js`):
  - `trapFocus(el)` — focuses the first focusable element in `el`, installs a `keydown` handler that cycles Tab/Shift+Tab within `el`. Stores the previously focused element.
  - `releaseFocus()` — removes the handler and returns focus to the previously focused element.
  - `openModal(overlay)` — sets `overlay.style.display = "flex"`, `overlay.setAttribute("aria-hidden","false")`, finds the `.modal-panel` (or first child element) and sets `role="dialog"` + `aria-modal="true"`, calls `trapFocus`, and wires an Esc keydown to `closeModal(overlay)`.
  - `closeModal(overlay)` — sets `display="none"`, `aria-hidden="true"`, `releaseFocus()`, removes the Esc handler.
  - These are additive: existing pages that toggle `.modal` display directly keep working; pages may opt into `openModal/closeModal`.

> This task can't run in a DOM-less node test, so its verification gate is `node --check functions/api.js` (syntax) plus the manual Playwright/browser check noted in the self-review. The `frontend_syntax.test.js` test enforces parseability of every front-end JS file via `child_process`.

- [ ] **Step 1: Write the failing test (front-end syntax gate)**

```js
// server/test/frontend_syntax.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

test("front-end JS files all parse with node --check", () => {
  const fnDir = path.join(__dirname, "..", "..", "functions");
  const files = fs.readdirSync(fnDir).filter((f) => f.endsWith(".js"));
  assert.ok(files.includes("api.js"));
  for (const f of files) {
    execFileSync(process.execPath, ["--check", path.join(fnDir, f)]);
  }
});

test("api.js exposes focus-trap + modal helpers", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "functions", "api.js"), "utf8");
  for (const fn of ["function trapFocus", "function releaseFocus", "function openModal", "function closeModal"]) {
    assert.ok(src.includes(fn), `missing ${fn}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/frontend_syntax.test.js`
Expected: FAIL — second test fails (`missing function trapFocus`).

- [ ] **Step 3: Add the helpers to functions/api.js**

Append to `functions/api.js` (after `refreshNotifDot`):

```js
// --- Accessibility: focus trap + modal helpers ----------------------
let _focusReturn = null;
let _trapEl = null;
let _trapHandler = null;

function _focusable(el) {
  return Array.from(el.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((n) => n.offsetParent !== null || n === document.activeElement);
}

function trapFocus(el) {
  _focusReturn = document.activeElement;
  _trapEl = el;
  const items = _focusable(el);
  if (items.length) items[0].focus();
  _trapHandler = function (e) {
    if (e.key !== "Tab") return;
    const f = _focusable(el);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  el.addEventListener("keydown", _trapHandler);
}

function releaseFocus() {
  if (_trapEl && _trapHandler) _trapEl.removeEventListener("keydown", _trapHandler);
  if (_focusReturn && _focusReturn.focus) _focusReturn.focus();
  _trapEl = _trapHandler = _focusReturn = null;
}

function openModal(overlay) {
  overlay.style.display = "flex";
  overlay.setAttribute("aria-hidden", "false");
  const panel = overlay.querySelector(".modal-panel") || overlay.firstElementChild;
  if (panel) { panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); }
  trapFocus(overlay);
  overlay._escHandler = function (e) { if (e.key === "Escape") closeModal(overlay); };
  document.addEventListener("keydown", overlay._escHandler);
}

function closeModal(overlay) {
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
  if (overlay._escHandler) { document.removeEventListener("keydown", overlay._escHandler); overlay._escHandler = null; }
  releaseFocus();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- server/test/frontend_syntax.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api.js server/test/frontend_syntax.test.js
git commit -m "feat(a11y): focus-trap + accessible modal open/close helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Front-end — ARIA on the shell + load-more helper

**Files:**
- Modify: `functions/api.js` (`renderShell` ARIA roles/labels; add `loadMore`)
- Test: `server/test/shell_aria.test.js` (Create — string assertions on `api.js` source)

**Interfaces:**
- Consumes: `API`, `escapeHtml`.
- Produces:
  - `renderShell` markup gains: `<nav class="side-nav" aria-label="Primary">` wrapping the nav list; `<aside class="sidebar" aria-label="Sidebar">`; `<main class="content" id="view" role="main" tabindex="-1">`; the logout button gains `aria-label="Log out"`; the notifications bell gains `aria-label="Notifications"`; the topbar `<header role="banner">`. (Existing classes/ids unchanged so CSS + page JS keep working.)
  - `loadMore({ path, cursor, render })` → `async` helper: fetches `path` with `cursor` appended (`?cursor=` or `&cursor=`), calls `render(data.blockages)` (append mode is the caller's job), returns `data.nextCursor`. Used by list pages.

- [ ] **Step 1: Write the failing test**

```js
// server/test/shell_aria.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("renderShell markup carries ARIA roles/labels + loadMore exists", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "functions", "api.js"), "utf8");
  assert.ok(src.includes('aria-label="Primary"'), "nav landmark");
  assert.ok(src.includes('role="main"'), "main role");
  assert.ok(src.includes('aria-label="Log out"'), "logout label");
  assert.ok(src.includes('aria-label="Notifications"'), "bell label");
  assert.ok(src.includes("function loadMore"), "loadMore helper");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/shell_aria.test.js`
Expected: FAIL — labels/roles absent.

- [ ] **Step 3: Add ARIA + loadMore**

In `functions/api.js` `renderShell`, update the markup:
- `<aside class="sidebar">` → `<aside class="sidebar" aria-label="Sidebar">`
- wrap the nav list: change `<ul class="side-nav">${items}</ul>` to `<nav class="side-nav-wrap" aria-label="Primary"><ul class="side-nav">${items}</ul></nav>`
- logout button: add `aria-label="Log out"` to the `<button class="logout-btn" id="logoutBtn" ...>` (keep `title`).
- `<header class="topbar">` → `<header class="topbar" role="banner">`
- bell link: add `aria-label="Notifications"`.
- `<main class="content" id="view">` → `<main class="content" id="view" role="main" tabindex="-1">`

Then append the helper after `closeModal`:

```js
// --- Pagination helper ----------------------------------------------
async function loadMore({ path, cursor, render }) {
  const sep = path.includes("?") ? "&" : "?";
  const url = cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : path;
  const data = await API.get(url);
  if (typeof render === "function") render(data.blockages || []);
  return data.nextCursor || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- server/test/shell_aria.test.js`
Expected: PASS.

- [ ] **Step 5: Run the front-end syntax gate (regression)**

Run: `cd server && npm test -- server/test/frontend_syntax.test.js`
Expected: PASS (api.js still parses).

- [ ] **Step 6: Commit**

```bash
git add functions/api.js server/test/shell_aria.test.js
git commit -m "feat(a11y): ARIA landmarks/labels on app shell + loadMore helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Wire "Load more" into the list pages

**Files:**
- Modify: `functions/owner_blockages.js`
- Modify: `functions/dashbord.js`
- Modify: `functions/instructor.js`
- Test: `server/test/frontend_syntax.test.js` (already exists — re-run as the gate)

**Interfaces:**
- Consumes: `loadMore`, `API`, the paginated `GET /api/blockages` (`{ blockages, nextCursor }`).
- Produces: each list page keeps a module-scoped `cursor`, renders the first page, and shows a `<button class="btn-ghost load-more">Load more</button>` when `nextCursor` is non-null. Clicking it calls `loadMore({ path, cursor, render: append })`, appends rows, updates `cursor`, and hides the button when `nextCursor` becomes null.

> Each page reads `{ blockages, nextCursor }` now (was `{ blockages }`). The rendering function must **append** on load-more and **replace** on first load. Since these are vanilla pages with bespoke render functions, the exact insertion differs per file; the contract is identical across all three.

- [ ] **Step 1: Update owner_blockages.js**

Locate where it calls `API.get("/api/blockages...")` and renders. Refactor to:
- a module variable `let cursor = null;` and `let listPath = "/api/blockages";` (carry any active status/cohort filter in `listPath`).
- `async function firstPage() { cursor = null; const d = await API.get(listPath); renderRows(d.blockages, /*replace*/ true); cursor = d.nextCursor; toggleLoadMore(); }`
- `async function nextPage() { cursor = await loadMore({ path: listPath, cursor, render: (rows) => renderRows(rows, /*replace*/ false) }); toggleLoadMore(); }`
- `function toggleLoadMore(){ const b=document.querySelector(".load-more"); if(b) b.hidden = !cursor; }`
- Add the button to the list container markup: `<button class="btn-ghost load-more" hidden>Load more</button>` and wire `addEventListener("click", nextPage)`.

(Keep `renderRows(rows, replace)` building `innerHTML` for replace and `insertAdjacentHTML("beforeend", …)` for append; escape via `escapeHtml` as today.)

- [ ] **Step 2: Apply the same pattern to dashbord.js and instructor.js**

Repeat the Step-1 structure in `functions/dashbord.js` and `functions/instructor.js`. The student board groups by status; for load-more, append into the matching status column. The instructor queue is a flat list — append to the queue container. Keep each file's existing filters in `listPath`.

- [ ] **Step 3: Run the front-end syntax gate**

Run: `cd server && npm test -- server/test/frontend_syntax.test.js`
Expected: PASS (all three pages still parse).

- [ ] **Step 4: Manual smoke (documented, not automated)**

Run: `cd server && npm start`, open `owner_blockages.html` with >20 blockages, confirm "Load more" appends and disappears at the end. (This is the Playwright/manual gate; capture a screenshot.)

- [ ] **Step 5: Commit**

```bash
git add functions/owner_blockages.js functions/dashbord.js functions/instructor.js
git commit -m "feat(ops): Load-more pagination in blockage list pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Focus styles + accessibility CSS

**Files:**
- Modify: `dashboard.css`
- Test: `server/test/a11y_css.test.js` (Create — string assertions on `dashboard.css`)

**Interfaces:**
- Consumes: "Signal" tokens (`--flow`, `--ink`) defined in `stylesheet.main.css`.
- Produces in `dashboard.css`:
  - A visible focus-ring rule: `:focus-visible { outline: 2px solid var(--flow); outline-offset: 2px; }` plus a stronger ring for buttons/links/inputs.
  - `.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }`
  - `[role="dialog"]` gets `outline: none;` (the trap manages focus) and the modal overlay keeps its existing layout.
  - `.load-more[hidden] { display:none; }` so the toggled button hides.

- [ ] **Step 1: Write the failing test**

```js
// server/test/a11y_css.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("dashboard.css ships focus-visible + sr-only + load-more rules", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "..", "dashboard.css"), "utf8");
  assert.ok(css.includes(":focus-visible"), "focus-visible rule");
  assert.ok(css.includes(".sr-only"), "sr-only utility");
  assert.ok(css.includes(".load-more[hidden]"), "load-more hidden rule");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/a11y_css.test.js`
Expected: FAIL — rules absent.

- [ ] **Step 3: Add the CSS**

Append to `dashboard.css`:

```css
/* --- Accessibility -------------------------------------------------- */
:focus-visible {
  outline: 2px solid var(--flow);
  outline-offset: 2px;
  border-radius: 4px;
}
a:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--flow);
  outline-offset: 2px;
}
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
[role="dialog"] { outline: none; }
.load-more[hidden] { display: none; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- server/test/a11y_css.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard.css server/test/a11y_css.test.js
git commit -m "feat(a11y): visible focus styles + sr-only utility in dashboard.css

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: Owner Ops page (SLA config + audit + data tools)

**Files:**
- Create: `ops.html`
- Create: `functions/ops.js`
- Modify: `functions/api.js` (`NAV.owner` gains an "Ops" entry)
- Test: `server/test/frontend_syntax.test.js` (re-run gate) + `server/test/ops_nav.test.js` (Create)

**Interfaces:**
- Consumes: `requireRole("owner")`, `renderShell`, `API`, `openModal/closeModal`, `escapeHtml`, `fmtRelative`; endpoints `GET/PUT /api/sla`, `GET /api/audit`, `GET /api/audit/export.csv`, `POST /api/sla/escalate`, `GET /api/export/org.json`, `GET /api/export/users/:id.json`, `DELETE /api/users/:id/data`.
- Produces: `ops.html` (loads `functions/api.js` then `functions/ops.js`, has `<div id="app"></div>`), an Ops page with three sections — SLA form, Audit log table (paginated via the audit `nextCursor` + a "Load more" button + an Export CSV link + an "Escalate now" button), and Data tools (Export org JSON link, plus erase-user by id with a confirm modal). `NAV.owner` in `functions/api.js` gains `{ href: "ops.html", icon: "cog", label: "Ops" }` placed before Settings.

- [ ] **Step 1: Write the failing test (nav + page presence)**

```js
// server/test/ops_nav.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("owner nav includes Ops + ops.html/ops.js exist and parse", () => {
  const root = path.join(__dirname, "..", "..");
  const api = fs.readFileSync(path.join(root, "functions", "api.js"), "utf8");
  assert.ok(api.includes('href: "ops.html"'), "Ops nav entry");
  assert.ok(fs.existsSync(path.join(root, "ops.html")), "ops.html exists");
  assert.ok(fs.existsSync(path.join(root, "functions", "ops.js")), "ops.js exists");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- server/test/ops_nav.test.js`
Expected: FAIL — nav entry + files missing.

- [ ] **Step 3: Add the nav entry**

In `functions/api.js`, in `NAV.owner`, insert before the Settings entry:

```js
    { href: "ops.html", icon: "cog", label: "Ops" },
```

- [ ] **Step 4: Create ops.html**

Create `ops.html` (mirror the structure of `owner_blockages.html` — `<div id="app"></div>`, load `functions/api.js`, then `functions/ops.js`):

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ops · Unblockify</title>
  <link rel="stylesheet" href="stylesheet.main.css" />
  <link rel="stylesheet" href="dashboard.css" />
</head>
<body>
  <div id="app"></div>
  <script src="functions/api.js"></script>
  <script src="functions/ops.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create functions/ops.js**

Create `functions/ops.js`:

```js
(async function () {
  const session = await requireRole("owner");
  if (!session) return;
  const view = renderShell({
    user: session.user, org: session.org, active: "ops.html",
    title: "Ops & trust", crumb: "Owner",
  });

  view.innerHTML = `
    <section class="card" aria-labelledby="sla-h">
      <h2 id="sla-h">SLA & business hours</h2>
      <form id="slaForm" class="form-grid">
        <label>Response target (h)<input name="responseHours" type="number" min="1" /></label>
        <label>Resolve target (h)<input name="resolveHours" type="number" min="1" /></label>
        <label>Day start (0-23)<input name="bhStart" type="number" min="0" max="23" /></label>
        <label>Day end (1-24)<input name="bhEnd" type="number" min="1" max="24" /></label>
        <label>Business days<input name="bhDays" type="text" placeholder="1,2,3,4,5" /></label>
        <label>TZ offset (min)<input name="tzOffsetMin" type="number" /></label>
        <button class="btn-primary" type="submit">Save SLA</button>
      </form>
    </section>

    <section class="card" aria-labelledby="audit-h">
      <h2 id="audit-h">Audit log</h2>
      <div class="row-actions">
        <button class="btn-ghost" id="escalateBtn">Escalate now</button>
        <a class="btn-ghost" href="/api/audit/export.csv">Export CSV</a>
      </div>
      <table class="data-table"><thead><tr>
        <th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>IP</th>
      </tr></thead><tbody id="auditBody"></tbody></table>
      <button class="btn-ghost load-more" id="auditMore" hidden>Load more</button>
    </section>

    <section class="card" aria-labelledby="data-h">
      <h2 id="data-h">Data tools</h2>
      <a class="btn-ghost" href="/api/export/org.json">Export org JSON</a>
      <form id="eraseForm" class="row-actions">
        <input name="userId" type="number" placeholder="User id" aria-label="User id to erase" />
        <button class="btn-ghost" type="submit">Erase user data</button>
      </form>
    </section>`;

  // --- SLA ---
  const slaForm = document.getElementById("slaForm");
  const sla = (await API.get("/api/sla")).sla;
  for (const k of ["responseHours","resolveHours","bhStart","bhEnd","bhDays","tzOffsetMin"])
    slaForm.elements[k].value = sla[k];
  slaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {};
    for (const k of ["responseHours","resolveHours","bhStart","bhEnd","tzOffsetMin"])
      body[k] = Number(slaForm.elements[k].value);
    body.bhDays = slaForm.elements.bhDays.value;
    try { await API.put("/api/sla", body); toast("SLA saved", "success"); }
    catch (err) { toast(err.message, "error"); }
  });

  // --- Audit (paginated) ---
  let cursor = null;
  const body = document.getElementById("auditBody");
  const moreBtn = document.getElementById("auditMore");
  function rowHtml(e) {
    return `<tr>
      <td>${escapeHtml(fmtRelative(e.createdAt))}</td>
      <td><code>${escapeHtml(e.action)}</code></td>
      <td>${escapeHtml(e.actorName || "—")}</td>
      <td>${escapeHtml((e.targetType || "") + (e.targetId ? " #" + e.targetId : ""))}</td>
      <td>${escapeHtml(e.ip || "")}</td></tr>`;
  }
  async function loadAudit(append) {
    const url = cursor ? `/api/audit?cursor=${cursor}` : "/api/audit";
    const d = await API.get(url);
    const html = d.entries.map(rowHtml).join("");
    if (append) body.insertAdjacentHTML("beforeend", html); else body.innerHTML = html;
    cursor = d.nextCursor;
    moreBtn.hidden = !cursor;
  }
  moreBtn.addEventListener("click", () => loadAudit(true));
  document.getElementById("escalateBtn").addEventListener("click", async () => {
    const r = await API.post("/api/sla/escalate", {});
    toast(`Escalated ${r.escalated} (breached ${r.breached}, at risk ${r.atRisk})`, "info");
  });
  await loadAudit(false);

  // --- Erase ---
  document.getElementById("eraseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = Number(e.target.elements.userId.value);
    if (!id || !confirm("Erase all data for user #" + id + "? This cannot be undone.")) return;
    try { await API.del(`/api/users/${id}/data`); toast("User data erased", "success"); }
    catch (err) { toast(err.message, "error"); }
  });
})();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd server && npm test -- server/test/ops_nav.test.js server/test/frontend_syntax.test.js`
Expected: PASS (nav entry present; ops.js parses).

- [ ] **Step 7: Manual smoke (documented)**

Run `npm start`, log in as an owner, open `ops.html`: save SLA, see the audit table populate, click "Escalate now", export CSV/JSON, erase a test student. Capture a screenshot.

- [ ] **Step 8: Commit**

```bash
git add ops.html functions/ops.js functions/api.js server/test/ops_nav.test.js
git commit -m "feat(ops): owner Ops page — SLA config, audit viewer, data tools

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 15: CI workflow (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`
- Test: manual (the workflow runs on push/PR); local dry-run via the same commands.

**Interfaces:**
- Consumes: `server/package.json` scripts (`npm ci`, `npm test`); front-end JS under `functions/`.
- Produces: a workflow `CI` that, on `push` and `pull_request`, runs a matrix on Node 22 and 24: checkout → setup-node → `npm ci` (in `server/`) → `npm test` (in `server/`) → `node --check` on every `functions/*.js`. (`npm test` already runs with `--experimental-sqlite` via the package script.)

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [22, 24]
    steps:
      - uses: actions/checkout@v4
      - name: Use Node ${{ matrix.node }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - name: Install (server)
        working-directory: server
        run: npm ci
      - name: Backend tests
        working-directory: server
        run: npm test
      - name: Front-end syntax check
        run: |
          set -e
          for f in functions/*.js; do
            node --check "$f"
          done
```

- [ ] **Step 2: Dry-run the commands locally**

Run:
```bash
cd /home/idder/Documents/github/Unblockify/server && npm ci && npm test
cd /home/idder/Documents/github/Unblockify && for f in functions/*.js; do node --check "$f"; done
```
Expected: all tests pass; every front-end file checks clean (no output = success).

> Note: `npm ci` requires a committed `server/package-lock.json`. If none exists, generate it first (`cd server && npm install` to produce the lockfile) and commit it as part of this task — otherwise `npm ci` fails in CI.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml server/package-lock.json
git commit -m "ci: GitHub Actions — npm ci + npm test + front-end node --check (Node 22/24)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 16: Full regression + docs touch-up

**Files:**
- Modify: `docs/EXPECTATIONS-AND-ROADMAP.md` (mark Phase 5 items delivered)
- Modify: `CLAUDE.md` (note new routes/tables/lib files in the architecture summary)
- Test: full suite.

**Interfaces:** none new — this task verifies the whole phase and updates docs to match reality.

- [ ] **Step 1: Run the entire backend suite**

Run: `cd server && npm test`
Expected: PASS — all prior tests plus `sla`, `sla_math`, `audit`, `audit_view`, `assign`, `escalate`, `gdpr`, `observability`, `pagination`, `frontend_syntax`, `shell_aria`, `a11y_css`, `ops_nav`.

- [ ] **Step 2: Update the roadmap**

In `docs/EXPECTATIONS-AND-ROADMAP.md`, in the Phase 5 row and the "we break the promise where" notes, mark the Phase 5 gaps (SLA + assignment rules; audit log; GDPR; observability; accessibility; pagination; CI) as delivered.

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md` `### Backend` and `### Database`, add: `routes/ops.js`, `routes/gdpr.js`, `lib/sla.js`, `lib/audit.js`, `lib/assign.js`, `lib/logger.js`; tables `sla_config`, `audit_log` and the new `cohorts.assign_strategy`/`rr_cursor` columns; the `/healthz` endpoint; the `ops.html` owner page; and note the env gates `LOG_DIR`, `LOG_STDOUT`, `ERROR_WEBHOOK_URL`.

- [ ] **Step 4: Commit**

```bash
git add docs/EXPECTATIONS-AND-ROADMAP.md CLAUDE.md
git commit -m "docs: record Phase 5 (ops & trust) delivery

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

**1. Spec coverage** — every Phase 5 scope item maps to a task:
- [ ] SLA + business hours + escalation → Tasks 1, 2, 6 (config, math, escalation + blockage SLA fields).
- [ ] Assignment rules (round-robin / least-loaded) → Task 5.
- [ ] Audit log (immutable, owner viewer + export) → Tasks 3, 4 (table+writer+events, viewer+CSV).
- [ ] GDPR export/erasure → Task 7.
- [ ] Observability (request log, error capture + webhook, `/healthz`, counters) → Task 8.
- [ ] Accessibility (focus trap, ARIA, keyboard/Esc, focus styles) → Tasks 10, 11, 13.
- [ ] Pagination (cursor + load-more) → Tasks 9, 11 (helper), 12 (pages).
- [ ] CI (Actions, npm ci/test, node --check, Node 22/24) → Task 15.

**2. Placeholder scan** — no "TBD/handle edge cases/similar to Task N" left; every code step shows the actual code. Where a page's render is bespoke (Task 12), the exact contract + structure is given rather than vague prose.

**3. Type/name consistency** — verify across tasks:
- [ ] `readSla(db, orgId)` exported from `routes/ops.js` and imported in `blockages.js` (Tasks 1, 6, 9).
- [ ] `summary(r, sla)` signature change is applied at all call sites (Task 6 Step 3 note + Task 9).
- [ ] `audit(db, {...})` + `AUDIT.*` constants used identically in `auth.js`, `members.js`, `blockages.js`, `ops.js`, `gdpr.js` (Tasks 3, 4, 6, 7).
- [ ] `slaState(blockage, sla, nowISO)` shape (`label/breached/atRisk/responseDueIn/resolveDueIn`) consumed consistently (Tasks 2, 6, 9).
- [ ] `pickAssignee(db, {cohortId, strategy})` argument shape matches caller in `blockages.js` (Task 5).
- [ ] `loadMore({path, cursor, render})` signature identical in helper (Task 11) and pages (Task 12) and ops.js audit loader (Task 14 uses its own inline loader — acceptable, different response shape).
- [ ] `openModal/closeModal/trapFocus/releaseFocus` names match between Task 10 (defs) and Task 14 (Interfaces reference).

**4. Tenancy** — every new query filters by `org_id`/`req.user.orgId`; cross-tenant targets return 404 (audit viewer Task 4, GDPR Task 7, escalation Task 6 scoped to caller). Audit rows carry `org_id`.

**5. Constraints** — pure-JS only (no new deps); optional webhook gated behind `ERROR_WEBHOOK_URL`; tests use `node:test` + `startServer/buildOrg/joinMember/makeClient`; AI gated by helper default `AI_AUTORESPOND=0`; every commit message ends with the Co-Authored-By line.

**6. Manual/Playwright gates** (no DOM in node:test): Task 12 load-more append, Task 14 Ops page interactions, and focus-trap keyboard behavior (Task 10) are verified by running the server and a browser/Playwright pass — captured as screenshots, noted in each task.
