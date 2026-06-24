/* Briefs management — owner/instructor: see all briefs across all cohorts in one place. */
(async function () {
  const s = await requireRole("owner", "instructor");
  if (!s) return;
  const isOwner = s.user.role === "owner";

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "briefs.html",
    title: "Cohort briefs",
    crumb: isOwner ? "Owner / Briefs" : "Briefs",
  });

  view.innerHTML = `<div id="briefs-root"><p class="thread-empty">Loading…</p></div>`;
  const el = document.getElementById("briefs-root");

  let cohorts = [];
  try {
    const data = await API.get("/api/cohorts");
    cohorts = data.cohorts || [];
  } catch (e) {
    el.innerHTML = `<div class="blk-empty">Couldn't load cohorts.</div>`;
    return;
  }

  // Load full details (includes briefs) for each cohort
  const details = await Promise.allSettled(cohorts.map(c => API.get(`/api/cohorts/${c.id}`)));
  const fullCohorts = details.map((r, i) => r.status === "fulfilled" ? r.value : cohorts[i]);

  function renderBriefs() {
    const allBriefs = [];
    for (const c of fullCohorts) {
      for (const b of (c.briefs || [])) {
        allBriefs.push({ ...b, cohortName: c.name, cohortId: c.id });
      }
    }

    if (!allBriefs.length) {
      el.innerHTML = `
        <div class="page-head"><h1>Cohort briefs</h1><p>Ground the AI Teaching Assistant in your curriculum.</p></div>
        <div class="blk-empty">No briefs yet. Go to a cohort to add one.</div>
        <div style="margin-top:1rem"><a class="btn btn-primary" href="cohorts.html">Go to cohorts</a></div>`;
      return;
    }

    el.innerHTML = `
      <div class="page-head">
        <h1>Cohort briefs</h1>
        <p>All briefs across all cohorts — the context that grounds the AI Teaching Assistant.</p>
        <a class="btn btn-ghost btn-sm" href="cohorts.html" style="margin-top:.5rem">Manage cohorts</a>
      </div>

      ${fullCohorts.filter(c => (c.briefs || []).length).map(c => `
        <div class="chart-card" style="margin-bottom:1.25rem">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
            <h3 style="margin:0">${escapeHtml(c.name)}</h3>
            <a class="btn btn-ghost btn-sm" href="cohorts.html">Edit in cohorts →</a>
          </div>
          ${(c.briefs || []).map(b => `
            <div style="border:1px solid var(--line,#e8e8e8);border-radius:8px;padding:1rem;margin-bottom:.75rem;background:#fff">
              <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:.5rem">
                <div style="font-weight:600">${escapeHtml(b.name || "Brief")}</div>
                <div style="font-size:.78rem;font-family:var(--font-mono),monospace;color:var(--muted)">Updated ${escapeHtml(fmtRelative(b.updated_at || b.created_at))}</div>
              </div>
              <div style="font-size:.88rem;color:var(--muted,#555);white-space:pre-wrap;max-height:120px;overflow:hidden;position:relative" id="brief-body-${escapeHtml(String(b.id))}">${escapeHtml((b.content || "").slice(0, 400))}${b.content && b.content.length > 400 ? "…" : ""}</div>
              ${b.content && b.content.length > 400 ? `<button class="btn btn-ghost btn-sm" style="margin-top:.5rem" onclick="document.getElementById('brief-body-${escapeHtml(String(b.id))}').style.maxHeight='none';this.remove()">Show full brief</button>` : ""}
            </div>`).join("")}
        </div>`).join("")}

      ${fullCohorts.filter(c => !(c.briefs || []).length).length ? `
        <div style="font-size:.88rem;color:var(--muted);margin-top:.5rem">
          Cohorts without a brief: ${fullCohorts.filter(c => !(c.briefs||[]).length).map(c => `<strong>${escapeHtml(c.name)}</strong>`).join(", ")}
          — <a href="cohorts.html" style="color:var(--flow)">add a brief</a>
        </div>` : ""}`;
  }

  renderBriefs();
})();
