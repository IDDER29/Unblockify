/* Ops & trust — owner only. Audit log, GDPR data export, right to erasure. */

(async function () {
  const s = await requireRole("owner");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "ops.html",
    title: "Ops & trust",
    crumb: "Owner",
  });

  view.innerHTML = `
    <div class="page-head">
      <h1>Ops &amp; trust</h1>
      <p>Audit trail, data portability, and the right to erasure for ${escapeHtml(s.org.name)}.</p>
    </div>

    <section class="panel" style="margin-bottom:2rem">
      <h3 style="margin:0 0 .8rem">SLA &amp; business hours</h3>
      <p style="margin:0 0 1rem;color:var(--muted)">Overdue blockages are flagged and can be escalated from the instructor queue.</p>
      <form id="slaForm" style="margin:0">
        <div style="display:flex;flex-wrap:wrap;gap:.8rem">
          <div class="form-row" style="margin:0">
            <label for="slaResponseHours">Response target (hours)</label>
            <input type="number" id="slaResponseHours" min="0" step="1" />
          </div>
          <div class="form-row" style="margin:0">
            <label for="slaResolveHours">Resolve target (hours)</label>
            <input type="number" id="slaResolveHours" min="0" step="1" />
          </div>
          <div class="form-row" style="margin:0">
            <label for="slaBhStart">Business hours start (0&ndash;23)</label>
            <input type="number" id="slaBhStart" min="0" max="23" step="1" />
          </div>
          <div class="form-row" style="margin:0">
            <label for="slaBhEnd">Business hours end (1&ndash;24)</label>
            <input type="number" id="slaBhEnd" min="1" max="24" step="1" />
          </div>
        </div>
        <div class="form-row" style="margin:.8rem 0 0">
          <label>Business days</label>
          <div id="slaDays" style="display:flex;flex-wrap:wrap;gap:1rem;margin-top:.4rem"></div>
        </div>
        <button class="btn btn-primary" type="submit" id="slaSaveBtn" style="margin-top:1rem">Save SLA</button>
      </form>
    </section>

    <section class="panel" style="margin-bottom:2rem">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem">
        <h3 style="margin:0">Audit log</h3>
        <a class="btn btn-ghost" href="/api/audit/export.csv" download>Export CSV</a>
      </div>
      <div id="auditWrap"></div>
      <div id="auditMore" style="margin-top:1rem;text-align:center"></div>
    </section>

    <section class="panel" style="margin-bottom:2rem">
      <h3 style="margin:0 0 .8rem">Data export (GDPR)</h3>
      <p style="margin:0 0 1rem;color:var(--muted)">Download portable JSON copies of your organization's data.</p>
      <div style="display:flex;flex-wrap:wrap;gap:.8rem;align-items:flex-end">
        <a class="btn btn-primary" href="/api/export/org.json" download>Export org data</a>
        <form id="userExportForm" style="display:flex;gap:.6rem;align-items:flex-end;margin:0">
          <div class="form-row" style="margin:0">
            <label for="exportUserId">Export a single user</label>
            <input type="text" id="exportUserId" placeholder="User id" />
          </div>
          <button class="btn btn-ghost" type="submit">Export user data</button>
        </form>
      </div>
    </section>

    <section class="panel">
      <h3 style="margin:0 0 .8rem">Right to erasure</h3>
      <p style="margin:0 0 1rem;color:var(--muted)">Permanently erase a user's data. This action cannot be undone.</p>
      <form id="eraseForm" style="display:flex;gap:.6rem;align-items:flex-end;margin:0">
        <div class="form-row" style="margin:0">
          <label for="eraseUserId">User id</label>
          <input type="text" id="eraseUserId" placeholder="User id" />
        </div>
        <button class="btn btn-ghost" type="submit" id="eraseBtn">Delete user data</button>
      </form>
    </section>`;

  // ----- SLA & business hours -----
  // Weekday checkboxes: label -> weekday number (0=Sun..6=Sat), Mon-Sun order.
  const SLA_DAYS = [
    ["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4],
    ["Fri", 5], ["Sat", 6], ["Sun", 0],
  ];
  const slaDaysEl = document.getElementById("slaDays");
  slaDaysEl.innerHTML = SLA_DAYS.map(
    ([label, num]) =>
      `<label class="row-select" style="display:inline-flex;align-items:center;gap:.4rem;margin:0">
         <input type="checkbox" class="slaDay" value="${num}" /> ${escapeHtml(label)}
       </label>`
  ).join("");

  async function loadSla() {
    let data;
    try {
      data = await API.get("/api/sla");
    } catch (_) {
      toast("Couldn't load SLA settings.", "error");
      return;
    }
    const sla = (data && data.sla) || {};
    document.getElementById("slaResponseHours").value = sla.responseHours != null ? sla.responseHours : "";
    document.getElementById("slaResolveHours").value = sla.resolveHours != null ? sla.resolveHours : "";
    document.getElementById("slaBhStart").value = sla.bhStart != null ? sla.bhStart : "";
    document.getElementById("slaBhEnd").value = sla.bhEnd != null ? sla.bhEnd : "";
    const days = Array.isArray(sla.bhDays) ? sla.bhDays.map(Number) : [];
    slaDaysEl.querySelectorAll(".slaDay").forEach((cb) => {
      cb.checked = days.includes(Number(cb.value));
    });
  }

  document.getElementById("slaForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const bhDays = Array.from(slaDaysEl.querySelectorAll(".slaDay"))
      .filter((cb) => cb.checked)
      .map((cb) => Number(cb.value));
    const payload = {
      responseHours: Number(document.getElementById("slaResponseHours").value),
      resolveHours: Number(document.getElementById("slaResolveHours").value),
      bhStart: Number(document.getElementById("slaBhStart").value),
      bhEnd: Number(document.getElementById("slaBhEnd").value),
      bhDays,
    };
    const btn = document.getElementById("slaSaveBtn");
    btn.disabled = true;
    try {
      await API.put("/api/sla", payload);
      toast("SLA saved.", "success");
    } catch (err) {
      toast(err.message || "Couldn't save SLA.", "error");
    } finally {
      btn.disabled = false;
    }
  });

  const auditWrap = document.getElementById("auditWrap");
  const auditMore = document.getElementById("auditMore");

  // ----- audit log -----
  const PAGE = 25;
  let offset = 0;
  let total = 0;

  function rowHtml(e) {
    const target = e.targetType
      ? `${escapeHtml(e.targetType)}${e.targetId != null && e.targetId !== "" ? " · " + escapeHtml(e.targetId) : ""}`
      : "&mdash;";
    return `
      <tr>
        <td title="${escapeHtml(e.createdAt)}">${escapeHtml(fmtRelative(e.createdAt))}</td>
        <td>${escapeHtml(e.action)}</td>
        <td>${escapeHtml(e.actor)}</td>
        <td>${target}</td>
        <td>${e.ip ? escapeHtml(e.ip) : "&mdash;"}</td>
      </tr>`;
  }

  function tableShell(bodyRows) {
    return `
      <table class="data-table">
        <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Target</th><th>IP</th></tr></thead>
        <tbody id="auditBody">${bodyRows}</tbody>
      </table>`;
  }

  function renderMore() {
    if (offset < total) {
      auditMore.innerHTML = `<button class="btn btn-ghost" type="button" id="loadMoreBtn">Load more (${escapeHtml(String(total - offset))} left)</button>`;
    } else {
      auditMore.innerHTML = "";
    }
  }

  async function loadAudit(append) {
    let data;
    try {
      data = await API.get(`/api/audit?limit=${PAGE}&offset=${offset}`);
    } catch (_) {
      if (!append) auditWrap.innerHTML = `<div class="blk-empty">Couldn't load the audit log.</div>`;
      return;
    }
    const entries = data.entries || [];
    total = Number(data.total) || 0;
    offset += entries.length;

    if (append) {
      const body = document.getElementById("auditBody");
      if (body) body.insertAdjacentHTML("beforeend", entries.map(rowHtml).join(""));
    } else if (!entries.length) {
      auditWrap.innerHTML = `<div class="blk-empty">No audit entries yet.</div>`;
    } else {
      auditWrap.innerHTML = tableShell(entries.map(rowHtml).join(""));
    }
    renderMore();
  }

  auditMore.addEventListener("click", async (e) => {
    const btn = e.target.closest("#loadMoreBtn");
    if (!btn) return;
    btn.disabled = true;
    await loadAudit(true);
  });

  // ----- single-user export -----
  document.getElementById("userExportForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("exportUserId").value.trim();
    if (!id) { toast("Enter a user id to export.", "error"); return; }
    window.location.href = "/api/export/users/" + encodeURIComponent(id) + ".json";
  });

  // ----- right to erasure -----
  document.getElementById("eraseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("eraseUserId");
    const id = input.value.trim();
    if (!id) { toast("Enter a user id to erase.", "error"); return; }
    if (!await confirmModal("Permanently erase this user's data? This can't be undone.", { confirmLabel: "Erase data", danger: true })) return;
    const btn = document.getElementById("eraseBtn");
    btn.disabled = true;
    try {
      await API.del("/api/users/" + encodeURIComponent(id) + "/data");
      toast("User data erased.", "success");
      input.value = "";
      // Refresh the audit log to surface the erasure event.
      offset = 0;
      await loadAudit(false);
    } catch (err) {
      toast(err.message || "Couldn't erase user data.", "error");
    } finally {
      btn.disabled = false;
    }
  });

  await loadSla();
  await loadAudit(false);
})();
