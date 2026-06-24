/* Student full blockage history — paginated, filterable list of all own blockages. */
(async function () {
  const s = await requireRole("student");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "history.html",
    title: "My history",
    crumb: "My history",
  });

  const PAGE = 20;
  let page = 1;
  let status = "";
  let total = 0;

  view.innerHTML = `
    <div class="page-head">
      <h1>My blockage history</h1>
      <p>Every blockage you've ever reported — searchable and filterable.</p>
    </div>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem">
      <select id="statusFilter" class="input" style="width:auto;min-width:140px">
        <option value="">All statuses</option>
        <option value="open">Blocked</option>
        <option value="in_support">In support</option>
        <option value="resolved">Resolved</option>
      </select>
      <span id="totalLabel" style="font-size:.85rem;color:var(--muted)"></span>
    </div>
    <div id="list"><p class="thread-empty">Loading…</p></div>
    <div id="pagination" style="display:flex;gap:.5rem;justify-content:center;margin-top:1.5rem"></div>`;

  async function load() {
    const listEl = document.getElementById("list");
    listEl.innerHTML = `<p class="thread-empty">Loading…</p>`;
    try {
      const params = new URLSearchParams({ page, limit: PAGE });
      if (status) params.set("status", status);
      const data = await API.get(`/api/blockages?${params}`);
      const items = data.blockages || [];
      total = data.total || items.length;
      document.getElementById("totalLabel").textContent = `${total} blockage${total !== 1 ? "s" : ""} total`;

      if (!items.length) {
        listEl.innerHTML = `<div class="blk-empty">No blockages found${status ? " with that filter" : ""}.</div>`;
        document.getElementById("pagination").innerHTML = "";
        return;
      }

      listEl.innerHTML = `<div class="blk-grid">${items.map(b => {
        const m = statusMeta(b.status);
        return `<a class="blk-card linkish" href="blockage.html?id=${encodeURIComponent(b.id)}" style="text-decoration:none;color:inherit">
          <div class="blk-card-top">
            <span class="blk-id">BLK-${escapeHtml(String(b.id))}</span>
            <span class="pill pill-${m.cls}">${escapeHtml(m.label)}</span>
          </div>
          <h3>${escapeHtml(b.title)}</h3>
          <div class="blk-meta">
            Reported ${escapeHtml(fmtRelative(b.createdAt))}
            ${b.resolvedAt ? ` · resolved ${escapeHtml(fmtRelative(b.resolvedAt))}` : ""}
          </div>
        </a>`;
      }).join("")}</div>`;

      // Pagination
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
        const next = document.createElement("button");
        next.className = "btn btn-ghost btn-sm";
        next.textContent = "Next →";
        next.addEventListener("click", () => { page++; load(); });
        pagEl.appendChild(next);
      }
    } catch (e) {
      listEl.innerHTML = `<div class="blk-empty">Couldn't load history.</div>`;
    }
  }

  document.getElementById("statusFilter").addEventListener("change", function () {
    status = this.value;
    page = 1;
    load();
  });

  load();
})();
