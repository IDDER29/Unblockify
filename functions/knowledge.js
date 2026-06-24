/* Resolution Library — what unblocked students in this org (F6, F7).
   Students browse before submitting; instructors see org-wide. */

(async function () {
  const s = await requireRole("student", "instructor", "owner");
  if (!s) return;

  const isStudent = s.user.role === "student";

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "knowledge.html",
    title: "Resolution library",
    crumb: isStudent ? "Student" : (s.user.role === "owner" ? "Owner" : "Instructor"),
    actions: isStudent
      ? '<a href="student_dashbord.html" class="btn btn-primary">+ Report a blockage</a>'
      : "",
  });

  view.innerHTML = `
    <div class="page-head">
      <h1>Resolution library</h1>
      <p>What has actually unblocked students in ${escapeHtml(s.org.name)}. Search before you submit — you might already have your answer.</p>
    </div>
    <div class="filters" style="margin-bottom:1rem">
      <input type="search" id="kbSearch" placeholder="Search by concept, error, or keyword…" autocomplete="off" style="max-width:420px" />
    </div>
    <div id="kbResults"></div>`;

  const searchInput = document.getElementById("kbSearch");
  const resultsEl = document.getElementById("kbResults");

  // Pre-fill from URL ?q=
  const initQ = new URLSearchParams(location.search).get("q") || "";
  searchInput.value = initQ;

  function renderResults(results, total, query) {
    if (!results || !results.length) {
      resultsEl.innerHTML = `<div class="blk-empty">
        ${query ? `No entries found for "<strong>${escapeHtml(query)}</strong>".` : "No resolutions in the library yet."}
        ${isStudent ? `<br><a href="student_dashbord.html" class="btn btn-ghost" style="margin-top:.75rem">Report a blockage</a>` : ""}
      </div>`;
      return;
    }
    resultsEl.innerHTML = `
      <p style="color:var(--muted,#666);font-size:.88rem;margin-bottom:.75rem">${total} result${total !== 1 ? "s" : ""}${query ? ` for "<strong>${escapeHtml(query)}</strong>"` : ""}</p>
      <div class="blk-grid">
        ${results.map((r) => {
          const meta = statusMeta(r.status || "resolved");
          const typeLabel = { self: "🎉 Student figured it out", ai: "✦ AI unblocked", explained: "Instructor: explained", demo: "Instructor: demo", pairing: "Instructor: pairing" }[r.resolutionType] || "Resolved";
          return `<a class="blk-card linkish" href="blockage.html?id=${encodeURIComponent(r.id)}" style="text-decoration:none;color:inherit">
            <div class="blk-card-top">
              <span class="blk-id">BLK-${String(r.id).padStart(3, "0")}</span>
              <span class="pill pill-${meta.cls}" style="font-size:.75rem">${escapeHtml(typeLabel)}</span>
            </div>
            <h3>${escapeHtml(r.title)}</h3>
            ${r.resolutionSummary ? `<div class="sp-summary" style="margin-top:.35rem;font-size:.85rem;color:var(--muted,#666);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(r.resolutionSummary)}</div>` : ""}
            <div class="blk-meta" style="margin-top:.4rem">Resolved ${escapeHtml(fmtRelative(r.resolvedAt || r.createdAt))}</div>
          </a>`;
        }).join("")}
      </div>`;
  }

  async function search(q) {
    try {
      resultsEl.innerHTML = `<div class="thread-empty">Loading…</div>`;
      const endpoint = q.length >= 2
        ? `/api/knowledge?q=${encodeURIComponent(q)}`
        : `/api/knowledge/browse`;
      const data = await API.get(endpoint);
      const results = data.results || data.blockages || [];
      const total = data.total || results.length;
      renderResults(results, total, q);
    } catch (e) {
      resultsEl.innerHTML = `<div class="blk-empty">Couldn't load the library.</div>`;
    }
  }

  // Debounced search
  let _timer = null;
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    const p = new URLSearchParams(location.search);
    q ? p.set("q", q) : p.delete("q");
    history.replaceState(null, "", "?" + p.toString());
    clearTimeout(_timer);
    _timer = setTimeout(() => search(q), 300);
  });

  // Initial load
  search(initQ);
})();
