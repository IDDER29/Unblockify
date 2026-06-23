/* Members & Invites — owner only. List members, manage pending invites. */

(async function () {
  const s = await requireRole("owner");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "members.html",
    title: "Members",
    crumb: "Owner",
    actions: '<button class="btn btn-primary" id="inviteBtn">Invite people</button>',
  });

  view.innerHTML = `
    <div class="page-head">
      <h1>Members &amp; invites</h1>
      <p>People in ${escapeHtml(s.org.name)}, and links waiting to be claimed.</p>
    </div>
    <section style="margin-bottom:2rem">
      <h3 style="margin:0 0 .8rem">Pending invites</h3>
      <div id="invitesWrap"></div>
    </section>
    <section>
      <h3 style="margin:0 0 .8rem">Members</h3>
      <div id="membersWrap"></div>
    </section>`;

  const invitesWrap = document.getElementById("invitesWrap");
  const membersWrap = document.getElementById("membersWrap");

  let cohortList = [];
  async function ensureCohorts() {
    if (cohortList.length) return cohortList;
    try { cohortList = (await API.get("/api/cohorts")).cohorts || []; } catch (_) {}
    return cohortList;
  }
  function cohortOptions(selectedId) {
    return ['<option value="">— none —</option>']
      .concat(cohortList.map((c) => `<option value="${c.id}" ${String(c.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(c.name)}</option>`))
      .join("");
  }
  function roleOptions(sel) {
    return ["owner", "instructor", "student"]
      .map((r) => `<option value="${r}" ${r === sel ? "selected" : ""}>${r}</option>`).join("");
  }

  // ----- link copy helper -----
  function copyFieldHtml(url) {
    const full = location.origin + url;
    return `<div class="copy-field">
      <input type="text" readonly value="${escapeHtml(full)}" />
      <button class="btn btn-ghost" type="button" data-copy="${escapeHtml(full)}">Copy</button>
    </div>`;
  }
  async function copyLink(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Invite link copied.", "success");
    } catch (_) {
      toast("Couldn't copy the link.", "error");
    }
  }

  // ----- pending invites -----
  async function loadInvites() {
    let data;
    try { data = await API.get("/api/invites"); }
    catch (_) { invitesWrap.innerHTML = `<div class="blk-empty">Couldn't load invites.</div>`; return; }

    const rows = (data.invites || []).map((inv) => `
      <tr>
        <td><span class="role-badge ${escapeHtml(inv.role)}">${escapeHtml(inv.role)}</span></td>
        <td>${inv.cohort_name ? escapeHtml(inv.cohort_name) : "&mdash;"}</td>
        <td>${copyFieldHtml(inv.url)}</td>
        <td style="text-align:right"><button class="btn btn-ghost" type="button" data-revoke="${escapeHtml(inv.id)}">Revoke</button></td>
      </tr>`).join("");

    invitesWrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Role</th><th>Cohort</th><th>Link</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4">No pending invites.</td></tr>`}</tbody>
      </table>`;
  }

  // ----- members -----
  async function loadMembers() {
    let data;
    try { data = await API.get("/api/members"); await ensureCohorts(); }
    catch (_) { membersWrap.innerHTML = `<div class="blk-empty">Couldn't load members.</div>`; return; }

    const rows = (data.members || []).map((m) => {
      const isSelf = m.id === s.user.id;
      const noCohort = m.role === "student" && !m.cohort_id;
      const roleCell = isSelf
        ? `<span class="role-badge ${escapeHtml(m.role)}">${escapeHtml(m.role)}</span>`
        : `<select class="row-select" data-role-for="${m.id}">${roleOptions(m.role)}</select>`;
      const cohortCell = m.role === "student"
        ? `<select class="row-select" data-cohort-for="${m.id}">${cohortOptions(m.cohort_id)}</select>`
        : "&mdash;";
      const nameCell = m.role === "student"
        ? `<a href="student_profile.html?id=${encodeURIComponent(m.id)}">${escapeHtml(m.name)}</a>`
        : escapeHtml(m.name);
      return `
      <tr>
        <td>${nameCell}${noCohort ? ' <span class="atrisk-tag">no cohort</span>' : ""}</td>
        <td>${escapeHtml(m.email)}</td>
        <td>${roleCell}</td>
        <td>${cohortCell}</td>
        <td>${escapeHtml(fmtDate(m.created_at))}</td>
        <td style="text-align:right">${isSelf ? '<span class="kb-id">you</span>' : `<button class="btn btn-ghost" data-makeowner="${m.id}" data-name="${escapeHtml(m.name)}">Make owner</button> <button class="btn btn-ghost" data-remove="${m.id}" data-name="${escapeHtml(m.name)}">Remove</button>`}</td>
      </tr>`;
    }).join("");

    membersWrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Cohort</th><th>Joined</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">No members yet.</td></tr>`}</tbody>
      </table>`;
  }

  // Inline edits: role / cohort change + remove
  membersWrap.addEventListener("change", async (e) => {
    const roleSel = e.target.closest("[data-role-for]");
    const cohortSel = e.target.closest("[data-cohort-for]");
    try {
      if (roleSel) {
        await API.put("/api/members/" + roleSel.dataset.roleFor, { role: roleSel.value });
        toast("Role updated.", "success");
        await loadMembers();
      } else if (cohortSel) {
        await API.put("/api/members/" + cohortSel.dataset.cohortFor, { cohortId: cohortSel.value || null });
        toast("Cohort updated.", "success");
        await loadMembers();
      }
    } catch (err) {
      toast(err.message || "Couldn't update member.", "error");
      await loadMembers();
    }
  });
  membersWrap.addEventListener("click", async (e) => {
    const mo = e.target.closest("[data-makeowner]");
    if (mo) {
      if (!await confirmModal(`Make ${mo.dataset.name} the owner? You will become an instructor.`, { confirmLabel: "Transfer ownership", danger: true })) return;
      mo.disabled = true;
      try {
        await API.post("/api/members/" + mo.dataset.makeowner + "/transfer-ownership");
        toast("Ownership transferred.", "success");
        window.location.reload();
      } catch (err) {
        mo.disabled = false;
        toast(err.message || "Couldn't transfer ownership.", "error");
      }
      return;
    }
    const rm = e.target.closest("[data-remove]");
    if (!rm) return;
    if (!await confirmModal(`Remove ${rm.dataset.name}? Their blockages will be deleted. This can't be undone.`, { confirmLabel: "Remove member", danger: true })) return;
    try {
      await API.del("/api/members/" + rm.dataset.remove);
      toast("Member removed.", "success");
      await loadMembers();
    } catch (err) {
      toast(err.message || "Couldn't remove member.", "error");
    }
  });

  // ----- delegated table actions -----
  invitesWrap.addEventListener("click", async (e) => {
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) { copyLink(copyBtn.getAttribute("data-copy")); return; }

    const revokeBtn = e.target.closest("[data-revoke]");
    if (revokeBtn) {
      revokeBtn.disabled = true;
      try {
        await API.del("/api/invites/" + encodeURIComponent(revokeBtn.getAttribute("data-revoke")));
        toast("Invite revoked.", "success");
        loadInvites();
      } catch (err) {
        revokeBtn.disabled = false;
        toast(err.message || "Couldn't revoke invite.", "error");
      }
    }
  });

  // ----- invite modal -----
  const modal = document.getElementById("inviteModal");
  const roleSel = document.getElementById("inviteRole");
  const cohortSel = document.getElementById("inviteCohort");
  const resultBox = document.getElementById("inviteResult");
  const createBtn = document.getElementById("createInviteBtn");
  const modalTitle = document.getElementById("inviteModalTitle");
  let cohortsLoaded = false;

  modalTitle.textContent = "Invite to " + s.org.name;

  function hideModal() { closeModal(modal); }
  function showModal() {
    resultBox.hidden = true;
    resultBox.innerHTML = "";
    openModal(modal, { labelledby: "inviteModalTitle" });
    if (!cohortsLoaded) loadCohorts();
  }

  async function loadCohorts() {
    await ensureCohorts();
    cohortSel.innerHTML = ['<option value="">— no cohort —</option>']
      .concat(cohortList.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`))
      .join("");
    cohortsLoaded = true;
  }

  const inviteCloseBtn = modal.querySelector("[data-close]");
  if (inviteCloseBtn && !inviteCloseBtn.getAttribute("aria-label")) inviteCloseBtn.setAttribute("aria-label", "Close");

  document.getElementById("inviteBtn").addEventListener("click", showModal);
  inviteCloseBtn.addEventListener("click", hideModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) hideModal(); });

  // result box delegation (copy the freshly created link)
  resultBox.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) copyLink(copyBtn.getAttribute("data-copy"));
  });

  createBtn.addEventListener("click", async () => {
    const body = { role: roleSel.value };
    if (cohortSel.value) body.cohortId = cohortSel.value;
    createBtn.disabled = true;
    try {
      const res = await API.post("/api/invites", body);
      const invite = res.invite || res;
      toast("Invite created.", "success");
      resultBox.hidden = false;
      resultBox.innerHTML = `<div class="form-row" style="margin-bottom:0">
        <label>Share this link</label>${copyFieldHtml(invite.url)}</div>`;
      loadInvites();
    } catch (err) {
      toast(err.message || "Couldn't create invite.", "error");
    } finally {
      createBtn.disabled = false;
    }
  });

  await Promise.all([loadInvites(), loadMembers()]);
})();
