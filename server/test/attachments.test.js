"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { openDb } = require("../db");
const up = require("../lib/uploads");
const { startServer, buildOrg } = require("./helpers");

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// --- Task 1: table -------------------------------------------------------
test("attachments table exists and is empty on a fresh db", () => {
  const db = openDb(":memory:");
  const cols = db.prepare("PRAGMA table_info(attachments)").all().map((c) => c.name);
  assert.deepEqual(cols, [
    "id", "org_id", "blockage_id", "comment_id", "uploader_id",
    "filename", "mime", "size", "stored_path", "created_at",
  ]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attachments").get().n, 0);
});

// --- Task 2: upload helpers ---------------------------------------------
test("decodeBase64 rejects disallowed mime", () => {
  const r = up.decodeBase64({ dataB64: Buffer.from("x").toString("base64"), mime: "application/x-sh" });
  assert.ok(r.error);
});
test("decodeBase64 rejects oversized payloads", () => {
  const big = Buffer.alloc(up.MAX_UPLOAD_BYTES + 1, 0x61).toString("base64");
  assert.ok(up.decodeBase64({ dataB64: big, mime: "image/png" }).error);
});
test("decodeBase64 accepts a small allowed file and reports size", () => {
  const r = up.decodeBase64({ dataB64: Buffer.from("hello").toString("base64"), mime: "text/plain" });
  assert.equal(r.error, undefined);
  assert.equal(r.size, 5);
  assert.ok(Buffer.isBuffer(r.buffer));
});
test("storedPathFor returns a unique rel path under uploads", () => {
  const a = up.storedPathFor("png");
  const b = up.storedPathFor("png");
  assert.notEqual(a.rel, b.rel);
  assert.match(a.rel, /\.png$/);
  assert.ok(fs.existsSync(up.uploadsDir()));
});

// --- Task 3: endpoints ---------------------------------------------------
test("upload + download is tenant-isolated", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Org A", "att-a");
    const b = await buildOrg(srv.base, "Org B", "att-b");
    const upd = await a.student.post("/api/attachments", {
      filename: "shot.png", mime: "image/png", dataB64: PNG_B64,
    });
    assert.equal(upd.status, 201);
    const attId = upd.body.attachment.id;
    assert.ok(upd.body.attachment.size > 0);
    const cross = await b.owner.get("/api/attachments/" + attId);
    assert.equal(cross.status, 404, "cross-tenant download is 404");
    const ok = await a.owner.get("/api/attachments/" + attId);
    assert.equal(ok.status, 200);
  } finally {
    await srv.close();
  }
});

test("upload rejects disallowed mime", async () => {
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

// --- Task 4: binding -----------------------------------------------------
test("attachments bind to a report and appear in detail", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Org D", "att-d");
    const upd = await a.student.post("/api/attachments", {
      filename: "err.png", mime: "image/png", dataB64: PNG_B64,
    });
    const rep = await a.student.post("/api/blockages", {
      title: "Red error", details: "stack trace here",
      cohortId: a.cohortId, attachmentIds: [upd.body.attachment.id],
    });
    assert.equal(rep.status, 201);
    const detail = await a.student.get("/api/blockages/" + rep.body.blockage.id);
    const reportAtts = detail.body.blockage.attachments || [];
    assert.equal(reportAtts.length, 1);
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
    const upd = await a.student.post("/api/attachments", {
      filename: "c.png", mime: "image/png", dataB64: PNG_B64, blockageId: blkId,
    });
    const cmt = await a.student.post("/api/blockages/" + blkId + "/comments", {
      body: "see screenshot", attachmentIds: [upd.body.attachment.id],
    });
    assert.equal(cmt.status, 201);
    const detail = await a.student.get("/api/blockages/" + blkId);
    const withAtt = (detail.body.blockage.comments || []).find((c) => (c.attachments || []).length);
    assert.ok(withAtt, "a comment carries its attachment");
    assert.equal(withAtt.attachments[0].filename, "c.png");
  } finally {
    await srv.close();
  }
});

test("attachment cannot be hijacked cross-tenant via comment binding", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Hijack A", "hj-a");
    const b = await buildOrg(srv.base, "Hijack B", "hj-b");
    // org A student uploads an UNBOUND attachment
    const up = await a.student.post("/api/attachments", { filename: "secret.png", mime: "image/png", dataB64: PNG_B64 });
    const victimId = up.body.attachment.id;
    // org B student reports a blockage and tries to bind A's attachment to a comment
    const blk = (await b.student.post("/api/blockages", { title: "x", cohortId: b.cohortId, details: "d" })).body.blockage;
    await b.student.post("/api/blockages/" + blk.id + "/comments", { body: "see", attachmentIds: [victimId] });
    // victim attachment must remain unbound (not repointed to B's blockage)
    const row = srv.db.prepare("SELECT blockage_id FROM attachments WHERE id=?").get(victimId);
    assert.equal(row.blockage_id, null, "cross-tenant attachment was NOT hijacked");
    const detail = await b.student.get("/api/blockages/" + blk.id);
    assert.equal((detail.body.blockage.attachments || []).length, 0, "victim file not exposed on B's blockage");
  } finally {
    await srv.close();
  }
});

test("attachment upload above the 100kb global cap succeeds", async () => {
  const srv = await startServer();
  try {
    const a = await buildOrg(srv.base, "Big Upload", "big");
    const big = Buffer.alloc(150 * 1024, 0x61).toString("base64"); // ~200KB JSON body
    const up = await a.student.post("/api/attachments", { filename: "big.txt", mime: "text/plain", dataB64: big });
    assert.equal(up.status, 201, "large upload accepted (not 413'd by the global 100kb parser)");
    assert.ok(up.body.attachment.size >= 150 * 1024);
  } finally {
    await srv.close();
  }
});
