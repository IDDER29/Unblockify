/* Owner all-blockages — every blockage in the org, filterable by status + cohort. */

(async function () {
  const s = await requireRole("owner");
  if (!s) return;

  const view = renderShell({
    user: s.user, org: s.org, active: "owner_blockages.html",
    title: "Blockages", crumb: "Owner",
  });

  view.innerHTML = `
    <div class="page-head"><h1>All blockages</h1><p>Every blockage across your organization.</p></div>
    <section class="stat-row" id="stats"></section>
    <div class="filters">
      <div class="seg" id="seg">
        <button data-status="" class="active">All</button>
        <button data-status="open">Blocked</button>
        <button data-status="in_support">In support</button>
        <button data-status="resolved">Resolved</button>
      </div>
      <select id="cohort"><option value="">All cohorts</option></select>
      <input type="search" id="search" placeholder="Search…" autocomplete="off">
      <a class="btn btn-ghost" href="/api/blockages/export.csv" download>Export CSV</a>
    </div>
    <div id="grid"></div>`;

  const stats = document.getElementById("stats");
  const grid = document.getElementById("grid");
  const seg = document.getElementById("seg");
  const cohortSel = document.getElementById("cohort");
  const searchInput = document.getElementById("search");

  // --- Read persisted filter state from the URL query string. ----------
  const params = new URLSearchParams(window.location.search);
  let statusFilter = params.get("status") || "";
  let cohortFilter = params.get("cohort") || "";
  let searchQuery = params.get("q") || "";

  let blockages = [];

  // Pre-apply the search box value.
  searchInput.value = searchQuery;

  // Pre-apply the active status segment.
  seg.querySelectorAll("button[data-status]").forEach((b) => {
    b.classList.toggle("active", (b.dataset.status || "") === statusFilter);
  });

  function syncUrl() {
    const p = new URLSearchParams();
    if (statusFilter) p.set("status", statusFilter);
    if (cohortFilter) p.set("cohort", cohortFilter);
    if (searchQuery) p.set("q", searchQuery);
    const qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : window.location.pathname);
  }

  // Populate cohort select.
  try {
    const { cohorts } = await API.get("/api/cohorts");
    (cohorts || []).forEach((c) => {
      const o = document.createElement("option");
      o.value = String(c.id);
      o.textContent = c.name;
      cohortSel.appendChild(o);
    });
    // Pre-apply the persisted cohort selection (only if it still exists).
    if (cohortFilter && cohortSel.querySelector(`option[value="${CSS.escape(cohortFilter)}"]`)) {
      cohortSel.value = cohortFilter;
    } else {
      cohortFilter = "";
    }
  } catch (_) {}

  // Show skeleton while loading.
  grid.innerHTML = `<div class="blk-grid">${Array.from({length: 6}, () =>
    `<article class="blk-card"><div class="skel w-30" style="height:1rem;margin-bottom:.5rem"></div><div class="skel w-70" style="height:1.2rem;margin-bottom:.4rem"></div><div class="skel w-50" style="height:.85rem"></div></article>`
  ).join("")}</div>`;

  // Fetch every blockage (owner sees all).
  try {
    const res = await API.get("/api/blockages");
    blockages = res.blockages || [];
  } catch (e) {
    grid.innerHTML = `<div class="blk-empty">Couldn't load blockages. Try refreshing the page.</div>`;
    return;
  }

  function renderStats() {
    const totals = { total: blockages.length, open: 0, in_support: 0, resolved: 0 };
    blockages.forEach((b) => { if (totals[b.status] != null) totals[b.status]++; });
    stats.innerHTML = `
      <div class="stat"><div class="k">Total</div><div class="v">${totals.total}</div></div>
      <div class="stat is-blocked"><div class="k">Blocked</div><div class="v">${totals.open}</div></div>
      <div class="stat is-pending"><div class="k">In support</div><div class="v">${totals.in_support}</div></div>
      <div class="stat is-resolved"><div class="k">Resolved</div><div class="v">${totals.resolved}</div></div>`;
  }

  function difficultyBadge(d) {
    const L = { low: "Low", medium: "Medium", high: "High", blocker: "Blocker" };
    if (!d || !L[d]) return "";
    const color = { low: "#5d6675", medium: "#F59F00", high: "#F59F00", blocker: "#FF5A4D" }[d];
    return `<span class="blk-id" style="border-color:${color};color:${color}">${L[d]}</span>`;
  }

  function cardHtml(b) {
    const { cls, label } = statusMeta(b.status);
    const pad = String(b.id).padStart(3, "0");
    const assignee = b.assigneeName ? "&rarr; " + escapeHtml(b.assigneeName) + " &middot; " : "";
    return `<article class="blk-card linkish status-${cls}" data-id="${escapeHtml(b.id)}">
      <div class="blk-card-top"><span class="blk-id">BLK-${escapeHtml(pad)}</span>${difficultyBadge(b.difficulty)}<span class="pill pill-${cls}">${escapeHtml(label)}</span></div>
      <h3>${escapeHtml(b.title)}</h3>
      <div class="who">${escapeHtml(b.studentName || "Unknown")} &middot; ${escapeHtml(b.cohortName || "No cohort")}</div>
      <div class="blk-meta">${assignee}${escapeHtml(fmtDate(b.createdAt))}</div>
    </article>`;
  }

  function renderGrid() {
    const q = searchQuery.trim().toLowerCase();
    const list = blockages.filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (cohortFilter && String(b.cohortId) !== cohortFilter) return false;
      if (q) {
        const hay = [b.title, b.studentName, b.cohortName]
          .map((v) => String(v == null ? "" : v).toLowerCase())
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (!list.length) {
      grid.innerHTML = `<div class="blk-empty">No blockages match these filters.</div>`;
      return;
    }
    const countLabel = list.length < blockages.length
      ? `<div class="result-count">Showing ${list.length} of ${blockages.length} blockages</div>`
      : `<div class="result-count">${blockages.length} blockage${blockages.length === 1 ? "" : "s"}</div>`;
    grid.innerHTML = countLabel + `<div class="blk-grid">${list.map(cardHtml).join("")}</div>`;
  }

  seg.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-status]");
    if (!btn) return;
    statusFilter = btn.dataset.status || "";
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    syncUrl();
    renderGrid();
  });

  cohortSel.addEventListener("change", () => {
    cohortFilter = cohortSel.value;
    syncUrl();
    renderGrid();
  });

  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      syncUrl();
      renderGrid();
    }, 150);
  });

  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".blk-card[data-id]");
    if (!card) return;
    window.location.href = "blockage.html?id=" + encodeURIComponent(card.dataset.id);
  });

  syncUrl();
  renderStats();
  renderGrid();
})();
