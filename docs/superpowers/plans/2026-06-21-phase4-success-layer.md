# Phase 4: Success Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the student-success layer that differentiates Unblockify — a Student 360 profile, org tags + tag filtering, saved filter views, post-resolution CSAT, owner nudges/campaigns, and per-org canned responses — so the platform keeps students enrolled and gives owners the retention DNA.

**Architecture:** Each feature is an Express route factory `(db) => router` mounted under `/api` in `server/index.js`, plus new tables added via `migrate()` in `server/db.js` (every row carries `org_id`; every query filters by the caller's `org_id`). The front-end is the existing vanilla HTML/CSS/JS stack: new pages load `functions/api.js`, then a page script, and render through `renderShell` + shared helpers; all user data passes through `escapeHtml`. CSAT and nudges write to the existing `notifications` table. No new dependencies.

**Tech Stack:** Node 22+ (`node:sqlite` via `--experimental-sqlite`, `node:test`), Express, JWT cookie auth (`requireAuth`/`requireRole`/`requireStaff`); vanilla HTML/CSS/JS sharing the "Signal" design system.

## Global Constraints
- Runs entirely LOCAL; no cloud. Node ≥22 node:sqlite (--experimental-sqlite); pure-JS deps only.
- New features local-first; app always runs offline.
- Backend: Express factories `(db)=>router` mounted under /api in server/index.js; JWT cookie {userId,orgId,role}; requireAuth/requireRole/requireStaff.
- Multi-tenant: every row org_id; every query filters by caller org; cross-tenant → 404; new tables/columns via migrate() in server/db.js.
- Front-end: vanilla HTML/CSS/JS; new app pages load functions/api.js then a page script and use renderShell + shared helpers; ALWAYS escapeHtml; follow "Signal" tokens. NOTE: adding a nav-linked page requires updating the NAV in functions/api.js.
- Tests: node:test, in-memory DB via test/helpers.js (buildOrg/joinMember); npm test auto-discovers; gate AI with AI_AUTORESPOND.
- Commit messages end with: Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## File Structure

**New backend files**
- `server/routes/profile.js` — `GET /api/members/:id/profile` (staff): one student's full blockage history + stats. Mounted under `/api`.
- `server/routes/tags.js` — `GET/POST/DELETE /api/tags` (org taxonomy, owner writes) + `POST/DELETE /api/blockages/:id/tags` (staff attach/detach). Mounted under `/api`.
- `server/routes/views.js` — `GET/POST/DELETE /api/views` (per-user saved filter combinations). Mounted under `/api`.
- `server/routes/csat.js` — `POST /api/blockages/:id/csat` (student rates a resolved blockage) + `GET /api/blockages/:id/csat` (rating echo). Mounted under `/api`.
- `server/routes/nudges.js` — `POST /api/nudges` (owner sends an in-app nudge to a cohort or the at-risk list). Mounted under `/api`.
- `server/routes/canned.js` — `GET/POST/DELETE /api/canned` (per-org reply snippets, staff). Mounted under `/api`.

**New test files** (each imports `{ startServer, buildOrg, joinMember, makeClient }` from `./helpers`)
- `server/test/profile.test.js`, `server/test/tags.test.js`, `server/test/views.test.js`, `server/test/csat.test.js`, `server/test/nudges.test.js`, `server/test/canned.test.js`

**New front-end pages + scripts**
- `student_profile.html` + `functions/student_profile.js` — Student 360 (owner/instructor). Not nav-linked; opened from member/at-risk lists via `?id=`.

**Modified files**
- `server/db.js` — add `tags`, `blockage_tags`, `saved_views`, `csat`, `canned_responses` tables + indexes in `migrate()`.
- `server/index.js` — mount the six new routers.
- `server/routes/blockages.js` — include `tags` in the blockage summary/detail; support `?tag=` filter on the list; surface `csat` on detail.
- `functions/api.js` — no NAV change (Student 360 is not nav-linked), but add shared helper `csatStars(n)` and a `tagPills(tags)` helper used by list pages.
- `functions/owner.js` — surface average CSAT stat; link at-risk names to `student_profile.html?id=`.
- `functions/instructor.js` — add a tag filter `<select>` + insert canned response in any future composer (the composer lives in `blockage.js`).
- `functions/blockage.js` — render tag pills + staff add/remove tags; show a "Did this help?" CSAT prompt to the student after resolution; add a "Canned" inserter to the instructor composer.
- `functions/members.js` — link each member name to `student_profile.html?id=`.

---

## Task 1: DB migrations for the Success Layer

**Files:**
- Modify: `server/db.js` (inside `migrate()`, append after the `notifications` table and before the index block)
- Test: `server/test/profile.test.js` (Step 1 uses a tiny schema assertion; later tasks reuse this file)

**Interfaces:**
- Consumes: `openDb(":memory:")` from `server/db.js`.
- Produces tables (all `org_id`-scoped):
  - `tags(id, org_id, name, color, created_at)` — `UNIQUE(org_id, name)`.
  - `blockage_tags(blockage_id, tag_id)` — `PRIMARY KEY(blockage_id, tag_id)`; both FKs `ON DELETE CASCADE`.
  - `saved_views(id, org_id, user_id, name, status, cohort_id, tag_id, search, created_at)`.
  - `csat(id, org_id, blockage_id UNIQUE, user_id, rating INTEGER CHECK(rating BETWEEN 1 AND 5), comment, created_at)`.
  - `canned_responses(id, org_id, title, body, created_by, created_at)`.

- [ ] **Step 1: Write the failing test** — create `server/test/profile.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { openDb } = require("../db");

test("phase4 tables exist after migrate", () => {
  const db = openDb(":memory:");
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const t of ["tags", "blockage_tags", "saved_views", "csat", "canned_responses"]) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --experimental-sqlite --test test/profile.test.js`
Expected: FAIL — `missing table tags`.

- [ ] **Step 3: Write minimal implementation** — in `server/db.js`, inside the `db.exec(\`...\`)` of `migrate()`, insert these `CREATE TABLE` statements immediately before the `CREATE INDEX` lines:

```sql
    CREATE TABLE IF NOT EXISTS tags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, name)
    );

    CREATE TABLE IF NOT EXISTS blockage_tags (
      blockage_id INTEGER NOT NULL REFERENCES blockages(id) ON DELETE CASCADE,
      tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (blockage_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS saved_views (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      status     TEXT,
      cohort_id  INTEGER REFERENCES cohorts(id) ON DELETE SET NULL,
      tag_id     INTEGER REFERENCES tags(id) ON DELETE SET NULL,
      search     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS csat (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      blockage_id INTEGER NOT NULL UNIQUE REFERENCES blockages(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS canned_responses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
```

Then add these to the existing `CREATE INDEX` block:

```sql
    CREATE INDEX IF NOT EXISTS idx_btags_blk ON blockage_tags(blockage_id);
    CREATE INDEX IF NOT EXISTS idx_btags_tag ON blockage_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_views_user ON saved_views(user_id);
    CREATE INDEX IF NOT EXISTS idx_csat_org ON csat(org_id);
    CREATE INDEX IF NOT EXISTS idx_canned_org ON canned_responses(org_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --experimental-sqlite --test test/profile.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/test/profile.test.js
git commit -m "feat(db): add tags, saved_views, csat, canned_responses tables

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Student 360 profile endpoint

**Files:**
- Create: `server/routes/profile.js`
- Modify: `server/index.js` (mount `profileRoutes`)
- Test: `server/test/profile.test.js` (append)

**Interfaces:**
- Consumes: `requireAuth`, `requireStaff` from `../auth`; `buildOrg`, `joinMember`, `startServer` from `./helpers`.
- Produces: `GET /api/members/:id/profile` (staff only) →
  `{ student:{id,name,email,cohortName}, stats:{total,open,in_support,resolved,medianHours,aiResolved,humanResolved,avgCsat,csatCount}, atRisk:{open,reasons}, recent:[{id,title,status,createdAt,resolvedAt}], trend:[{date,count}] }`.
  Cross-tenant target id → 404. Non-student target id → 404.

- [ ] **Step 1: Write the failing test** — append to `server/test/profile.test.js`:

```js
const { startServer, buildOrg, joinMember } = require("./helpers");

test("staff sees a student's 360 profile; cross-tenant is 404", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");
    // student reports two blockages, owner resolves one
    const c = await a.student.post("/api/blockages", {
      title: "stuck on routing", cohortId: a.cohortId, details: "help me",
    });
    await a.student.post("/api/blockages", {
      title: "css overflow", cohortId: a.cohortId, details: "scroll bug",
    });
    await a.owner.post(`/api/blockages/${c.body.blockage.id}/resolve`, {
      type: "guidedSupport", note: "fixed it",
    });

    const prof = await a.owner.get(`/api/members/${a.studentId}/profile`);
    assert.equal(prof.status, 200);
    assert.equal(prof.body.student.id, a.studentId);
    assert.equal(prof.body.stats.total, 2);
    assert.equal(prof.body.stats.resolved, 1);
    assert.equal(prof.body.recent.length, 2);

    // tenant isolation: org B owner cannot see org A's student
    const b = await buildOrg(srv.base, "Beta", "b");
    const x = await b.owner.get(`/api/members/${a.studentId}/profile`);
    assert.equal(x.status, 404);

    // students cannot call the staff endpoint
    const s = await a.student.get(`/api/members/${a.studentId}/profile`);
    assert.equal(s.status, 403);
  } finally {
    await srv.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --experimental-sqlite --test test/profile.test.js`
Expected: FAIL — `404`/`Not found` (route not mounted).

- [ ] **Step 3: Write minimal implementation** — create `server/routes/profile.js`:

```js
"use strict";

const express = require("express");
const { requireAuth, requireStaff } = require("../auth");

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

module.exports = function profileRoutes(db) {
  const router = express.Router();
  router.use(requireAuth, requireStaff);

  // GET /api/members/:id/profile — one student's full history + stats
  router.get("/members/:id/profile", (req, res) => {
    const { orgId } = req.user;
    const student = db
      .prepare(
        `SELECT u.id, u.name, u.email, c.name AS cohort_name
           FROM users u LEFT JOIN cohorts c ON c.id = u.cohort_id
          WHERE u.id = ? AND u.org_id = ? AND u.role = 'student'`
      )
      .get(Number(req.params.id), orgId);
    if (!student) return res.status(404).json({ error: "Student not found." });

    const blks = db
      .prepare(
        `SELECT id, title, status, resolution_type, created_at, resolved_at,
                (julianday(resolved_at) - julianday(created_at)) * 24 AS hours,
                (julianday('now') - julianday(created_at)) * 24 AS open_hours,
                (julianday('now') - julianday(created_at)) AS age_days
           FROM blockages WHERE org_id = ? AND user_id = ? ORDER BY created_at DESC`
      )
      .all(orgId, student.id);

    const totals = { open: 0, in_support: 0, resolved: 0 };
    blks.forEach((b) => (totals[b.status] = (totals[b.status] || 0) + 1));
    const resolvedHours = blks.filter((b) => b.resolved_at).map((b) => b.hours);
    const aiResolved = blks.filter((b) => b.resolution_type === "ai").length;

    const csatRows = db
      .prepare(
        `SELECT cs.rating FROM csat cs JOIN blockages b ON b.id = cs.blockage_id
          WHERE cs.org_id = ? AND b.user_id = ?`
      )
      .all(orgId, student.id);
    const avgCsat = csatRows.length
      ? Math.round((csatRows.reduce((a, r) => a + r.rating, 0) / csatRows.length) * 10) / 10
      : 0;

    // At-risk reasoning (mirrors analytics radar)
    const open = blks.filter((b) => b.status !== "resolved");
    const last7 = blks.filter((b) => b.age_days <= 7).length;
    const maxOpenHours = open.length ? Math.max(...open.map((b) => b.open_hours)) : 0;
    const reasons = [];
    if (open.length) reasons.push(`${open.length} open`);
    if (maxOpenHours > 24) reasons.push(`stuck ${Math.round(maxOpenHours)}h`);
    if (last7 >= 3) reasons.push(`${last7} this week`);

    // 14-day trend
    const byDate = {};
    blks.forEach((b) => {
      const d = (b.created_at || "").slice(0, 10);
      byDate[d] = (byDate[d] || 0) + 1;
    });
    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      trend.push({ date: d, count: byDate[d] || 0 });
    }

    res.json({
      student: {
        id: student.id, name: student.name, email: student.email,
        cohortName: student.cohort_name,
      },
      stats: {
        total: blks.length,
        open: totals.open, in_support: totals.in_support, resolved: totals.resolved,
        medianHours: Math.round(median(resolvedHours) * 10) / 10,
        aiResolved, humanResolved: totals.resolved - aiResolved,
        avgCsat, csatCount: csatRows.length,
      },
      atRisk: { open: open.length, reasons },
      recent: blks.slice(0, 20).map((b) => ({
        id: b.id, title: b.title, status: b.status,
        createdAt: b.created_at, resolvedAt: b.resolved_at,
      })),
      trend,
    });
  });

  return router;
};
```

Then in `server/index.js` add near the other `require`s and mounts:

```js
const profileRoutes = require("./routes/profile");
// ...with the other app.use("/api", ...) lines:
  app.use("/api", profileRoutes(db));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --experimental-sqlite --test test/profile.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/profile.js server/index.js server/test/profile.test.js
git commit -m "feat(profile): Student 360 endpoint with stats, at-risk, trend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Tags taxonomy + attach/detach + list filter

**Files:**
- Create: `server/routes/tags.js`
- Modify: `server/index.js` (mount `tagRoutes`)
- Modify: `server/routes/blockages.js` (include `tags` in `summary`/detail; support `?tag=` filter)
- Test: `server/test/tags.test.js`

**Interfaces:**
- Consumes: `requireAuth`, `requireRole`, `requireStaff` from `../auth`; `canSeeBlockage` from `../lib/helpers`; `tooLong` from `../lib/validate`.
- Produces:
  - `GET /api/tags` (any member) → `{ tags:[{id,name,color}] }` org-scoped.
  - `POST /api/tags {name, color?}` (owner) → `{ tag:{id,name,color} }`; duplicate name (same org) → 409.
  - `DELETE /api/tags/:id` (owner) → `{ ok:true }`; cascades `blockage_tags`.
  - `POST /api/blockages/:id/tags {tagId}` (staff, blockage visible) → `{ tags:[...] }`.
  - `DELETE /api/blockages/:id/tags/:tagId` (staff) → `{ tags:[...] }`.
  - Blockage `summary(r)` gains `tags:[{id,name,color}]`; `GET /api/blockages?tag=<id>` filters.

- [ ] **Step 1: Write the failing test** — create `server/test/tags.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("owner creates tags, staff tags a blockage, list filters by tag", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");
    const t = await a.owner.post("/api/tags", { name: "react", color: "#12B886" });
    assert.equal(t.status, 201);
    const tagId = t.body.tag.id;

    // duplicate name rejected
    const dup = await a.owner.post("/api/tags", { name: "react" });
    assert.equal(dup.status, 409);

    // students may not create tags
    const st = await a.student.post("/api/tags", { name: "css" });
    assert.equal(st.status, 403);

    const b = await a.student.post("/api/blockages", {
      title: "hooks", cohortId: a.cohortId, details: "useEffect loop",
    });
    const bid = b.body.blockage.id;

    const tag = await a.owner.post(`/api/blockages/${bid}/tags`, { tagId });
    assert.equal(tag.status, 200);
    assert.equal(tag.body.tags[0].name, "react");

    // list filtered by tag returns it
    const filtered = await a.owner.get(`/api/blockages?tag=${tagId}`);
    assert.equal(filtered.body.blockages.length, 1);
    assert.equal(filtered.body.blockages[0].tags[0].name, "react");

    // detach
    const off = await a.owner.del(`/api/blockages/${bid}/tags/${tagId}`);
    assert.equal(off.body.tags.length, 0);

    const empty = await a.owner.get(`/api/blockages?tag=${tagId}`);
    assert.equal(empty.body.blockages.length, 0);
  } finally {
    await srv.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --experimental-sqlite --test test/tags.test.js`
Expected: FAIL — `404`/`Not found`.

- [ ] **Step 3: Write minimal implementation** — create `server/routes/tags.js`:

```js
"use strict";

const express = require("express");
const { requireAuth, requireRole, requireStaff } = require("../auth");
const { canSeeBlockage } = require("../lib/helpers");
const { tooLong } = require("../lib/validate");

module.exports = function tagRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  const tagsFor = (blockageId) =>
    db
      .prepare(
        `SELECT t.id, t.name, t.color FROM tags t
           JOIN blockage_tags bt ON bt.tag_id = t.id
          WHERE bt.blockage_id = ? ORDER BY t.name`
      )
      .all(blockageId);

  // GET /api/tags — org taxonomy (any member)
  router.get("/tags", (req, res) => {
    const tags = db
      .prepare("SELECT id, name, color FROM tags WHERE org_id = ? ORDER BY name")
      .all(req.user.orgId);
    res.json({ tags });
  });

  // POST /api/tags { name, color? } — owner
  router.post("/tags", requireRole("owner"), (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Tag name is required." });
    const lenErr = tooLong(name, 60, "Tag name");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const color = (req.body.color || "").trim() || null;
    const exists = db
      .prepare("SELECT id FROM tags WHERE org_id = ? AND name = ?")
      .get(req.user.orgId, name);
    if (exists) return res.status(409).json({ error: "That tag already exists." });
    const info = db
      .prepare("INSERT INTO tags (org_id, name, color) VALUES (?, ?, ?)")
      .run(req.user.orgId, name, color);
    res.status(201).json({ tag: { id: info.lastInsertRowid, name, color } });
  });

  // DELETE /api/tags/:id — owner
  router.delete("/tags/:id", requireRole("owner"), (req, res) => {
    const tag = db
      .prepare("SELECT * FROM tags WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!tag) return res.status(404).json({ error: "Tag not found." });
    db.prepare("DELETE FROM tags WHERE id = ?").run(tag.id);
    res.json({ ok: true });
  });

  const visibleBlockage = (req) => {
    const row = db
      .prepare("SELECT * FROM blockages WHERE id = ?")
      .get(Number(req.params.id));
    return canSeeBlockage(db, req.user, row) ? row : null;
  };

  // POST /api/blockages/:id/tags { tagId } — staff attach
  router.post("/blockages/:id/tags", requireStaff, (req, res) => {
    const row = visibleBlockage(req);
    if (!row) return res.status(404).json({ error: "Blockage not found." });
    const tag = db
      .prepare("SELECT * FROM tags WHERE id = ? AND org_id = ?")
      .get(Number(req.body.tagId), req.user.orgId);
    if (!tag) return res.status(400).json({ error: "Unknown tag." });
    db.prepare(
      "INSERT OR IGNORE INTO blockage_tags (blockage_id, tag_id) VALUES (?, ?)"
    ).run(row.id, tag.id);
    res.json({ tags: tagsFor(row.id) });
  });

  // DELETE /api/blockages/:id/tags/:tagId — staff detach
  router.delete("/blockages/:id/tags/:tagId", requireStaff, (req, res) => {
    const row = visibleBlockage(req);
    if (!row) return res.status(404).json({ error: "Blockage not found." });
    db.prepare("DELETE FROM blockage_tags WHERE blockage_id = ? AND tag_id = ?").run(
      row.id,
      Number(req.params.tagId)
    );
    res.json({ tags: tagsFor(row.id) });
  });

  return router;
};
```

In `server/index.js` add:

```js
const tagRoutes = require("./routes/tags");
// with the other mounts:
  app.use("/api", tagRoutes(db));
```

In `server/routes/blockages.js`, add a tags loader near the top of the factory (after `joinedById`):

```js
  const tagsFor = (blockageId) =>
    db
      .prepare(
        `SELECT t.id, t.name, t.color FROM tags t
           JOIN blockage_tags bt ON bt.tag_id = t.id
          WHERE bt.blockage_id = ? ORDER BY t.name`
      )
      .all(blockageId);
```

Change `summary(r)` to attach tags — make it a closure that can read `tagsFor`. Replace the standalone `summary` usage: keep `summary(r)` returning the existing object, then add `tags: tagsFor(r.id)` to the returned object:

```js
  function summary(r) {
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      difficulty: r.difficulty,
      cohortId: r.cohort_id,
      cohortName: r.cohort_name,
      briefName: r.brief_name,
      studentName: r.student_name,
      assigneeName: r.assignee_name,
      commentCount: r.comment_count,
      tags: tagsFor(r.id),
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    };
  }
```

> Note: `summary` is currently a module-level function above the factory. Move its definition **inside** `module.exports = function blockageRoutes(db) {` (just after `tagsFor`) so it can call `tagsFor(r.id)`. Delete the old module-level `summary`.

In the `GET /api/blockages` handler, after the existing `cohortId` filter and before the `ORDER BY`, add:

```js
    if (req.query.tag) {
      sql += " AND b.id IN (SELECT blockage_id FROM blockage_tags WHERE tag_id = ?)";
      args.push(Number(req.query.tag));
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --experimental-sqlite --test test/tags.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite (summary moved — guard against regressions)**

Run: `cd server && npm test`
Expected: PASS (existing blockage tests still green; summaries now carry `tags`).

- [ ] **Step 6: Commit**

```bash
git add server/routes/tags.js server/routes/blockages.js server/index.js server/test/tags.test.js
git commit -m "feat(tags): org tag taxonomy, blockage tagging, ?tag= list filter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Saved views

**Files:**
- Create: `server/routes/views.js`
- Modify: `server/index.js` (mount `viewRoutes`)
- Test: `server/test/views.test.js`

**Interfaces:**
- Consumes: `requireAuth` from `../auth`; `tooLong` from `../lib/validate`.
- Produces (per-user, org-scoped):
  - `GET /api/views` → `{ views:[{id,name,status,cohortId,tagId,search}] }` (caller's own only).
  - `POST /api/views {name, status?, cohortId?, tagId?, search?}` → `{ view:{...} }`.
  - `DELETE /api/views/:id` → `{ ok:true }`; another user's view → 404.

- [ ] **Step 1: Write the failing test** — create `server/test/views.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg, joinMember } = require("./helpers");

test("a user saves, lists, and deletes their own views; isolated per user", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");
    const v = await a.instructor.post("/api/views", {
      name: "Open in A", status: "open", cohortId: a.cohortId, search: "css",
    });
    assert.equal(v.status, 201);

    const mine = await a.instructor.get("/api/views");
    assert.equal(mine.body.views.length, 1);
    assert.equal(mine.body.views[0].name, "Open in A");
    assert.equal(mine.body.views[0].status, "open");

    // another staff member sees none of the first user's views
    const other = await joinMember(srv.base, a.owner, "instructor", null, "a-ins2");
    const otherViews = await other.client.get("/api/views");
    assert.equal(otherViews.body.views.length, 0);

    // cannot delete a view they don't own
    const del = await other.client.del(`/api/views/${v.body.view.id}`);
    assert.equal(del.status, 404);

    const ok = await a.instructor.del(`/api/views/${v.body.view.id}`);
    assert.equal(ok.status, 200);
    const after = await a.instructor.get("/api/views");
    assert.equal(after.body.views.length, 0);
  } finally {
    await srv.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --experimental-sqlite --test test/views.test.js`
Expected: FAIL — `404`/`Not found`.

- [ ] **Step 3: Write minimal implementation** — create `server/routes/views.js`:

```js
"use strict";

const express = require("express");
const { requireAuth } = require("../auth");
const { tooLong } = require("../lib/validate");

module.exports = function viewRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  const publicView = (r) => ({
    id: r.id, name: r.name, status: r.status || "",
    cohortId: r.cohort_id, tagId: r.tag_id, search: r.search || "",
  });

  // GET /api/views — the caller's own saved views
  router.get("/views", (req, res) => {
    const rows = db
      .prepare(
        "SELECT * FROM saved_views WHERE org_id = ? AND user_id = ? ORDER BY created_at"
      )
      .all(req.user.orgId, req.user.userId);
    res.json({ views: rows.map(publicView) });
  });

  // POST /api/views { name, status?, cohortId?, tagId?, search? }
  router.post("/views", (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name your view." });
    const lenErr = tooLong(name, 100, "View name");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const status = (req.body.status || "").trim() || null;
    const cohortId = req.body.cohortId ? Number(req.body.cohortId) : null;
    const tagId = req.body.tagId ? Number(req.body.tagId) : null;
    const search = (req.body.search || "").trim() || null;
    const info = db
      .prepare(
        `INSERT INTO saved_views (org_id, user_id, name, status, cohort_id, tag_id, search)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(req.user.orgId, req.user.userId, name, status, cohortId, tagId, search);
    res.status(201).json({
      view: publicView({
        id: info.lastInsertRowid, name, status, cohort_id: cohortId, tag_id: tagId, search,
      }),
    });
  });

  // DELETE /api/views/:id — owner of the view only
  router.delete("/views/:id", (req, res) => {
    const row = db
      .prepare("SELECT * FROM saved_views WHERE id = ? AND org_id = ? AND user_id = ?")
      .get(Number(req.params.id), req.user.orgId, req.user.userId);
    if (!row) return res.status(404).json({ error: "View not found." });
    db.prepare("DELETE FROM saved_views WHERE id = ?").run(row.id);
    res.json({ ok: true });
  });

  return router;
};
```

In `server/index.js`:

```js
const viewRoutes = require("./routes/views");
// with the other mounts:
  app.use("/api", viewRoutes(db));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --experimental-sqlite --test test/views.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/views.js server/index.js server/test/views.test.js
