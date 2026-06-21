# Unblockify Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Unblockify into a complete, multi-tenant, role-based SaaS platform (Owner / Instructor / Student) for managing student blockages, runnable locally on Express + SQLite.

**Architecture:** One Express app serves a vanilla-JS front-end and a JSON API. SQLite (`node:sqlite`) holds every tenant's data in one DB, isolated by `org_id` on every row and enforced server-side. Auth is bcrypt + a JWT httpOnly cookie carrying `{ userId, orgId, role }`. The front-end is plain HTML/CSS/JS sharing one design system ("Signal") and a role-aware app shell; pages call the API via `functions/api.js`.

**Tech Stack:** Node 22+ (`node:sqlite`, `node:test`), Express, bcryptjs, jsonwebtoken, cookie-parser; vanilla HTML/CSS/JS; Playwright for E2E.

## Global Constraints
- Fully local: no cloud services, no SMTP, no native build deps. Port `5050` (override `PORT`).
- Every data row carries `org_id`; every query filters by the caller's `org_id`. Cross-tenant access returns 404, never data.
- Roles: `owner` | `instructor` | `student`. Owner can do anything an instructor can within its org.
- Blockage status lifecycle: `open` → `in_support` → `resolved` (no skipping backward except reopen by owner — out of scope).
- Design language "Signal": tokens in `stylesheet.main.css` (ink `#0C111B`, flow `#12B886`, blocked `#FF5A4D`, pending `#F59F00`); Space Grotesk / Inter / JetBrains Mono; pulse-line signature.
- All injected user data rendered through `escapeHtml`.
- Each backend task: write `node:test` test first, see it fail, implement, see it pass, commit. Front-end tasks end with a Playwright screenshot/flow check.
- Test DB is a separate file (`DB_PATH=:memory:` or `data.test.db`); never run tests against `data.db`.

---

## Phase 0 — Backend foundation & test harness

### Task 0.1: Test harness + in-memory DB switch
**Files:** Modify `server/db.js` (honor `DB_PATH`, allow `:memory:`); Create `server/test/helpers.js`; Modify `server/package.json` (add `"test": "node --experimental-sqlite --test"`).
**Interfaces:** Produces `freshDb()` (returns a migrated, seeded in-memory `DatabaseSync`), and `makeApp(db)` injectable app factory.
- [ ] Refactor `server/index.js` to export `createApp(db)` and only `listen` when run directly.
- [ ] `db.js` exports `openDb(path)` (schema + migrate) instead of a singleton; keep a default export for the app.
- [ ] Write `server/test/smoke.test.js`: `openDb(':memory:')` creates tables; `assert` the `users` table exists.
- [ ] Run `npm test`; expect pass. Commit.

### Task 0.2: Multi-tenant schema (rewrite)
**Files:** Modify `server/db.js`.
**Interfaces:** Produces tables: `organizations, users, invites, cohorts, briefs, cohort_instructors, blockages, comments, status_events, notifications` (columns listed in Data Model appendix below).
- [ ] Write the full `CREATE TABLE` schema per the appendix, all with `org_id` where applicable + FKs + indexes.
- [ ] Write `server/test/schema.test.js`: insert an org, a user, a blockage; assert FK + `org_id` present; assert a `CHECK` rejects a bad `role`/`status`.
- [ ] Run, pass, commit.

---

## Phase 1 — Auth & organizations
### Task 1.1: Org signup (creates org + owner)
**Files:** Create `server/routes/auth.js` (rewrite); Modify `server/auth.js` (JWT carries `userId, orgId, role`).
**Interfaces:** `POST /api/auth/signup {orgName, name, email, password}` → creates `organizations` row + `users` row role `owner`; sets cookie; returns `{ user:{id,name,email,role}, org:{id,name,slug} }`. Produces `currentUser(req) -> {userId,orgId,role}`, `requireAuth`, `requireRole(...roles)`, `issueToken(res,{id,orgId,role})`.
- [ ] Test: signup returns 201 with owner role + org; second signup with same email → 409.
- [ ] Implement; pass; commit.

