# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Unblockify is a **multi-tenant SaaS platform** for managing student "blockages" (things a
student is stuck on). Any organization self-registers, gets an isolated workspace, invites
instructors and students, and turns blockages into resolved, measured momentum. It runs
entirely **locally**: a Node/Express server with a **SQLite** database, serving a plain
HTML/CSS/vanilla-JS front-end. No framework, no build step.

Vision: `docs/VISION.md`. Implementation plan: `docs/superpowers/plans/2026-06-21-unblockify-platform.md`.

## Running

```bash
cd server
npm install        # pure-JS deps only (no native build)
npm start          # -> http://localhost:5050   (node --experimental-sqlite)
npm test           # backend test suite (node:test, in-memory DB)
```

`npm run dev` adds `--watch`. Port `5050` by default (3000 is often taken); override `PORT`.
Requires **Node ≥ 22** for the built-in `node:sqlite` module (developed on Node 24). The
SQLite file is `server/data.db` (gitignored); delete it to reset. There is **no seeded admin** —
the first person to sign up creates an organization and becomes its **owner**.

## Roles & tenancy
- Three roles: **owner** (creates the org, manages members/cohorts/briefs, sees analytics;
  can also act as an instructor), **instructor** (works the queue for assigned cohorts,
  claims & resolves), **student** (reports blockages, follows status, replies in threads).
- **Multi-tenant in one DB**: every row carries `org_id`; every query filters by the caller's
  `org_id`. Cross-tenant access returns 404, never data. Enforced server-side via the JWT.
- **Onboarding**: signup creates an org + owner. Owners generate **invite links/codes**
  (`/api/invites`); opening `join.html?code=…` creates a user with the invite's role + org +
  cohort. No email server.

## Architecture

### Backend (`server/`)
- `index.js` — exports `createApp(db)` (testable factory); `listen`s only when run directly.
  Caps JSON bodies at 100kb, sets conservative security headers (nosniff / frame-deny /
  no-referrer), returns JSON 404 for unknown `/api` paths.
- `db.js` — `openDb(path)` opens + migrates SQLite (pass `":memory:"` for tests). Schema below.
- `auth.js` — JWT in an **httpOnly cookie** (`unblockify_token`) carrying `{userId, orgId, role}`;
  `requireAuth`, `requireRole(...roles)`, `requireStaff` (owner|instructor). The role lives in the
  JWT, so a role change re-issues the caller's token (see ownership transfer) — a promoted member's
  own elevated powers take effect on their next request/login.
- `lib/helpers.js` — `slugify`, `randomCode`, `publicUser/publicOrg`, `addEvent`, `notify`,
  `cohortInstructorIds`, `canSeeBlockage` (the visibility rule).
- `lib/validate.js` — `tooLong(value, max, label)` length-cap helper used across routes
  (title 200, details/comment 5000, names 100, orgName 120).
- `lib/ratelimit.js` — `rateLimit({windowMs, max})` in-memory per-IP limiter on login/signup/join;
  no-op when `AUTH_RATELIMIT=off` (set by the test helper), `max` via `AUTH_RATELIMIT_MAX`.
