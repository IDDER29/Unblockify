/* Owner dashboard — analytics with inline SVG charts. */

function donut(totals) {
  const segs = [
    { v: totals.open || 0, c: "#FF5A4D" },
    { v: totals.in_support || 0, c: "#F59F00" },
    { v: totals.resolved || 0, c: "#12B886" },
  ];
  const actual = segs.reduce((a, s) => a + s.v, 0);
  const total = actual || 1;
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const rings = segs
    .map((s) => {
      const len = (s.v / total) * C;
      const ring = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${s.c}" stroke-width="16"
        stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)" stroke-linecap="butt"/>`;
      off += len;
      return ring;
    })
    .join("");
  return `<svg viewBox="0 0 140 140" width="140" height="140">
    <circle cx="70" cy="70" r="52" fill="none" stroke="#EEF0F3" stroke-width="16"/>${rings}
    <text x="70" y="66" text-anchor="middle" font-family="Space Grotesk" font-size="26" font-weight="700" fill="#0C111B">${actual}</text>
    <text x="70" y="86" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="#5d6675" letter-spacing="1">TOTAL</text>
  </svg>`;
}

function lineChart(points) {
  if (!points || !points.length || points.every((p) => !p.count)) {
    return `<p class="thread-empty" style="padding:1.5rem 0">No activity in this period yet.</p>`;
  }
  const W = 520, H = 150, P = 8;
  const max = Math.max(1, ...points.map((p) => p.count));
  const step = points.length > 1 ? (W - P * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => [P + i * step, H - P - (p.count / max) * (H - P * 2)]);
  const line = coords.map((c, i) => (i ? "L" : "M") + c[0].toFixed(1) + " " + c[1].toFixed(1)).join(" ");
  const area = `${line} L ${coords[coords.length - 1][0].toFixed(1)} ${H - P} L ${coords[0][0].toFixed(1)} ${H - P} Z`;
  const dots = coords.map((c) => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="2.5" fill="#12B886"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
    <defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#12B886" stop-opacity="0.18"/><stop offset="100%" stop-color="#12B886" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#vg)"/><path d="${line}" fill="none" stroke="#12B886" stroke-width="2.5" stroke-linejoin="round"/>${dots}
  </svg>`;
}

function bars(rows, valKey, color) {
  if (!rows.length) return `<p class="thread-empty">No data yet.</p>`;
  const max = Math.max(1, ...rows.map((r) => r[valKey]));
  return rows
    .map(
      (r) => `<div class="bar-row"><div class="lbl">${escapeHtml(r.label)}</div>
        <div class="track"><div class="fill" style="width:${(r[valKey] / max) * 100}%;background:${color}"></div></div>
        <div class="n">${r[valKey]}</div></div>`
    )
    .join("");
}

function activityLabel(ev) {
  const who = escapeHtml(ev.actor || "Someone");
  const title = `'${escapeHtml(ev.blockageTitle || "a blockage")}'`;
  switch (ev.type) {
    case "created": return `${who} reported ${title}`;
    case "claimed": return `${who} started helping with ${title}`;
    case "comment": return `${who} replied on ${title}`;
    case "ai_reply": return `AI responded to ${title}`;
    case "resolved": return `${who} resolved ${title}`;
    case "reopened": return `${who} reopened ${title}`;
    default: return `${who} updated ${title}`;
  }
}

function activityHtml(items) {
  if (!items || !items.length) return `<p class="thread-empty">No activity yet.</p>`;
  return `<ul class="timeline">${items
    .map(
      (ev) => `<li class="ev-${escapeHtml(ev.type)}">
        <a href="blockage.html?id=${encodeURIComponent(ev.blockageId)}" style="text-decoration:none;color:inherit">
          <div class="ev-t">${activityLabel(ev)}</div>
          <div class="ev-m">${escapeHtml(fmtRelative(ev.createdAt))}</div>
        </a>
      </li>`
    )
    .join("")}</ul>`;
}

function welcomeHtml(orgName) {
  return `<section class="panel" style="margin-bottom:1.25rem">
    <div class="page-head" style="margin-bottom:.75rem">
      <h1>Welcome to ${escapeHtml(orgName)} 👋</h1>
      <p>Your workspace is ready. Unblockify turns the things your students get stuck on into resolved, measured momentum. Here's how to get going:</p>
    </div>
    <ol class="timeline" style="margin:0 0 1.25rem">
      <li class="ev-created"><div class="ev-t">Create a cohort</div><div class="ev-m">Group your students and add a brief so the AI TA can answer in context.</div></li>
      <li class="ev-claimed"><div class="ev-t">Invite your people</div><div class="ev-m">Send invite links to instructors and students — they join with one click.</div></li>
      <li class="ev-resolved"><div class="ev-t">Watch the signal</div><div class="ev-m">Students report blockages, the AI replies instantly, and this dashboard lights up.</div></li>
    </ol>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap">
      <a class="btn btn-primary" href="cohorts.html">Create your first cohort</a>
      <a class="btn" href="members.html">Invite instructors &amp; students</a>
      <a class="btn btn-ghost" href="cohorts.html#briefs">Set up a brief</a>
    </div>
  </section>`;
}

function atRiskHtml(rows) {
  if (!rows || !rows.length) return `<p class="atrisk-empty">No students at risk right now. 🎉</p>`;
  return `<div class="atrisk-list">${rows
    .map(
      (s) => `<div class="atrisk-item">
        <span class="nm">${
          s.id != null
            ? `<a href="student_profile.html?id=${encodeURIComponent(s.id)}" style="color:inherit">${escapeHtml(s.name)}</a>`
            : escapeHtml(s.name)
        }</span>
        <span class="rs">${(s.reasons || []).map((t) => `<span class="atrisk-tag">${escapeHtml(t)}</span>`).join("")}</span>
        <div class="atrisk-actions">
          <button class="btn btn-sm" onclick="nudgeStudent(${s.id})">Send nudge</button>
          <a class="btn btn-sm btn-ghost" href="owner_blockages.html?student=${encodeURIComponent(s.id)}">View blockages</a>
          <button class="btn btn-sm btn-ghost" onclick="flagStudent(${s.id})">Flag for check-in</button>
          ${s.lastInterventionAt ? `<span class="atrisk-last">Last action: ${escapeHtml(fmtRelative(s.lastInterventionAt))}</span>` : ""}
          ${s.recovered ? `<span class="pill pill-resolved">Recovered</span>` : ""}
        </div>
      </div>`
    )
    .join("")}</div>`;
}

async function nudgeStudent(id) {
  try {
    await API.post(`/api/students/${id}/nudge`, { message: "Your instructor is checking in on you." });
    toast("Nudge sent", "success");
  } catch (e) {
    toast(e.message || "Couldn't send nudge.", "error");
  }
}

async function flagStudent(id) {
  try {
    await API.post(`/api/students/${id}/flag`, {});
    toast("Flagged for check-in", "success");
  } catch (e) {
    toast(e.message || "Couldn't flag student.", "error");
  }
}

(async function () {
  const s = await requireRole("owner");
  if (!s) return;
  const view = renderShell({
    user: s.user, org: s.org, active: "owner_dashboard.html",
    title: "Dashboard", crumb: "Owner / Analytics",
  });
  view.innerHTML = `<div class="page-head"><h1>${escapeHtml(s.org.name)}</h1><p>How your organization is clearing blockages.</p></div><div id="analytics"></div>`;
  const el = document.getElementById("analytics");

  let a;
  try { a = await API.get("/api/analytics"); }
  catch (e) { el.innerHTML = `<div class="blk-empty">Couldn't load analytics.</div>`; return; }

  const cohortRows = a.byCohort.map((c) => ({ label: c.cohort, resolved: c.resolved, open: c.open }));
  const insRows = a.byInstructor.map((i) => ({ label: i.name, resolved: i.resolved }));

  const welcome = a.total === 0 ? welcomeHtml(s.org.name) : "";

  el.innerHTML = `
    ${welcome}
    <section class="kpi-strip">
      <div class="kpi is-blocked"><div class="kpi-v">${a.totals.open || 0}</div><div class="kpi-k">Blocked</div></div>
      <div class="kpi is-pending"><div class="kpi-v">${a.totals.in_support || 0}</div><div class="kpi-k">In support</div></div>
      <div class="kpi is-resolved"><div class="kpi-v">${a.totals.resolved || 0}</div><div class="kpi-k">Resolved</div></div>
      <div class="kpi"><div class="kpi-v">${a.resolveRate || 0}%</div><div class="kpi-k">Resolve rate</div></div>
      <div class="kpi"><div class="kpi-v">${a.medianHoursToUnblock || 0}h</div><div class="kpi-k">Median to unblock</div></div>
      <div class="kpi"><div class="kpi-v">${a.deflectionRate || 0}%</div><div class="kpi-k">AI deflection</div></div>
    </section>

    ${(a.atRisk && a.atRisk.length) ? `<div class="chart-card atrisk-card" style="border-left:3px solid var(--pending);margin-bottom:1.25rem">
      <h3 style="display:flex;align-items:center;gap:.5rem">Students who need attention <span style="background:var(--pending);color:#fff;border-radius:99px;font-size:.7rem;padding:.1rem .45rem;font-family:var(--font-mono)">${a.atRisk.length}</span></h3>
      ${atRiskHtml(a.atRisk)}
    </div>` : ""}

    <div class="chart-grid">
      <div class="chart-card"><h3>Volume · last 14 days</h3>${lineChart(a.volumeByDay)}</div>
      <div class="chart-card"><h3>Status mix</h3>
        <div style="display:flex;gap:1rem;align-items:center">
          ${donut(a.totals)}
          <div class="legend">
            <div class="row"><span class="sw" style="background:var(--blocked)"></span>Blocked · ${a.totals.open || 0}</div>
            <div class="row"><span class="sw" style="background:var(--pending)"></span>In support · ${a.totals.in_support || 0}</div>
            <div class="row"><span class="sw" style="background:var(--flow)"></span>Resolved · ${a.totals.resolved || 0}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="chart-card">
      <h3>AI Teaching Assistant</h3>
      <div class="ai-stats-row">
        <div class="ai-stat"><div class="ai-stat-v">${a.deflectionRate || 0}%</div><div class="ai-stat-k">Deflection rate</div></div>
        <div class="ai-stat"><div class="ai-stat-v">${a.aiResolved || 0}</div><div class="ai-stat-k">Cleared by AI</div></div>
        <div class="ai-stat"><div class="ai-stat-v">~${a.hoursSaved || 0}h</div><div class="ai-stat-k">Instructor time saved</div></div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="chart-card"><h3>Resolved by cohort</h3>${bars(cohortRows, "resolved", "#12B886")}</div>
      <div class="chart-card"><h3>Resolved by instructor</h3>${bars(insRows, "resolved", "#0C111B")}</div>
    </div>

    <div class="chart-grid">
      <div class="chart-card"><h3>This week</h3><div id="digestPanel"><p class="thread-empty">Loading…</p></div></div>
      <div class="chart-card"><h3>Top AI topics</h3>${bars((a.byTopic || []).map((t) => ({ label: t.topic, count: t.count })), "count", "#12B886")}</div>
    </div>

    <div class="chart-card"><h3>Recent activity</h3><div id="activityFeed"><p class="thread-empty">Loading…</p></div></div>

    <div class="chart-card" id="hotspotsCard"><h3>Curriculum hot-spots <span class="eyebrow" style="font-size:.72rem;margin-left:.4rem">last 7 days</span></h3><p class="thread-empty">Loading…</p></div>

    <div class="chart-card"><h3>Nudge a cohort</h3>
      <p class="thread-empty" style="margin:.2rem 0 .8rem">Send an in-app nudge to every student in a cohort.</p>
      <div class="form-row" style="margin-bottom:.7rem">
        <label for="nudgeCohort">Cohort</label>
        <select id="nudgeCohort" class="row-select"><option value="">Loading cohorts…</option></select>
      </div>
      <div class="form-row" style="margin-bottom:.7rem">
        <label for="nudgeMessage">Message</label>
        <textarea id="nudgeMessage" rows="3" maxlength="500" placeholder="e.g. Office hours at 3pm — bring your blockers!"></textarea>
        <div class="char-count" id="nudgeCount" style="text-align:right;font-size:.78rem;font-family:var(--font-mono);color:var(--muted);margin-top:.25rem">0 / 500</div>
      </div>
      <button class="btn btn-primary" id="nudgeSend" type="button">Send nudge</button>
    </div>`;

  // Weekly AI digest (loads after the charts).
  const dp = document.getElementById("digestPanel");
  try {
    const dg = await API.get("/api/analytics/digest");
    const chips = (dg.themes || [])
      .map((t) => `<span class="theme-chip">${escapeHtml(t.theme)}<b>${t.count}</b></span>`)
      .join("");
    dp.innerHTML =
      `<p class="digest-summary">${escapeHtml(dg.summary || "")}</p>` +
      (chips ? `<div class="theme-chips">${chips}</div>` : "");
  } catch (e) {
    dp.innerHTML = `<p class="thread-empty">No digest yet.</p>`;
  }

  // Recent activity feed (loads after the charts so a failure here can't blank the dashboard).
  const feed = document.getElementById("activityFeed");
  try {
    const { activity } = await API.get("/api/activity");
    feed.innerHTML = activityHtml(activity);
  } catch (e) {
    feed.innerHTML = `<p class="thread-empty">Couldn't load activity.</p>`;
  }

  // Nudge composer — pick a cohort, write a message, POST /api/nudges.
  const nudgeCohort = document.getElementById("nudgeCohort");
  const nudgeMessage = document.getElementById("nudgeMessage");
  const nudgeSend = document.getElementById("nudgeSend");
  const nudgeCount = document.getElementById("nudgeCount");
  nudgeMessage.addEventListener("input", () => {
    const len = nudgeMessage.value.length;
    nudgeCount.textContent = `${len} / 500`;
    nudgeCount.style.color = len > 450 ? "var(--blocked)" : "var(--muted)";
  });
  try {
    const { cohorts } = await API.get("/api/cohorts");
    nudgeCohort.innerHTML = (cohorts && cohorts.length)
      ? cohorts.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")
      : `<option value="">No cohorts yet</option>`;
  } catch (e) {
    nudgeCohort.innerHTML = `<option value="">Couldn't load cohorts</option>`;
  }
  nudgeSend.addEventListener("click", async () => {
    const cohortId = nudgeCohort.value;
    const message = nudgeMessage.value.trim();
    if (!cohortId) { toast("Pick a cohort first.", "error"); return; }
    if (!message) { toast("Write a message to send.", "error"); return; }
    nudgeSend.disabled = true;
    try {
      const r = await API.post("/api/nudges", { message, target: "cohort:" + cohortId });
      const n = r.sent || 0;
      toast(`Sent to ${n} student${n === 1 ? "" : "s"}.`, "success");
      nudgeMessage.value = "";
      nudgeCount.textContent = "0 / 500";
      nudgeCount.style.color = "var(--muted)";
    } catch (err) {
      toast(err.message || "Couldn't send the nudge.", "error");
    } finally {
      nudgeSend.disabled = false;
    }
  });

  // Curriculum hot-spots (loads last; failure is non-fatal)
  const hc = document.getElementById("hotspotsCard");
  try {
    const { hotspots } = await API.get("/api/analytics/hotspots?windowDays=7");
    if (!hotspots || !hotspots.length) {
      hc.querySelector("p").textContent = "No topic clusters yet — hot-spots appear once AI has triaged a few blockages.";
    } else {
      hc.innerHTML = `<h3>Curriculum hot-spots <span class="eyebrow" style="font-size:.72rem;margin-left:.4rem">last 7 days</span></h3>
        <div class="hotspot-list">
          ${hotspots.map((h) => `
            <div class="hotspot-row">
              <div class="hotspot-info">
                <span class="hotspot-topic">${escapeHtml(h.topic)}</span>
                <span class="hotspot-meta">${h.count} student${h.count !== 1 ? "s" : ""} stuck${h.medianResolveHours != null ? ` · median ${h.medianResolveHours}h to resolve` : ""}</span>
              </div>
              <span class="pill ${h.count >= 5 ? "pill-blocked" : h.count >= 3 ? "pill-pending" : "pill-resolved"}" style="min-width:2rem;text-align:center">${h.count}</span>
            </div>`).join("")}
        </div>`;
    }
  } catch (_) {
    hc.querySelector("p").textContent = "Couldn't load hot-spots.";
  }
})();