### Task 1.2: Login / logout / me
- [ ] `POST /api/auth/login {email,password}` → cookie + `{user, org}`; bad creds → 401.
- [ ] `POST /api/auth/logout` clears cookie. `GET /api/auth/me` → `{user, org}` or 401.
- [ ] Tests for each; pass; commit.

---

## Phase 2 — Invites & members
### Task 2.1: Create / list / revoke invites (owner)
**Files:** Create `server/routes/members.js`.
**Interfaces:** `POST /api/invites {role, cohortId?}` (owner) → `{code, url}`; `GET /api/invites` (owner) list active; `DELETE /api/invites/:id` revoke. `GET /api/members` list org users.
- [ ] Tests: owner creates instructor invite → code returned; student cannot create invite (403); invite scoped to org.
- [ ] Implement; pass; commit.

### Task 2.2: Inspect + accept invite (join)
**Interfaces:** `GET /api/invites/code/:code` → `{orgName, role, valid}` (public); `POST /api/auth/join {code, name, password}` → creates user with the invite's role+org+cohort, marks invite used, sets cookie.
- [ ] Tests: valid code joins as that role in that org; used/expired code → 410; join puts user in the invite's org (isolation).
- [ ] Implement; pass; commit.

---

## Phase 3 — Cohorts & briefs
### Task 3.1: Cohort CRUD + instructor assignment (owner)
**Files:** Create `server/routes/cohorts.js`.
**Interfaces:** `GET/POST /api/cohorts`, `PUT/DELETE /api/cohorts/:id`; `POST /api/cohorts/:id/instructors {userId}` + `DELETE` to unassign; `GET /api/cohorts/:id` includes briefs + instructors. Student/instructor `GET` sees only cohorts they belong to / are assigned to.
- [ ] Tests: owner creates cohort; assigns instructor; instructor now sees cohort; cross-org cohort invisible.
- [ ] Implement; pass; commit.

### Task 3.2: Briefs under a cohort
**Interfaces:** `POST /api/cohorts/:id/briefs {name}`, `DELETE /api/briefs/:id`.
- [ ] Tests: brief created under cohort; listed in cohort detail; org-scoped.
- [ ] Implement; pass; commit.

---

## Phase 4 — Blockages lifecycle
### Task 4.1: Report / list / get (scoped)
**Files:** Rewrite `server/routes/blockages.js`.
**Interfaces:** `POST /api/blockages {title, cohortId, briefId?, difficulty?, details}` (student, must be in cohort) → status `open`, `org_id` from token. `GET /api/blockages?status=&cohortId=` — student: own; instructor: blockages in assigned cohorts; owner: all in org. `GET /api/blockages/:id` includes student, cohort, brief, assignee, comments, events.
- [ ] Tests: student reports → open; instructor of that cohort sees it; instructor of another cohort does not; other org never sees it.
- [ ] Implement; pass; commit.

### Task 4.2: Status transitions + edit/delete
**Interfaces:** `POST /api/blockages/:id/claim` (instructor) → `in_support`, sets `assignee_id`, writes status_event. `POST /api/blockages/:id/resolve {type, note}` → `resolved`. `PUT /api/blockages/:id` / `DELETE` (student, own, only while `open`; else 423).
- [ ] Tests: claim moves open→in_support + assignee; resolve sets fields + resolved_at; edit/delete blocked once not `open` (423); status_events recorded.
- [ ] Implement; pass; commit.

---

## Phase 5 — Conversation threads + timeline
### Task 5.1: Comments
**Files:** Create `server/routes/comments.js`.
**Interfaces:** `POST /api/blockages/:id/comments {body}` (any member who can see the blockage) → comment; `GET` via blockage detail. Writes a `status_event` of type `comment` and a notification to the other party.
- [ ] Tests: student and assigned instructor can comment; unrelated instructor cannot (404); comment appears in detail; XSS body stored raw, escaped on render (front-end).
- [ ] Implement; pass; commit.

