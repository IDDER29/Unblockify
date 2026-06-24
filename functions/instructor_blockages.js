/* Instructor full blockage list — all blockages across assigned cohorts, paginated. */
(async function () {
  const s = await requireRole("instructor", "owner");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "instructor_blockages.html",
    title: "All blockages",
    crumb: "All blockages",
  });

  const PAGE = 25;
  let page = 1;
  let status = "";
  let total = 0;

  view.innerHTML = `
    <div class="page-head">
      <h1>All blockages</h1>
      <p>Full paginated view of every blockage across your cohorts — not just the live queue.</p>
    </div>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem">
      <select id="statusFilter" class="input" style="width:auto">
        <option value="">All statuses</option>
        <option value="open">Blocked</option>
        <option value="in_support">In support</option>
        <option value="resolved">Resolved</option>
      </select>
      <span id="totalLabel" style="font-size:.85rem;color:var(--muted)"></span>
    </div>
    <div id="blk-list"></div>
    <div id="pagination" style="display:flex;gap:.5rem;justify-content:center;margin-top:1.5rem"></div>`;

  async function load() {
    const el = document.getElementById("blk-list");
    el.innerHTML = `<p class="thread-empty">Loading…</p>`;
    try {
      const params = new URLSearchParams({ page, limit: PAGE, assignee: s.user.id });
      if (status) params.set("status", status);
      // Use the instructor's cohort blockages view (all cohort blockages, not just claimed)
      const params2 = new URLSearchParams({ page, limit: PAGE });
      if (status) params2.set("status", status);
      const data = await API.get(`/api/blockages?${params2}`);
      const items = data.blockages || [];
      total = data.total || items.length;
      document.getElementById("totalLabel").textContent = `${total} blockage${total !== 1 ? "s" : ""}`;

      if (!items.length) {
        el.innerHTML = `<div class="blk-empty">No blockages found${status ? " with that status" : ""}.</div>`;
        document.getElementById("pagination").innerHTML = "";
        return;
      }

      el.innerHTML = `<div class="blk-grid">${items.map(b => {
        const m = statusMeta(b.status);
        return `<a class="blk-card linkish" href="blockage.html?id=${encodeURIComponent(b.id)}" style="text-decoration:none;color:inherit">
          <div class="blk-card-top">
            <span class="blk-id">BLK-${escapeHtml(String(b.id))}</span>
            <span class="pill pill-${m.cls}">${escapeHtml(m.label)}</span>
          </div>
          <h3>${escapeHtml(b.title)}</h3>
          <div class="blk-meta">
            ${escapeHtml(b.studentName || b.student_name || "Anonymous")} ·
            Reported ${escapeHtml(fmtRelative(b.createdAt))}
            ${b.resolvedAt ? ` · resolved ${escapeHtml(fmtRelative(b.resolvedAt))}` : ""}
          </div>
        </a>`;
      }).join("")}</div>`;

      const totalPages = Math.ceil(total / PAGE);
      const pagEl = document.getElementById("pagination");
      if (totalPages <= 1) { pagEl.innerHTML = ""; return; }
      pagEl.innerHTML = "";
      if (page > 1) {
        const prev = document.createElement("button");
        prev.className = "btn btn-ghost btn-sm";
        prev.textContent = "← Previous";
        prev.addEventListener("click", () => { page--; load(); });
        pagEl.appendChild(prev);
      }
      const info = document.createElement("span");
      info.style.cssText = "font-size:.85rem;color:var(--muted);align-self:center";
      info.textContent = `Page ${page} of ${totalPages}`;
      pagEl.appendChild(info);
      if (page < totalPages) {
        const nxt = document.createElement("button");
        nxt.className = "btn btn-ghost btn-sm";
        nxt.textContent = "Next →";
        nxt.addEventListener("click", () => { page++; load(); });
        pagEl.appendChild(nxt);
      }
    } catch (e) {
      document.getElementById("blk-list").innerHTML = `<div class="blk-empty">Couldn't load blockages.</div>`;
    }
  }

  document.getElementById("statusFilter").addEventListener("change", function () {
    status = this.value; page = 1; load();
  });

  load();
})();
