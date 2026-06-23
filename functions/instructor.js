/* Instructor queue — blockages in assigned cohorts / assigned to the instructor. */

(async function () {
  const s = await requireRole("instructor");
  if (!s) return;

  const view = renderShell({
    user: s.user, org: s.org, active: "instructor_queue.html",
    title: "Support queue", crumb: "Instructor",
  });

  view.innerHTML = `
    <div class="page-head"><h1>Support queue</h1><p>Blockages from your cohorts and the ones assigned to you.</p></div>
    <section class="stat-row" id="stats"></section>
    <div class="filters">
      <div class="seg" id="seg">
        <button data-status="" class="active">All</button>
        <button data-status="open">Blocked</button>
        <button data-status="in_support">In support</button>
        <button data-status="resolved">Resolved</button>
      </div>
      <button data-backup="1" class="btn-mini backup-chip" id="backupChip">AI needs backup</button>
      <select id="cohort"><option value="">All cohorts</option></select>
      <select id="tag"><option value="">All tags</option></select>
      <input type="search" id="search" placeholder="Search…" autocomplete="off">
      <button type="button" class="btn-mini" id="saveView">Save view</button>
      <button type="button" class="btn-mini btn-mini-danger" id="escalateOverdue">Escalate overdue</button>
    </div>
    <div class="save-view-row" id="saveViewRow" hidden>
      <input type="text" id="saveViewName" placeholder="Name this view…" autocomplete="off" maxlength="60" />
      <button type="button" class="btn btn-primary btn-sm" id="saveViewConfirm">Save</button>
      <button type="button" class="btn btn-ghost btn-sm" id="saveViewCancel">Cancel</button>
    </div>
    <div class="saved-views" id="savedViews"></div>
    <div id="grid"></div>`;

  const stats = document.getElementById("stats");
  const grid = document.getElementById("grid");
  const seg = document.getElementById("seg");
  const cohortSel = document.getElementById("cohort");
  const tagSel = document.getElementById("tag");
  const searchInput = document.getElementById("search");
  const saveViewBtn = document.getElementById("saveView");
  const savedViews = document.getElementById("savedViews");
  const escalateBtn = document.getElementById("escalateOverdue");
  const backupChip = document.getElementById("backupChip");

  // --- Read persisted filter state from the URL query string. ----------
  const params = new URLSearchParams(window.location.search);
  let statusFilter = params.get("status") || "";
  let cohortFilter = params.get("cohort") || "";
  let tagFilter = params.get("tag") || "";
  let searchQuery = params.get("q") || "";
  let backupOnly = params.get("backup") === "1";

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
    if (tagFilter) p.set("tag", tagFilter);
    if (searchQuery) p.set("q", searchQuery);
    if (backupOnly) p.set("backup", "1");
    const qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : window.location.pathname);
  }

  function updateBackupChip() {
    const backupCount = blockages.filter((b) => b.needsBackup).length;
    backupChip.textContent = `AI needs backup (${backupCount})`;
    backupChip.classList.toggle("active", backupOnly);
    backupChip.style.display = backupCount > 0 || backupOnly ? "" : "none";
  }

  // Show skeleton loaders while data loads.
  function showSkeletons() {
    // Stat skeletons.
    stats.innerHTML = Array.from({ length: 5 }, () =>
      `<div class="skel-stat"><div class="skel h-sm"></div><div class="skel h-lg"></div></div>`
    ).join("");
    // Card skeletons.
    grid.innerHTML = `<div class="blk-grid">${Array.from({ length: 6 }, () =>
      `<div class="skel-card">
        <div class="skel w-40"></div>
        <div class="skel h-title w-80"></div>
        <div class="skel w-60"></div>
        <div class="skel w-40"></div>
      </div>`
    ).join("")}</div>`;
  }

  showSkeletons();

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

  // Populate tag select.
  try {
    const { tags } = await API.get("/api/tags");
    (tags || []).forEach((t) => {
      const o = document.createElement("option");
      o.value = String(t.id);
      o.textContent = t.name;
      tagSel.appendChild(o);
    });
    // Pre-apply the persisted tag selection (only if it still exists).
    if (tagFilter && tagSel.querySelector(`option[value="${CSS.escape(tagFilter)}"]`)) {
      tagSel.value = tagFilter;
    } else {
      tagFilter = "";
    }
  } catch (_) {}

  // Fetch the queue.
  try {
    const res = await API.get("/api/blockages");
    blockages = res.blockages || [];
  } catch (e) {
    grid.innerHTML = `<div class="blk-empty">Couldn't load your queue.</div>`;
    return;
  }

  function renderStats() {
    const totals = { total: blockages.length, open: 0, in_support: 0, resolved: 0, mine: 0 };
    blockages.forEach((b) => {
      if (totals[b.status] != null) totals[b.status]++;
      if (b.assigneeId && String(b.assigneeId) === String(s.user.id)) totals.mine++;
    });
    stats.innerHTML = `
      <div class="stat"><div class="k">Total</div><div class="v">${totals.total}</div></div>
      <div class="stat is-blocked"><div class="k">Blocked</div><div class="v">${totals.open}</div></div>
      <div class="stat is-pending"><div class="k">In support</div><div class="v">${totals.in_support}</div></div>
      <div class="stat is-resolved"><div class="k">Resolved</div><div class="v">${totals.resolved}</div></div>
      <div class="stat"><div class="k">Mine</div><div class="v">${totals.mine}</div></div>`;
  }

  function tagPills(tags) {
    return (tags || [])
      .map((t) => `<span class="blk-tag">${escapeHtml(t.name)}</span>`)
      .join("");
  }

  function difficultyBadge(d) {
    const L = { low: "Low", medium: "Medium", high: "High", blocker: "Blocker" };
    if (!d || !L[d]) return "";
    const color = { low: "#5d6675", medium: "#F59F00", high: "#F59F00", blocker: "#FF5A4D" }[d];
    return `<span class="blk-id" style="border-color:${color};color:${color}">${L[d]}</span>`;
  }

  // SLA badge from whatever the card data exposes (sla object, or breached/atRisk flags).
  function slaBadge(b) {
    const sla = b.sla || b;
    const breached = sla.breached || sla.slaBreached;
    const atRisk = sla.atRisk || sla.slaAtRisk;
    if (breached) {
      return `<span class="pill pill-blocked sla-flag">${escapeHtml(
        (b.sla && b.sla.label) || "SLA breached"
      )}</span>`;
    }
    if (atRisk) {
      return `<span class="pill pill-pending sla-flag">${escapeHtml(
        (b.sla && b.sla.label) || "At risk"
      )}</span>`;
    }
    return "";
  }

  function cardHtml(b) {
    const { cls, label } = statusMeta(b.status);
    const pad = String(b.id).padStart(3, "0");
    const replies = b.commentCount || 0;
    const replyText = replies === 1 ? "1 reply" : replies + " replies";
    const sla = slaBadge(b);
    return `<article class="blk-card linkish status-${cls}${b.needsBackup ? " needs-backup" : ""}" data-id="${escapeHtml(b.id)}">
      <div class="blk-card-top">
        <span class="blk-id">BLK-${escapeHtml(pad)}</span>
        ${difficultyBadge(b.difficulty)}
        <span class="pill pill-${cls}">${escapeHtml(label)}</span>
        ${sla ? `<span class="blk-card-sla">${sla}</span>` : ""}
        ${b.needsBackup ? `<span class="pill" style="background:var(--pending);color:#fff;font-size:.68rem">AI needs backup</span>` : ""}
      </div>
      <h3>${escapeHtml(b.title)}</h3>
      <div class="who">${escapeHtml(b.studentName)} · ${escapeHtml(b.cohortName)}</div>
      ${b.tags && b.tags.length ? `<div class="blk-tags">${tagPills(b.tags)}</div>` : ""}
      <div class="blk-meta">${escapeHtml(fmtDate(b.createdAt))} · ${escapeHtml(replyText)}</div>
    </article>`;
  }

  function emptyStateHtml(hasFilters) {
    if (hasFilters) {
      return `<div class="blk-empty">
        <div class="blk-empty-icon">&#9906;</div>
        <div class="blk-empty-title">No matches</div>
        <div class="blk-empty-hint">Try adjusting your filters or search query.</div>
      </div>`;
    }
    return `<div class="blk-empty">
      <div class="blk-empty-icon">&#10003;</div>
      <div class="blk-empty-title">Your queue is clear</div>
      <div class="blk-empty-hint">No blockages right now. Check back soon or ask a student to report a new one.</div>
    </div>`;
  }

  function renderGrid() {
    const q = searchQuery.trim().toLowerCase();
    const list = blockages.filter((b) => {
      if (backupOnly && !b.needsBackup) return false;
      if (statusFilter && b.status !== statusFilter) return false;
      if (cohortFilter && String(b.cohortId) !== cohortFilter) return false;
      if (tagFilter && !(b.tags || []).some((t) => String(t.id) === tagFilter)) return false;
      if (q) {
        const hay = [b.title, b.studentName, b.cohortName]
          .map((v) => String(v == null ? "" : v).toLowerCase())
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (!list.length) {
      const hasFilters = !!(statusFilter || cohortFilter || tagFilter || q);
      grid.innerHTML = emptyStateHtml(hasFilters);
      return;
    }
    grid.innerHTML = `<div class="blk-grid">${list.map(cardHtml).join("")}</div>`;
    updateBackupChip();
  }

  backupChip.addEventListener("click", () => {
    backupOnly = !backupOnly;
    backupChip.classList.toggle("active", backupOnly);
    syncUrl();
    renderGrid();
  });

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

  tagSel.addEventListener("change", () => {
    tagFilter = tagSel.value;
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

  async function reloadQueue() {
    try {
      const res = await API.get("/api/blockages");
      blockages = res.blockages || [];
    } catch (_) {
      return;
    }
    renderStats();
    renderGrid();
  }

  // --- Saved views ------------------------------------------------------
  // Reflect the current filter state onto the UI controls (used when a saved
  // view is applied). Only apply a cohort/tag that still exists as an option.
  function applyControls() {
    if (cohortSel.querySelector(`option[value="${CSS.escape(cohortFilter)}"]`)) {
      cohortSel.value = cohortFilter;
    } else {
      cohortFilter = "";
      cohortSel.value = "";
    }
    if (tagSel.querySelector(`option[value="${CSS.escape(tagFilter)}"]`)) {
      tagSel.value = tagFilter;
    } else {
      tagFilter = "";
      tagSel.value = "";
    }
    searchInput.value = searchQuery;
    seg.querySelectorAll("button[data-status]").forEach((b) => {
      b.classList.toggle("active", (b.dataset.status || "") === statusFilter);
    });
  }

  let views = [];

  function renderViews() {
    if (!views.length) {
      savedViews.innerHTML = "";
      return;
    }
    savedViews.innerHTML = views
      .map(
        (v) =>
          `<span class="view-chip" data-id="${escapeHtml(v.id)}">` +
          `<button type="button" class="view-apply" data-id="${escapeHtml(v.id)}">${escapeHtml(v.name)}</button>` +
          `<button type="button" class="view-del" data-id="${escapeHtml(v.id)}" aria-label="Delete view">×</button>` +
          `</span>`
      )
      .join("");
  }

  async function loadViews() {
    try {
      const res = await API.get("/api/views");
      views = res.views || [];
    } catch (_) {
      views = [];
    }
    renderViews();
  }

  savedViews.addEventListener("click", async (e) => {
    const del = e.target.closest(".view-del");
    if (del) {
      try {
        await API.del(`/api/views/${encodeURIComponent(del.dataset.id)}`);
        views = views.filter((v) => String(v.id) !== del.dataset.id);
        renderViews();
        toast("View deleted.");
      } catch (_) {
        toast("Couldn't delete that view.");
      }
      return;
    }
    const apply = e.target.closest(".view-apply");
    if (!apply) return;
    const v = views.find((x) => String(x.id) === apply.dataset.id);
    if (!v) return;
    statusFilter = v.status || "";
    cohortFilter = v.cohortId != null ? String(v.cohortId) : "";
    tagFilter = v.tagId != null ? String(v.tagId) : "";
    searchQuery = v.search || "";
    applyControls();
    syncUrl();
    renderGrid();
  });

  const saveViewRow = document.getElementById("saveViewRow");
  const saveViewName = document.getElementById("saveViewName");
  const saveViewConfirm = document.getElementById("saveViewConfirm");
  const saveViewCancel = document.getElementById("saveViewCancel");

  saveViewBtn.addEventListener("click", () => {
    saveViewRow.hidden = false;
    saveViewName.value = "";
    saveViewName.focus();
  });

  saveViewCancel.addEventListener("click", () => {
    saveViewRow.hidden = true;
  });

  async function doSaveView() {
    const name = saveViewName.value.trim();
    if (!name) { saveViewName.focus(); return; }
    saveViewConfirm.disabled = true;
    try {
      const res = await API.post("/api/views", {
        name,
        status: statusFilter || undefined,
        cohortId: cohortFilter || undefined,
        tagId: tagFilter || undefined,
        search: searchQuery || undefined,
      });
      if (res && res.view) {
        views.push(res.view);
        renderViews();
        toast("View saved.");
      }
    } catch (_) {
      toast("Couldn't save that view.");
    } finally {
      saveViewConfirm.disabled = false;
      saveViewRow.hidden = true;
    }
  }

  saveViewConfirm.addEventListener("click", doSaveView);
  saveViewName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doSaveView(); }
    if (e.key === "Escape") { saveViewRow.hidden = true; }
  });

  // SLA: escalate overdue blockages, then refresh the queue.
  if (escalateBtn) {
    escalateBtn.addEventListener("click", async () => {
      const confirmed = await confirmModal(
        "Escalate all overdue blockages? This will flag them as high-priority.",
        { confirmLabel: "Escalate", danger: true }
      );
      if (!confirmed) return;
      escalateBtn.disabled = true;
      try {
        const res = await API.post("/api/sla/escalate");
        const n = (res && res.escalated) || 0;
        toast(`Escalated ${n} overdue blockages`, "success");
        await reloadQueue();
      } catch (err) {
        toast(err.message || "Couldn't escalate overdue blockages.", "error");
      } finally {
        escalateBtn.disabled = false;
      }
    });
  }

  syncUrl();
  renderStats();
  renderGrid();
  loadViews();

  // Live updates: a relevant event (new blockage, comment, resolve…) arrived on
  // the shared stream — re-fetch the queue, debounced. Filters/search/cohort
  // selection are preserved because they're read fresh inside renderGrid().
  let liveTimer = null;
  onStreamEvent("notification", () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { reloadQueue(); }, 300);
  });
})();
