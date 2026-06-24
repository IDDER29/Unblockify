/* Settings / profile — editable name + password, shared across all roles. */

(async function () {
  const s = await requireRole("owner", "instructor", "student");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "settings.html",
    title: "Settings",
    crumb: ROLE_LABEL[s.user.role] + " / Settings",
  });

  const slug = s.org.slug || s.org.workspaceSlug || "";

  view.innerHTML = `
    <div class="page-head"><h1>Settings</h1><p>Your account and organization.</p></div>

    <div class="panel settings-card">
      <h2>Your profile</h2>
      <form id="profileForm">
        <div class="form-row">
          <label for="profileName">Name</label>
          <input type="text" id="profileName" value="${escapeHtml(s.user.name)}" required />
        </div>
        <div class="form-row">
          <label>Email</label>
          <input type="text" value="${escapeHtml(s.user.email)}" disabled />
          ${s.user.emailVerified ? "" : `<div class="hint"><span class="is-blocked-text">Verify your email</span> to secure your account. <button type="button" class="btn btn-ghost" id="resendVerifyBtn">Resend verification email</button></div>`}
        </div>
        <div class="form-row">
          <label>Role</label>
          <input type="text" value="${escapeHtml(ROLE_LABEL[s.user.role] || s.user.role)}" disabled />
          <div class="hint">Your role is set by your organization admin.</div>
        </div>
        <button type="submit" class="btn btn-primary" id="saveProfileBtn">Save</button>
      </form>
    </div>

    <div class="panel settings-card">
      <h2>Change password</h2>
      <form id="passwordForm">
        <div class="form-row">
          <label for="currentPassword">Current password</label>
          <input type="password" id="currentPassword" autocomplete="current-password" required />
        </div>
        <div class="form-row">
          <label for="newPassword">New password</label>
          <input type="password" id="newPassword" autocomplete="new-password" required />
        </div>
        <div class="form-row">
          <label for="confirmPassword">Confirm new password</label>
          <input type="password" id="confirmPassword" autocomplete="new-password" required />
          <div class="hint">At least 6 characters.</div>
        </div>
        <button type="submit" class="btn btn-primary" id="changePwdBtn">Change password</button>
      </form>
    </div>

    <div class="panel settings-card">
      <h2>Organization</h2>
      <div class="form-row">
        <label for="orgName">Organization</label>
        <input type="text" id="orgName" value="${escapeHtml(s.org.name)}" ${s.user.role === "owner" ? "" : "disabled"} />
        ${s.user.role === "owner" ? '<button class="btn btn-primary" id="saveOrgBtn" type="button" style="margin-top:.6rem">Save</button>' : ""}
      </div>
      <div class="form-row">
        <label>Workspace</label>
        <input type="text" value="${escapeHtml(slug)}" disabled />
        <div class="hint">Your workspace slug.</div>
      </div>
      <button class="btn btn-ghost" id="logoutBtn2">Log out</button>
    </div>
    ${s.user.role === "student" ? `
    <div class="panel settings-card" id="peerMentorCard">
      <h2>Peer mentorship</h2>
      <p style="color:var(--muted,#666);font-size:.9rem;margin-bottom:.75rem">When you enable this, students who are stuck on something you've already unblocked can see your name and what worked for you. Fully opt-in — you can turn it off any time.</p>
      <label class="form-row" style="align-items:center;gap:.75rem;cursor:pointer">
        <input type="checkbox" id="peerMentorToggle" style="width:18px;height:18px" />
        <span>I'm open to being a peer mentor</span>
      </label>
    </div>` : ""}`;

  const profileForm = view.querySelector("#profileForm");
  const passwordForm = view.querySelector("#passwordForm");

  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = profileForm.querySelector("#profileName").value.trim();
    if (!name) { toast("Name can't be empty.", "error"); return; }
    const btn = profileForm.querySelector("#saveProfileBtn");
    const origText = btn.textContent;
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const r = await API.put("/api/auth/me", { name });
      toast("Profile updated.", "success");
      if (r && r.user) {
        const nm = document.querySelector(".side-user .nm");
        if (nm) nm.textContent = r.user.name;
        const avatar = document.querySelector(".side-user .avatar");
        if (avatar) avatar.textContent = (r.user.name || "?").charAt(0).toUpperCase();
      }
    } catch (err) {
      toast(err.message || "Couldn't update profile.", "error");
    } finally {
      btn.disabled = false; btn.textContent = origText;
    }
  });

  passwordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = passwordForm.querySelector("#currentPassword").value;
    const newPassword = passwordForm.querySelector("#newPassword").value;
    const confirmPassword = passwordForm.querySelector("#confirmPassword").value;
    if (newPassword.length < 6) { toast("Password must be at least 6 characters.", "error"); return; }
    if (newPassword !== confirmPassword) { toast("New passwords don't match.", "error"); return; }
    const btn = passwordForm.querySelector("#changePwdBtn");
    const origText = btn.textContent;
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await API.put("/api/auth/me", { currentPassword, newPassword });
      toast("Password changed.", "success");
      passwordForm.reset();
    } catch (err) {
      toast(err.message || "Couldn't change password.", "error");
    } finally {
      btn.disabled = false; btn.textContent = origText;
    }
  });

  const saveOrgBtn = view.querySelector("#saveOrgBtn");
  if (saveOrgBtn) {
    saveOrgBtn.addEventListener("click", async () => {
      const input = view.querySelector("#orgName");
      const name = input.value.trim();
      if (!name) { toast("Organization name can't be empty.", "error"); return; }
      const origText = saveOrgBtn.textContent;
      saveOrgBtn.disabled = true; saveOrgBtn.textContent = "Saving…";
      try {
        const r = await API.put("/api/org", { name });
        toast("Organization renamed.", "success");
        const newName = (r && r.org && r.org.name) || name;
        input.value = newName;
        const orgEl = document.querySelector(".sidebar .side-section");
        if (orgEl) orgEl.textContent = newName;
      } catch (err) {
        toast(err.message || "Couldn't rename organization.", "error");
      } finally {
        saveOrgBtn.disabled = false; saveOrgBtn.textContent = origText;
      }
    });
  }

  const resendVerifyBtn = view.querySelector("#resendVerifyBtn");
  if (resendVerifyBtn) {
    resendVerifyBtn.addEventListener("click", async () => {
      resendVerifyBtn.disabled = true;
      try {
        await API.post("/api/auth/resend-verify");
        toast("Verification email sent.", "success");
      } catch (err) {
        toast(err.message || "Couldn't send verification email.", "error");
      } finally {
        resendVerifyBtn.disabled = false;
      }
    });
  }

  document.getElementById("logoutBtn2").addEventListener("click", logout);

  // Peer mentorship toggle (student only, T2-4)
  const peerToggle = view.querySelector("#peerMentorToggle");
  if (peerToggle) {
    // Load current state
    API.get("/api/me/peer-mentor-opt-in").then(({ optedIn }) => {
      peerToggle.checked = optedIn;
    }).catch(() => {});

    peerToggle.addEventListener("change", async () => {
      try {
        if (peerToggle.checked) {
          await API.post("/api/me/peer-mentor-opt-in", {});
          toast("You're now open to peer mentorship. 🎉", "success");
        } else {
          await API.del("/api/me/peer-mentor-opt-in");
          toast("Peer mentorship turned off.", "info");
        }
      } catch (err) {
        peerToggle.checked = !peerToggle.checked; // revert on error
        toast(err.message || "Couldn't update.", "error");
      }
    });
  }
})();
