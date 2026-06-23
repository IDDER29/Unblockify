/* Student "My blockages" board — talks to the API via the shared runtime.
   Reframed around momentum (your own progress) and pull (you're not alone),
   not just a status tracker. All figures are computed from the student's real
   blockages; the "solved before" social proof comes from /blockages/similar. */

(async function () {
  const s = await requireRole("student");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "student_dashbord.html",
    title: "My blockages",
    crumb: "Student",
    actions: '<button class="btn btn-primary" id="newBtn">I\'m stuck</button>',
  });

  view.innerHTML = `
    <div class="page-head">
      <h1>Welcome back, ${escapeHtml(s.user.name)}</h1>
      <p id="momentumLine">Loading your momentum…</p>
    </div>
    <section id="momentum"></section>
    <div class="filters">
      <input type="search" id="search" placeholder="Search…" autocomplete="off">
    </div>
    <div class="board-tabs" id="boardTabs"></div>
    <div class="board" id="board"></div>`;
  view.classList.add("board-page");

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

  // --- Momentum (the student's own progress, from real data) -----------
  function fmtDur(h) {
    if (h == null) return "—";
    if (h < 1) return "<1h";
    if (h < 48) return Math.round(h) + "h";
    return Math.round(h / 24) + "d";
  }
  function durationHours(b) {
    const c = parseDate(b.createdAt), r = parseDate(b.resolvedAt);
    return c && r ? (r - c) / 3600000 : null;
  }
  function median(nums) {
    const s2 = nums.filter((x) => x != null && x >= 0).sort((a, b) => a - b);
    return s2.length ? s2[Math.floor((s2.length - 1) / 2)] : null;
  }
  function computeMomentum(list) {
    const resolved = list.filter((b) => b.status === "resolved");
    const active = list.filter((b) => b.status === "open" || b.status === "in_support");
    const self = resolved.filter((b) => b.resolutionType === "ai");
    const selfRate = resolved.length ? Math.round((self.length / resolved.length) * 100) : 0;
    const med = median(resolved.map(durationHours));

    // Trend: are recent unblocks faster than earlier ones? Only claim it with
    // enough resolved history and a real (>=10%) improvement — never invent one.
    let trend = null;
    if (resolved.length >= 4) {
      const chron = resolved
        .filter((b) => parseDate(b.resolvedAt))
        .sort((a, b) => parseDate(a.resolvedAt) - parseDate(b.resolvedAt));
      const half = Math.floor(chron.length / 2);
      const early = median(chron.slice(0, half).map(durationHours));
      const late = median(chron.slice(half).map(durationHours));
      if (early != null && late != null && early > 0 && late < early) {
        const pct = Math.round((1 - late / early) * 100);
        if (pct >= 10) trend = pct;
      }
    }
    return { total: list.length, resolved: resolved.length, active: active.length, selfRate, median: med, trend };
  }

  function renderMomentum(list) {
    const m = computeMomentum(list);
    const line = document.getElementById("momentumLine");
    const slot = document.getElementById("momentum");

    if (m.total === 0) {
      if (line) line.textContent =
        "Stuck on something? You're in the right place — reporting a blocker is how you get moving. No judgment, ever.";
      slot.innerHTML = `
        <section class="momentum first">
          <div class="momentum-lead">
            <div class="momentum-k">Your momentum</div>
            <div class="momentum-head">No blockers yet. When you hit a wall, this is where you get unblocked — fast, and in private.</div>
            <p class="momentum-note">Most students who ask for help finish. The ones who stay stuck in silence don't. Be the first kind.</p>
          </div>
          <button class="btn btn-primary" id="momentumNew">I'm stuck</button>
        </section>`;
      const mn = document.getElementById("momentumNew");
      if (mn) mn.addEventListener("click", showModal);
      return;
    }

    if (line) {
      line.textContent = m.resolved
        ? `You've cleared ${m.resolved} blocker${m.resolved === 1 ? "" : "s"}` +
          (m.selfRate ? ` and figured out ${m.selfRate}% of them yourself` : "") + ". Keep the signal going."
        : `${m.active} in progress. Every blocker you clear makes the next one faster.`;
    }
    const trendChip = m.trend
      ? `<div class="momentum-trend">⚡ ${m.trend}% faster than when you started</div>` : "";
    slot.innerHTML = `
      <section class="momentum">
        <div class="momentum-lead">
          <div class="momentum-k">Your momentum</div>
          <div class="momentum-figs">
            <div><span class="f">${m.resolved}</span><span class="l">Unblocked</span></div>
            <div><span class="f">${m.selfRate}%</span><span class="l">You solved yourself</span></div>
            <div><span class="f">${fmtDur(m.median)}</span><span class="l">Typical unblock</span></div>
            <div><span class="f">${m.active}</span><span class="l">In progress</span></div>
          </div>
          ${trendChip}
        </div>
      </section>`;
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
    const selfTag = b.status === "resolved" && b.resolutionType === "ai"
      ? '<span class="self-solve" title="You marked this solved yourself">✓ self-solved</span>' : "";
    return `<article class="blk-card linkish status-${cls}" data-id="${b.id}">
      <div class="blk-card-top">
        <span class="blk-id">BLK-${String(b.id).padStart(3, "0")}</span>
        ${difficultyBadge(b.difficulty)}
        <span class="pill pill-${cls}">${label}</span>
      </div>
      <h3>${escapeHtml(b.title)}</h3>
      <div class="blk-meta">${escapeHtml(fmtDate(b.createdAt))} · ${replies} ${replies === 1 ? "reply" : "replies"}${selfTag}</div>
    </article>`;
  }

  function render(blockages) {
    renderMomentum(blockages);

    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? blockages.filter((b) => String(b.title == null ? "" : b.title).toLowerCase().includes(q))
      : blockages;

    if (q && !filtered.length) {
      board.innerHTML = `<div class="blk-empty">No matches for “${escapeHtml(searchQuery.trim())}”.</div>`;
      return;
    }

    // Mobile tab bar
    const counts = { open: 0, in_support: 0, resolved: 0 };
    filtered.forEach((b) => { if (counts[b.status] != null) counts[b.status]++; });
    const tabsEl = document.getElementById("boardTabs");
    if (tabsEl) {
      tabsEl.innerHTML = COLS.map((col) =>
        `<button class="board-tab${_mobileActiveCol === col.status ? " t-active" : ""}" data-col="${col.status}">
          ${col.label} <span class="tab-n">${counts[col.status]}</span>
        </button>`
      ).join("");
    }

    const EMPTY = {
      open: { icon: "🎯", strong: "Nothing blocked", sub: "Keep building. When you hit a wall, this is where you get unblocked." },
      in_support: { icon: "💬", strong: "Nothing in support", sub: "Blockages you report get picked up by your instructor here." },
      resolved: { icon: "✓", strong: "Cleared blockers land here", sub: "Every resolved blockage adds to your momentum score." },
    };

    board.innerHTML = COLS.map((col) => {
      const cards = filtered.filter((b) => b.status === col.status);
      const es = EMPTY[col.status];
      const body = cards.length
        ? cards.map(cardHtml).join("")
        : `<div class="col-empty"><span class="col-empty-icon">${es.icon}</span><strong>${es.strong}</strong>${es.sub}</div>`;
      const isActive = _mobileActiveCol === col.status;
      return `<div class="board-col ${col.cls}${isActive ? " t-active" : ""}">
        <div class="board-col-head"><span class="t">${col.label}</span><span class="c">${cards.length}</span></div>
        ${body}
      </div>`;
    }).join("");
  }

  function renderSkeleton() {
    const skelCard = () => `<div class="skel-card"><div class="skel w-40"></div><div class="skel w-80 h-title"></div><div class="skel w-60"></div></div>`;
    board.innerHTML = `
      <div class="board-col col-blocked t-active"><div class="board-col-head"><span class="t">Blocked</span><span class="c">—</span></div>${skelCard()}${skelCard()}</div>
      <div class="board-col col-pending"><div class="board-col-head"><span class="t">In support</span><span class="c">—</span></div>${skelCard()}</div>
      <div class="board-col col-resolved"><div class="board-col-head"><span class="t">Resolved</span><span class="c">—</span></div>${skelCard()}${skelCard()}</div>`;
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
  document.getElementById("boardTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".board-tab[data-col]");
    if (!btn) return;
    _mobileActiveCol = btn.dataset.col;
    render(allBlockages);
  });

  // --- New blockage modal ---------------------------------------------
  const modal = document.getElementById("newModal");
  const form = document.getElementById("newForm");
  const fields = document.getElementById("newFields");
  const briefSelect = document.getElementById("briefSelect");
  const newBtn = document.getElementById("newBtn");
  const socialProof = document.getElementById("socialProof");
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
      '<option value="low">A little stuck</option>' +
      '<option value="medium">Properly stuck</option>' +
      '<option value="high">Very stuck</option>' +
      '<option value="blocker">Totally blocked</option>';
    old.replaceWith(select);
  })();

  // Label the dialog by its heading and give the icon-only close button a name.
  const modalHeading = modal.querySelector(".header h1");
  if (modalHeading && !modalHeading.id) modalHeading.id = "newModalTitle";
  const closeBtn = document.getElementById("newClose");
  if (closeBtn && !closeBtn.getAttribute("aria-label")) closeBtn.setAttribute("aria-label", "Close");

  function clearSocialProof() {
    if (socialProof) { socialProof.hidden = true; socialProof.innerHTML = ""; }
  }
  function showModal() {
    openModal(modal, { labelledby: modalHeading ? modalHeading.id : undefined });
  }
  function hideModal() {
    closeModal(modal);
    clearSocialProof();
  }

  if (newBtn) newBtn.addEventListener("click", showModal);
  if (closeBtn) closeBtn.addEventListener("click", hideModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) hideModal();
  });

  // --- "You're not alone": surface look-alikes as the student types ----
  const titleInput = form.querySelector("#title");
  let spTimer = null, spSeq = 0;
  function renderSocialProof(data) {
    if (!socialProof) return;
    if (!data || !data.count) {
      socialProof.className = "social-proof first";
      socialProof.hidden = false;
      socialProof.innerHTML =
        `<div class="sp-head">✨ You might be the first here</div>` +
        `Nobody in your workspace has logged this yet — what you work out will help whoever hits it next.`;
      return;
    }
    const links = data.matches
      .map((m) => `<a href="blockage.html?id=${encodeURIComponent(m.id)}">${escapeHtml(m.title)}</a>`)
      .join("");
    socialProof.className = "social-proof";
    socialProof.hidden = false;
    socialProof.innerHTML =
      `<div class="sp-head">💡 ${data.count} ${data.count === 1 ? "person" : "people"} in your workspace hit something like this — and got unblocked</div>` +
      links;
  }
  if (titleInput && socialProof) {
    titleInput.addEventListener("input", () => {
      const text = titleInput.value.trim();
      clearTimeout(spTimer);
      if (text.length < 4) { clearSocialProof(); return; }
      const seq = ++spSeq;
      spTimer = setTimeout(async () => {
        try {
          const q = "/api/blockages/similar?text=" + encodeURIComponent(text) +
            (cohort && cohort.id ? "&cohortId=" + encodeURIComponent(cohort.id) : "");
          const data = await API.get(q);
          if (seq === spSeq) renderSocialProof(data);
        } catch (_) {}
      }, 350);
    });
  }

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
      clearSocialProof();
      await refresh();
      toast("You're on the board — help is on the way.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  // --- Boot ------------------------------------------------------------
  try {
    await refresh();
  } catch (_) {
    board.innerHTML = `<div class="blk-empty">Couldn't load your blockages.</div>`;
  }
  loadCohort();

  // Live updates: a relevant event (claim, AI reply, resolve, comment…) arrived
  // on the shared stream — re-fetch the board, debounced.
  let liveTimer = null;
  onStreamEvent("notification", () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { refresh().catch(() => {}); }, 300);
  });

  // Mobile sticky "I'm stuck" CTA — injected outside #view so it doesn't scroll
  if (!document.getElementById("boardMobileCta")) {
    const cta = document.createElement("div");
    cta.className = "board-mobile-cta";
    cta.id = "boardMobileCta";
    cta.innerHTML = '<button class="btn btn-primary" id="mobileStickyNew">I\'m stuck</button>';
    document.body.appendChild(cta);
    cta.querySelector("#mobileStickyNew").addEventListener("click", showModal);
  }
})();
