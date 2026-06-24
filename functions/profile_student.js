/* Student profile — view/edit own account info, cohort, and account stats. */
(async function () {
  const s = await requireRole("student");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "profile.html",
    title: "My profile",
    crumb: "My profile",
  });

  view.innerHTML = `<div id="profile-root"><p class="thread-empty">Loading…</p></div>`;
  const el = document.getElementById("profile-root");

  let me;
  try {
    me = await API.get("/api/me");
  } catch (e) {
    el.innerHTML = `<div class="blk-empty">Couldn't load your profile.</div>`;
    return;
  }

  const u = me.user || s.user;

  el.innerHTML = `
    <div class="page-head">
      <h1>My profile</h1>
      <p>Manage your name, password, and account settings.</p>
    </div>

    <div class="panel" style="max-width:560px;margin-bottom:1.5rem">
      <h3 style="margin-bottom:1rem">Account details</h3>
      <div class="form-row">
        <label for="nameInput">Name</label>
        <input type="text" id="nameInput" value="${escapeHtml(u.name || "")}" maxlength="100" />
      </div>
      <div class="form-row">
        <label>Email</label>
        <input type="text" value="${escapeHtml(u.email || "")}" disabled style="opacity:.6;cursor:not-allowed" />
        <p class="form-hint">Email cannot be changed. Contact your instructor if this is incorrect.</p>
      </div>
      <div class="form-row">
        <label>Organization</label>
        <input type="text" value="${escapeHtml(s.org.name || "")}" disabled style="opacity:.6;cursor:not-allowed" />
      </div>
      <div class="form-row">
        <label>Cohort</label>
        <input type="text" value="${escapeHtml(u.cohortName || "No cohort assigned")}" disabled style="opacity:.6;cursor:not-allowed" />
      </div>
      <div class="form-row">
        <label>Role</label>
        <input type="text" value="Student" disabled style="opacity:.6;cursor:not-allowed" />
      </div>
      <button class="btn btn-primary" id="saveNameBtn">Save name</button>
      <span id="saveNameMsg" style="margin-left:.75rem;font-size:.88rem"></span>
    </div>

    <div class="panel" style="max-width:560px;margin-bottom:1.5rem">
      <h3 style="margin-bottom:1rem">Change password</h3>
      <div class="form-row">
        <label for="pwCurrent">Current password</label>
        <input type="password" id="pwCurrent" autocomplete="current-password" />
      </div>
      <div class="form-row">
        <label for="pwNew">New password</label>
        <input type="password" id="pwNew" autocomplete="new-password" />
      </div>
      <div class="form-row">
        <label for="pwConfirm">Confirm new password</label>
        <input type="password" id="pwConfirm" autocomplete="new-password" />
      </div>
      <button class="btn btn-primary" id="savePwBtn">Change password</button>
      <span id="savePwMsg" style="margin-left:.75rem;font-size:.88rem"></span>
    </div>

    <div class="panel" style="max-width:560px;background:var(--surface-2,#f8f9fb)">
      <h3 style="margin-bottom:.5rem">Quick links</h3>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem">
        <a class="btn btn-ghost btn-sm" href="growth.html">My growth</a>
        <a class="btn btn-ghost btn-sm" href="history.html">Full blockage history</a>
        <a class="btn btn-ghost btn-sm" href="portfolio.html">Export portfolio</a>
        <a class="btn btn-ghost btn-sm" href="notifications.html">Notifications</a>
        <a class="btn btn-ghost btn-sm" href="settings.html">Settings</a>
      </div>
    </div>`;

  document.getElementById("saveNameBtn").addEventListener("click", async () => {
    const name = document.getElementById("nameInput").value.trim();
    const msg = document.getElementById("saveNameMsg");
    if (!name) { msg.textContent = "Name cannot be empty."; msg.style.color = "var(--blocked)"; return; }
    try {
      await API.put("/api/me", { name });
      msg.textContent = "Saved.";
      msg.style.color = "var(--flow,#12B886)";
      toast("Name updated.", "success");
    } catch (e) {
      msg.textContent = e.message || "Couldn't save.";
      msg.style.color = "var(--blocked)";
    }
  });

  document.getElementById("savePwBtn").addEventListener("click", async () => {
    const current = document.getElementById("pwCurrent").value;
    const next = document.getElementById("pwNew").value;
    const confirm = document.getElementById("pwConfirm").value;
    const msg = document.getElementById("savePwMsg");
    if (!current || !next) { msg.textContent = "Fill in all fields."; msg.style.color = "var(--blocked)"; return; }
    if (next !== confirm) { msg.textContent = "Passwords don't match."; msg.style.color = "var(--blocked)"; return; }
    if (next.length < 8) { msg.textContent = "Password must be at least 8 characters."; msg.style.color = "var(--blocked)"; return; }
    try {
      await API.put("/api/me", { currentPassword: current, password: next });
      msg.textContent = "Password changed.";
      msg.style.color = "var(--flow,#12B886)";
      document.getElementById("pwCurrent").value = "";
      document.getElementById("pwNew").value = "";
      document.getElementById("pwConfirm").value = "";
      toast("Password changed.", "success");
    } catch (e) {
      msg.textContent = e.message || "Couldn't change password.";
      msg.style.color = "var(--blocked)";
    }
  });
})();
