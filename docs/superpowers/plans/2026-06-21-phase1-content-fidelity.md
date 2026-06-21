# Phase 1: Content Fidelity Implementation Plan

**Goal:** Make Unblockify usable by a real coding bootcamp by giving threads and blockage
details the two things code learners cannot work without: (1) safe **markdown + fenced
code-block rendering** in comments and blockage details, and (2) **file/image/screenshot
attachments**, stored locally on disk, attachable when reporting a blockage and when
commenting, and rendered inline in the thread and detail. Both are XSS-safe and tenant-isolated;
the app keeps running with zero external config.

**Architecture:** Unchanged shape. The backend stays an Express app built by `createApp(db)`
(`server/index.js`), mounting route factories `(db)=>router` under `/api`; JWT lives in an
httpOnly cookie `{userId, orgId, role}`; auth is enforced via `requireAuth` / `requireRole` /
`requireStaff`. Multi-tenancy is one SQLite DB where every row carries `org_id` and every query
filters by the caller's org (cross-tenant → 404). Phase 1 adds:
- A **client-only** rendering layer: a new `renderMarkdown(raw)` helper in `functions/api.js`
  that escapes HTML first, then renders a minimal safe markdown subset into HTML. Comment/detail
  bodies are stored as **raw text** (unchanged storage); rendering happens only at display time.
- A new **`attachments`** table (added via `migrate()` in `server/db.js`), files written under
  `server/uploads/` (gitignored). A new route factory `server/routes/attachments.js` exposes a
  JSON+base64 **upload** endpoint (size-capped, mime-allowlisted), a tenant-guarded **download/
  preview** endpoint that streams the stored file, and a **list** endpoint. Reporting a blockage
  and posting a comment accept attachment IDs to bind freshly-uploaded files to a blockage/comment.
- Front-end wiring in `functions/blockage.js` (render markdown + attachments in thread/detail,
  attach-to-comment UI) and `functions/dashbord.js` (attach-on-report UI). A tiny shared upload
  helper lives in `functions/api.js`.

The base64 JSON transport (not multipart) is deliberate: the existing test client
(`test/helpers.js` `makeClient`) speaks JSON only, deps stay pure-JS (no `multer`/native build),
and the 100kb express JSON cap is raised only for the upload route.

**Tech Stack:** Node ≥22 with the built-in `node:sqlite` module (run via
`node --experimental-sqlite`); Express; `jsonwebtoken`; `cookie-parser`; built-in `node:fs`,
`node:path`, `node:crypto`. Front-end is vanilla HTML/CSS/JS (no build step). Tests use
`node:test` + `node:assert/strict` against an in-memory DB via `server/test/helpers.js`.

