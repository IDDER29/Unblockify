/* Check-ins page — staff view of flagged students awaiting follow-up. */

(async function () {
  const s = await requireRole("instructor", "owner");
  if (!s) return;

  const view = renderShell({
    user: s.user, org: s.org, active: "check-ins.html",
    title: "Check-ins", crumb: "Support",
  });

  view.innerHTML = `
    <div class="page-head">
      <h1>Student check-ins</h1>
      <p>Students flagged for follow-up. Resolve once you've checked in with them.</p>
    </div>
    <div class="filters">
      <div class="seg" id="seg">
        <button data-status="open" class="active">Open</button>
        <button data-status="resolved">Resolved</button>
      </div>
    </div>
    <div id="list" class="data-table-wrap"></div>`;

  const list = document.getElementById("list");
  const seg = document.getElementById("seg");
  let currentStatus = "open";

  async function load() {
    list.innerHTML = `<p class="muted" style="padding:1rem">Loading…</p>`;
    try {
      const { checkIns } = await API.get(`/api/check-ins?status=${currentStatus}`);
      if (!checkIns.length) {
        list.innerHTML = `<p class="muted" style="padding:1rem">No ${currentStatus} check-ins.</p>`;
        return;
      }
      list.innerHTML = `
        <table class="data-table">
          <thead><tr>
            <th>Student</th><th>Note</th><th>Flagged by</th>
            <th>When</th>${currentStatus === "open" ? "<th></th>" : "<th>Resolved</th>"}
          </tr></thead>
          <tbody>
            ${checkIns.map(ci => `
              <tr data-id="${ci.id}">
                <td><strong>${escapeHtml(ci.student_name)}</strong></td>
                <td>${ci.note ? escapeHtml(ci.note) : '<span class="muted">—</span>'}</td>
                <td>${escapeHtml(ci.instructor_name)}</td>
                <td class="mono">${fmtRelative(ci.created_at)}</td>
                ${currentStatus === "open"
                  ? `<td><button class="btn-mini btn-resolve" data-id="${ci.id}">Mark resolved</button></td>`
                  : `<td class="mono">${ci.resolved_at ? fmtRelative(ci.resolved_at) : "—"}</td>`
                }
              </tr>`).join("")}
          </tbody>
        </table>`;

      list.querySelectorAll(".btn-resolve").forEach(btn => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          btn.textContent = "Resolving…";
          try {
            await API.post(`/api/check-ins/${btn.dataset.id}/resolve`, {});
            toast("Check-in resolved.");
            load();
          } catch (e) {
            toast(e.message || "Failed to resolve.", "error");
            btn.disabled = false;
            btn.textContent = "Mark resolved";
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<p class="muted" style="padding:1rem">Failed to load check-ins.</p>`;
    }
  }

  seg.addEventListener("click", e => {
    const btn = e.target.closest("button[data-status]");
    if (!btn) return;
    seg.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentStatus = btn.dataset.status;
    load();
  });

  load();
})();
