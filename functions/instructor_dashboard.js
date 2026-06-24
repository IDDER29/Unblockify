/* Instructor personal analytics dashboard — resolved count, avg time, CSAT, top topics. */
(async function () {
  const s = await requireRole("instructor", "owner");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "instructor_dashboard.html",
    title: "My dashboard",
    crumb: "My dashboard",
  });

  view.innerHTML = `<div id="dash-root"><p class="thread-empty">Loading…</p></div>`;
  const el = document.getElementById("dash-root");

  const [teaching, checkIns] = await Promise.allSettled([
    API.get("/api/me/teaching"),
    API.get("/api/check-ins?status=open"),
  ]);

  const t = teaching.status === "fulfilled" ? (teaching.value.teaching || {}) : {};
  const openCIs = checkIns.status === "fulfilled" ? (checkIns.value.checkIns || []) : [];
  const myCIs = openCIs.filter(ci => String(ci.instructor_id) === String(s.user.id));

  function tile(k, v) {
    return `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${v}</div></div>`;
  }

  const topicsHtml = (t.byTopic || []).length
    ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.75rem">
        ${(t.byTopic || []).slice(0, 8).map(tp =>
          `<span class="atrisk-tag">${escapeHtml(tp.topic)} <span style="opacity:.6;font-size:.78rem">${tp.count}</span></span>`
        ).join("")}
      </div>`
    : `<p class="muted" style="margin-top:.5rem">No topics yet — resolve some blockages first.</p>`;

  const ciHtml = myCIs.length
    ? myCIs.slice(0, 5).map(ci => `
        <div style="padding:.6rem 0;border-bottom:1px solid var(--line,#eee)">
          <div style="font-weight:600;font-size:.9rem">${escapeHtml(ci.student_name)}</div>
          <div style="font-size:.82rem;color:var(--muted)">${ci.note ? escapeHtml(ci.note) : "No note"} · ${escapeHtml(fmtRelative(ci.created_at))}</div>
          <a style="font-size:.8rem;color:var(--flow)" href="student_profile.html?id=${encodeURIComponent(ci.student_id)}">View profile →</a>
        </div>`).join("")
    : `<p class="muted" style="margin-top:.5rem">No open check-ins assigned to you.</p>`;

  el.innerHTML = `
    <div class="page-head" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:1rem">
      <div>
        <h1>My teaching dashboard</h1>
        <p>Your personal teaching stats — all time, across all your assigned cohorts.</p>
      </div>
      <a class="btn btn-ghost btn-sm" href="instructor_queue.html">Go to queue →</a>
    </div>

    <section class="profile-grid" style="margin-bottom:1.5rem">
      ${tile("Blockages resolved", t.totalResolved || 0)}
      ${tile("Avg time to resolve", t.avgResolveHours != null ? `${t.avgResolveHours}h` : "—")}
      ${tile("Open check-ins (you)", myCIs.length)}
    </section>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin-bottom:1.25rem">
      <div class="chart-card">
        <h3>Top topics you've resolved</h3>
        ${topicsHtml}
        <p style="font-size:.8rem;color:var(--muted);margin-top:.75rem">Topics extracted by the AI from every blockage you've resolved. These are your strongest areas.</p>
      </div>

      <div class="chart-card">
        <h3>Open check-ins assigned to you</h3>
        ${ciHtml}
        ${myCIs.length ? `<a class="btn btn-ghost btn-sm" style="margin-top:.75rem" href="check-ins.html">All check-ins →</a>` : ""}
      </div>
    </div>

    <div class="chart-card" style="background:var(--surface-2,#f8f9fb)">
      <h3>Quick actions</h3>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem">
        <a class="btn btn-primary btn-sm" href="instructor_queue.html">Work the queue</a>
        <a class="btn btn-ghost btn-sm" href="instructor_students.html">My students</a>
        <a class="btn btn-ghost btn-sm" href="instructor_blockages.html">All blockages</a>
        <a class="btn btn-ghost btn-sm" href="check-ins.html">Check-ins</a>
        <a class="btn btn-ghost btn-sm" href="cohorts.html">Cohorts</a>
      </div>
    </div>`;
})();