### Task 5.2: Timeline aggregation
**Interfaces:** Blockage detail `events` = merged `status_events` (created, claimed, resolved, comment) sorted ascending, each `{type, actorName, at, meta}`.
- [ ] Tests: lifecycle produces ordered events created→claimed→comment→resolved.
- [ ] Implement; pass; commit.

---

## Phase 6 — Notifications
### Task 6.1: Notification create on events + list/read
**Files:** Create `server/routes/notifications.js`; helper `notify(db, {orgId,userId,type,blockageId,body})`.
**Interfaces:** `GET /api/notifications` (own, newest first, `unread` count), `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`. Created on: blockage reported (→ cohort instructors), claimed (→ student), comment (→ other party), resolved (→ student).
- [ ] Tests: reporting a blockage notifies the cohort's instructors; resolving notifies the student; read marks read; notifications org-scoped.
- [ ] Implement; pass; commit.

---

## Phase 7 — Analytics
### Task 7.1: Org analytics (owner/instructor)
**Files:** Create `server/routes/analytics.js`.
**Interfaces:** `GET /api/analytics` → `{ totals:{open,in_support,resolved}, resolveRate, medianHoursToUnblock, volumeByDay:[{date,count}], byCohort:[{cohort,open,resolved}], byInstructor:[{name,resolved,medianHours}] }`. Scoped to org; instructor limited to assigned cohorts.
- [ ] Tests: with seeded blockages, totals + resolveRate correct; medianHours computed from resolved_at-created_at; byCohort sums match.
- [ ] Implement; pass; commit.

---

## Phase 8 — Front-end foundation (shell + client)
### Task 8.1: API client + helpers (rewrite)
**Files:** Modify `functions/api.js`.
**Interfaces:** `API.get/post/put/del`; `getMe()` → `{user, org}`; `requireRole(...roles)` (redirect mismatches); `logout()`; `escapeHtml`, `fmtDate/fmtTime/fmtRelative`; `toast()`; `nav(role)` returns the sidebar items for a role; `renderShell({user, org, active})` injects sidebar + topbar into `#app`.
- [ ] Manual check: include on a stub page; `renderShell` paints sidebar with correct role items. Commit.

### Task 8.2: Shared shell CSS
**Files:** Modify `dashboard.css` — generalize `.sidebar/.topbar/.content`, add `.board`, `.thread`, `.timeline`, `.table`, `.tabs`, `.chart` component styles (used by later pages).
- [ ] Visual check via Playwright on a stub. Commit.

---

## Phase 9 — Auth & marketing pages
### Task 9.1: Landing (keep, refine copy for multi-org)
**Files:** `index.html`. Update CTA to "Create your workspace".
- [ ] Screenshot check. Commit.
### Task 9.2: Signup (create org), Login, Join
**Files:** `signup.html` (+orgName field), `login.html`, Create `join.html` (reads `?code=`), Modify `functions/singUp.js`, `functions/login.js`, Create `functions/join.js`.
- [ ] Playwright: create org → land in owner dashboard; join via code → land in role dashboard. Commit.

---

## Phase 10 — Student app
### Task 10.1: Overview + My Blockages board
**Files:** `student_dashbord.html`, `functions/dashbord.js`. Board columns Open / In support / Resolved; stat tiles; New-blockage modal (cohort+brief from API).
- [ ] Playwright: report blockage appears in Open; stats update. Commit.
### Task 10.2: Blockage detail (thread + timeline)
**Files:** Create `blockage.html`, `functions/blockage.js` (reads `?id=`). Shows details, status timeline, comment thread with composer; student can comment, edit/delete while open.
- [ ] Playwright: open detail, post a comment, see it + timeline event. Commit.
### Task 10.3: Notifications + Settings
**Files:** Create `notifications.html`+`functions/notifications.js`, `settings.html`+`functions/settings.js` (shared across roles).
- [ ] Playwright: notification list renders + mark read; settings shows profile. Commit.

