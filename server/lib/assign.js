"use strict";

const { cohortInstructorIds } = require("./helpers");

// Pick an instructor for a new blockage per the cohort's strategy.
// Returns a userId or null (null for 'none' or no instructors).
function pickAssignee(db, { cohortId, strategy }) {
  if (!strategy || strategy === "none") return null;
  const ids = cohortInstructorIds(db, cohortId).slice().sort((a, b) => a - b);
  if (!ids.length) return null;

  if (strategy === "least_loaded") {
    let best = null, bestLoad = Infinity;
    for (const id of ids) {
      const { n } = db
        .prepare("SELECT COUNT(*) AS n FROM blockages WHERE assignee_id = ? AND status != 'resolved'")
        .get(id);
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
