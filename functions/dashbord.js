/* Student "My blockages" board — talks to the API via the shared runtime. */

(async function () {
  const s = await requireRole("student");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "student_dashbord.html",
    title: "My blockages",
    crumb: "Student",
    actions: '<button class="btn btn-primary" id="newBtn">+ New blockage</button>',
  });

  view.innerHTML = `
    <div class="page-head">
      <h1>Welcome back, ${escapeHtml(s.user.name)}</h1>
      <p>Everything you've reported and where it stands.</p>
    </div>
    <section class="stat-row">
      <div class="stat"><div class="k">Total</div><div class="v" data-stat="total">0</div></div>
      <div class="stat is-blocked"><div class="k">Blocked</div><div class="v" data-stat="open">0</div></div>
      <div class="stat is-pending"><div class="k">In support</div><div class="v" data-stat="in_support">0</div></div>
      <div class="stat is-resolved"><div class="k">Resolved</div><div class="v" data-stat="resolved">0</div></div>
    </section>
    <div class="filters">
      <input type="search" id="search" placeholder="Search…" autocomplete="off">
    </div>
    <div class="board-tabs" id="boardTabs"></div>
    <div class="board" id="board"></div>`;
  view.classList.add("board-page");
  // Mobile sticky CTA (outside #view so it doesn't scroll with content)
  if (!document.getElementById("boardMobileCta")) {
    const cta = document.createElement("div");
    cta.className = "board-mobile-cta";
    cta.id = "boardMobileCta";
    cta.innerHTML = '<button class="btn btn-primary" id="mobileStickyNew">I\'m stuck</button>';
    document.body.appendChild(cta);
  }

  const board = document.getElementById("board");
  const searchInput = document.getElementById("search");

  // --- Persisted search state (URL ?q=) --------------------------------
  let searchQuery = new URLSearchParams(window.location.search).get("q") || "";
  searchInput.value = searchQuery;
  let allBlockages = [];
  let _mobileActiveCol = "open";

  function syncUrl() {
    const p = new URLSearchParams(window.location.search);
    if (searchQuery) p.set("q", searchQuery);
    else p.delete("q");
    const qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : window.location.pathname);
  }

  // --- Card / column rendering ----------------------------------------
  const COLS = [
    { status: "open", cls: "col-blocked", label: "Blocked" },
    { status: "in_support", cls: "col-pending", label: "In support" },
    { status: "resolved", cls: "col-resolved", label: "Resolved" },
  ];

  function difficultyBadge(d) {
    const L = { low: "Low", medium: "Medium", high: "High", blocker: "Blocker" };
    if (!d || !L[d]) return "";
    const color = { low: "#5d6675", medium: "#F59F00", high: "#F59F00", blocker: "#FF5A4D" }[d];
    return `<span class="blk-id" style="border-color:${color};color:${color}">${L[d]}</span>`;
  }

  function cardHtml(b) {
    const { cls, label } = statusMeta(b.status);
    const replies = b.commentCount || 0;
    return `<article class="blk-card linkish status-${cls}" data-id="${b.id}">
      <div class="blk-card-top">
        <span class="blk-id">BLK-${String(b.id).padStart(3, "0")}</span>
        ${difficultyBadge(b.difficulty)}
        <span class="pill pill-${cls}">${label}</span>
      </div>
      <h3>${escapeHtml(b.title)}</h3>
      <div class="blk-meta">${escapeHtml(fmtDate(b.createdAt))} · ${replies} ${replies === 1 ? "reply" : "replies"}</div>
    </article>`;
  }

  function render(blockages) {
    // Stat tiles always reflect the full (unfiltered) set.
    const allCounts = { open: 0, in_support: 0, resolved: 0 };
    blockages.forEach((b) => {
      if (allCounts[b.status] === undefined) allCounts[b.status] = 0;
      allCounts[b.status]++;
    });

    const total = blockages.length;
    const stats = { total, open: allCounts.open, in_support: allCounts.in_support, resolved: allCounts.resolved };
    document.querySelectorAll(“[data-stat]”).forEach((el) => {
      el.textContent = stats[el.dataset.stat] != null ? stats[el.dataset.stat] : 0;
    });

    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? blockages.filter((b) => String(b.title == null ? “” : b.title).toLowerCase().includes(q))
      : blockages;

    if (q && !filtered.length) {
      board.innerHTML = `<div class=”blk-empty”>No matches for “${escapeHtml(searchQuery.trim())}”. <button class=”btn btn-ghost” onclick=”document.getElementById('search').value='';document.getElementById('search').dispatchEvent(new Event('input'))”>Clear search</button></div>`;
      return;
    }

    // Mobile tab bar — per-filtered counts
    const counts = { open: 0, in_support: 0, resolved: 0 };
    filtered.forEach((b) => { if (counts[b.status] != null) counts[b.status]++; });
    const activeMobileCol = _mobileActiveCol || "open";

    const tabsContainer = document.getElementById("boardTabs");
    if (tabsContainer) {
      tabsContainer.innerHTML = COLS.map((col) =>
        `<button class="board-tab${activeMobileCol === col.status ? " t-active" : ""}" data-col="${col.status}">
          ${col.label}<span class="tab-n">${counts[col.status]}</span>
        </button>`
      ).join("");
    }

    board.innerHTML = COLS.map((col) => {
      const cards = filtered.filter((b) => b.status === col.status);
      const emptyStates = {
        open: { icon: "🎯", strong: "Nothing blocked", sub: "Keep building. When you hit a wall, this is where you clear it." },
        in_support: { icon: "💬", strong: "Nothing in support", sub: "Blockages you report get picked up by your instructor here." },
        resolved: { icon: "✓", strong: "Cleared blockers land here", sub: "Every resolved blockage adds to your momentum score." },
      };
      const es = emptyStates[col.status];
      const body = cards.length
        ? cards.map(cardHtml).join("")
        : `<div class="col-empty"><span class="col-empty-icon">${es.icon}</span><strong>${es.strong}</strong>${es.sub}</div>`;
      const isActive = activeMobileCol === col.status;
      return `<div class="board-col ${col.cls}${isActive ? " t-active" : ""}">
        <div class="board-col-head"><span class="t">${col.label}</span><span class="c">${cards.length}</span></div>
        ${body}
      </div>`;
    }).join("");
  }

  function renderSkeleton() {
    const skel3 = (n) => Array.from({length: n}, () =>
      `<div class="skel-card"><div class="skel w-40"></div><div class="skel w-80 h-title"></div><div class="skel w-60"></div></div>`
    ).join("");
    board.innerHTML = `
      <div class="board-col col-blocked"><div class="board-col-head"><span class="t">Blocked</span><span class="c">—</span></div>${skel3(2)}</div>
      <div class="board-col col-pending"><div class="board-col-head"><span class="t">In support</span><span class="c">—</span></div>${skel3(1)}</div>
      <div class="board-col col-resolved"><div class="board-col-head"><span class="t">Resolved</span><span class="c">—</span></div>${skel3(2)}</div>`;
  }

  async function refresh() {
    renderSkeleton();
    const { blockages } = await API.get("/api/blockages");
    allBlockages = blockages || [];
    render(allBlockages);
  }

  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      syncUrl();
      render(allBlockages);
    }, 150);
  });

  // Card click -> blockage detail page
  board.addEventListener("click", (e) => {
    const card = e.target.closest(".blk-card[data-id]");
    if (!card) return;
    window.location.href = "blockage.html?id=" + card.dataset.id;
  });

  // Mobile tab switching
  const boardTabsEl = document.getElementById("boardTabs");
  if (boardTabsEl) {
    boardTabsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".board-tab[data-col]");
      if (!btn) return;
      _mobileActiveCol = btn.dataset.col;
      render(allBlockages);
    });
  }

  // --- New blockage modal ---------------------------------------------
  const modal = document.getElementById("newModal");
  const form = document.getElementById("newForm");
  const fields = document.getElementById("newFields");
  const briefSelect = document.getElementById("briefSelect");
  const newBtn = document.getElementById("newBtn");
  let cohort = null; // {id, name}

  // Upgrade the free-text difficulty input to a structured <select> whose
  // values match the labels the blockage detail page knows (low/medium/high/
  // blocker). Done in JS (this file owns the change); keeps id="difficulty"
  // and name="difficulty" so the submit handler reads .value unchanged.
  (function structuredDifficulty() {
    const old = document.getElementById("difficulty");
    if (!old || old.tagName === "SELECT") return;
    const select = document.createElement("select");
    select.id = "difficulty";
    select.name = "difficulty";
    select.innerHTML =
      '<option value="">— not sure —</option>' +
      '<option value="low">Low</option>' +
      '<option value="medium">Medium</option>' +
      '<option value="high">High</option>' +
      '<option value="blocker">Blocker</option>';
    old.replaceWith(select);
  })();

  // Label the dialog by its heading and give the icon-only close button a name.
  const modalHeading = modal.querySelector(".header h1");
  if (modalHeading && !modalHeading.id) modalHeading.id = "newModalTitle";
  const closeBtn = document.getElementById("newClose");
  if (closeBtn && !closeBtn.getAttribute("aria-label")) closeBtn.setAttribute("aria-label", "Close");

  function showModal() {
    openModal(modal, { labelledby: modalHeading ? modalHeading.id : undefined });
  }
  function hideModal() {
    closeModal(modal);
  }

  if (newBtn) newBtn.addEventListener("click", showModal);
  if (closeBtn) closeBtn.addEventListener("click", hideModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) hideModal();
  });

  // Load the student's cohort + its briefs to populate the form.
  async function loadCohort() {
    try {
      const { cohorts } = await API.get("/api/cohorts");
      cohort = (cohorts && cohorts[0]) || null;
      if (!cohort) {
        fields.innerHTML = `<p>You're not in a cohort yet — ask your instructor for an invite.</p>`;
        return;
      }
      let briefs = [];
      try {
        const data = await API.get("/api/cohorts/" + cohort.id);
        briefs = (data && data.cohort && data.cohort.briefs) || [];
      } catch (_) {}
      briefSelect.innerHTML =
        `<option value="">— none —</option>` +
        briefs
          .map((br) => `<option value="${br.id}">${escapeHtml(br.name)}</option>`)
          .join("");
    } catch (_) {
      fields.innerHTML = `<p>You're not in a cohort yet — ask your instructor for an invite.</p>`;
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!cohort) {
      toast("You're not in a cohort yet.", "error");
      return;
    }
    const title = form.querySelector("#title").value.trim();
    const details = form.querySelector("#details").value.trim();
    const difficulty = form.querySelector("#difficulty").value.trim();
    const briefId = form.querySelector("#briefSelect").value;

    const payload = { title, cohortId: cohort.id, difficulty, details };
    if (briefId) payload.briefId = Number(briefId);

    // Upload any chosen files first, then send their ids with the report.
    const fileInput = form.querySelector("#reportFiles");
    if (fileInput && fileInput.files.length) {
      const ids = [];
      for (const file of Array.from(fileInput.files)) {
        try {
          const att = await uploadAttachment(file);
          ids.push(att.id);
        } catch (err) {
          toast(err.message || "Couldn't attach a file.", "error");
        }
      }
      if (ids.length) payload.attachmentIds = ids;
    }

    try {
      await API.post("/api/blockages", payload);
      hideModal();
      form.reset();
      await refresh();
      toast("Blockage reported.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  // --- Boot ------------------------------------------------------------
  try {
    await refresh();
  } catch (_) {
    board.innerHTML = `<div class="blk-empty">
      <p>Couldn't load your blockages. Check your connection and try again.</p>
      <button class="btn btn-ghost" onclick="location.reload()">Retry</button>
    </div>`;
  }
  loadCohort();

  // Live updates: a relevant event (claim, AI reply, resolve, comment…) arrived
  // on the shared stream — re-fetch the board, debounced.
  let liveTimer = null;
  onStreamEvent("notification", () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { refresh().catch(() => {}); }, 300);
  });

  // Wire mobile sticky CTA
  const _mSticky = document.getElementById("mobileStickyNew");
  if (_mSticky) _mSticky.addEventListener("click", showModal);
})();