git commit -m "feat(views): per-user saved filter views

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: CSAT (post-resolution rating)

**Files:**
- Create: `server/routes/csat.js`
- Modify: `server/index.js` (mount `csatRoutes`)
- Modify: `server/routes/blockages.js` (include `csat` on `GET /api/blockages/:id`)
- Modify: `server/routes/analytics.js` (add `avgCsat` + `csatCount` to `/analytics`)
- Test: `server/test/csat.test.js`

**Interfaces:**
- Consumes: `requireAuth`, `requireRole`, `requireStaff` from `../auth`.
- Produces:
  - `POST /api/blockages/:id/csat {rating, comment?}` (student, own, resolved only) → `{ csat:{rating,comment} }`; rating not 1–5 → 400; not resolved → 409; re-submit updates the row.
  - `GET /api/blockages/:id/csat` (student-own or staff who can see it) → `{ csat:{rating,comment}|null }`.
  - Blockage detail gains `csat:{rating,comment}|null`.
  - `/analytics` gains `avgCsat` (rounded to 0.1) and `csatCount`.

- [ ] **Step 1: Write the failing test** — create `server/test/csat.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("student rates a resolved blockage; surfaces in analytics", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");
    const b = await a.student.post("/api/blockages", {
      title: "deploy fails", cohortId: a.cohortId, details: "build error",
    });
    const bid = b.body.blockage.id;

    // cannot rate while still open
    const early = await a.student.post(`/api/blockages/${bid}/csat`, { rating: 5 });
    assert.equal(early.status, 409);

    await a.owner.post(`/api/blockages/${bid}/resolve`, {
      type: "guidedSupport", note: "deployed",
    });

    // invalid rating rejected
    const bad = await a.student.post(`/api/blockages/${bid}/csat`, { rating: 9 });
    assert.equal(bad.status, 400);

    const ok = await a.student.post(`/api/blockages/${bid}/csat`, {
      rating: 4, comment: "helpful",
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.csat.rating, 4);

    // re-submit updates, not duplicates
    const again = await a.student.post(`/api/blockages/${bid}/csat`, { rating: 5 });
    assert.equal(again.body.csat.rating, 5);

    // detail echoes csat
    const detail = await a.student.get(`/api/blockages/${bid}`);
    assert.equal(detail.body.blockage.csat.rating, 5);

    // analytics shows the average
    const an = await a.owner.get("/api/analytics");
    assert.equal(an.body.csatCount, 1);
    assert.equal(an.body.avgCsat, 5);
  } finally {
    await srv.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --experimental-sqlite --test test/csat.test.js`
