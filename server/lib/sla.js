"use strict";

// Pure SLA math + config reader. Business hours = hours that fall inside the
// org's configured working window on configured weekdays. Timestamps are the
// SQLite "YYYY-MM-DD HH:MM:SS" UTC strings; tz_offset_min shifts to local.

const DEFAULT_SLA = {
  responseHours: 4, resolveHours: 48, bhStart: 9, bhEnd: 17,
  bhDays: [1, 2, 3, 4, 5], tzOffsetMin: 0,
};

function parseTs(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(" ", "T") + "Z");
  return isNaN(d) ? null : d;
}

// Hours of business time between two UTC timestamps for the given sla config.
function businessHoursBetween(startISO, endISO, sla) {
  const start = parseTs(startISO);
  const end = parseTs(endISO);
  if (!start || !end || end <= start) return 0;
  const days = new Set(sla.bhDays);
  const off = (sla.tzOffsetMin || 0) * 60000;
  let total = 0;
  // Walk in 15-minute steps (cap to ~120 days to stay bounded).
  const STEP = 15 * 60000;
  const maxMs = 120 * 24 * 3600000;
  for (let t = start.getTime(); t < end.getTime() && t - start.getTime() < maxMs; t += STEP) {
    const local = new Date(t + off);
    const dow = local.getUTCDay();
    const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
    if (days.has(dow) && hour >= sla.bhStart && hour < sla.bhEnd) total += STEP / 3600000;
  }
  return Math.round(total * 100) / 100;
}

// SLA state for a blockage row given the org sla. Resolved → label null.
function slaState(row, sla, nowISO) {
  if (!row || row.status === "resolved") {
    return { label: null, breached: false, atRisk: false, responseDueIn: null, resolveDueIn: null };
  }
  const now = nowISO || new Date().toISOString().slice(0, 19).replace("T", " ");
  const elapsed = businessHoursBetween(row.created_at, now, sla);
  const responseDueIn = Math.round((sla.responseHours - elapsed) * 10) / 10;
  const resolveDueIn = Math.round((sla.resolveHours - elapsed) * 10) / 10;
  const unclaimed = row.status === "open";
  const breached = elapsed > sla.resolveHours || (unclaimed && elapsed > sla.responseHours);
  const atRisk = !breached && (
    (unclaimed && elapsed > sla.responseHours * 0.8) || elapsed > sla.resolveHours * 0.8
  );
  const label = breached ? "breached" : atRisk ? "at_risk" : "on_track";
  return { label, breached, atRisk, responseDueIn, resolveDueIn };
}

// Read an org's SLA config (defaults when unset).
function readSla(db, orgId) {
  const r = db.prepare("SELECT * FROM sla_config WHERE org_id = ?").get(orgId);
  if (!r) return { ...DEFAULT_SLA };
  return {
    responseHours: r.response_hours, resolveHours: r.resolve_hours,
    bhStart: r.bh_start, bhEnd: r.bh_end,
    bhDays: String(r.bh_days).split(",").map((n) => Number(n)).filter((n) => !isNaN(n)),
    tzOffsetMin: r.tz_offset_min,
  };
}

module.exports = { DEFAULT_SLA, businessHoursBetween, slaState, readSla };