---

## Phase 11 — Instructor app
### Task 11.1: Queue + claim/resolve in detail
**Files:** `admin_dashbord.html` → instructor Queue (filter by cohort/status); reuse `blockage.html` detail with claim + resolve + thread for instructor.
- [ ] Playwright: instructor claims (→ in support), resolves; student sees resolved. Commit.
### Task 11.2: My Cohorts (read) + nav
**Files:** Create `cohorts.html`+`functions/cohorts.js` (instructor: read assigned; owner: manage — gated).
- [ ] Playwright: instructor sees assigned cohorts. Commit.

---

## Phase 12 — Owner app
### Task 12.1: Analytics dashboard (charts)
**Files:** Create `owner_dashboard.html`+`functions/owner.js`. Inline SVG charts (no library): volume line, status donut, time-to-unblock, by-cohort bars — fed by `/api/analytics`.
- [ ] Playwright: charts render with seeded data; numbers match API. Commit.
### Task 12.2: Members & Invites
**Files:** Create `members.html`+`functions/members.js`. Member table; create invite (role+cohort) → copyable link; revoke.
- [ ] Playwright: owner creates instructor invite, copies link, revokes. Commit.
### Task 12.3: Cohorts & Briefs management + Org Settings
**Files:** extend `cohorts.html` for owner CRUD + instructor assignment + briefs; `settings.html` org section for owner.
- [ ] Playwright: owner creates cohort, adds brief, assigns instructor. Commit.

---

## Phase 13 — End-to-end & isolation verification
### Task 13.1: Full lifecycle E2E
**Files:** Create `server/test/e2e.flow.test.js` or a Playwright spec under `tests/`.
- [ ] Org A: owner signs up → invites instructor + student → student reports (cohort) → instructor claims + threads + resolves → student sees resolved → owner analytics reflect it. Assert no console errors.
### Task 13.2: Tenant isolation E2E
- [ ] Org B created; Org B instructor/owner cannot see Org A blockages/members/analytics via API (404/empty). Assert.
### Task 13.3: Responsive + a11y + reduced-motion sweep; update `CLAUDE.md`, `README.md`.
- [ ] Screenshots at 1280 / 768 / 390. Fix overflow. Update docs. Final commit.

---

## Data Model appendix (exact columns)
- `organizations(id PK, name, slug UNIQUE, created_at)`
- `users(id PK, org_id FK, name, email, password_hash, role CHECK(owner|instructor|student), cohort_id NULL FK, created_at, UNIQUE(email))`
- `invites(id PK, org_id FK, role, cohort_id NULL, code UNIQUE, created_by FK, used_by NULL FK, expires_at NULL, created_at)`
- `cohorts(id PK, org_id FK, name, created_at)`
- `briefs(id PK, org_id FK, cohort_id FK, name, created_at)`
- `cohort_instructors(cohort_id FK, user_id FK, PRIMARY KEY(cohort_id,user_id))`
- `blockages(id PK, org_id FK, cohort_id FK, brief_id NULL FK, user_id FK(student), assignee_id NULL FK(instructor), title, difficulty, details, status CHECK(open|in_support|resolved) DEFAULT 'open', resolution_type NULL, resolution_note NULL, created_at, resolved_at NULL)`
- `comments(id PK, org_id FK, blockage_id FK, user_id FK, body, created_at)`
- `status_events(id PK, org_id FK, blockage_id FK, type CHECK(created|claimed|comment|resolved|reopened), actor_id FK, meta NULL, created_at)`
- `notifications(id PK, org_id FK, user_id FK, type, blockage_id NULL FK, body, read INTEGER DEFAULT 0, created_at)`

## Status → UI mapping
`open` → pill "Blocked" (coral, `.pill-blocked`, card `.status-blocked`); `in_support` → "In support" (amber, `.pill-pending`, `.status-pending`); `resolved` → "Resolved" (green, `.pill-resolved`, `.status-resolved`).