Expected: FAIL — `404`/`Not found`.

- [ ] **Step 3: Write minimal implementation** — create `server/routes/csat.js`:

```js
"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth");
const { canSeeBlockage } = require("../lib/helpers");
const { tooLong } = require("../lib/validate");

module.exports = function csatRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  const csatFor = (blockageId) => {
    const r = db
      .prepare("SELECT rating, comment FROM csat WHERE blockage_id = ?")
      .get(blockageId);
    return r ? { rating: r.rating, comment: r.comment || "" } : null;
  };

  // POST /api/blockages/:id/csat { rating, comment? } — student rates own, resolved only
  router.post("/blockages/:id/csat", requireRole("student"), (req, res) => {
    const row = db
      .prepare("SELECT * FROM blockages WHERE id = ?")
      .get(Number(req.params.id));
    if (!row || row.user_id !== req.user.userId)
      return res.status(404).json({ error: "Blockage not found." });
    if (row.status !== "resolved")
      return res.status(409).json({ error: "You can rate it once it's resolved." });
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ error: "Pick a rating from 1 to 5." });
    const comment = (req.body.comment || "").trim() || null;
    const lenErr = tooLong(comment, 1000, "Comment");
    if (lenErr) return res.status(400).json({ error: lenErr });
    db.prepare(
      `INSERT INTO csat (org_id, blockage_id, user_id, rating, comment)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(blockage_id) DO UPDATE SET rating = excluded.rating,
            comment = excluded.comment, created_at = datetime('now')`
    ).run(row.org_id, row.id, req.user.userId, rating, comment);
    res.json({ csat: csatFor(row.id) });
  });

  // GET /api/blockages/:id/csat — student-own or any staff who can see it
  router.get("/blockages/:id/csat", (req, res) => {
    const row = db
      .prepare("SELECT * FROM blockages WHERE id = ?")
      .get(Number(req.params.id));
    if (!canSeeBlockage(db, req.user, row))
      return res.status(404).json({ error: "Blockage not found." });
    res.json({ csat: csatFor(row.id) });
  });

  return router;
};
```

