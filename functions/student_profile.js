/* Student 360 — owner/instructor view of one student's full blockage history.
   Opened via student_profile.html?id=<userId> from members & at-risk lists. */

(async function () {
  const s = await requireRole("owner", "instructor");
  if (!s) return;
  const isOwner = s.user.role === "owner";

  const id = new URLSearchParams(location.search).get("id");

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: isOwner ? "members.html" : "instructor_queue.html",
    title: "Student",
    crumb: isOwner ? "Owner / Members" : "Instructor",
  });

  if (!id) {
    view.innerHTML = `<div class="blk-empty">No student selected.</div>`;
    return;
  }

  view.innerHTML = `<div id="profile"><p class="thread-empty">Loading…</p></div>`;
  const el = document.getElementById("profile");

  let p;
  try {
    p = await API.get(`/api/members/${encodeURIComponent(id)}/profile`);
  } catch (e) {
    el.innerHTML = `<div class="blk-empty">${
      e.status === 404
        ? "That student isn't here. They may have left, or you don't have access."
        : "Couldn't load this student."
    }</div>`;
    return;
  }

  const st = p.student;
  const stats = p.stats || {};
  const atRisk = p.atRisk || { open: 0, reasons: [] };
  const recent = p.recent || [];

  function tile(k, v) {
    return `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${v}</div></div>`;
  }

  const reasons = (atRisk.reasons || []).length
    ? `<div class="atrisk-list"><div class="atrisk-item">
        <span class="nm">Needs a human?</span>
        <span class="rs">${atRisk.reasons
          .map((t) => `<span class="atrisk-tag">${escapeHtml(t)}</span>`)
          .join("")}</span>
      </div></div>`
    : `<p class="atrisk-empty">Looking healthy — nothing flagged right now. 🎉</p>`;

  const recentHtml = recent.length
    ? `<div class="blk-grid">${recent
        .map((b) => {
          const m = statusMeta(b.status);
          return `<a class="blk-card linkish" style="text-decoration:none;color:inherit"
              href="blockage.html?id=${encodeURIComponent(b.id)}">
            <div class="blk-card-top">
              <span class="blk-id">BLK-${escapeHtml(b.id)}</span>
              <span class="pill pill-${m.cls}">${escapeHtml(m.label)}</span>
            </div>
            <h3>${escapeHtml(b.title)}</h3>
            <div class="blk-meta">Reported ${escapeHtml(fmtRelative(b.createdAt))}${
              b.resolvedAt ? ` · resolved ${escapeHtml(fmtRelative(b.resolvedAt))}` : ""
            }</div>
          </a>`;
        })
        .join("")}</div>`
    : `<div class="blk-empty">No blockages reported yet.</div>`;

  el.innerHTML = `
    <div class="page-head">
      <h1>${escapeHtml(st.name)}</h1>
      <p>${escapeHtml(st.email)}${
        st.cohortName ? ` · ${escapeHtml(st.cohortName)}` : " · no cohort"
      }</p>
    </div>

    <section class="profile-grid">
      ${tile("Total blockages", stats.total || 0)}
      ${tile("Open", `<span class="is-blocked-text">${stats.open || 0}</span>`)}
      ${tile("Resolved", stats.resolved || 0)}
      ${tile("Median time to unblock", `${stats.medianHours || 0}h`)}
      ${tile("AI vs human", `${stats.aiResolved || 0} / ${stats.humanResolved || 0}`)}
      ${tile(
        "Avg satisfaction",
        stats.csatCount
          ? `<span class="csat-inline">${csatStars(stats.avgCsat)}</span> <span class="csat-n">${stats.avgCsat}</span>`
          : "—"
      )}
    </section>

    <div class="chart-grid">
      <div class="chart-card"><h3>Needs a human?</h3>${reasons}</div>
    </div>

    <div class="chart-card">
      <h3>Recent blockages</h3>
      ${recentHtml}
    </div>

    <div class="chart-card" style="margin-top:1rem">
      <h3>Quick actions</h3>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.5rem">
        <button class="btn btn-sm" id="nudgeBtn">Send nudge</button>
        <button class="btn btn-ghost btn-sm" id="flagBtn">Flag for check-in</button>
        <a class="btn btn-ghost btn-sm" href="owner_blockages.html?student=${encodeURIComponent(id)}">View all blockages</a>
      </div>
      <div id="flagNoteRow" style="display:none;margin-top:.6rem;display:none">
        <textarea id="flagNote" rows="2" placeholder="Optional note for check-in…" style="width:100%;margin-bottom:.4rem"></textarea>
        <button class="btn btn-primary btn-sm" id="flagConfirm">Confirm flag</button>
        <button class="btn btn-ghost btn-sm" id="flagCancel">Cancel</button>
      </div>
    </div>

    <div class="chart-card" style="margin-top:1rem" id="checkInsCard">
      <h3>Check-in history</h3>
      <div id="checkInsList"><p class="muted" style="padding:.25rem 0">Loading…</p></div>
    </div>`;

  // Wire nudge
  document.getElementById("nudgeBtn").addEventListener("click", async () => {
    try {
      await API.post(`/api/students/${encodeURIComponent(id)}/nudge`, { message: "Your instructor is checking in on you." });
      toast("Nudge sent.", "success");
    } catch (e) { toast(e.message || "Couldn't send nudge.", "error"); }
  });

  // Wire flag with optional note
  const flagBtn = document.getElementById("flagBtn");
  const flagNoteRow = document.getElementById("flagNoteRow");
  const flagNote = document.getElementById("flagNote");
  flagBtn.addEventListener("click", () => { flagNoteRow.style.display = "block"; flagBtn.style.display = "none"; });
  document.getElementById("flagCancel").addEventListener("click", () => { flagNoteRow.style.display = "none"; flagBtn.style.display = ""; });
  document.getElementById("flagConfirm").addEventListener("click", async () => {
    try {
      await API.post(`/api/students/${encodeURIComponent(id)}/flag`, { note: flagNote.value.trim() });
      toast("Flagged for check-in.", "success");
      flagNoteRow.style.display = "none";
      flagBtn.style.display = "";
      flagNote.value = "";
      loadCheckIns();
    } catch (e) { toast(e.message || "Couldn't flag student.", "error"); }
  });

  // Load check-ins for this student
  async function loadCheckIns() {
    const ciList = document.getElementById("checkInsList");
    try {
      const { checkIns } = await API.get(`/api/check-ins?status=open`);
      const mine = (checkIns || []).filter(ci => String(ci.student_id) === String(id));
      if (!mine.length) {
        ciList.innerHTML = `<p class="muted" style="padding:.25rem 0">No open check-ins for this student.</p>`;
        return;
      }
      ciList.innerHTML = mine.map(ci => `
        <div style="padding:.5rem 0;border-bottom:1px solid var(--line,#eee)">
          <div style="font-size:.85rem">${ci.note ? escapeHtml(ci.note) : '<span style="color:var(--muted,#666)">No note</span>'}</div>
          <div class="blk-meta">${fmtRelative(ci.created_at)} · flagged by ${escapeHtml(ci.instructor_name)}</div>
        </div>`).join("");
    } catch (_) {
      ciList.innerHTML = `<p class="muted">Couldn't load check-ins.</p>`;
    }
  }
  loadCheckIns();
})();
