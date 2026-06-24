/* Instructor students list — all students across assigned cohorts with at-risk flags. */
(async function () {
  const s = await requireRole("instructor", "owner");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "instructor_students.html",
    title: "My students",
    crumb: "My students",
  });

  view.innerHTML = `<div id="stu-root"><p class="thread-empty">Loading…</p></div>`;
  const el = document.getElementById("stu-root");

  let cohorts = [];
  let analytics = null;
  try {
    [cohorts, analytics] = await Promise.all([
      API.get("/api/cohorts"),
      API.get("/api/analytics"),
    ]);
  } catch (e) {
    el.innerHTML = `<div class="blk-empty">Couldn't load students.</div>`;
    return;
  }

  // Only cohorts this instructor is assigned to
  const myCohorts = (cohorts.cohorts || []).filter(c =>
    s.user.role === "owner" || (c.instructors || []).some(i => i.id === s.user.id)
  );

  const atRiskMap = {};
  if (analytics && analytics.atRisk) {
    for (const r of analytics.atRisk) atRiskMap[r.id] = r;
  }

  let filterCohort = "";
  let filterRisk = "";
  let searchQ = "";

  function renderList() {
    // Collect all students across assigned cohorts
    let allStudents = [];
    for (const c of myCohorts) {
      if (filterCohort && String(c.id) !== filterCohort) continue;
      for (const st of (c.students || [])) {
        allStudents.push({ ...st, cohortName: c.name, cohortId: c.id });
      }
    }

    // Apply search
    if (searchQ) {
      const q = searchQ.toLowerCase();
      allStudents = allStudents.filter(st =>
        (st.name || "").toLowerCase().includes(q) ||
        (st.email || "").toLowerCase().includes(q)
      );
    }

    // Apply at-risk filter
    if (filterRisk === "atrisk") {
      allStudents = allStudents.filter(st => atRiskMap[st.id]);
    }

    const listEl = document.getElementById("stuList");
    if (!listEl) return;

    if (!allStudents.length) {
      listEl.innerHTML = `<div class="blk-empty">No students match the current filter.</div>`;
      return;
    }

    listEl.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:.9rem">
        <thead>
          <tr style="border-bottom:2px solid var(--line,#e8e8e8);text-align:left">
            <th style="padding:.5rem .75rem">Name</th>
            <th style="padding:.5rem .75rem">Cohort</th>
            <th style="padding:.5rem .75rem">Status</th>
            <th style="padding:.5rem .75rem"></th>
          </tr>
        </thead>
        <tbody>
          ${allStudents.map(st => {
            const risk = atRiskMap[st.id];
            return `<tr style="border-bottom:1px solid var(--line,#e8e8e8)">
              <td style="padding:.5rem .75rem">
                <div style="font-weight:500">${escapeHtml(st.name || "")}</div>
                <div style="font-size:.78rem;color:var(--muted)">${escapeHtml(st.email || "")}</div>
              </td>
              <td style="padding:.5rem .75rem;color:var(--muted)">${escapeHtml(st.cohortName || "—")}</td>
              <td style="padding:.5rem .75rem">
                ${risk
                  ? `<span class="pill pill-blocked" style="font-size:.75rem">At risk</span>
                     <div style="font-size:.75rem;color:var(--muted);margin-top:.2rem">${escapeHtml((risk.reasons || []).join(", "))}</div>`
                  : `<span class="pill pill-resolved" style="font-size:.75rem">On track</span>`}
              </td>
              <td style="padding:.5rem .75rem;text-align:right">
                <a class="btn btn-ghost btn-sm" href="student_profile.html?id=${encodeURIComponent(st.id)}">View profile</a>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  }

  el.innerHTML = `
    <div class="page-head">
      <h1>My students</h1>
      <p>All students across your assigned cohorts, with at-risk flags.</p>
    </div>

    <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem">
      <input type="search" id="searchInput" placeholder="Search by name or email…" class="input" style="flex:1;min-width:160px;max-width:280px" />
      <select id="cohortFilter" class="input" style="width:auto">
        <option value="">All cohorts</option>
        ${myCohorts.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
      </select>
      <select id="riskFilter" class="input" style="width:auto">
        <option value="">All students</option>
        <option value="atrisk">At-risk only</option>
      </select>
    </div>

    <div class="panel" style="padding:0;overflow:auto" id="stuList">
      <p class="thread-empty">Rendering…</p>
    </div>`;

  // Load cohort students
  const cohortDetails = await Promise.allSettled(
    myCohorts.map(c => API.get(`/api/cohorts/${c.id}`))
  );
  for (let i = 0; i < myCohorts.length; i++) {
    if (cohortDetails[i].status === "fulfilled") {
      myCohorts[i].students = cohortDetails[i].value.students || [];
      myCohorts[i].instructors = cohortDetails[i].value.instructors || [];
    }
  }

  renderList();

  document.getElementById("searchInput").addEventListener("input", function () { searchQ = this.value; renderList(); });
  document.getElementById("cohortFilter").addEventListener("change", function () { filterCohort = this.value; renderList(); });
  document.getElementById("riskFilter").addEventListener("change", function () { filterRisk = this.value; renderList(); });
})();