In `server/index.js`:

```js
const csatRoutes = require("./routes/csat");
// with the other mounts:
  app.use("/api", csatRoutes(db));
```

In `server/routes/blockages.js`, inside `GET /api/blockages/:id`, add a csat read and include it in the response. After the `events` query and before `res.json({ blockage: {...} })`, add:

```js
    const csat = db
      .prepare("SELECT rating, comment FROM csat WHERE blockage_id = ?")
      .get(row.id);
```

and add to the `blockage` object:

```js
        csat: csat ? { rating: csat.rating, comment: csat.comment || "" } : null,
```

In `server/routes/analytics.js`, inside the `/analytics` handler, after the `atRiskTop` computation and before `res.json({...})`, add:

```js
    const csatRows = db
      .prepare(
        `SELECT cs.rating FROM csat cs JOIN blockages b ON b.id = cs.blockage_id
          WHERE b.org_id = ?${cohortFilter.replace(/b\.cohort_id/g, "b.cohort_id")}`
      )
      .all(...scopeArgs);
    const avgCsat = csatRows.length
      ? Math.round((csatRows.reduce((s, r) => s + r.rating, 0) / csatRows.length) * 10) / 10
      : 0;
```

and add `avgCsat, csatCount: csatRows.length,` to the `res.json({...})` object.

> Note: `cohortFilter` already references `b.cohort_id` and `scopeArgs` already carries the instructor's `userId` when scoped, so the join + filter stays tenant- and scope-correct.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --experimental-sqlite --test test/csat.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite (blockage detail + analytics changed)**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/csat.js server/routes/blockages.js server/routes/analytics.js server/index.js server/test/csat.test.js
git commit -m "feat(csat): post-resolution rating + average in analytics & detail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Nudges / campaigns

**Files:**
- Create: `server/routes/nudges.js`
- Modify: `server/index.js` (mount `nudgeRoutes`)
- Test: `server/test/nudges.test.js`

**Interfaces:**
- Consumes: `requireAuth`, `requireRole` from `../auth`; `notify` from `../lib/helpers`.
- Produces: `POST /api/nudges {message, target}` (owner) where `target` is `"cohort:<id>"`, `"at-risk"`, or `"all-students"` →
  `{ ok:true, sent:<n> }`. Writes one `notifications` row per recipient (`type:"nudge"`). Empty message → 400; unknown cohort → 400.
- Degrades gracefully: in-app only; if a Phase-2 email transport exists later, it can hook the same recipient list — no email dependency now.

- [ ] **Step 1: Write the failing test** — create `server/test/nudges.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("owner nudges a cohort; students get an in-app notification", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");

    // empty message rejected
    const bad = await a.owner.post("/api/nudges", {
      message: "  ", target: `cohort:${a.cohortId}`,
    });
    assert.equal(bad.status, 400);

    // non-owner forbidden
    const ins = await a.instructor.post("/api/nudges", {
      message: "hi", target: "all-students",
    });
    assert.equal(ins.status, 403);

    const r = await a.owner.post("/api/nudges", {
      message: "Office hours at 3pm — bring your blockers!",
      target: `cohort:${a.cohortId}`,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.sent, 1);

    // the cohort student now has an unread nudge
    const n = await a.student.get("/api/notifications");
    assert.ok(n.body.unread >= 1);
    assert.ok(
      n.body.notifications.some((x) => x.type === "nudge")
    );
  } finally {
    await srv.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --experimental-sqlite --test test/nudges.test.js`
Expected: FAIL — `404`/`Not found`.

- [ ] **Step 3: Write minimal implementation** — create `server/routes/nudges.js`:

```js
"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth");
const { notify } = require("../lib/helpers");
const { tooLong } = require("../lib/validate");

module.exports = function nudgeRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  // POST /api/nudges { message, target } — owner sends an in-app nudge
  // target: "cohort:<id>" | "at-risk" | "all-students"
  router.post("/nudges", requireRole("owner"), (req, res) => {
    const { orgId } = req.user;
    const message = (req.body.message || "").trim();
    if (!message) return res.status(400).json({ error: "Write a message to send." });
    const lenErr = tooLong(message, 1000, "Message");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const target = (req.body.target || "").trim();

    let recipients = [];
    if (target.startsWith("cohort:")) {
      const cohortId = Number(target.slice("cohort:".length));
      const c = db
        .prepare("SELECT id FROM cohorts WHERE id = ? AND org_id = ?")
        .get(cohortId, orgId);
      if (!c) return res.status(400).json({ error: "Unknown cohort." });
      recipients = db
        .prepare(
          "SELECT id FROM users WHERE org_id = ? AND role = 'student' AND cohort_id = ?"
        )
        .all(orgId, cohortId)
        .map((r) => r.id);
    } else if (target === "all-students") {
      recipients = db
        .prepare("SELECT id FROM users WHERE org_id = ? AND role = 'student'")
        .all(orgId)
        .map((r) => r.id);
    } else if (target === "at-risk") {
      // Students with at least one open blockage in the org.
      recipients = db
        .prepare(
          `SELECT DISTINCT u.id FROM users u
             JOIN blockages b ON b.user_id = u.id AND b.status != 'resolved'
            WHERE u.org_id = ? AND u.role = 'student'`
        )
        .all(orgId)
        .map((r) => r.id);
    } else {
      return res.status(400).json({ error: "Pick who to send to." });
    }

    let sent = 0;
    for (const uid of recipients) {
      notify(db, {
        orgId, userId: uid, type: "nudge", blockageId: null, body: message,
      });
      sent++;
    }
    res.json({ ok: true, sent });
  });

  return router;
};
```

