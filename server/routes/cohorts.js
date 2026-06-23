"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth");
const { tooLong } = require("../lib/validate");

module.exports = function cohortRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  const orgCohort = (id, orgId) =>
    db.prepare("SELECT * FROM cohorts WHERE id = ? AND org_id = ?").get(id, orgId);

  function withCounts(c) {
    const students = db
      .prepare("SELECT COUNT(*) n FROM users WHERE cohort_id = ? AND role = 'student'")
      .get(c.id).n;
    const open = db
      .prepare("SELECT COUNT(*) n FROM blockages WHERE cohort_id = ? AND status != 'resolved'")
      .get(c.id).n;
    return { id: c.id, name: c.name, students, openBlockages: open, assignStrategy: c.assign_strategy || "none", createdAt: c.created_at };
  }

  // GET /api/cohorts — role-aware
  router.get("/cohorts", (req, res) => {
    const { orgId, role, userId } = req.user;
    let rows;
    if (role === "owner") {
      rows = db.prepare("SELECT * FROM cohorts WHERE org_id = ? ORDER BY created_at").all(orgId);
    } else if (role === "instructor") {
      rows = db
        .prepare(
          `SELECT c.* FROM cohorts c JOIN cohort_instructors ci ON ci.cohort_id = c.id
            WHERE ci.user_id = ? AND c.org_id = ? ORDER BY c.created_at`
        )
        .all(userId, orgId);
    } else {
      rows = db
        .prepare(
          "SELECT c.* FROM cohorts c JOIN users u ON u.cohort_id = c.id WHERE u.id = ?"
        )
        .all(userId);
    }
    res.json({ cohorts: rows.map(withCounts) });
  });

  // POST /api/cohorts — owner
  router.post("/cohorts", requireRole("owner"), (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Cohort name is required." });
    const lenErr = tooLong(name, 100, "Cohort name");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const info = db
      .prepare("INSERT INTO cohorts (org_id, name) VALUES (?, ?)")
      .run(req.user.orgId, name);
    res.status(201).json({ cohort: withCounts(orgCohort(info.lastInsertRowid, req.user.orgId)) });
  });

  // GET /api/cohorts/:id — detail with briefs; roster (instructors+students)
  // only for staff. Students may read this for the brief picker but never see
  // the member roster of their cohort.
  router.get("/cohorts/:id", (req, res) => {
    const c = orgCohort(Number(req.params.id), req.user.orgId);
    if (!c) return res.status(404).json({ error: "Cohort not found." });
    const briefs = db.prepare("SELECT id, name FROM briefs WHERE cohort_id = ?").all(c.id);
    if (req.user.role === "student") {
      return res.json({ cohort: { ...withCounts(c), briefs, instructors: [], students: [] } });
    }
    const instructors = db
      .prepare(
        `SELECT u.id, u.name, u.email FROM users u
           JOIN cohort_instructors ci ON ci.user_id = u.id WHERE ci.cohort_id = ?`
      )
      .all(c.id);
    const students = db
      .prepare(
        "SELECT id, name, email FROM users WHERE cohort_id = ? AND role = 'student' ORDER BY name"
      )
      .all(c.id);
    res.json({ cohort: { ...withCounts(c), briefs, instructors, students } });
  });

  // PUT /api/cohorts/:id — owner
  router.put("/cohorts/:id", requireRole("owner"), (req, res) => {
    const c = orgCohort(Number(req.params.id), req.user.orgId);
    if (!c) return res.status(404).json({ error: "Cohort not found." });
    // Partial update: name and assignStrategy are each optional.
    if (req.body.name !== undefined) {
      const name = (req.body.name || "").trim();
      if (!name) return res.status(400).json({ error: "Cohort name is required." });
      const lenErr = tooLong(name, 100, "Cohort name");
      if (lenErr) return res.status(400).json({ error: lenErr });
      db.prepare("UPDATE cohorts SET name = ? WHERE id = ?").run(name, c.id);
    }
    if (req.body.assignStrategy !== undefined) {
      const strat = String(req.body.assignStrategy);
      if (!["none", "round_robin", "least_loaded"].includes(strat))
        return res.status(400).json({ error: "Invalid assignment strategy." });
      db.prepare("UPDATE cohorts SET assign_strategy = ? WHERE id = ?").run(strat, c.id);
    }
    res.json({ cohort: withCounts(orgCohort(c.id, req.user.orgId)) });
  });

  // DELETE /api/cohorts/:id — owner (refuses while non-empty)
  router.delete("/cohorts/:id", requireRole("owner"), (req, res) => {
    const c = orgCohort(Number(req.params.id), req.user.orgId);
    if (!c) return res.status(404).json({ error: "Cohort not found." });
    const students = db
      .prepare("SELECT COUNT(*) n FROM users WHERE cohort_id = ?")
      .get(c.id).n;
    const blockages = db
      .prepare("SELECT COUNT(*) n FROM blockages WHERE cohort_id = ?")
      .get(c.id).n;
    if (students > 0 || blockages > 0) {
      return res.status(409).json({
        error: `Move this cohort's ${students} student(s) and ${blockages} blockage(s) before deleting it.`,
      });
    }
    db.prepare("DELETE FROM cohorts WHERE id = ?").run(c.id);
    res.json({ ok: true });
  });

  // POST /api/cohorts/:id/move-students { toCohortId } — owner moves all
  // students AND their blockages from this cohort into another cohort.
  router.post("/cohorts/:id/move-students", requireRole("owner"), (req, res) => {
    const src = orgCohort(Number(req.params.id), req.user.orgId);
    if (!src) return res.status(400).json({ error: "Source cohort not found." });
    const toCohortId = Number(req.body.toCohortId);
    if (!toCohortId || toCohortId === src.id)
      return res.status(400).json({ error: "Pick a different destination cohort." });
    const dest = orgCohort(toCohortId, req.user.orgId);
    if (!dest) return res.status(400).json({ error: "Destination cohort not found." });

    const movedStudents = db
      .prepare("UPDATE users SET cohort_id = ? WHERE cohort_id = ?")
      .run(dest.id, src.id).changes;
    const movedBlockages = db
      .prepare("UPDATE blockages SET cohort_id = ? WHERE cohort_id = ?")
      .run(dest.id, src.id).changes;

    res.json({ ok: true, movedStudents, movedBlockages });
  });

  // POST /api/cohorts/:id/instructors { userId } — owner assigns
  router.post("/cohorts/:id/instructors", requireRole("owner"), (req, res) => {
    const c = orgCohort(Number(req.params.id), req.user.orgId);
    if (!c) return res.status(404).json({ error: "Cohort not found." });
    const u = db
      .prepare("SELECT * FROM users WHERE id = ? AND org_id = ?")
      .get(Number(req.body.userId), req.user.orgId);
    if (!u || (u.role !== "instructor" && u.role !== "owner"))
      return res.status(400).json({ error: "Pick an instructor in your organization." });
    db.prepare(
      "INSERT OR IGNORE INTO cohort_instructors (cohort_id, user_id) VALUES (?, ?)"
    ).run(c.id, u.id);
    res.status(201).json({ ok: true });
  });

  // DELETE /api/cohorts/:id/instructors/:userId — owner unassigns
  router.delete("/cohorts/:id/instructors/:userId", requireRole("owner"), (req, res) => {
    const c = orgCohort(Number(req.params.id), req.user.orgId);
    if (!c) return res.status(404).json({ error: "Cohort not found." });
    db.prepare("DELETE FROM cohort_instructors WHERE cohort_id = ? AND user_id = ?").run(
      c.id,
      Number(req.params.userId)
    );
    res.json({ ok: true });
  });

  // POST /api/cohorts/:id/briefs { name } — owner
  router.post("/cohorts/:id/briefs", requireRole("owner"), (req, res) => {
    const c = orgCohort(Number(req.params.id), req.user.orgId);
    if (!c) return res.status(404).json({ error: "Cohort not found." });
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Brief name is required." });
    const lenErr = tooLong(name, 100, "Brief name");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const info = db
      .prepare("INSERT INTO briefs (org_id, cohort_id, name) VALUES (?, ?, ?)")
      .run(req.user.orgId, c.id, name);
    res.status(201).json({ brief: { id: info.lastInsertRowid, name } });
  });

  // GET /api/briefs/:id — brief detail with content
  router.get("/briefs/:id", (req, res) => {
    const b = db
      .prepare("SELECT * FROM briefs WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!b) return res.status(404).json({ error: "Brief not found." });
    res.json({ brief: { id: b.id, name: b.name, content: b.content || null, maxScaffold: b.max_scaffold || null, cohortId: b.cohort_id, createdAt: b.created_at } });
  });

  // GET /api/briefs/:id/history — version snapshots newest-first
  router.get("/briefs/:id/history", requireRole("owner"), (req, res) => {
    const b = db
      .prepare("SELECT * FROM briefs WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!b) return res.status(404).json({ error: "Brief not found." });
    const versions = db
      .prepare(
        `SELECT bv.id, bv.name, bv.content, bv.created_at, u.name as author_name
           FROM brief_versions bv
           LEFT JOIN users u ON u.id = bv.created_by
          WHERE bv.brief_id = ? AND bv.org_id = ?
          ORDER BY bv.created_at DESC`
      )
      .all(b.id, req.user.orgId)
      .map((v) => ({ id: v.id, name: v.name, content: v.content, authorName: v.author_name, createdAt: v.created_at }));
    res.json({ versions });
  });

  // PUT /api/briefs/:id { name, content } — owner updates brief, snapshots prior version
  router.put("/briefs/:id", requireRole("owner"), (req, res) => {
    const b = db
      .prepare("SELECT * FROM briefs WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!b) return res.status(404).json({ error: "Brief not found." });
    const name = req.body.name !== undefined ? (req.body.name || "").trim() : b.name;
    if (!name) return res.status(400).json({ error: "Brief name is required." });
    const lenErr = tooLong(name, 100, "Brief name");
    if (lenErr) return res.status(400).json({ error: lenErr });
    const content = req.body.content !== undefined ? req.body.content : b.content;
    // Snapshot prior version if name or content actually changed
    if (name !== b.name || content !== b.content) {
      db.prepare(
        "INSERT INTO brief_versions (brief_id, org_id, name, content, created_by) VALUES (?, ?, ?, ?, ?)"
      ).run(b.id, req.user.orgId, b.name, b.content || null, req.user.userId);
    }
    db.prepare("UPDATE briefs SET name = ?, content = ? WHERE id = ?").run(name, content || null, b.id);
    res.json({ brief: { id: b.id, name, content: content || null } });
  });

  // DELETE /api/briefs/:id — owner
  router.delete("/briefs/:id", requireRole("owner"), (req, res) => {
    const b = db
      .prepare("SELECT * FROM briefs WHERE id = ? AND org_id = ?")
      .get(Number(req.params.id), req.user.orgId);
    if (!b) return res.status(404).json({ error: "Brief not found." });
    db.prepare("DELETE FROM briefs WHERE id = ?").run(b.id);
    res.json({ ok: true });
  });

  return router;
};
