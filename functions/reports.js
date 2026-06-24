/* Reports — owner-only: cohort progress summary, CSV export, weekly digest. */
(async function () {
  const s = await requireRole("owner");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "reports.html",
    title: "Reports",
    crumb: "Owner / Reports",
  });

  view.innerHTML = `<div id="rep-root"><p class="thread-empty">Loading…</p></div>`;
  const el = document.getElementById("rep-root");

  let analytics = null;
  let digest = null;
  try {
    [analytics, digest] = await Promise.all([
      API.get("/api/analytics"),
      API.get("/api/analytics/digest"),
    ]);
  } catch (_) {}

  const a = analytics || {};
  const d = (digest && digest.digest) || {};

  const byCohort = a.byCohort || [];
  const byInstructor = a.byInstructor || [];

  el.innerHTML = `
    <div class="page-head">
      <h1>Reports</h1>
      <p>Org-wide summaries, cohort progress, and data exports.</p>
    </div>

    <!-- Weekly digest -->
    <div class="chart-card" style="margin-bottom:1.25rem">
      <h3>Weekly digest</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.75rem;margin:.75rem 0">
        <div class="stat"><div class="k">Reported this week</div><div class="v">${d.reported || 0}</div></div>
        <div class="stat"><div class="k">Resolved this week</div><div class="v">${d.resolved || 0}</div></div>
        <div class="stat"><div class="k">AI-resolved</div><div class="v">${d.aiResolved || 0}</div></div>
        <div class="stat"><div class="k">Avg time (week)</div><div class="v">${d.avgHours != null ? `${d.avgHours}h` : "—"}</div></div>
      </div>
      ${(d.topTopics || []).length ? `
      <div style="margin-top:.5rem">
        <div style="font-size:.8rem;color:var(--muted);margin-bottom:.4rem">Top topics this week</div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          ${(d.topTopics || []).slice(0, 6).map(t => `<span class="atrisk-tag">${escapeHtml(t.topic)}</span>`).join("")}
        </div>
      </div>` : ""}
    </div>

    <!-- Cohort progress table -->
    <div class="chart-card" style="margin-bottom:1.25rem">
      <h3>Cohort progress</h3>
      ${byCohort.length ? `
      <div style="overflow-x:auto;margin-top:.75rem">
        <table style="width:100%;border-collapse:collapse;font-size:.9rem">
          <thead>
            <tr style="border-bottom:2px solid var(--line,#e8e8e8);text-align:left">
              <th style="padding:.5rem .75rem">Cohort</th>
              <th style="padding:.5rem .75rem">Open</th>
              <th style="padding:.5rem .75rem">In support</th>
              <th style="padding:.5rem .75rem">Resolved</th>
              <th style="padding:.5rem .75rem">Resolve rate</th>
            </tr>
          </thead>
          <tbody>
            ${byCohort.map(c => {
              const total = (c.open || 0) + (c.in_support || 0) + (c.resolved || 0);
              const rate = total ? Math.round((c.resolved || 0) / total * 100) : 0;
              return `<tr style="border-bottom:1px solid var(--line,#e8e8e8)">
                <td style="padding:.5rem .75rem;font-weight:500">${escapeHtml(c.name || "—")}</td>
                <td style="padding:.5rem .75rem"><span class="pill pill-blocked" style="font-size:.75rem">${c.open || 0}</span></td>
                <td style="padding:.5rem .75rem"><span class="pill pill-pending" style="font-size:.75rem">${c.in_support || 0}</span></td>
                <td style="padding:.5rem .75rem"><span class="pill pill-resolved" style="font-size:.75rem">${c.resolved || 0}</span></td>
                <td style="padding:.5rem .75rem">
                  <div style="display:flex;align-items:center;gap:.5rem">
                    <div style="background:var(--line);border-radius:4px;height:6px;width:80px;overflow:hidden">
                      <div style="background:var(--flow,#12B886);height:100%;width:${rate}%"></div>
                    </div>
                    ${rate}%
                  </div>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : `<p class="muted" style="margin-top:.5rem">No cohort data yet.</p>`}
    </div>

    <!-- Instructor stats -->
    <div class="chart-card" style="margin-bottom:1.25rem">
      <h3>Instructor performance</h3>
      ${byInstructor.length ? `
      <div style="overflow-x:auto;margin-top:.75rem">
        <table style="width:100%;border-collapse:collapse;font-size:.9rem">
          <thead>
            <tr style="border-bottom:2px solid var(--line);text-align:left">
              <th style="padding:.5rem .75rem">Instructor</th>
              <th style="padding:.5rem .75rem">Resolved</th>
              <th style="padding:.5rem .75rem">Avg time</th>
              <th style="padding:.5rem .75rem">Avg CSAT</th>
            </tr>
          </thead>
          <tbody>
            ${byInstructor.map(i => `
              <tr style="border-bottom:1px solid var(--line)">
                <td style="padding:.5rem .75rem;font-weight:500">${escapeHtml(i.name || "—")}</td>
                <td style="padding:.5rem .75rem">${i.resolved || 0}</td>
                <td style="padding:.5rem .75rem">${i.avgHours != null ? `${i.avgHours}h` : "—"}</td>
                <td style="padding:.5rem .75rem">${i.avgCsat ? `${i.avgCsat}★` : "—"}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `<p class="muted" style="margin-top:.5rem">No instructor data yet.</p>`}
    </div>

    <!-- Export section -->
    <div class="chart-card">
      <h3>Data exports</h3>
      <div style="display:flex;flex-direction:column;gap:.75rem;margin-top:.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;padding:.75rem;background:var(--surface-2);border-radius:8px">
          <div>
            <div style="font-weight:500">All blockages — CSV</div>
            <div style="font-size:.82rem;color:var(--muted)">Every blockage, status, timestamps, resolution type, assignee.</div>
          </div>
          <a class="btn btn-ghost btn-sm" href="/api/blockages/export.csv" download>Download CSV</a>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;padding:.75rem;background:var(--surface-2);border-radius:8px">
          <div>
            <div style="font-weight:500">Filtered export</div>
            <div style="font-size:.82rem;color:var(--muted)">Filter by date or status in Owner Blockages, then export from there.</div>
          </div>
          <a class="btn btn-ghost btn-sm" href="owner_blockages.html">Go to blockages →</a>
        </div>
      </div>
    </div>`;
})();