In `server/index.js`:

```js
const nudgeRoutes = require("./routes/nudges");
// with the other mounts:
  app.use("/api", nudgeRoutes(db));
```

> Note: `notify` inserts into `notifications` with a nullable `blockage_id`, which the schema allows. Confirm `notify` accepts `blockageId:null` — the existing signature already passes `blockageId` straight through.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --experimental-sqlite --test test/nudges.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/nudges.js server/index.js server/test/nudges.test.js
git commit -m "feat(nudges): owner sends in-app nudges to cohort / at-risk / all students

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Canned responses

**Files:**
- Create: `server/routes/canned.js`
- Modify: `server/index.js` (mount `cannedRoutes`)
- Test: `server/test/canned.test.js`

**Interfaces:**
- Consumes: `requireAuth`, `requireStaff` from `../auth`; `tooLong` from `../lib/validate`.
- Produces (per-org, staff):
  - `GET /api/canned` → `{ canned:[{id,title,body}] }`.
  - `POST /api/canned {title, body}` → `{ canned:{id,title,body} }`.
  - `DELETE /api/canned/:id` → `{ ok:true }`; cross-org id → 404.

- [ ] **Step 1: Write the failing test** — create `server/test/canned.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

test("staff manage per-org canned responses; tenant-scoped", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Alpha", "a");
    const c = await a.instructor.post("/api/canned", {
      title: "Centering", body: "Use flexbox: display:flex; align-items:center;",
    });
    assert.equal(c.status, 201);
    const id = c.body.canned.id;

    const list = await a.owner.get("/api/canned");
    assert.equal(list.body.canned.length, 1);
    assert.equal(list.body.canned[0].title, "Centering");

    // students cannot read/write canned responses
    const sd = await a.student.get("/api/canned");
    assert.equal(sd.status, 403);

    // another org cannot delete this one
    const b = await buildOrg(srv.base, "Beta", "b");
    const cross = await b.owner.del(`/api/canned/${id}`);
    assert.equal(cross.status, 404);

    const ok = await a.instructor.del(`/api/canned/${id}`);
    assert.equal(ok.status, 200);
    const after = await a.owner.get("/api/canned");
    assert.equal(after.body.canned.length, 0);
  } finally {
    await srv.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --experimental-sqlite --test test/canned.test.js`
Expected: FAIL — `404`/`Not found`.

- [ ] **Step 3: Write minimal implementation** — create `server/routes/canned.js`:

```js
"use strict";

const express = require("express");
const { requireAuth, requireStaff } = require("../auth");
const { tooLong } = require("../lib/validate");

module.exports = function cannedRoutes(db) {
  const router = express.Router();
  router.use(requireAuth, requireStaff);

  // GET /api/canned — per-org snippets
  router.get("/canned", (req, res) => {
    const canned = db
      .prepare("SELECT id, title, body FROM canned_responses WHERE org_id = ? ORDER BY title")
      .all(req.user.orgId);
    res.json({ canned });
  });

  // POST /api/canned { title, body }
  router.post("/canned", (req, res) => {
    const title = (req.body.title || "").trim();
    const body = (req.body.body || "").trim();
    if (!title) return res.status(400).json({ error: "Give the snippet a title." });
    if (!body) return res.status(400).json({ error: "Write the snippet body." });
    const lenErr = tooLong(title, 100, "Title") || tooLong(body, 5000, "Body");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const info = db
      .prepare(
        "INSERT INTO canned_responses (org_id, title, body, created_by) VALUES (?, ?, ?, ?)"
      )
      .run(req.user.orgId, title, body, req.user.userId);
    res.status(201).json({ canned: { id: info.lastInsertRowid, title, body } });
  });

  // DELETE /api/canned/:id
  router.delete("/canned/:id", (req, res) => {
    const row = db
      .prepare("SELECT * FROM canned_responses WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!row) return res.status(404).json({ error: "Snippet not found." });
    db.prepare("DELETE FROM canned_responses WHERE id = ?").run(row.id);
    res.json({ ok: true });
  });

  return router;
};
```

In `server/index.js`:

