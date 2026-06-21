/* Notifications — shared across all roles. */

(async function () {
  const s = await requireRole("owner", "instructor", "student");
  if (!s) return;

  let filter = "all"; // "all" | "unread"

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: dashboardFor(s.user.role),
    title: "Notifications",
    crumb: ROLE_LABEL[s.user.role] + " / Notifications",
    actions:
      '<button class="btn btn-ghost" id="emailDigest">Email me a digest</button>' +
      '<button class="btn btn-ghost" id="readAll">Mark all read</button>' +
      '<button class="btn btn-ghost" id="clearAll">Clear all</button>',
  });

  function segHtml() {
    return `<div class="seg">
      <button data-filter="all" class="${filter === "all" ? "active" : ""}">All</button>
      <button data-filter="unread" class="${filter === "unread" ? "active" : ""}">Unread</button>
    </div>`;
  }

  function itemHtml(n) {
    return `<div class="notif-item ${n.read ? "" : "unread"}" data-id="${escapeHtml(n.id)}" data-blk="${escapeHtml(n.blockageId == null ? "" : n.blockageId)}">
      <span class="dot"></span>
      <div class="b">
        <div class="body">${escapeHtml(n.body)}</div>
        <div class="when">${escapeHtml(fmtRelative(n.createdAt))}</div>
      </div>
      <button class="btn btn-ghost notif-dismiss" data-dismiss="${escapeHtml(n.id)}" title="Dismiss" aria-label="Dismiss">✕</button>
    </div>`;
  }

  async function render() {
    let data;
    try {
      data = await API.get("/api/notifications" + (filter === "unread" ? "?unread=1" : ""));
    } catch (e) {
      view.innerHTML = `<div class="page-head"><h1>Notifications</h1></div><div class="blk-empty">Couldn't load notifications.</div>`;
      return;
    }
    const list = data.notifications || [];
    const body = list.length
      ? `<div class="notif-list">${list.map(itemHtml).join("")}</div>`
      : `<div class="blk-empty">You're all caught up.</div>`;
    view.innerHTML = `<div class="page-head"><h1>Notifications</h1><p>Updates on your blockages and activity.</p></div>${segHtml()}${body}`;
  }

  view.addEventListener("click", async (e) => {
    // Filter toggle
    const seg = e.target.closest(".seg button");
    if (seg) {
      const next = seg.dataset.filter;
      if (next !== filter) {
        filter = next;
        await render();
      }
      return;
    }

    // Dismiss a single notification
    const dismiss = e.target.closest(".notif-dismiss");
    if (dismiss) {
      const id = dismiss.dataset.dismiss;
      try {
        await API.del("/api/notifications/" + encodeURIComponent(id));
      } catch (_) {
        toast("Couldn't dismiss notification.", "error");
        return;
      }
      const row = dismiss.closest(".notif-item");
      const listEl = row ? row.parentElement : null;
      if (row) row.remove();
      if (listEl && !listEl.querySelector(".notif-item")) await render();
      refreshNotifDot();
      return;
    }

    // Body click → mark read + navigate
    const item = e.target.closest(".notif-item");
    if (!item) return;
    const id = item.dataset.id;
    const blk = item.dataset.blk;
    try {
      await API.post(`/api/notifications/${encodeURIComponent(id)}/read`);
    } catch (_) {}
    if (blk) {
      window.location.href = "blockage.html?id=" + encodeURIComponent(blk);
      return;
    }
    item.classList.remove("unread");
    if (filter === "unread") await render();
    refreshNotifDot();
  });

  document.getElementById("emailDigest").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await API.post("/api/notifications/digest");
      const count = Number(r && r.count) || 0;
      toast(count ? `Emailed ${count} update${count === 1 ? "" : "s"}.` : "You're all caught up.", "success");
    } catch (_) {
      toast("Couldn't send the digest.", "error");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("readAll").addEventListener("click", async () => {
    try {
      await API.post("/api/notifications/read-all");
    } catch (e) {
      toast("Couldn't mark all read.", "error");
      return;
    }
    await render();
    refreshNotifDot();
  });

  document.getElementById("clearAll").addEventListener("click", async () => {
    try {
      await API.del("/api/notifications");
    } catch (e) {
      toast("Couldn't clear notifications.", "error");
      return;
    }
    await render();
    refreshNotifDot();
  });

  await render();

  // Live updates: a new notification arrived on the shared stream — re-render
  // (debounced) so the list reflects it without a manual refresh.
  let liveTimer = null;
  onStreamEvent("notification", () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { render(); }, 300);
  });
})();
