/* Personal Growth Fingerprint — student's own learning trajectory. F3 from the roadmap.
   Framed entirely as personal progress — never compared to other students. */

(async function () {
  const s = await requireRole("student");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "growth.html",
    title: "My growth",
    crumb: "Student",
  });

  view.innerHTML = `<div class="page-head">
    <h1>Your learning fingerprint</h1>
    <p>Your own unblocking data — how you're improving over time.</p>
    <div style="margin-top:.75rem">
      <a class="btn btn-ghost btn-sm" href="/api/me/export.json" download="unblockify-portfolio.json">↓ Export portfolio</a>
    </div>
  </div>
  <div id="growthContent"><div class="thread-empty">Loading…</div></div>`;

  const el = document.getElementById("growthContent");

  let m;
  try {
    m = await API.get("/api/me/momentum");
  } catch (e) {
    el.innerHTML = `<div class="blk-empty">Couldn't load your growth data.</div>`;
    return;
  }

  if (!m || (m.totalCleared === 0 && (!m.history || !m.history.length))) {
    el.innerHTML = `<div class="blk-empty">
      <strong>Nothing here yet.</strong><br>
      Submit your first blockage from <a href="student_dashbord.html">My blockages</a> — your growth fingerprint builds automatically as you work through walls.
    </div>`;
    return;
  }

  // --- KPI row ---
  const kpis = [
    { v: m.totalCleared, k: "Total cleared", cls: "is-resolved" },
    { v: m.fastestResolveHours != null ? m.fastestResolveHours + "h" : "—", k: "Fastest unblock" },
    { v: m.activeDaysLast30 + (m.activeDaysLast30 === 1 ? " day" : " days"), k: "Active (last 30d)" },
  ];
  if (m.topStuckTopics && m.topStuckTopics.length) {
    kpis.push({ v: m.topStuckTopics[0].topic, k: "Most blocked on" });
  }

  const kpiHtml = kpis.map((k) =>
    `<div class="stat${k.cls ? " " + k.cls : ""}"><div class="k">${escapeHtml(k.k)}</div><div class="v">${escapeHtml(String(k.v))}</div></div>`
  ).join("");

  // --- Insight ---
  let insightHtml = "";
  if (m.totalCleared >= 3) {
    insightHtml = `<div class="summary-card" style="margin-bottom:1.5rem">
      <span class="ai-badge">Insight</span>
      You've cleared <strong>${m.totalCleared}</strong> wall${m.totalCleared !== 1 ? "s" : ""} so far.
      ${m.fastestResolveHours != null && m.fastestResolveHours < 2 ? " Your fastest unblock was under 2 hours — that's a strong sign you're getting better at debugging." : ""}
      ${m.activeDaysLast30 >= 10 ? " You've been consistently active over the last month — that consistency is what separates engineers who level up from those who don't." : ""}
    </div>`;
  }

  // --- Topic breakdown ---
  const topicHtml = m.topStuckTopics && m.topStuckTopics.length
    ? `<div class="chart-card" style="margin-bottom:1.5rem">
        <h3>What you get stuck on most</h3>
        <p style="color:var(--muted,#666);font-size:.88rem;margin-bottom:.75rem">These are the areas where you ask for help most often — knowing your patterns is the first step to mastering them.</p>
        <div class="hotspot-list">
          ${m.topStuckTopics.map((t) => `
            <div class="hotspot-row">
              <div class="hotspot-info">
                <div class="hotspot-topic">${escapeHtml(t.topic)}</div>
                <div class="hotspot-meta">${t.count} blockage${t.count !== 1 ? "s" : ""}</div>
              </div>
              <div class="hotspot-bar" style="width:${Math.round((t.count / m.topStuckTopics[0].count) * 100)}%;max-width:200px;height:6px;background:var(--flow,#12B886);border-radius:3px;margin-left:auto"></div>
            </div>`).join("")}
        </div>
      </div>`
    : "";

  // --- Recent history ---
  const historyHtml = m.history && m.history.length
    ? `<div class="chart-card">
        <h3>Recent blockages</h3>
        <div class="blk-grid">
          ${m.history.map((b) => {
            const meta = statusMeta(b.status);
            return `<a class="blk-card linkish" href="blockage.html?id=${encodeURIComponent(b.id)}" style="text-decoration:none;color:inherit">
              <div class="blk-card-top">
                <span class="blk-id">BLK-${String(b.id).padStart(3, "0")}</span>
                <span class="pill pill-${meta.cls}">${escapeHtml(meta.label)}</span>
              </div>
              <h3>${escapeHtml(b.title)}</h3>
              <div class="blk-meta">
                ${escapeHtml(fmtRelative(b.createdAt))}
                ${b.resolvedAt ? ` · unblocked ${escapeHtml(fmtRelative(b.resolvedAt))}` : ""}
              </div>
            </a>`;
          }).join("")}
        </div>
      </div>`
    : "";

  // --- Weekly digest ---
  let digestHtml = "";
  try {
    const dg = await API.get("/api/me/weekly-digest");
    if (dg && (dg.reported > 0 || dg.resolved > 0)) {
      const selfPct = dg.resolved > 0 ? Math.round((dg.selfResolved / dg.resolved) * 100) : 0;
      const aiPct = dg.resolved > 0 ? Math.round((dg.aiResolved / dg.resolved) * 100) : 0;
      const cohortLine = dg.cohortReported > 0
        ? `<div class="blk-meta" style="margin-top:.6rem">Your cohort reported <strong>${dg.cohortReported}</strong> blockage${dg.cohortReported !== 1 ? "s" : ""} this week too — you're not alone.</div>`
        : "";
      const topicsLine = dg.weekTopics && dg.weekTopics.length
        ? `<div class="blk-meta" style="margin-top:.5rem">This week's topics: ${dg.weekTopics.map(t => `<strong>${escapeHtml(t.topic)}</strong>`).join(", ")}</div>`
        : "";
      digestHtml = `<div class="chart-card" style="margin-bottom:1.5rem">
        <h3>This week</h3>
        <section class="stat-row" style="margin:.5rem 0 .75rem;gap:.75rem">
          <div class="stat"><div class="k">Reported</div><div class="v">${dg.reported}</div></div>
          <div class="stat is-resolved"><div class="k">Cleared</div><div class="v">${dg.resolved}</div></div>
          ${selfPct > 0 ? `<div class="stat"><div class="k">Self-resolved</div><div class="v">${selfPct}%</div></div>` : ""}
          ${dg.fastestHours != null ? `<div class="stat"><div class="k">Fastest</div><div class="v">${dg.fastestHours}h</div></div>` : ""}
        </section>
        ${cohortLine}${topicsLine}
      </div>`;
    }
  } catch (_) { /* non-fatal */ }

  // --- What's ahead (cohort heatmap) ---
  let aheadHtml = "";
  try {
    const ahead = await API.get("/api/me/ahead");
    if (ahead && (ahead.hotspots.length || ahead.hotTopics.length)) {
      const hotspotsSection = ahead.hotspots.length
        ? ahead.hotspots.map(h => `
            <div class="hotspot-row">
              <div class="hotspot-info">
                <div class="hotspot-topic">${escapeHtml(h.brief)}</div>
                <div class="hotspot-meta">${h.count} student${h.count !== 1 ? "s" : ""} stuck${h.avgHours != null ? ` · avg ${h.avgHours}h to unblock` : ""}</div>
              </div>
            </div>`).join("")
        : "";
      const topicsSection = ahead.hotTopics.length
        ? `<div style="margin-top:.75rem;font-size:.85rem;color:var(--muted,#666)">
            Common topics: ${ahead.hotTopics.map(t => `<strong>${escapeHtml(t.topic)}</strong> (${t.count})`).join(", ")}
           </div>`
        : "";
      aheadHtml = `<div class="chart-card" style="margin-bottom:1.5rem">
        <h3>What's coming up</h3>
        <p style="color:var(--muted,#666);font-size:.88rem;margin-bottom:.75rem">
          These are the areas others in your cohort have hit. Knowing the hard zones ahead turns anxiety into preparation.
        </p>
        <div class="hotspot-list">${hotspotsSection}${topicsSection}</div>
      </div>`;
    }
  } catch (_) { /* non-fatal */ }

  el.innerHTML = `
    <section class="stat-row" style="margin-bottom:1.5rem">${kpiHtml}</section>
    ${insightHtml}
    ${digestHtml}
    ${topicHtml}
    ${aheadHtml}
    ${historyHtml}
  `;
})();