```js
const cannedRoutes = require("./routes/canned");
// with the other mounts:
  app.use("/api", cannedRoutes(db));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --experimental-sqlite --test test/canned.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/canned.js server/index.js server/test/canned.test.js
git commit -m "feat(canned): per-org reply snippets for staff

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Shared front-end helpers (csatStars, tagPills)

**Files:**
- Modify: `functions/api.js` (add two helpers near the formatting/status helpers)
- Test: manual browser check (no node:test for front-end; verify in Task 13)

**Interfaces:**
- Produces global helpers:
  - `csatStars(n)` → HTML string of 5 stars with `n` filled (escaped, no user input).
  - `tagPills(tags)` → HTML string of `.tag-pill` spans from `[{id,name,color}]`, each name through `escapeHtml`.

- [ ] **Step 1: Add the helpers** — in `functions/api.js`, after `statusMeta`, add:

```js
// --- Tags + CSAT ----------------------------------------------------
function tagPills(tags) {
  if (!tags || !tags.length) return "";
  return tags
    .map((t) => {
      const c = t.color ? `style="--tag:${escapeHtml(t.color)}"` : "";
      return `<span class="tag-pill" ${c}>${escapeHtml(t.name)}</span>`;
    })
    .join("");
}
function csatStars(n) {
  const r = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  let out = "";
  for (let i = 1; i <= 5; i++) {
    out += `<span class="csat-star${i <= r ? " on" : ""}">★</span>`;
  }
  return out;
}
```

- [ ] **Step 2: Add minimal "Signal" styles** — in `dashboard.css`, append:

```css
.tag-pill {
  display: inline-flex; align-items: center;
  font: 600 0.72rem/1 var(--font-mono);
  padding: 0.22rem 0.5rem; border-radius: 999px;
  border: 1px solid var(--tag, #d4d8df); color: var(--tag, #5d6675);
  background: color-mix(in srgb, var(--tag, #5d6675) 8%, transparent);
  margin: 0 0.3rem 0.3rem 0;
}
.csat-star { color: #d4d8df; font-size: 1.05rem; }
.csat-star.on { color: #F59F00; }
```

- [ ] **Step 3: Sanity-check the helpers in a browser console**

Run: `cd server && npm start` then in the browser console on any app page:
`tagPills([{name:"react",color:"#12B886"}])` and `csatStars(4)`.
Expected: non-empty HTML strings; the tag name is escaped.

- [ ] **Step 4: Commit**

```bash
git add functions/api.js dashboard.css
git commit -m "feat(ui): shared tagPills + csatStars helpers and Signal styles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Student 360 page

**Files:**
- Create: `student_profile.html`
- Create: `functions/student_profile.js`
- Modify: `functions/members.js` (link member names to the profile)
- Modify: `functions/owner.js` (link at-risk names to the profile)

**Interfaces:**
- Consumes: `requireRole("owner","instructor")`, `renderShell`, `escapeHtml`, `fmtDate`, `fmtRelative`, `statusMeta`, `csatStars`, `API` from `functions/api.js`; `GET /api/members/:id/profile`.
- Produces: a read-only Student 360 page opened via `student_profile.html?id=<studentId>`.

- [ ] **Step 1: Create `student_profile.html`** (mirrors `owner_dashboard.html`'s head/shell):

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Student profile · Unblockify</title>
  <link rel="stylesheet" href="stylesheet.main.css" />
  <link rel="stylesheet" href="dashboard.css" />
</head>
<body>
  <div id="app"></div>
  <script src="functions/api.js"></script>
  <script src="functions/student_profile.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `functions/student_profile.js`:**

```js
/* Student 360 — read-only profile for owner/instructor. */
(async function () {
  const id = new URLSearchParams(location.search).get("id");
  const s = await requireRole("owner", "instructor");
  if (!s) return;

  const view = renderShell({
    user: s.user, org: s.org, active: dashboardFor(s.user.role),
    title: "Student profile", crumb: "Student 360",
  });

  if (!id) {
    view.innerHTML = `<div class="blk-empty">No student selected.</div>`;
    return;
  }

  let p;
  try {
    p = await API.get("/api/members/" + encodeURIComponent(id) + "/profile");
  } catch (e) {
    view.innerHTML = `<div class="blk-empty">${
      e.status === 404 ? "Student not found." : "Couldn't load this profile."
    }</div>`;
    return;
  }

  const st = p.stats;
  const reasons = (p.atRisk.reasons || [])
    .map((r) => `<span class="atrisk-tag">${escapeHtml(r)}</span>`)
    .join("");

  const recent = (p.recent || []).length
    ? `<ul class="timeline">${p.recent
        .map((b) => {
          const m = statusMeta(b.status);
          return `<li class="ev-${b.status === "resolved" ? "resolved" : "created"}">
            <a href="blockage.html?id=${encodeURIComponent(b.id)}" style="text-decoration:none;color:inherit">
              <div class="ev-t">${escapeHtml(b.title)}
                <span class="pill pill-${m.cls}">${m.label}</span></div>
              <div class="ev-m">${escapeHtml(fmtRelative(b.createdAt))}</div>
            </a></li>`;
        })
        .join("")}</ul>`
    : `<p class="thread-empty">No blockages yet.</p>`;

  view.innerHTML = `
    <div class="page-head">
      <h1>${escapeHtml(p.student.name)}</h1>
      <p>${escapeHtml(p.student.email)} · ${escapeHtml(p.student.cohortName || "No cohort")}</p>
    </div>
    <section class="stat-row">
      <div class="stat"><div class="k">Total</div><div class="v">${st.total}</div></div>
      <div class="stat is-blocked"><div class="k">Open</div><div class="v">${st.open + st.in_support}</div></div>
      <div class="stat is-resolved"><div class="k">Resolved</div><div class="v">${st.resolved}</div></div>
      <div class="stat"><div class="k">Median unblock</div><div class="v">${st.medianHours || 0}h</div></div>
    </section>
    <div class="chart-grid">
      <div class="chart-card"><h3>Resolution mix</h3>
        <div class="deflect-sub">AI cleared ${st.aiResolved} · humans cleared ${st.humanResolved}</div>
      </div>
      <div class="chart-card"><h3>Satisfaction</h3>
        <div class="csat-row">${csatStars(st.avgCsat)} <span class="deflect-sub">${
          st.csatCount ? st.avgCsat + " avg · " + st.csatCount + " rating(s)" : "No ratings yet"
        }</span></div>
      </div>
    </div>
    ${
      p.atRisk.open
        ? `<section class="panel" style="margin-bottom:1rem"><h3>Needs attention</h3>
            <div class="atrisk-item"><span class="rs">${reasons}</span></div></section>`
        : ""
    }
    <div class="chart-card"><h3>Recent blockages</h3>${recent}</div>`;
})();
```

- [ ] **Step 3: Link member names** — in `functions/members.js`, find where each member's name cell is rendered and wrap student names in a link. Locate the row template that prints `member.name` and replace the name cell for students with:

```js
    const nameCell =
      m.role === "student"
        ? `<a href="student_profile.html?id=${encodeURIComponent(m.id)}">${escapeHtml(m.name)}</a>`
        : escapeHtml(m.name);
```

and use `${nameCell}` where `escapeHtml(m.name)` was previously emitted for the name column.

- [ ] **Step 4: Link at-risk names** — in `functions/owner.js`, change `atRiskHtml` so each name links to the profile:

```js
function atRiskHtml(rows) {
  if (!rows || !rows.length) return `<p class="atrisk-empty">No students at risk right now. 🎉</p>`;
  return `<div class="atrisk-list">${rows
    .map(
      (r) => `<div class="atrisk-item">
        <span class="nm"><a href="student_profile.html?id=${encodeURIComponent(r.id)}" style="color:inherit">${escapeHtml(r.name)}</a></span>
        <span class="rs">${(r.reasons || []).map((t) => `<span class="atrisk-tag">${escapeHtml(t)}</span>`).join("")}</span>
      </div>`
    )
    .join("")}</div>`;
}
```

- [ ] **Step 5: Manual verify**

Run: `cd server && npm start`. Sign up, create a cohort, invite + join a student, report a blockage, resolve it, rate it. As owner, open the dashboard → click an at-risk name → confirm the Student 360 loads with stats and recent blockages. Open Members → click the student name → same page.
Expected: page renders; no console errors; all names escaped.

- [ ] **Step 6: Commit**

```bash
git add student_profile.html functions/student_profile.js functions/members.js functions/owner.js
git commit -m "feat(profile): Student 360 page linked from members & at-risk radar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Tags + tag filter on list pages

**Files:**
- Modify: `functions/instructor.js` (add a tag `<select>` filter + render tag pills on cards)
- Modify: `functions/owner_blockages.js` (same tag filter + pills — mirror the instructor changes)

**Interfaces:**
- Consumes: `GET /api/tags`, `GET /api/blockages?...&tag=`, `tagPills` from `functions/api.js`.
- Produces: a working client-side `tag` filter on both list pages, persisted in the URL like the existing `status`/`cohort`/`q`.

- [ ] **Step 1: Add the tag select to the instructor filters** — in `functions/instructor.js`, in the `view.innerHTML` filters block, add a tag select after the cohort select:

```html
      <select id="tag"><option value="">All tags</option></select>
```

- [ ] **Step 2: Wire the tag filter state** — in `functions/instructor.js`, after the `searchQuery` line add:

```js
  let tagFilter = params.get("tag") || "";
```

In `syncUrl()`, after the search line add:

```js
    if (tagFilter) p.set("tag", tagFilter);
```

After the cohort `<select>` is populated, populate tags:

```js
  const tagSel = document.getElementById("tag");
  try {
    const { tags } = await API.get("/api/tags");
    (tags || []).forEach((t) => {
      const o = document.createElement("option");
      o.value = String(t.id);
      o.textContent = t.name;
      tagSel.appendChild(o);
    });
    if (tagFilter && tagSel.querySelector(`option[value="${CSS.escape(tagFilter)}"]`)) {
      tagSel.value = tagFilter;
    } else {
      tagFilter = "";
    }
  } catch (_) {}
  tagSel.addEventListener("change", () => {
    tagFilter = tagSel.value;
    syncUrl();
    renderGrid();
  });
```

- [ ] **Step 3: Filter by tag + render pills** — in `renderGrid()`'s `.filter(...)`, add after the cohort check:

```js
      if (tagFilter && !(b.tags || []).some((t) => String(t.id) === tagFilter)) return false;
```

In `cardHtml(b)`, add the pills row before the closing `</article>`:

```js
      ${b.tags && b.tags.length ? `<div class="blk-tags">${tagPills(b.tags)}</div>` : ""}
```

- [ ] **Step 4: Mirror into `functions/owner_blockages.js`** — apply the identical four edits (filter `<select>`, `tagFilter` state + `syncUrl`, populate + listener, filter-and-pills). The owner page already follows the same filter pattern; reuse the exact snippets from Steps 1–3.

- [ ] **Step 5: Manual verify**

Run: `cd server && npm start`. As owner create a tag, open a blockage, attach it (Task 11 UI), then on the queue/blockages list pick the tag in the filter.
Expected: only tagged blockages show; pills render on cards; the `?tag=` param persists on reload.

- [ ] **Step 6: Commit**

```bash
git add functions/instructor.js functions/owner_blockages.js
git commit -m "feat(tags): tag filter + tag pills on queue & blockages lists

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Tags + CSAT + canned on the blockage detail page

**Files:**
- Modify: `functions/blockage.js`

**Interfaces:**
- Consumes: `tagPills`, `csatStars` from `functions/api.js`; `GET /api/tags`, `POST/DELETE /api/blockages/:id/tags`, `POST /api/blockages/:id/csat`, `GET /api/canned`.
- Produces: staff tag editing (add/remove) on the meta panel; a student CSAT prompt on resolved blockages; an instructor "Canned" inserter in the composer.

- [ ] **Step 1: Render tag pills + staff editor** — in `render()`, inside the right-column meta `panel`, after the `meta-list`, add a tags block:

```js
        ${
          role !== "student"
            ? `<div class="panel"><h2>Tags</h2>
                <div class="blk-tags" id="tagList">${tagPills(blk.tags)}</div>
                <div class="composer" style="margin-top:.5rem">
                  <select id="tagAdd"><option value="">Add a tag…</option></select>
                </div></div>`
            : blk.tags && blk.tags.length
            ? `<div class="panel"><h2>Tags</h2><div class="blk-tags">${tagPills(blk.tags)}</div></div>`
            : ""
        }
```

- [ ] **Step 2: Wire tag add/remove (staff)** — at the end of `render()` (after `wireComposer()`), add a call `wireTags();` and define:

```js
  async function wireTags() {
    const sel = document.getElementById("tagAdd");
    if (!sel) return;
    let tags = [];
    try {
      tags = (await API.get("/api/tags")).tags || [];
    } catch (_) {}
    const have = new Set((blk.tags || []).map((t) => t.id));
    tags
      .filter((t) => !have.has(t.id))
      .forEach((t) => {
        const o = document.createElement("option");
        o.value = String(t.id);
        o.textContent = t.name;
        sel.appendChild(o);
      });
    sel.addEventListener("change", async () => {
      const tagId = Number(sel.value);
      if (!tagId) return;
      try {
        await API.post("/api/blockages/" + encodeURIComponent(id) + "/tags", { tagId });
        await load();
      } catch (err) {
        toast(err.message || "Couldn't add tag.", "error");
      }
    });
    // Click a pill in the editor to remove it.
    const list = document.getElementById("tagList");
    if (list) {
      list.querySelectorAll(".tag-pill").forEach((pill, i) => {
        const tag = (blk.tags || [])[i];
        if (!tag) return;
        pill.style.cursor = "pointer";
        pill.title = "Remove tag";
        pill.addEventListener("click", async () => {
          try {
            await API.del(
              "/api/blockages/" + encodeURIComponent(id) + "/tags/" + encodeURIComponent(tag.id)
            );
            await load();
          } catch (err) {
            toast(err.message || "Couldn't remove tag.", "error");
          }
        });
      });
    }
  }
```

- [ ] **Step 3: Student CSAT prompt** — in `render()`, inside the left-column first `panel` (after `resolutionBlock`), add when the viewer is the student-owner and it's resolved with no rating yet:

```js
        ${
          role === "student" && blk.status === "resolved" && !blk.csat
            ? `<div class="csat-prompt" id="csatPrompt">
                <h3>Did this help?</h3>
                <div class="csat-pick">
                  ${[1, 2, 3, 4, 5]
                    .map((n) => `<button type="button" class="csat-star" data-rate="${n}">★</button>`)
                    .join("")}
                </div></div>`
            : blk.csat
            ? `<div class="csat-readout"><h3>Your rating</h3><div>${csatStars(blk.csat.rating)}</div></div>`
            : ""
        }
```

- [ ] **Step 4: Wire CSAT submit** — at the end of `render()`, add `wireCsat();` and define:

```js
  function wireCsat() {
    const prompt = document.getElementById("csatPrompt");
    if (!prompt) return;
    prompt.querySelectorAll(".csat-star[data-rate]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const rating = Number(btn.getAttribute("data-rate"));
        try {
          await API.post("/api/blockages/" + encodeURIComponent(id) + "/csat", { rating });
          toast("Thanks for the feedback!", "success");
          await load();
        } catch (err) {
          toast(err.message || "Couldn't save your rating.", "error");
        }
      });
    });
  }
```

- [ ] **Step 5: Canned-response inserter (instructor)** — in `wireComposer()`, after the `draftBtn` wiring, add a canned inserter next to the composer. First, in `render()`, change the composer to include a Canned button for staff (beside the Draft button):

```js
              ${role !== "student" ? '<button type="button" class="btn btn-ghost" id="cannedBtn" title="Insert a saved reply">⎘ Canned</button>' : ""}
```

Then in `wireComposer()`:

```js
    const cannedBtn = document.getElementById("cannedBtn");
    if (cannedBtn) {
      cannedBtn.addEventListener("click", async () => {
        let canned = [];
        try {
          canned = (await API.get("/api/canned")).canned || [];
        } catch (_) {}
        if (!canned.length) {
          toast("No saved replies yet. Add some in Settings.", "info");
          return;
        }
        const existing = document.getElementById("cannedMenu");
        if (existing) { existing.remove(); return; }
        const menu = document.createElement("div");
        menu.id = "cannedMenu";
        menu.className = "canned-menu";
        menu.innerHTML = canned
          .map(
            (c) => `<button type="button" class="canned-item" data-cid="${c.id}">${escapeHtml(c.title)}</button>`
          )
          .join("");
        cannedBtn.after(menu);
        menu.addEventListener("click", (e) => {
          const item = e.target.closest(".canned-item");
          if (!item) return;
          const chosen = canned.find((c) => String(c.id) === item.getAttribute("data-cid"));
          const ta = form.querySelector("#commentBody");
          ta.value = (ta.value ? ta.value + "\n\n" : "") + (chosen ? chosen.body : "");
          ta.focus();
          menu.remove();
        });
      });
    }
```

- [ ] **Step 6: Add minimal styles** — append to `dashboard.css`:

```css
.blk-tags { display: flex; flex-wrap: wrap; }
.csat-prompt, .csat-readout, .csat-row { margin-top: 0.75rem; }
.csat-pick .csat-star { background: none; border: 0; cursor: pointer; }
.canned-menu { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.5rem; }
.canned-item { text-align: left; padding: 0.4rem 0.6rem; border: 1px solid #e3e6ea; border-radius: 8px; background: #fff; cursor: pointer; }
.canned-item:hover { background: #f5f7f9; }
```

- [ ] **Step 7: Manual verify**

Run: `cd server && npm start`. As owner: open a resolved blockage, add/remove a tag, click Canned (after adding one in Settings — Task 12). As the student-owner: open the resolved blockage and click a star; reload — the prompt becomes the readout.
Expected: tags update without errors; CSAT persists; canned text inserts into the composer.

- [ ] **Step 8: Commit**

```bash
git add functions/blockage.js dashboard.css
git commit -m "feat(detail): tag editing, student CSAT prompt, canned-reply inserter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Settings — manage tags, canned responses, and send a nudge

**Files:**
- Modify: `functions/settings.js` (add owner sections: Tags, Canned responses, Nudge a cohort)

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/tags`, `GET/POST/DELETE /api/canned`, `GET /api/cohorts`, `POST /api/nudges`.
- Produces: owner-only management UI; instructors get the Canned-responses section only (staff endpoint).

- [ ] **Step 1: Append a Tags section (owner)** — in `functions/settings.js`, after the existing settings content render, append a tags manager when `s.user.role === "owner"`:

```js
  if (s.user.role === "owner") {
    const tagsPanel = document.createElement("section");
    tagsPanel.className = "panel";
    tagsPanel.innerHTML = `<h2>Tags</h2>
      <form id="tagForm" class="composer">
        <input id="tagName" placeholder="New tag name" />
        <input id="tagColor" type="color" value="#12B886" />
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
      <div id="tagAll" class="blk-tags" style="margin-top:.75rem"></div>`;
    view.appendChild(tagsPanel);

    async function renderTags() {
      const { tags } = await API.get("/api/tags");
      document.getElementById("tagAll").innerHTML = (tags || [])
        .map(
          (t) => `<span class="tag-pill" style="--tag:${escapeHtml(t.color || "#5d6675")}">
            ${escapeHtml(t.name)} <button type="button" class="tag-del" data-id="${t.id}" title="Delete" style="background:none;border:0;cursor:pointer">×</button></span>`
        )
        .join("");
    }
    document.getElementById("tagForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("tagName").value.trim();
      const color = document.getElementById("tagColor").value;
      if (!name) return;
      try {
        await API.post("/api/tags", { name, color });
        document.getElementById("tagName").value = "";
        await renderTags();
      } catch (err) {
        toast(err.message || "Couldn't add tag.", "error");
      }
    });
    document.getElementById("tagAll").addEventListener("click", async (e) => {
      const del = e.target.closest(".tag-del");
      if (!del) return;
      try {
        await API.del("/api/tags/" + encodeURIComponent(del.getAttribute("data-id")));
        await renderTags();
      } catch (err) {
        toast(err.message || "Couldn't delete tag.", "error");
      }
    });
    await renderTags();
  }
```

- [ ] **Step 2: Append a Canned-responses section (staff)** — when `s.user.role !== "student"`:

```js
  if (s.user.role !== "student") {
    const cannedPanel = document.createElement("section");
    cannedPanel.className = "panel";
    cannedPanel.innerHTML = `<h2>Canned responses</h2>
      <form id="cannedForm" class="composer" style="flex-direction:column;align-items:stretch">
        <input id="cannedTitle" placeholder="Title (e.g. Centering a div)" />
        <textarea id="cannedBody" placeholder="The reply text…" rows="3"></textarea>
        <button class="btn btn-primary" type="submit">Save snippet</button>
      </form>
      <div id="cannedAll" style="margin-top:.75rem"></div>`;
    view.appendChild(cannedPanel);

    async function renderCanned() {
      const { canned } = await API.get("/api/canned");
      document.getElementById("cannedAll").innerHTML = (canned || []).length
        ? (canned)
            .map(
              (c) => `<div class="canned-item" style="cursor:default">
                <strong>${escapeHtml(c.title)}</strong>
                <button type="button" class="canned-del btn btn-ghost" data-id="${c.id}">Delete</button></div>`
            )
            .join("")
        : `<p class="thread-empty">No snippets yet.</p>`;
    }
    document.getElementById("cannedForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("cannedTitle").value.trim();
      const body = document.getElementById("cannedBody").value.trim();
      if (!title || !body) { toast("Title and body are required.", "warning"); return; }
      try {
        await API.post("/api/canned", { title, body });
        document.getElementById("cannedTitle").value = "";
        document.getElementById("cannedBody").value = "";
        await renderCanned();
      } catch (err) {
        toast(err.message || "Couldn't save snippet.", "error");
      }
    });
    document.getElementById("cannedAll").addEventListener("click", async (e) => {
      const del = e.target.closest(".canned-del");
      if (!del) return;
      try {
        await API.del("/api/canned/" + encodeURIComponent(del.getAttribute("data-id")));
        await renderCanned();
      } catch (err) {
        toast(err.message || "Couldn't delete snippet.", "error");
      }
    });
    await renderCanned();
  }
```

- [ ] **Step 3: Append a Nudge section (owner)** — when `s.user.role === "owner"`:

```js
  if (s.user.role === "owner") {
    const { cohorts } = await API.get("/api/cohorts");
    const cohortOpts = (cohorts || [])
      .map((c) => `<option value="cohort:${c.id}">${escapeHtml(c.name)}</option>`)
      .join("");
    const nudgePanel = document.createElement("section");
    nudgePanel.className = "panel";
    nudgePanel.innerHTML = `<h2>Send a nudge</h2>
      <form id="nudgeForm" class="composer" style="flex-direction:column;align-items:stretch">
        <select id="nudgeTarget">
          <option value="all-students">All students</option>
          <option value="at-risk">At-risk students</option>
          ${cohortOpts}
        </select>
        <textarea id="nudgeMsg" placeholder="Your message…" rows="3"></textarea>
        <button class="btn btn-primary" type="submit">Send nudge</button>
      </form>`;
    view.appendChild(nudgePanel);
    document.getElementById("nudgeForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = document.getElementById("nudgeMsg").value.trim();
      const target = document.getElementById("nudgeTarget").value;
      if (!message) { toast("Write a message first.", "warning"); return; }
      try {
        const r = await API.post("/api/nudges", { message, target });
        document.getElementById("nudgeMsg").value = "";
        toast(`Nudge sent to ${r.sent} student(s).`, "success");
      } catch (err) {
        toast(err.message || "Couldn't send the nudge.", "error");
      }
    });
  }
```

> Note: if `functions/settings.js` currently stores the shell content area in a variable other than `view`, use that variable instead. The reference shell helper returns `#view` via `renderShell`; reuse the same element the existing settings render appends to.

- [ ] **Step 4: Manual verify**

Run: `cd server && npm start`. As owner in Settings: add a tag (with color), add a canned response, send a nudge to a cohort. Log in as that cohort's student → Notifications shows the nudge.
Expected: each form works; lists refresh; nudge notification arrives.

- [ ] **Step 5: Commit**

```bash
git add functions/settings.js
git commit -m "feat(settings): manage tags, canned responses, and send nudges

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: CSAT + saved-views surfacing + full-suite verification

**Files:**
- Modify: `functions/owner.js` (show average CSAT stat in the dashboard stat row)
- Modify: `functions/instructor.js` and `functions/owner_blockages.js` (saved-views chip bar)

**Interfaces:**
- Consumes: `/api/analytics` (`avgCsat`,`csatCount`); `GET/POST/DELETE /api/views`; `csatStars`.
- Produces: an avg-CSAT stat on the owner dashboard; a "Saved views" chip bar on both list pages that applies/saves/deletes views.

- [ ] **Step 1: Show avg CSAT on the owner dashboard** — in `functions/owner.js`, in the first `stat-row`, add a fifth stat after "Median time to unblock":

```js
      <div class="stat"><div class="k">Avg satisfaction</div><div class="v">${a.csatCount ? a.avgCsat : "—"}</div></div>
```

- [ ] **Step 2: Add a saved-views chip bar to the instructor queue** — in `functions/instructor.js`, after the `.filters` div in `view.innerHTML`, add:

```html
    <div class="views-bar" id="viewsBar"></div>
```

After all filter state + listeners are wired, add:

```js
  async function loadViews() {
    let views = [];
    try { views = (await API.get("/api/views")).views || []; } catch (_) {}
    const bar = document.getElementById("viewsBar");
    bar.innerHTML =
      views
        .map(
          (v) => `<span class="view-chip" data-id="${v.id}">
            <button type="button" class="view-apply" data-id="${v.id}">${escapeHtml(v.name)}</button>
            <button type="button" class="view-del" data-id="${v.id}" title="Delete">×</button></span>`
        )
        .join("") + `<button type="button" class="btn btn-ghost" id="saveViewBtn">+ Save current view</button>`;

    bar.querySelector("#saveViewBtn").addEventListener("click", async () => {
      const name = prompt("Name this view:");
      if (!name) return;
      try {
        await API.post("/api/views", {
          name, status: statusFilter, cohortId: cohortFilter || null,
          tagId: tagFilter || null, search: searchQuery,
        });
        await loadViews();
      } catch (err) { toast(err.message || "Couldn't save view.", "error"); }
    });
    bar.querySelectorAll(".view-apply").forEach((b) =>
      b.addEventListener("click", () => {
        const v = views.find((x) => String(x.id) === b.getAttribute("data-id"));
        if (!v) return;
        statusFilter = v.status || "";
        cohortFilter = v.cohortId ? String(v.cohortId) : "";
        tagFilter = v.tagId ? String(v.tagId) : "";
        searchQuery = v.search || "";
        searchInput.value = searchQuery;
        cohortSel.value = cohortFilter;
        document.getElementById("tag").value = tagFilter;
        seg.querySelectorAll("button[data-status]").forEach((bt) =>
          bt.classList.toggle("active", (bt.dataset.status || "") === statusFilter)
        );
        syncUrl();
        renderGrid();
      })
    );
    bar.querySelectorAll(".view-del").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await API.del("/api/views/" + encodeURIComponent(b.getAttribute("data-id")));
          await loadViews();
        } catch (err) { toast(err.message || "Couldn't delete view.", "error"); }
      })
    );
  }
  await loadViews();
```

- [ ] **Step 3: Mirror the chip bar into `functions/owner_blockages.js`** — apply the identical `views-bar` markup + `loadViews()` block, using that page's filter-state variable names.

- [ ] **Step 4: Add chip styles** — append to `dashboard.css`:

```css
.views-bar { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.5rem 0 1rem; }
.view-chip { display: inline-flex; align-items: center; border: 1px solid #e3e6ea; border-radius: 999px; overflow: hidden; }
.view-chip .view-apply { background: none; border: 0; padding: 0.3rem 0.6rem; cursor: pointer; font: 600 0.8rem var(--font-mono); }
.view-chip .view-del { background: none; border: 0; padding: 0 0.5rem; cursor: pointer; color: #99a1ad; }
```

- [ ] **Step 5: Run the full backend suite**

Run: `cd server && npm test`
Expected: PASS — all Phase 4 tests plus the pre-existing suite green.

- [ ] **Step 6: Full-stack manual verify**

Run: `cd server && npm start`. Flow: signup → cohort + brief → invite/join student → report → resolve → student rates (CSAT) → owner dashboard shows avg satisfaction → save a queue view, apply it, delete it → send a nudge.
Expected: no console errors; every Phase 4 surface works end to end.

- [ ] **Step 7: Commit**

```bash
git add functions/owner.js functions/instructor.js functions/owner_blockages.js dashboard.css
git commit -m "feat(views): saved-view chips on lists + avg CSAT on dashboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

**1. Spec coverage**
- [ ] Student 360 profile — `student_profile.html` + `functions/student_profile.js` (Task 9), backend `GET /api/members/:id/profile` (Task 2, staff + tenant-scoped). ✅
- [ ] Tags / custom fields — `tags` + `blockage_tags` via `migrate()` (Task 1), CRUD + attach/detach + `?tag=` filter (Task 3), list/detail UI (Tasks 10–11). ✅
- [ ] Saved views — `saved_views` table (Task 1), endpoints (Task 4), chip bar on list pages (Task 13). ✅
- [ ] CSAT — `csat` table (Task 1), rate endpoint + analytics avg + detail echo (Task 5), student prompt + dashboard stat + 360 surface (Tasks 9, 11, 13). ✅
- [ ] Nudges / campaigns — `POST /api/nudges` in-app notifications, degrades gracefully (Task 6), Settings UI (Task 12). ✅
- [ ] Canned responses — `canned_responses` table (Task 1), staff CRUD (Task 7), composer inserter + Settings manager (Tasks 11–12). ✅

**2. Placeholder scan** — No "TBD/TODO/implement later"; every code step shows real code; tests carry concrete assertions. ✅

**3. Type consistency**
- [ ] `tagsFor(blockageId)` defined inside both `tags.js` and `blockages.js`; `summary(r)` returns `tags:[{id,name,color}]` consumed by `tagPills`/list filters/blockage detail.
- [ ] `csatFor` returns `{rating,comment}`; detail field `blk.csat`, analytics `avgCsat`/`csatCount`, profile `stats.avgCsat`/`stats.csatCount` — names consistent across Tasks 2, 5, 9, 13.
- [ ] Saved-view shape `{id,name,status,cohortId,tagId,search}` consistent between `views.js` (Task 4) and the chip bar (Task 13).
- [ ] Nudge `target` strings `"cohort:<id>" | "at-risk" | "all-students"` match between `nudges.js` (Task 6) and Settings (Task 12).
- [ ] `csatStars(n)` / `tagPills(tags)` defined once in `api.js` (Task 8) and used in Tasks 9, 11, 13.

**4. Constraint adherence**
- [ ] Every new table carries `org_id` and every query filters by the caller's `org_id`; cross-tenant returns 404 (profile, canned, tags tests assert this).
- [ ] All factories are `(db) => router`, mounted under `/api` in `server/index.js`.
- [ ] No new nav-linked page (Student 360 is opened via `?id=`), so no `NAV` change is required in `functions/api.js`.
- [ ] All user-supplied values rendered via `escapeHtml`; tests gate AI with the helper's default `AI_AUTORESPOND=0`.
- [ ] Each commit message ends with the required `Co-Authored-By` trailer.
