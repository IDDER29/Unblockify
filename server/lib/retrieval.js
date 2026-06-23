"use strict";

// Lightweight local "knowledge base": find past RESOLVED blockages in the same
// org that look similar, by keyword overlap. No vector DB — keeps it local.

const STOP = new Set(
  ("the a an of to in on for and or is are was were be been it this that with my your our " +
    "i we you they he she my me at by from as not but if then so do does did how what why " +
    "when where which who can cant cannot wont will just get got it's im ive id").split(" ")
);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Top resolved blockages in the org similar to the given text.
 * Returns [{ id, title, resolutionType, resolutionNote, score }].
 */
function similarResolved(db, { orgId, cohortId = null, text, excludeId = null, limit = 3 }) {
  const rows = db
    .prepare(
      `SELECT id, title, details, difficulty, resolution_type, resolution_note, resolution_summary, cohort_id
         FROM blockages
        WHERE org_id = ? AND status = 'resolved'
          AND (resolution_note IS NOT NULL OR resolution_summary IS NOT NULL) ${excludeId ? "AND id != ?" : ""}`
    )
    .all(...(excludeId ? [orgId, excludeId] : [orgId]));

  const q = new Set(tokenize(text));
  if (!q.size) return [];

  const scored = rows
    .map((r) => {
      const words = new Set(tokenize(r.title + " " + r.details + " " + r.difficulty));
      let overlap = 0;
      for (const w of q) if (words.has(w)) overlap++;
      // small boost for same cohort
      const score = overlap + (cohortId && r.cohort_id === cohortId ? 0.5 : 0);
      return { r, score };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ r, score }) => ({
    id: r.id,
    title: r.title,
    resolutionType: r.resolution_type,
    resolutionNote: r.resolution_note,
    resolution_summary: r.resolution_summary || null,
    score,
  }));
}

/**
 * Cluster the org's recently-resolved blockages into themes by greedy keyword
 * overlap. Returns [{ theme, count, blockageIds, sampleTitles }]. Deterministic.
 */
function clusterResolved(db, { orgId, sinceDays = 7, maxThemes = 4, cohortIds = null }) {
  let sql = `SELECT id, title, details, cohort_id FROM blockages
        WHERE org_id = ? AND status = 'resolved' AND resolved_at IS NOT NULL
          AND resolved_at >= datetime('now', '-' || ? || ' days')`;
  const args = [orgId, sinceDays];
  if (Array.isArray(cohortIds)) {
    if (!cohortIds.length) return [];
    sql += ` AND cohort_id IN (${cohortIds.map(() => "?").join(",")})`;
    args.push(...cohortIds);
  }
  const rows = db.prepare(sql).all(...args);
  if (!rows.length) return [];

  const freq = new Map();
  const items = rows.map((r) => {
    const t = Array.from(new Set(tokenize(r.title + " " + (r.details || ""))));
    t.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
    return { r, t };
  });
  const seeds = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).map(([w]) => w);

  const clusters = [];
  const assigned = new Set();
  for (const seed of seeds) {
    if (clusters.length >= maxThemes) break;
    const members = items.filter((x) => !assigned.has(x.r.id) && x.t.includes(seed));
    if (!members.length) continue;
    members.forEach((m) => assigned.add(m.r.id));
    clusters.push({
      theme: seed,
      count: members.length,
      blockageIds: members.map((m) => m.r.id),
      sampleTitles: members.slice(0, 3).map((m) => m.r.title),
    });
  }
  const leftover = items.filter((x) => !assigned.has(x.r.id));
  if (leftover.length) {
    clusters.push({
      theme: "other",
      count: leftover.length,
      blockageIds: leftover.map((m) => m.r.id),
      sampleTitles: leftover.slice(0, 3).map((m) => m.r.title),
    });
  }
  return clusters;
}

module.exports = { similarResolved, tokenize, clusterResolved };