## Global Constraints
- Runs entirely LOCAL; no cloud. Node ≥22 built-in node:sqlite (run with --experimental-sqlite); pure-JS deps only (no native build).
- External/heavy features follow the AI pattern: a local-first default that works with zero config; app always runs offline.
- Backend: Express; route files are factories `(db)=>router` mounted in server/index.js under /api; JWT httpOnly cookie {userId,orgId,role}; requireAuth/requireRole/requireStaff.
- Multi-tenant: every row has org_id; every query filters by caller org; cross-tenant → 404. New tables/columns via migrate() in server/db.js.
- Front-end: vanilla HTML/CSS/JS, no build; pages load functions/api.js then page script; use renderShell + shared helpers; ALWAYS escapeHtml user values; follow the "Signal" design tokens.
- Tests: node:test, in-memory DB via test/helpers.js (buildOrg/joinMember exported); npm test auto-discovers test/*.test.js; gate AI with AI_AUTORESPOND.
- Commit messages end with: Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## File Structure

**Created**
- `server/lib/uploads.js` — upload domain helpers: mime allowlist + extension map, size cap
  constant, base64 decode + validation, deterministic stored-path generation, ensure-dir.
- `server/routes/attachments.js` — route factory `(db)=>router`: `POST /api/attachments`
  (JSON+base64 upload), `GET /api/attachments/:id` (tenant-guarded download/preview stream),
  `GET /api/blockages/:id/attachments` (list for a blockage). Reuses `canSeeBlockage`.
- `server/uploads/` — on-disk file store (created at runtime; gitignored). A committed
  `server/uploads/.gitkeep` keeps the directory in the tree.
- `server/test/attachments.test.js` — backend tests: upload validation (size/mime), tenant
  isolation on download, binding on report + comment, listing, orphan cleanup-on-delete.
- `server/test/markdown_note.test.js` — a tiny backend assertion that comment/detail bodies are
  stored **raw** (markdown is never transformed server-side).

**Modified**
- `server/db.js` — add `attachments` table + indexes in `migrate()`; bind `blockage_id` /
  `comment_id` columns are nullable so an attachment can be uploaded first, then bound.
- `server/index.js` — mount `attachmentRoutes(db)`; the attachments router sets its own larger
  JSON body limit (so the global 100kb cap stays for everything else).
- `server/routes/blockages.js` — on report (`POST /blockages`) and on comment
  (`POST /blockages/:id/comments`) accept an `attachmentIds` array and bind those rows; include
  per-comment + blockage-level `attachments` in `GET /blockages/:id`.
- `functions/api.js` — add `renderMarkdown(raw)` (HTML-escape-first safe subset) and
  `uploadAttachment(file)` (reads a `File`, base64-encodes, POSTs to `/api/attachments`).
- `functions/blockage.js` — render bodies with `renderMarkdown`; render attachments (image
  thumbnails / file chips) in detail + each comment; add an attach control to the composer and
  send `attachmentIds` with comments.
- `functions/dashbord.js` — add an attach control to the "New blockage" modal; upload chosen
  files then send `attachmentIds` with the report.
- `dashboard.css` — styles for `.md-*` rendered markdown (code blocks, inline code, lists,
  links), `.attachments` grid, `.att-thumb`, `.att-chip`, and the `.attach-row` composer control,
  using the "Signal" tokens (`--font-mono`, ink, `--flow`).
- `.gitignore` — ignore `server/uploads/*` but keep `.gitkeep`.

---

### Task 1 — `attachments` table + migration

**Files:** `server/db.js`, `server/test/attachments.test.js` (new, first assertions),
`server/test/helpers.js` (read-only; reused).

**Interfaces:**
- Consumes: `openDb(":memory:") -> db` (existing).
- Produces: table `attachments(id INTEGER PK, org_id INTEGER NOT NULL, blockage_id INTEGER NULL,
  comment_id INTEGER NULL, uploader_id INTEGER NOT NULL, filename TEXT NOT NULL, mime TEXT NOT
  NULL, size INTEGER NOT NULL, stored_path TEXT NOT NULL, created_at TEXT NOT NULL)` with FKs
  to `organizations`, `blockages`, `comments`, `users` and indexes on `org_id`, `blockage_id`,
  `comment_id`.

**TDD steps**

1. Write a failing test that the table exists and is empty after a fresh DB.

   `server/test/attachments.test.js`:
   ```js
   "use strict";
   const test = require("node:test");
   const assert = require("node:assert/strict");
   const { openDb } = require("../db");

   test("attachments table exists and is empty on a fresh db", () => {
     const db = openDb(":memory:");
     const cols = db.prepare("PRAGMA table_info(attachments)").all().map((c) => c.name);
     assert.deepEqual(
       cols,
       ["id", "org_id", "blockage_id", "comment_id", "uploader_id",
        "filename", "mime", "size", "stored_path", "created_at"],
       "attachments has the expected columns in order"
     );
     const n = db.prepare("SELECT COUNT(*) AS n FROM attachments").get().n;
     assert.equal(n, 0);
   });
   ```

2. Run — expect fail (`no such table: attachments`).
   ```bash
   cd server && node --experimental-sqlite --test test/attachments.test.js
   ```

3. Add the table to `migrate()` in `server/db.js`, immediately after the `notifications` table
   block and before the existing `CREATE INDEX` lines:
   ```sql
   CREATE TABLE IF NOT EXISTS attachments (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     blockage_id INTEGER REFERENCES blockages(id) ON DELETE CASCADE,
     comment_id  INTEGER REFERENCES comments(id) ON DELETE CASCADE,
     uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     filename    TEXT NOT NULL,
     mime        TEXT NOT NULL,
     size        INTEGER NOT NULL,
     stored_path TEXT NOT NULL,
     created_at  TEXT NOT NULL DEFAULT (datetime('now'))
   );
   ```
   And add to the index block:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_att_org ON attachments(org_id);
   CREATE INDEX IF NOT EXISTS idx_att_blk ON attachments(blockage_id);
   CREATE INDEX IF NOT EXISTS idx_att_cmt ON attachments(comment_id);
   ```

4. Run — expect pass.
   ```bash
   cd server && node --experimental-sqlite --test test/attachments.test.js
   ```

5. Commit.
   ```bash
   git add server/db.js server/test/attachments.test.js
   git commit -m "Add attachments table + migration

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

### Task 2 — Upload domain helpers (`lib/uploads.js`)

**Files:** `server/lib/uploads.js` (new), `server/test/attachments.test.js` (append).

**Interfaces:**
- Consumes: nothing (pure functions + fs).
- Produces:
  - `MAX_UPLOAD_BYTES: number` (= `5 * 1024 * 1024`).
  - `ALLOWED_MIME: Record<string,string>` (mime → canonical extension).
  - `extForMime(mime: string) -> string|null`.
  - `decodeBase64({ dataB64: string, mime: string }) -> { buffer: Buffer, size: number } | { error: string }` — validates mime is allowed and decoded size ≤ cap.
  - `uploadsDir() -> string` (absolute path to `server/uploads`, created if missing).
  - `storedPathFor(ext: string) -> { abs: string, rel: string }` — random `crypto`-named file; `rel` is what we persist in `stored_path`.

**TDD steps**

1. Append failing tests for the helper contract.
   ```js
   const up = require("../lib/uploads");
   const fs = require("node:fs");

   test("decodeBase64 rejects disallowed mime", () => {
     const r = up.decodeBase64({ dataB64: Buffer.from("x").toString("base64"), mime: "application/x-sh" });
     assert.ok(r.error, "returns an error for a disallowed mime");
   });

   test("decodeBase64 rejects oversized payloads", () => {
     const big = Buffer.alloc(up.MAX_UPLOAD_BYTES + 1, 0x61).toString("base64");
     const r = up.decodeBase64({ dataB64: big, mime: "image/png" });
     assert.ok(r.error, "returns an error past the size cap");
   });

   test("decodeBase64 accepts a small allowed file and reports size", () => {
     const buf = Buffer.from("hello");
     const r = up.decodeBase64({ dataB64: buf.toString("base64"), mime: "text/plain" });
     assert.equal(r.error, undefined);
     assert.equal(r.size, 5);
     assert.ok(Buffer.isBuffer(r.buffer));
   });

   test("storedPathFor returns a unique rel path under uploads", () => {
     const a = up.storedPathFor("png");
     const b = up.storedPathFor("png");
     assert.notEqual(a.rel, b.rel, "paths are unique");
     assert.match(a.rel, /\.png$/);
     assert.ok(fs.existsSync(up.uploadsDir()), "uploads dir exists");
   });
   ```

2. Run — expect fail (`Cannot find module '../lib/uploads'`).
   ```bash
   cd server && node --experimental-sqlite --test test/attachments.test.js
   ```

3. Implement `server/lib/uploads.js`:
   ```js
   "use strict";

   const fs = require("node:fs");
   const path = require("node:path");
   const crypto = require("node:crypto");

   const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

   // mime -> canonical extension. Allowlist only: images, plain text, pdf.
   const ALLOWED_MIME = {
     "image/png": "png",
     "image/jpeg": "jpg",
     "image/gif": "gif",
     "image/webp": "webp",
     "image/svg+xml": "svg",
     "text/plain": "txt",
     "application/pdf": "pdf",
   };

   function extForMime(mime) {
     return ALLOWED_MIME[String(mime || "").toLowerCase()] || null;
   }

   function uploadsDir() {
     const dir = path.join(__dirname, "..", "uploads");
     if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
     return dir;
   }

   function storedPathFor(ext) {
     const name = crypto.randomBytes(16).toString("hex") + "." + ext;
     return { abs: path.join(uploadsDir(), name), rel: name };
   }

   function decodeBase64({ dataB64, mime }) {
     const ext = extForMime(mime);
     if (!ext) return { error: "Unsupported file type." };
     if (typeof dataB64 !== "string" || !dataB64)
       return { error: "Empty file." };
     let buffer;
     try {
       buffer = Buffer.from(dataB64, "base64");
     } catch (_) {
       return { error: "Could not read the file." };
     }
     if (!buffer.length) return { error: "Empty file." };
     if (buffer.length > MAX_UPLOAD_BYTES)
       return { error: "File is larger than 5MB." };
     return { buffer, size: buffer.length };
   }

   module.exports = {
     MAX_UPLOAD_BYTES, ALLOWED_MIME, extForMime, uploadsDir, storedPathFor, decodeBase64,
   };
   ```

4. Run — expect pass.
   ```bash
   cd server && node --experimental-sqlite --test test/attachments.test.js
   ```

5. Commit.
   ```bash
   git add server/lib/uploads.js server/test/attachments.test.js
   git commit -m "Add upload domain helpers (mime allowlist, base64 decode, stored paths)

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

### Task 3 — Upload + download + list endpoints (`routes/attachments.js`)

**Files:** `server/routes/attachments.js` (new), `server/index.js`, `.gitignore`,
`server/uploads/.gitkeep` (new), `server/test/attachments.test.js` (append),
`server/test/helpers.js` (read-only; `startServer`/`buildOrg`/`makeClient` reused).

**Interfaces:**
- Consumes:
  - `requireAuth`, `requireStaff` from `../auth`.
  - `canSeeBlockage` from `../lib/helpers`.
  - `decodeBase64`, `extForMime`, `storedPathFor`, `uploadsDir`, `MAX_UPLOAD_BYTES` from `../lib/uploads`.
- Produces (mounted under `/api`):
  - `POST /api/attachments` body `{ filename: string, mime: string, dataB64: string, blockageId?: number }`
    → `201 { attachment: { id, filename, mime, size, blockageId } }`. Writes file to disk + a row
    (`org_id` = caller, `uploader_id` = caller, `blockage_id` nullable). If `blockageId` is given,
    the caller must pass `canSeeBlockage`, else 404.
  - `GET /api/attachments/:id` → streams the file bytes with `Content-Type: <mime>` and
    `Content-Disposition: inline; filename="<name>"`; SVG is forced to `Content-Disposition:
    attachment` and served with `X-Content-Type-Options: nosniff` (defence-in-depth against
    inline SVG script). Cross-tenant or unseeable → 404.
  - `GET /api/blockages/:id/attachments` → `{ attachments: [{ id, filename, mime, size, commentId, createdAt }] }` for a visible blockage.

**TDD steps**

1. Append failing endpoint tests (use the JSON test client + `buildOrg`).
   ```js
   const { startServer, buildOrg, makeClient } = require("./helpers");

   const PNG_B64 =
     "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

   test("upload + download is tenant-isolated", async () => {
     const srv = await startServer();
     try {
       const a = await buildOrg(srv.base, "Org A", "att-a");
       const b = await buildOrg(srv.base, "Org B", "att-b");

       const up = await a.student.post("/api/attachments", {
         filename: "shot.png", mime: "image/png", dataB64: PNG_B64,
       });
       assert.equal(up.status, 201, "owner of org A uploads");
       const attId = up.body.attachment.id;
       assert.ok(up.body.attachment.size > 0);

       // Org B cannot download org A's attachment.
       const cross = await b.owner.get("/api/attachments/" + attId);
       assert.equal(cross.status, 404, "cross-tenant download is 404");

       // Owner of org A can.
       const ok = await a.owner.get("/api/attachments/" + attId);
       assert.equal(ok.status, 200);
     } finally {
       await srv.close();
     }
   });

   test("upload rejects disallowed mime and oversized files", async () => {
     const srv = await startServer();
     try {
       const a = await buildOrg(srv.base, "Org C", "att-c");
       const bad = await a.student.post("/api/attachments", {
         filename: "x.sh", mime: "application/x-sh", dataB64: PNG_B64,
       });
       assert.equal(bad.status, 400);
     } finally {
       await srv.close();
     }
   });
   ```
   (Note: `makeClient`'s `get` returns parsed JSON; for a 200 binary download the helper's
   `res.json()` will throw and `body` is `null` — the test only asserts on `status`, which is
   what matters for the isolation contract.)

2. Run — expect fail (route not mounted; 404 on POST).
   ```bash
   cd server && node --experimental-sqlite --test test/attachments.test.js
   ```

3. Implement `server/routes/attachments.js`:
   ```js
   "use strict";

   const express = require("express");
   const fs = require("node:fs");
   const path = require("node:path");
   const { requireAuth } = require("../auth");
   const { canSeeBlockage } = require("../lib/helpers");
   const {
     decodeBase64, extForMime, storedPathFor, uploadsDir, MAX_UPLOAD_BYTES,
   } = require("../lib/uploads");

   module.exports = function attachmentRoutes(db) {
     const router = express.Router();
     // Allow base64 payloads up to ~7MB JSON for a 5MB binary; this router only.
     router.use(express.json({ limit: "8mb" }));
     router.use(requireAuth);

     const blockageById = (id) =>
       db.prepare("SELECT * FROM blockages WHERE id = ?").get(Number(id));

     // POST /api/attachments — JSON+base64 upload
     router.post("/attachments", (req, res) => {
       const filename = String(req.body.filename || "").trim().slice(0, 200) || "file";
       const mime = String(req.body.mime || "").toLowerCase();
       const blockageId = req.body.blockageId ? Number(req.body.blockageId) : null;

       const decoded = decodeBase64({ dataB64: req.body.dataB64, mime });
       if (decoded.error) return res.status(400).json({ error: decoded.error });

       if (blockageId) {
         const row = blockageById(blockageId);
         if (!canSeeBlockage(db, req.user, row))
           return res.status(404).json({ error: "Blockage not found." });
       }

       const { abs, rel } = storedPathFor(extForMime(mime));
       try {
         fs.writeFileSync(abs, decoded.buffer);
       } catch (_) {
         return res.status(500).json({ error: "Couldn't save the file." });
       }
       const info = db
         .prepare(
           `INSERT INTO attachments (org_id, blockage_id, comment_id, uploader_id, filename, mime, size, stored_path)
            VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`
         )
         .run(req.user.orgId, blockageId, req.user.userId, filename, mime, decoded.size, rel);
       res.status(201).json({
         attachment: {
           id: info.lastInsertRowid,
           filename, mime, size: decoded.size, blockageId,
         },
       });
     });

     // GET /api/attachments/:id — tenant-guarded stream
     router.get("/attachments/:id", (req, res) => {
       const att = db
         .prepare("SELECT * FROM attachments WHERE id = ? AND org_id = ?")
         .get(Number(req.params.id), req.user.orgId);
       if (!att) return res.status(404).json({ error: "Not found." });
       // If bound to a blockage, the caller must be able to see it.
       if (att.blockage_id) {
         const row = blockageById(att.blockage_id);
         if (!canSeeBlockage(db, req.user, row))
           return res.status(404).json({ error: "Not found." });
       }
       const abs = path.join(uploadsDir(), att.stored_path);
       if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found." });

       res.setHeader("X-Content-Type-Options", "nosniff");
       res.setHeader("Content-Type", att.mime);
       // SVG can carry script; never render it inline.
       const disp = att.mime === "image/svg+xml" ? "attachment" : "inline";
       res.setHeader(
         "Content-Disposition",
         `${disp}; filename="${att.filename.replace(/"/g, "")}"`
       );
       fs.createReadStream(abs).pipe(res);
     });

     // GET /api/blockages/:id/attachments — list for a visible blockage
     router.get("/blockages/:id/attachments", (req, res) => {
       const row = blockageById(req.params.id);
       if (!canSeeBlockage(db, req.user, row))
         return res.status(404).json({ error: "Blockage not found." });
       const rows = db
         .prepare(
           `SELECT id, filename, mime, size, comment_id AS commentId, created_at AS createdAt
              FROM attachments WHERE blockage_id = ? AND org_id = ? ORDER BY created_at`
         )
         .all(row.id, req.user.orgId);
       res.json({ attachments: rows });
     });

     return router;
   };
   ```

4. Mount it in `server/index.js`. Add the require near the other route requires:
   ```js
   const attachmentRoutes = require("./routes/attachments");
   ```
   and mount it **before** the generic `/api` 404 handler, alongside the others:
   ```js
   app.use("/api", attachmentRoutes(db));
   ```

5. Add `server/uploads/.gitkeep` (empty) and update `.gitignore`:
   ```
   server/uploads/*
   !server/uploads/.gitkeep
   ```

6. Run — expect pass.
   ```bash
   cd server && node --experimental-sqlite --test test/attachments.test.js
   ```

7. Commit.
   ```bash
   git add server/routes/attachments.js server/index.js .gitignore server/uploads/.gitkeep server/test/attachments.test.js
   git commit -m "Add attachment upload/download/list endpoints (local-first, tenant-guarded)

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

### Task 4 — Bind attachments on report + comment; surface them in detail

**Files:** `server/routes/blockages.js`, `server/test/attachments.test.js` (append).

**Interfaces:**
- Consumes (request bodies, additive — existing fields unchanged):
  - `POST /api/blockages` now also reads `attachmentIds?: number[]` and binds each owned, unbound
    attachment (same org, `uploader_id` = caller, `blockage_id IS NULL`) to the new blockage.
  - `POST /api/blockages/:id/comments` now also reads `attachmentIds?: number[]` and binds each
    such attachment to the blockage **and** the new comment.
- Produces:
  - `GET /api/blockages/:id` response: each `comments[i]` gains `attachments: [{id,filename,mime,size}]`;
    the `blockage` object gains a top-level `attachments` array for files attached to the report
    itself (those with `blockage_id` set and `comment_id IS NULL`).

**TDD steps**

1. Append a failing test that an attachment uploaded then referenced on report shows up in detail.
   ```js
   test("attachments bind to a report and appear in detail", async () => {
     const srv = await startServer();
     try {
       const a = await buildOrg(srv.base, "Org D", "att-d");
       const up = await a.student.post("/api/attachments", {
         filename: "err.png", mime: "image/png", dataB64: PNG_B64,
       });
       const attId = up.body.attachment.id;

       const rep = await a.student.post("/api/blockages", {
         title: "Red error", details: "stack trace here",
         cohortId: a.cohortId, attachmentIds: [attId],
       });
       assert.equal(rep.status, 201);
       const blkId = rep.body.blockage.id;

       const detail = await a.student.get("/api/blockages/" + blkId);
       assert.equal(detail.status, 200);
       const reportAtts = detail.body.blockage.attachments || [];
       assert.equal(reportAtts.length, 1, "report-level attachment present");
       assert.equal(reportAtts[0].filename, "err.png");
     } finally {
       await srv.close();
     }
   });

   test("attachments bind to a comment", async () => {
     const srv = await startServer();
     try {
       const a = await buildOrg(srv.base, "Org E", "att-e");
       const rep = await a.student.post("/api/blockages", {
         title: "Q", details: "d", cohortId: a.cohortId,
       });
       const blkId = rep.body.blockage.id;
       const up = await a.student.post("/api/attachments", {
         filename: "c.png", mime: "image/png", dataB64: PNG_B64, blockageId: blkId,
       });
       const cmt = await a.student.post("/api/blockages/" + blkId + "/comments", {
         body: "see screenshot", attachmentIds: [up.body.attachment.id],
       });
       assert.equal(cmt.status, 201);

       const detail = await a.student.get("/api/blockages/" + blkId);
       const withAtt = (detail.body.blockage.comments || []).find(
         (c) => (c.attachments || []).length
       );
       assert.ok(withAtt, "a comment carries its attachment");
       assert.equal(withAtt.attachments[0].filename, "c.png");
     } finally {
       await srv.close();
     }
   });
   ```

2. Run — expect fail (no binding; arrays absent).
   ```bash
   cd server && node --experimental-sqlite --test test/attachments.test.js
   ```

3. In `server/routes/blockages.js`, add a binding helper near the top of the factory
   (after `joinedById` is defined):
   ```js
   // Bind caller-owned, still-unbound attachments to a blockage (+ optional comment).
   function bindAttachments(user, ids, blockageId, commentId) {
     if (!Array.isArray(ids) || !ids.length) return;
     const upd = db.prepare(
       `UPDATE attachments SET blockage_id = ?, comment_id = ?
         WHERE id = ? AND org_id = ? AND uploader_id = ? AND blockage_id IS NULL`
     );
     for (const raw of ids.slice(0, 10)) {
       const id = Number(raw);
       if (id) upd.run(blockageId, commentId || null, id, user.orgId, user.userId);
     }
   }
   ```
   (Comment-time attachments are uploaded with `blockageId` set, so loosen the comment binding to
   also accept rows already bound to *this* blockage by the same uploader with `comment_id IS NULL`
   — implement a second prepared statement for the comment path:)
   ```js
   function bindToComment(user, ids, blockageId, commentId) {
     if (!Array.isArray(ids) || !ids.length) return;
     const upd = db.prepare(
       `UPDATE attachments SET comment_id = ?
         WHERE id = ? AND org_id = ? AND uploader_id = ?
           AND comment_id IS NULL AND (blockage_id = ? OR blockage_id IS NULL)`
     );
     const setBlk = db.prepare(
       `UPDATE attachments SET blockage_id = ? WHERE id = ? AND blockage_id IS NULL`
     );
     for (const raw of ids.slice(0, 10)) {
       const id = Number(raw);
       if (!id) continue;
       setBlk.run(blockageId, id);
       upd.run(commentId, id, user.orgId, user.userId, blockageId);
     }
   }
   ```

4. In `POST /blockages`, after `addEvent(... "created" ...)` and before sending the response, bind
   report-level attachments:
   ```js
   bindAttachments(req.user, req.body.attachmentIds, id, null);
   ```

5. In `POST /blockages/:id/comments`, capture the inserted comment id and bind to it. Change:
   ```js
   db.prepare(
     "INSERT INTO comments (org_id, blockage_id, user_id, body) VALUES (?, ?, ?, ?)"
   ).run(row.org_id, row.id, req.user.userId, body);
   ```
   to:
   ```js
   const cmtInfo = db.prepare(
     "INSERT INTO comments (org_id, blockage_id, user_id, body) VALUES (?, ?, ?, ?)"
   ).run(row.org_id, row.id, req.user.userId, body);
   bindToComment(req.user, req.body.attachmentIds, row.id, cmtInfo.lastInsertRowid);
   ```

6. In `GET /blockages/:id`, after `comments` are fetched, attach per-comment + report-level files.
   Add after the `comments` query:
   ```js
   const atts = db
     .prepare(
       `SELECT id, filename, mime, size, comment_id AS commentId
          FROM attachments WHERE blockage_id = ? ORDER BY created_at`
     )
     .all(row.id);
   const byComment = new Map();
   const reportAtts = [];
   for (const at of atts) {
     const slim = { id: at.id, filename: at.filename, mime: at.mime, size: at.size };
     if (at.commentId == null) reportAtts.push(slim);
     else {
       if (!byComment.has(at.commentId)) byComment.set(at.commentId, []);
       byComment.get(at.commentId).push(slim);
     }
   }
   for (const c of comments) c.attachments = byComment.get(c.id) || [];
   ```
   Then add `attachments: reportAtts` to the `blockage` object returned in `res.json(...)`.

7. Run — expect pass.
   ```bash
   cd server && node --experimental-sqlite --test test/attachments.test.js
   ```

8. Commit.
   ```bash
   git add server/routes/blockages.js server/test/attachments.test.js
   git commit -m "Bind attachments on report + comment and surface them in blockage detail

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

### Task 5 — Raw-storage guard test for markdown

**Files:** `server/test/markdown_note.test.js` (new).

**Interfaces:**
- Consumes: `startServer`, `buildOrg` from `./helpers`.
- Produces: assertion that a markdown comment body round-trips byte-for-byte (server stores raw;
  rendering is client-only).

**TDD steps**

1. Write the test (it should pass immediately — it pins the contract that no server-side
   transform sneaks in later).
   ```js
   "use strict";
   const test = require("node:test");
   const assert = require("node:assert/strict");
   const { startServer, buildOrg } = require("./helpers");

   test("comment markdown is stored and returned raw (no server-side render)", async () => {
     const srv = await startServer();
     try {
       const a = await buildOrg(srv.base, "Org MD", "md");
       const rep = await a.student.post("/api/blockages", {
         title: "T", details: "**not rendered**", cohortId: a.cohortId,
       });
       const blkId = rep.body.blockage.id;
       const raw = "Try `npm test` and **bold** and:\n```js\nconst x = 1;\n```";
       await a.student.post("/api/blockages/" + blkId + "/comments", { body: raw });
       const detail = await a.student.get("/api/blockages/" + blkId);
       const mine = detail.body.blockage.comments.find((c) => c.body === raw);
       assert.ok(mine, "comment body is byte-for-byte the raw markdown");
       assert.equal(detail.body.blockage.details, "**not rendered**");
     } finally {
       await srv.close();
     }
   });
   ```

2. Run — expect pass (storage is already raw).
   ```bash
   cd server && node --experimental-sqlite --test test/markdown_note.test.js
   ```

3. No implementation needed (this guards existing behaviour). Commit.
   ```bash
   git add server/test/markdown_note.test.js
   git commit -m "Pin that comment/detail bodies are stored raw (markdown is client-only)

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

### Task 6 — `renderMarkdown(raw)` + `uploadAttachment(file)` in `functions/api.js`

**Files:** `functions/api.js`, `server/test/markdown_render.test.js` (new — a Node-runnable unit
test of the pure `renderMarkdown` function).

**Interfaces:**
- Consumes: `escapeHtml` (already in `api.js`).
- Produces:
  - `renderMarkdown(raw: string) -> string` (HTML). Order is mandatory: **escape first**, then
    render the safe subset. Subset: fenced code blocks ```` ```lang ... ``` ````
    (monospace block + optional language label), inline `` `code` ``, `**bold**`, `*italic*`,
    `[text](http(s)://url)` → `<a href rel="noopener noreferrer" target="_blank">` (URL allowlist:
    only `http:`/`https:`; anything else rendered as escaped text), simple `-`/`*` bullet lists,
    and line breaks (`\n` → `<br>` outside code). No raw HTML passthrough.
  - `uploadAttachment(file: File, opts?: { blockageId?: number }) -> Promise<{ id, filename, mime, size }>`
    — reads the `File` as base64, POSTs to `/api/attachments`, returns `attachment`. Throws if the
    file exceeds 5MB or its type is not allowed (client mirrors the server allowlist for a fast
    error).

**TDD steps**

1. Write a failing pure-function test. Because `functions/api.js` is a browser script (no
   `module.exports`), the test reads the file, strips the browser-only `uploadAttachment`/DOM bits
   by evaluating only `renderMarkdown` + `escapeHtml` in a sandbox. Implement the test to `eval`
   the two function sources via a small extraction:
   ```js
   "use strict";
   const test = require("node:test");
   const assert = require("node:assert/strict");
   const fs = require("node:fs");
   const path = require("node:path");
   const vm = require("node:vm");

   // Load escapeHtml + renderMarkdown out of the browser file into a sandbox.
   const src = fs.readFileSync(
     path.join(__dirname, "..", "..", "functions", "api.js"), "utf8"
   );
   const ctx = { document: undefined };
   vm.createContext(ctx);
   // Expose just the two pure helpers we need.
   vm.runInContext(
     src.match(/function escapeHtml[\s\S]*?\n}\n/)[0] +
     src.match(/function renderMarkdown[\s\S]*?\n}\n/)[0] +
     "this.escapeHtml = escapeHtml; this.renderMarkdown = renderMarkdown;",
     ctx
   );
   const { renderMarkdown } = ctx;

   test("renderMarkdown escapes HTML before formatting (XSS-safe)", () => {
     const out = renderMarkdown('<img src=x onerror=alert(1)> **bold**');
     assert.ok(!out.includes("<img"), "raw HTML is neutralised");
     assert.ok(out.includes("&lt;img"), "tags are escaped");
     assert.ok(out.includes("<strong>bold</strong>"));
   });

   test("renderMarkdown renders fenced code blocks with a language label", () => {
     const out = renderMarkdown("```js\nconst x = 1;\n```");
     assert.ok(out.includes('class="md-code"'));
     assert.ok(out.includes("const x = 1;"));
     assert.ok(out.includes("js"), "language label present");
   });

   test("renderMarkdown renders inline code and keeps it escaped", () => {
     const out = renderMarkdown("run `rm -rf <x>` now");
     assert.ok(out.includes('<code class="md-inline">rm -rf &lt;x&gt;</code>'));
   });

   test("renderMarkdown only allows http(s) links", () => {
     const ok = renderMarkdown("[site](https://ex.com)");
     assert.ok(ok.includes('rel="noopener noreferrer"'));
     const bad = renderMarkdown("[x](javascript:alert(1))");
     assert.ok(!bad.includes("<a "), "javascript: scheme is not linkified");
   });

   test("renderMarkdown renders simple bullet lists", () => {
     const out = renderMarkdown("- one\n- two");
     assert.ok(out.includes("<ul class=\"md-list\">"));
     assert.ok((out.match(/<li>/g) || []).length === 2);
   });
   ```

2. Run — expect fail (`renderMarkdown` not defined).
   ```bash
   cd server && node --experimental-sqlite --test test/markdown_render.test.js
   ```

3. Implement `renderMarkdown` in `functions/api.js` (place after `escapeHtml`). Real code:
   ```js
   // Safe markdown subset. ESCAPE FIRST, then render — never trust raw HTML.
   function renderMarkdown(raw) {
     const source = String(raw == null ? "" : raw);
     // 1) Pull out fenced code blocks first so their contents are never formatted.
     const blocks = [];
     let escaped = source.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
       const i = blocks.length;
       const label = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : "";
       blocks.push(
         `<pre class="md-code">${label}<code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`
       );
       return ` BLOCK${i} `;
     });
     // 2) Escape everything else.
     escaped = escapeHtml(escaped);
     // 3) Inline code (escape its inner text again is unnecessary — already escaped).
     escaped = escaped.replace(/`([^`\n]+)`/g, (m, c) => `<code class="md-inline">${c}</code>`);
     // 4) Bold then italic (bold first to avoid * collisions).
     escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
     escaped = escaped.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
     // 5) Links — only http/https. Text was already escaped above.
     escaped = escaped.replace(
       /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
       (m, text, url) =>
         `<a href="${url}" rel="noopener noreferrer" target="_blank">${text}</a>`
     );
     // 6) Bullet lists: consecutive lines starting with - or * .
     escaped = escaped.replace(/(?:^|\n)((?:[-*] .*(?:\n|$))+)/g, (m, list) => {
       const items = list
         .trim()
         .split("\n")
         .map((l) => `<li>${l.replace(/^[-*]\s+/, "")}</li>`)
         .join("");
       return `\n<ul class="md-list">${items}</ul>`;
     });
     // 7) Remaining newlines -> <br> (block placeholders are on their own line).
     escaped = escaped.replace(/\n/g, "<br>");
     // 8) Re-insert code blocks (strip the <br> we may have added around them).
     escaped = escaped.replace(/(?:<br>)? BLOCK(\d+) (?:<br>)?/g, (m, i) => blocks[Number(i)]);
     return escaped;
   }
   ```

4. Run — expect pass.
   ```bash
   cd server && node --experimental-sqlite --test test/markdown_render.test.js
   ```

5. Add `uploadAttachment` to `functions/api.js` (browser-only; not unit-tested here — covered by
   the manual full-stack check in Task 9). Place after `renderMarkdown`:
   ```js
   const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
   const ATTACH_ALLOWED = [
     "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
     "text/plain", "application/pdf",
   ];
   function fileToBase64(file) {
     return new Promise((resolve, reject) => {
       const fr = new FileReader();
       fr.onload = () => resolve(String(fr.result).split(",").pop());
       fr.onerror = () => reject(new Error("Could not read the file."));
       fr.readAsDataURL(file);
     });
   }
   async function uploadAttachment(file, opts = {}) {
     if (file.size > ATTACH_MAX_BYTES) throw new Error(file.name + " is larger than 5MB.");
     if (!ATTACH_ALLOWED.includes(file.type)) throw new Error(file.name + " is not a supported type.");
     const dataB64 = await fileToBase64(file);
     const body = { filename: file.name, mime: file.type, dataB64 };
     if (opts.blockageId) body.blockageId = opts.blockageId;
     const { attachment } = await API.post("/api/attachments", body);
     return attachment;
   }
   ```

6. Run the whole suite — expect pass (no regressions).
   ```bash
   cd server && npm test
   ```

7. Commit.
   ```bash
   git add functions/api.js server/test/markdown_render.test.js
   git commit -m "Add renderMarkdown (XSS-safe subset) and uploadAttachment client helper

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

### Task 7 — Render markdown + attachments in `functions/blockage.js`

**Files:** `functions/blockage.js`, `dashboard.css`.

**Interfaces:**
- Consumes: `renderMarkdown`, `uploadAttachment` (from `api.js`); the `blockage.attachments`,
  `comment.attachments` arrays now returned by `GET /api/blockages/:id`.
- Produces: detail description + each comment body rendered through `renderMarkdown`; an
  `attachmentsHtml(list)` block of image thumbnails (`<img>` pointing at
  `/api/attachments/:id`) and non-image file chips (download links); a composer "Attach" control
  that uploads files (with `blockageId`) and posts their ids with the comment.

**TDD steps**

> Front-end DOM wiring is verified by the manual full-stack run in Task 9; these steps are written
> as small, reviewable diffs rather than node tests (the repo has no headless DOM harness checked
> in — consistent with existing front-end verification via Playwright/ad hoc).

1. In `functions/blockage.js`, render the detail description with markdown. Change:
   ```js
   <p class="detail-desc">${escapeHtml(blk.details)}</p>
   ```
   to:
   ```js
   <div class="detail-desc md">${renderMarkdown(blk.details)}</div>
   ${attachmentsHtml(blk.attachments)}
   ```

2. Add an `attachmentsHtml` helper near `threadHtml`:
   ```js
   function attachmentsHtml(list) {
     if (!list || !list.length) return "";
     const items = list
       .map((a) => {
         const href = "/api/attachments/" + a.id;
         if (String(a.mime).startsWith("image/") && a.mime !== "image/svg+xml") {
           return `<a class="att-thumb" href="${href}" target="_blank" rel="noopener noreferrer"
             title="${escapeHtml(a.filename)}"><img src="${href}" alt="${escapeHtml(a.filename)}" loading="lazy"></a>`;
         }
         return `<a class="att-chip" href="${href}" target="_blank" rel="noopener noreferrer">
           <span class="att-ic">📎</span><span class="att-nm">${escapeHtml(a.filename)}</span></a>`;
       })
       .join("");
     return `<div class="attachments">${items}</div>`;
   }
   ```

3. In `threadHtml`, render the body with markdown and append per-comment attachments. Change the
   body line:
   ```js
   <div class="body" data-cid="${c.id}" data-raw="${escapeHtml(c.body)}">${escapeHtml(c.body)}</div>
   ```
   to:
   ```js
   <div class="body md" data-cid="${c.id}" data-raw="${escapeHtml(c.body)}">${renderMarkdown(c.body)}</div>
   ${attachmentsHtml(c.attachments)}
   ```
   (The inline-edit path already reads `data-raw` for the textarea, so editing still uses the raw
   markdown — no change needed there.)

4. Add an attach control to the composer. Change the composer markup:
   ```js
   <form class="composer" id="composer">
     <textarea id="commentBody" placeholder="Write a reply…" rows="1"></textarea>
     ${role !== "student" ? '<button type="button" class="btn btn-ghost" id="draftBtn" title="Draft a reply with AI">✦ Draft</button>' : ""}
     <button type="submit" class="btn btn-primary">Send</button>
   </form>
   ```
   to add an attach row + hidden file input + a pending-files list:
   ```js
   <form class="composer" id="composer">
     <textarea id="commentBody" placeholder="Write a reply…" rows="1"></textarea>
     <label class="btn btn-ghost attach-btn" title="Attach a file">📎
       <input type="file" id="commentFiles" multiple hidden
         accept="image/png,image/jpeg,image/gif,image/webp,text/plain,application/pdf">
     </label>
     ${role !== "student" ? '<button type="button" class="btn btn-ghost" id="draftBtn" title="Draft a reply with AI">✦ Draft</button>' : ""}
     <button type="submit" class="btn btn-primary">Send</button>
   </form>
   <div class="attach-pending" id="attachPending"></div>
   ```

5. In `wireComposer`, upload chosen files (bound to this blockage) and send their ids. Add near
   the top of `wireComposer`:
   ```js
   let pending = []; // [{ id, filename }]
   const fileInput = document.getElementById("commentFiles");
   const pendingEl = document.getElementById("attachPending");
   function renderPending() {
     pendingEl.innerHTML = pending
       .map((p) => `<span class="att-chip">${escapeHtml(p.filename)}</span>`)
       .join("");
   }
   if (fileInput) {
     fileInput.addEventListener("change", async () => {
       for (const file of Array.from(fileInput.files)) {
         try {
           const att = await uploadAttachment(file, { blockageId: Number(id) });
           pending.push({ id: att.id, filename: att.filename });
         } catch (err) {
           toast(err.message || "Couldn't attach that file.", "error");
         }
       }
       fileInput.value = "";
       renderPending();
     });
   }
   ```
   Then in the submit handler, allow sending when there are attachments even if the text is empty,
   and include `attachmentIds`. Change the guard + post:
   ```js
   const body = ta.value.trim();
   if (!body && !pending.length) {
     toast("Write something or attach a file.", "warning");
     return;
   }
   try {
     await API.post("/api/blockages/" + encodeURIComponent(id) + "/comments", {
       body: body || "(attachment)",
       attachmentIds: pending.map((p) => p.id),
     });
     ta.value = "";
     pending = [];
     renderPending();
     await load();
   } catch (err) { ... }
   ```

6. Add styles to `dashboard.css` (Signal tokens). Append:
   ```css
   /* --- Rendered markdown --- */
   .md p { margin: 0 0 .5rem; }
   .md strong { font-weight: 700; }
   .md .md-inline { font-family: var(--font-mono); font-size: .85em;
     background: rgba(12,17,27,.06); padding: .1em .35em; border-radius: 4px; }
   .md .md-code { position: relative; font-family: var(--font-mono); font-size: .82rem;
     background: #0C111B; color: #e7edf5; padding: .85rem 1rem; border-radius: 10px;
     overflow-x: auto; margin: .6rem 0; }
   .md .md-code code { white-space: pre; }
   .md .md-code-lang { position: absolute; top: .4rem; right: .6rem; font-size: .65rem;
     letter-spacing: .08em; text-transform: uppercase; color: #12B886; }
   .md .md-list { margin: .4rem 0 .6rem 1.1rem; }
   .md a { color: #12B886; text-decoration: underline; }

   /* --- Attachments --- */
   .attachments { display: flex; flex-wrap: wrap; gap: .5rem; margin: .6rem 0; }
   .att-thumb img { width: 96px; height: 96px; object-fit: cover; border-radius: 10px;
     border: 1px solid rgba(12,17,27,.12); display: block; }
   .att-chip { display: inline-flex; align-items: center; gap: .4rem; font-family: var(--font-mono);
     font-size: .75rem; padding: .35rem .6rem; border: 1px solid rgba(12,17,27,.14);
     border-radius: 8px; color: #0C111B; text-decoration: none; }
   .att-chip:hover { border-color: #12B886; }
   .composer .attach-btn { cursor: pointer; }
   .attach-pending { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .4rem; }
   ```

7. Commit.
   ```bash
   git add functions/blockage.js dashboard.css
   git commit -m "Render markdown + attachments in blockage thread/detail; attach on comment

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

### Task 8 — Attach-on-report in `functions/dashbord.js`

**Files:** `functions/dashbord.js`, `student_dashbord.html` (verify the New-blockage form markup;
add the file input near `#details`).

**Interfaces:**
- Consumes: `uploadAttachment` (from `api.js`).
- Produces: the New-blockage modal gains a multi-file input; on submit, files are uploaded (no
  `blockageId` yet — they are unbound), then `attachmentIds` is sent with `POST /api/blockages`,
  which binds them to the new blockage (Task 4).

**TDD steps**

1. Add a file input to the New-blockage form in `student_dashbord.html`. Read the file first to
   find the form; add, just after the `#details` textarea's field group:
   ```html
   <label for="reportFiles">Attach files (optional)</label>
   <input type="file" id="reportFiles" multiple
     accept="image/png,image/jpeg,image/gif,image/webp,text/plain,application/pdf">
   ```
   (Keep it inside `#newForm` so the submit handler can read it.)

2. In `functions/dashbord.js`, in the form submit handler, upload selected files before posting.
   Change the block that builds `payload` / posts:
   ```js
   const payload = { title, cohortId: cohort.id, difficulty, details };
   if (briefId) payload.briefId = Number(briefId);
   ```
   to also collect uploads:
   ```js
   const payload = { title, cohortId: cohort.id, difficulty, details };
   if (briefId) payload.briefId = Number(briefId);

   const fileInput = form.querySelector("#reportFiles");
   if (fileInput && fileInput.files.length) {
     const ids = [];
     for (const file of Array.from(fileInput.files)) {
       try {
         const att = await uploadAttachment(file);
         ids.push(att.id);
       } catch (err) {
         toast(err.message || "Couldn't attach a file.", "error");
       }
     }
     if (ids.length) payload.attachmentIds = ids;
   }
   ```
   The existing `await API.post("/api/blockages", payload)` then carries `attachmentIds`. After a
   successful submit, `form.reset()` already clears the file input.

3. Commit.
   ```bash
   git add functions/dashbord.js student_dashbord.html
   git commit -m "Attach files when reporting a blockage (student dashboard)

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

### Task 9 — Full-stack manual verification + suite green

**Files:** none (verification only).

**Interfaces:** Consumes the running server + browser.

**Steps**

1. Run the whole backend suite — expect all green (existing + new tests).
   ```bash
   cd server && npm test
   ```

2. Start the server and walk the flow in a browser (signup → cohort → invite student → join →
   report with a screenshot → AI replies → student comments with a code fence + a file →
   instructor opens detail). Confirm: code fences render as monospace blocks with a language
   label; inline code and bold render; `<img onerror=...>` typed into a comment shows as escaped
   text (no execution); image attachments show as thumbnails and open inline; a `.pdf`/`.txt`
   shows as a chip and downloads; SVG downloads (never inline).
   ```bash
   cd server && AI_AUTORESPOND=1 npm start
   # then open http://localhost:5050
   ```

3. Confirm tenant isolation by hitting another org's `/api/attachments/:id` while logged into a
   different org (expect 404) — already asserted in `attachments.test.js`, but spot-check live.

4. Confirm `server/uploads/` is gitignored and only `.gitkeep` is tracked.
   ```bash
   git status --porcelain server/uploads
   ```

---

## Self-review checklist

- [ ] **XSS:** `renderMarkdown` escapes HTML *before* any formatting; fenced blocks are extracted
      pre-escape and their contents escaped; inline code, bold, italic, lists, and links never
      emit raw user HTML; links are restricted to `http:`/`https:`; tested with `<img onerror>`.
- [ ] **Storage stays raw:** server never transforms comment/detail bodies; `markdown_note.test.js`
      pins byte-for-byte round-trip; inline-comment editing still reads `data-raw`.
- [ ] **Tenant isolation:** every attachment query filters by `org_id`; download additionally
      enforces `canSeeBlockage` when bound; cross-tenant download → 404 (tested).
- [ ] **Local-first / pure-JS:** JSON+base64 upload (no multer/native dep); files on local disk
      under `server/uploads/`; app runs offline with zero config.
- [ ] **Size + type limits:** 5MB cap and mime allowlist enforced server-side (`lib/uploads.js`)
      and mirrored client-side for fast errors; oversized/disallowed → 400 (tested).
- [ ] **SVG safety:** SVG served with `nosniff` and `Content-Disposition: attachment`; never
      rendered inline as a thumbnail.
- [ ] **Body-size cap:** global 100kb JSON cap unchanged; only the attachments router raises its
      own limit (8mb) for base64 payloads.
- [ ] **Binding correctness:** report-level attachments have `comment_id IS NULL`; comment
      attachments carry `comment_id`; binding only touches caller-owned, same-org rows; capped at
      10 ids per request.
- [ ] **Cascade cleanup:** `attachments.blockage_id`/`comment_id` use `ON DELETE CASCADE`, so
      deleting a blockage/comment removes its attachment rows (disk files become orphans — noted
      as acceptable for local-first; a sweep is out of Phase 1 scope).
- [ ] **Conventions:** routes are `(db)=>router` mounted under `/api`; `escapeHtml` used on all
      user values in front-end HTML; Signal tokens (`--font-mono`, ink, `--flow`) used in CSS;
      modals/composer patterns preserved.
- [ ] **Tests:** `npm test` auto-discovers `attachments.test.js`, `markdown_note.test.js`,
      `markdown_render.test.js`; all green; AI gated via `AI_AUTORESPOND=0` (helper default).
- [ ] **Each task committed** with the `Co-Authored-By: Claude Opus 4.8` trailer.