- `routes/` — each is a factory `(db) => router`:
  - `auth.js` — signup (create org), login, logout, me, invite preview, join, **`PUT /me`**
    (edit own name / change password). Login/signup/join are rate-limited.
  - `members.js` — invites create/list/revoke, members list, **`PUT /members/:id`** (change a
    member's cohort or role), **`DELETE /members/:id`** (remove), **`PUT /org`** (rename org),
    **`POST /members/:id/transfer-ownership`** (promote member to owner, demote self). Owner only.
  - `cohorts.js` — cohorts CRUD (delete refuses while non-empty), briefs (incl. **`PUT /briefs/:id`**
    rename), instructor assignment, **`POST /cohorts/:id/move-students`** (move students+blockages to
    another cohort). `GET /cohorts/:id` includes briefs, instructors, and **students**.
  - `blockages.js` — report/list/detail, **claim → resolve → reopen** lifecycle, edit/delete (open
    only), **reassign** (`/assign` + `/assignees`), **student-reopen** of AI-resolved, comments
    (thread) with **author edit/delete**, and **`GET /blockages/export.csv`**. Writes
    `status_events` + `notifications`.
  - `notifications.js` — list (`?unread=1`) / mark read / read-all / **delete one** / **clear all**.
  - `analytics.js` — totals, resolve rate, median time-to-unblock, volume, by-cohort,
    by-instructor, **AI deflection rate + hours saved**, an **at-risk students** radar (includes
    cohort-less students), and **`GET /activity`** (recent status-event feed).
- `lib/ai.js` — the **AI Teaching Assistant** (the product wedge). Uses the real Claude API
  when `ANTHROPIC_API_KEY` is set, else a deterministic local fallback (so it always demos).
  `unblock()` posts a Socratic first response to every new blockage, grounded in the cohort/brief
  and retrieved past resolutions; `draftReply()` is the instructor copilot. Model via `AI_MODEL`
  (default `claude-haiku-4-5`). `lib/retrieval.js` is the self-building knowledge base (keyword
  similarity over the org's resolved blockages). On report, the AI replies in the background
  (`setImmediate`; gate off in tests with `AI_AUTORESPOND=0`); a student can hit "This unblocked
  me" (`POST /api/blockages/:id/ai-resolve`, `resolution_type='ai'`) to deflect. AI comments have
  `is_ai=1` / null `user_id` / `ai_author`; the `ai_reply` status-event type marks them.
- `test/` — `helpers.js` boots an in-memory app on an ephemeral port + a cookie-tracking client,
  and exports `buildOrg`/`joinMember` so each feature area has its own `*.test.js` (api, blockage_ops,
  cohorts_ops, cohorts_depth, org, profile, validate, notifications, ratelimit, activity, comments,
  export). `npm test` auto-discovers all of them (40+ tests). Helper defaults `AI_AUTORESPOND=0`
  and `AUTH_RATELIMIT=off`.

### Database (`db.js`, all `org_id`-scoped)
`organizations, users(role owner|instructor|student, cohort_id), cohorts, briefs,
cohort_instructors, invites, blockages(status open|in_support|resolved, assignee_id,
resolution_*), comments(nullable user_id + is_ai/ai_author for AI messages),
status_events(created|claimed|comment|ai_reply|resolved|reopened), notifications`.

### Front-end (root pages + `functions/`)
Every page loads `functions/api.js` first. `api.js` is the shared runtime: `API` (fetch wrapper),
`getSession()`→`{user,org}`, `requireRole(...roles)` (guards + redirects), `dashboardFor(role)`,
`logout()`, `escapeHtml`, `fmtDate/fmtTime/fmtRelative`, `statusMeta(status)`→`{cls,label}`,
`toast()`, and **`renderShell({user,org,active,title,crumb,actions})`** — injects the role-aware
sidebar + topbar into `<div id="app">` and returns the `<main class="content">` to fill. App
pages follow this pattern (see `owner_dashboard.html` + `functions/owner.js` as the reference).

| Page | Script | Role |
|------|--------|------|
| `index.html` | — | Public marketing landing |
| `login.html` / `signup.html` / `join.html` | `login.js` / `singUp.js` / `join.js` | Auth (signup creates an org) |
| `owner_dashboard.html` | `owner.js` | Owner analytics (inline SVG charts) |
| `owner_blockages.html` | `owner_blockages.js` | Owner: all blockages |
| `members.html` | `members.js` | Owner: members & invites |
| `cohorts.html` | `cohorts.js` | Owner manage / instructor read |
| `instructor_queue.html` | `instructor.js` | Instructor queue |
| `student_dashbord.html` | `dashbord.js` | Student board (Blocked/In support/Resolved) |
| `blockage.html` | `blockage.js` | Shared detail: thread + timeline + claim/resolve/edit |
| `notifications.html` / `settings.html` | `notifications.js` / `settings.js` | All roles |

### Design language — "Signal"
Status is the brand. Tokens at the top of `stylesheet.main.css`: ink `#0C111B`, signal green
`--flow #12B886` (resolved/brand + accents), coral `--blocked #FF5A4D`, amber `--pending`.
Type: **Space Grotesk** (display) / **Inter** (body) / **JetBrains Mono** (`--font-mono`:
eyebrows, `BLK-024` IDs, stats, timestamps, pills). Primary buttons are ink/black. Signature:
the **pulse line** SVG (`<symbol id="mark">`, inlined per page; animated in hero/auth). App shell
+ all platform components (board, detail-grid, timeline, thread, data-table, charts, etc.) live in
`dashboard.css`. Status → UI: `open`→Blocked (`.pill-blocked`/`.status-blocked`), `in_support`→
In support (`.pill-pending`), `resolved`→Resolved (`.pill-resolved`). `desktop.css`/`tablet.css`
are legacy orphans (no page links them).

## Conventions & gotchas
- Modals: the `.modal` overlay defaults to `display:none` and is toggled to `flex` by JS; the
  panel inside is plain `display:block`. (One panel per overlay — don't reintroduce per-panel
  `display:none`.)
- Always render user-supplied values through `escapeHtml` when building HTML.
- Filenames keep legacy spellings: `dashbord`, `singUp.js`. The status pill text is derived from
  `statusMeta`, not hardcoded.
- Verification: backend via `npm test`; full stack via Playwright against the running server
  (signup → invite → join → report → claim/resolve → analytics). No Playwright config is checked
  in; tests were run ad hoc.
