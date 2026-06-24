/* Invites — owner-only dedicated invite management page. */
(async function () {
  const s = await requireRole("owner");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "invites.html",
    title: "Invites",
    crumb: "Owner / Invites",
  });

  view.innerHTML = `<div id="inv-root"><p class="thread-empty">Loading…</p></div>`;
  const el = document.getElementById("inv-root");

  let cohorts = [];
  try {
    const data = await API.get("/api/cohorts");
    cohorts = data.cohorts || [];
  } catch (_) {}

  async function load() {
    let invites = [];
    try {
      const data = await API.get("/api/invites");
      invites = data.invites || [];
    } catch (_) {}

    const active = invites.filter(i => !i.revoked);
    const revoked = invites.filter(i => i.revoked);

    el.innerHTML = `
      <div class="page-head">
        <h1>Invites</h1>
        <p>Generate invite links for instructors and students. Anyone with the link can join your workspace.</p>
      </div>

      <!-- Create new invite -->
      <div class="chart-card" style="margin-bottom:1.25rem">
        <h3>Create an invite</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:.75rem;align-items:end;flex-wrap:wrap;margin-top:.75rem">
          <div class="form-row" style="margin:0">
            <label for="invRole">Role</label>
            <select id="invRole" class="input">
              <option value="student">Student</option>
              <option value="instructor">Instructor</option>
            </select>
          </div>
          <div class="form-row" style="margin:0">
            <label for="invCohort">Cohort (optional)</label>
            <select id="invCohort" class="input">
              <option value="">No cohort</option>
              ${cohorts.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
            </select>
          </div>
          <button class="btn btn-primary" id="createInvBtn" style="height:fit-content">Create link</button>
        </div>
        <div id="newInviteResult" style="margin-top:.75rem"></div>
      </div>

      <!-- Active invites -->
      <div class="chart-card" style="margin-bottom:1.25rem">
        <h3>Active invites</h3>
        ${active.length ? `
        <div style="overflow-x:auto;margin-top:.75rem">
          <table style="width:100%;border-collapse:collapse;font-size:.9rem">
            <thead>
              <tr style="border-bottom:2px solid var(--line);text-align:left">
                <th style="padding:.5rem .75rem">Role</th>
                <th style="padding:.5rem .75rem">Cohort</th>
                <th style="padding:.5rem .75rem">Link</th>
                <th style="padding:.5rem .75rem">Created</th>
                <th style="padding:.5rem .75rem"></th>
              </tr>
            </thead>
            <tbody id="activeBody">
              ${active.map(inv => `
                <tr style="border-bottom:1px solid var(--line)" id="inv-row-${inv.id}">
                  <td style="padding:.5rem .75rem"><span class="pill pill-${inv.role === "instructor" ? "pending" : "resolved"}" style="font-size:.75rem">${escapeHtml(inv.role)}</span></td>
                  <td style="padding:.5rem .75rem;color:var(--muted)">${escapeHtml(inv.cohort_name || "—")}</td>
                  <td style="padding:.5rem .75rem;font-family:var(--font-mono),monospace;font-size:.78rem">
                    <span style="max-width:220px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle">${escapeHtml(location.origin + (inv.url || "/join.html?code=" + inv.code))}</span>
                    <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText('${escapeHtml(location.origin + (inv.url || "/join.html?code=" + inv.code))}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)" style="margin-left:.25rem">Copy</button>
                  </td>
                  <td style="padding:.5rem .75rem;color:var(--muted)">${escapeHtml(fmtRelative(inv.created_at))}</td>
                  <td style="padding:.5rem .75rem">
                    <button class="btn btn-ghost btn-sm revoke-btn" data-id="${inv.id}">Revoke</button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>` : `<p class="muted" style="margin-top:.5rem">No active invites. Create one above.</p>`}
      </div>

      ${revoked.length ? `
      <div class="chart-card" style="opacity:.6">
        <h3>Revoked invites (${revoked.length})</h3>
        <p class="muted" style="font-size:.85rem;margin-top:.5rem">These links no longer work.</p>
      </div>` : ""}`;

    // Wire create
    document.getElementById("createInvBtn").addEventListener("click", async () => {
      const role = document.getElementById("invRole").value;
      const cohortId = document.getElementById("invCohort").value || null;
      const result = document.getElementById("newInviteResult");
      try {
        const res = await API.post("/api/invites", { role, cohortId });
        const inv = res.invite || res;
        const url = location.origin + (inv.url || "/join.html?code=" + inv.code);
        result.innerHTML = `
          <div style="background:var(--surface-2);border-radius:8px;padding:.75rem 1rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
            <span style="font-family:var(--font-mono),monospace;font-size:.82rem;flex:1;word-break:break-all">${escapeHtml(url)}</span>
            <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText('${escapeHtml(url)}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy link',1500)">Copy link</button>
          </div>`;
        toast("Invite created.", "success");
        await load();
      } catch (e) { toast(e.message || "Couldn't create invite.", "error"); }
    });

    // Wire revoke buttons
    document.querySelectorAll(".revoke-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        try {
          await API.del(`/api/invites/${id}`);
          toast("Invite revoked.", "success");
          await load();
        } catch (e) { toast(e.message || "Couldn't revoke.", "error"); }
      });
    });
  }

  load();
})();
