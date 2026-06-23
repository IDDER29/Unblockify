/* Student 360 — owner/instructor view of one student's full blockage history.
   Opened via student_profile.html?id=<userId> from members & at-risk lists. */

(async function () {
  const s = await requireRole("owner", "instructor");
  if (!s) return;
  const isOwner = s.user.role === "owner";

  const id = new URLSearchParams(location.search).get("id");

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: isOwner ? "members.html" : "instructor_queue.html",
    title: "Student",
    crumb: isOwner ? "Owner / Members" : "Instructor",
  });

  if (!id) {
    view.innerHTML = `<div class="blk-empty">No student selected.</div>`;
    return;
  }

  view.innerHTML = `<div id="profile"><p class="thread-empty">Loading…</p></div>`;
  const el = document.getElementById("profile");

  let p;
  try {
    p = await API.get(`/api/members/${encodeURIComponent(id)}/profile`);
  } catch (e) {
    el.innerHTML = `<div class="blk-empty">${
      e.status === 404
        ? "That student isn't here. They may have left, or you don't have access."
        : "Couldn't load this student."
    }</div>`;
    return;
  }

  const st = p.student;
  const stats = p.stats || {};
  const atRisk = p.atRisk || { open: 0, reasons: [] };
  const recent = p.recent || [];

  function tile(k, v) {
    return `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${v}</div></div>`;
  }

  const reasons = (atRisk.reasons || []).length
    ? `<div class="atrisk-list"><div class="atrisk-item">
        <span class="nm">Needs a human?</span>
        <span class="rs">${atRisk.reasons
          .map((t) => `<span class="atrisk-tag">${escapeHtml(t)}</span>`)
          .join("")}</span>
      </div></div>`
    : `<p class="atrisk-empty">Looking healthy — nothing flagged right now. 🎉</p>`;

  const recentHtml = recent.length
    ? `<div class="blk-grid">${recent
        .map((b) => {
          const m = statusMeta(b.status);
          return `<a class="blk-card linkish" style="text-decoration:none;color:inherit"
              href="blockage.html?id=${encodeURIComponent(b.id)}">
            <div class="blk-card-top">
              <span class="blk-id">BLK-${escapeHtml(b.id)}</span>
              <span class="pill pill-${m.cls}">${escapeHtml(m.label)}</span>
            </div>
            <h3>${escapeHtml(b.title)}</h3>
            <div class="blk-meta">Reported ${escapeHtml(fmtRelative(b.createdAt))}${
              b.resolvedAt ? ` · resolved ${escapeHtml(fmtRelative(b.resolvedAt))}` : ""
            }</div>
          </a>`;
        })
        .join("")}</div>`
    : `<div class="blk-empty">No blockages reported yet.</div>`;

  el.innerHTML = `
    <div class="page-head">
      <h1>${escapeHtml(st.name)}</h1>
      <p>${escapeHtml(st.email)}${
        st.cohortName ? ` · ${escapeHtml(st.cohortName)}` : " · no cohort"
      }</p>
    </div>

    <section class="profile-grid">
      ${tile("Total blockages", stats.total || 0)}
      ${tile("Open", `<span class="is-blocked-text">${stats.open || 0}</span>`)}
      ${tile("Resolved", stats.resolved || 0)}
      ${tile("Median time to unblock", `${stats.medianHours || 0}h`)}
      ${tile("AI vs human", `${stats.aiResolved || 0} / ${stats.humanResolved || 0}`)}
      ${tile(
        "Avg satisfaction",
        stats.csatCount
          ? `<span class="csat-inline">${csatStars(stats.avgCsat)}</span> <span class="csat-n">${stats.avgCsat}</span>`
          : "—"
      )}
    </section>

    <div class="chart-grid">
      <div class="chart-card"><h3>Needs a human?</h3>${reasons}</div>
    </div>

    <div class="chart-card">
      <h3>Recent blockages</h3>
      ${recentHtml}
    </div>`;
})();
