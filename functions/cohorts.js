/* Cohorts page — owner manages cohorts (create, assign instructors, add briefs);
   instructor sees a read-only list of their assigned cohorts and briefs. */

(async function () {
  const s = await requireRole("owner", "instructor");
  if (!s) return;
  const isOwner = s.user.role === "owner";

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "cohorts.html",
    title: "Cohorts",
    crumb: isOwner ? "Owner / Cohorts" : "Instructor / Cohorts",
    actions: isOwner
      ? `<button class="btn btn-primary" id="newCohortBtn">New cohort</button>`
      : "",
  });

  view.innerHTML = `<div class="page-head"><h1>Cohorts</h1><p>${
    isOwner
      ? "Group students, route briefs, and assign instructors."
      : "The cohorts you're assigned to and their briefs."
  }</p></div><div id="cohortGrid"></div>`;

  const grid = document.getElementById("cohortGrid");

  // --- Modal helpers -------------------------------------------------
  const newCohortModal = document.getElementById("newCohortModal");
  const cohortModal = document.getElementById("cohortModal");
  const cohortModalContent = document.getElementById("cohortModalContent");

  // Label the new-cohort dialog by its (HTML) heading.
  const newCohortHeading = newCohortModal.querySelector(".modal-header h2");
  if (newCohortHeading && !newCohortHeading.id) newCohortHeading.id = "newCohortTitle";

  // Route open/close through the shared accessibility helpers (dialog
  // semantics, focus trap, Esc-to-close, focus restore). The labelledby id is
  // resolved per-modal at open time.
  function openCohortModal(el) {
    const heading = el.querySelector(".modal-header h2, .header h1, h2");
    openModal(el, { labelledby: heading && heading.id ? heading.id : undefined });
  }
  function closeCohortModal(el) { closeModal(el); }

  // Close on overlay click or any [data-close] button.
  [newCohortModal, cohortModal].forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m) closeCohortModal(m);
      const closer = e.target.closest("[data-close]");
      if (closer) closeCohortModal(document.getElementById(closer.dataset.close));
    });
  });

  // --- Grid ----------------------------------------------------------
  function cardHtml(c) {
    return `<article class="blk-card linkish" data-id="${escapeHtml(c.id)}">
      <div class="blk-card-top">
        <span class="blk-id">${escapeHtml(c.students)} students</span>
        <span class="pill pill-pending">${escapeHtml(c.openBlockages)} open</span>
      </div>
      <h3>${escapeHtml(c.name)}</h3>
      <div class="blk-meta">Created ${escapeHtml(fmtDate(c.createdAt))}</div>
    </article>`;
  }

  async function loadGrid() {
    try {
      const { cohorts } = await API.get("/api/cohorts");
      allCohorts = cohorts || [];
      if (!cohorts || !cohorts.length) {
        grid.innerHTML = `<div class="blk-empty">No cohorts yet.${
          isOwner ? "<br><span style=\"color:var(--muted)\">Create one to start grouping students.</span>" : ""
        }</div>`;
        return;
      }
      grid.innerHTML = `<div class="blk-grid">${cohorts.map(cardHtml).join("")}</div>`;
      grid.querySelectorAll(".blk-card").forEach((card) => {
        card.addEventListener("click", () => openCohort(card.dataset.id));
      });
    } catch (e) {
      grid.innerHTML = `<div class="blk-empty">Couldn't load cohorts.</div>`;
    }
  }

  // --- New cohort ----------------------------------------------------
  if (isOwner) {
    document.getElementById("newCohortBtn").addEventListener("click", () => {
      const form = document.getElementById("newCohortForm");
      form.reset();
      openCohortModal(newCohortModal);
    });

    document.getElementById("newCohortForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.target.querySelector("#cohortName");
      const name = input.value.trim();
      if (!name) return;
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await API.post("/api/cohorts", { name });
        closeCohortModal(newCohortModal);
        toast("Cohort created.", "success");
        await loadGrid();
      } catch (err) {
        toast(err.message || "Couldn't create cohort.", "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  // --- Cohort detail modal -------------------------------------------
  let currentId = null;
  let orgInstructors = null; // lazily loaded list for the assign <select>
  let allCohorts = []; // cached for the "move students to…" <select>

  async function openCohort(id) {
    currentId = id;
    cohortModalContent.innerHTML = `
      <div class="modal-header">
        <h2 id="cohortModalTitle"><span class="skel-line" style="width:140px;display:inline-block"></span></h2>
        <button class="close" type="button" data-close="cohortModal" aria-label="Close">&times;</button>
      </div>
      <div style="padding:1.6rem;display:flex;flex-direction:column;gap:1rem">
        <span class="skel-line" style="width:60%;height:1rem"></span>
        <span class="skel-line" style="width:40%;height:1rem"></span>
        <span class="skel-line" style="width:80%;height:1rem"></span>
      </div>`;
    openModal(cohortModal, { labelledby: "cohortModalTitle" });
    await renderCohortDetail();
  }

  async function renderCohortDetail() {
    let data;
    try {
      data = await API.get(`/api/cohorts/${encodeURIComponent(currentId)}`);
    } catch (e) {
      cohortModalContent.innerHTML = `<div class="modal-header"><h2 id="cohortModalTitle">Cohort</h2>
        <button class="close" type="button" data-close="cohortModal" aria-label="Close">&times;</button></div>
        <div style="padding:1.6rem">Couldn't load this cohort.</div>`;
      return;
    }
    const c = data.cohort;
    const instructors = c.instructors || [];
    const briefs = c.briefs || [];
    const students = c.students || [];

    const ROW = "display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.55rem 0;border-bottom:1px solid var(--line);font-size:.92rem";
    const CTRL = "display:flex;align-items:center;gap:.6rem;margin-top:.8rem";
    const FIELD = "flex:1;padding:.55rem .7rem;border:1px solid var(--line-2);border-radius:var(--r-sm);font-family:inherit;font-size:.9rem";

    // Instructors list
    const insRows = instructors.length
      ? instructors
          .map(
            (i) => `<div style="${ROW}" data-uid="${escapeHtml(i.id)}">
              <span>${escapeHtml(i.name)}${i.email ? ` <span style="color:var(--muted)">· ${escapeHtml(i.email)}</span>` : ""}</span>
              ${isOwner ? `<button type="button" class="btn-mini ins-remove" title="Remove" style="flex:0 0 auto">Remove</button>` : ""}
            </div>`
          )
          .join("")
      : `<p class="thread-empty">No instructors assigned.</p>`;

    // Briefs list — each owner row has an inline rename (Edit → input + Save) + delete + Insights.
    const briefRows = briefs.length
      ? briefs
          .map(
            (b) => `<div data-bid="${escapeHtml(b.id)}">
              <div style="${ROW}">
                <span class="brief-name" style="flex:1">${escapeHtml(b.name)}</span>
                ${
                  isOwner
                    ? `<input type="text" class="brief-rename-input" value="${escapeHtml(b.name)}" autocomplete="off" style="${FIELD};display:none" />
                <button type="button" class="btn-mini brief-insights" title="AI Insights" style="flex:0 0 auto">✦ Insights</button>
                <button type="button" class="btn-mini brief-edit" title="Rename" style="flex:0 0 auto">Edit</button>
                <button type="button" class="btn-mini brief-save" title="Save" style="flex:0 0 auto;display:none">Save</button>
                <button type="button" class="btn-mini brief-delete" title="Delete" style="flex:0 0 auto">Delete</button>`
                    : ""
                }
              </div>
              <div class="brief-insights-panel" style="display:none;margin:.5rem 0 .75rem;padding:.75rem;background:var(--surface-2,#F8F9FA);border-radius:var(--r-sm);font-size:.875rem"></div>
            </div>`
          )
          .join("")
      : `<p class="thread-empty">No briefs yet.</p>`;

    // Students list — each owner row can remove the student from this cohort.
    const studentRows = students.length
      ? students
          .map(
            (st) => `<div style="${ROW}" data-sid="${escapeHtml(st.id)}">
              <span>${escapeHtml(st.name)}${st.email ? ` <span style="color:var(--muted)">· ${escapeHtml(st.email)}</span>` : ""}</span>
              ${isOwner ? `<button type="button" class="btn-mini student-remove" title="Remove from cohort" style="flex:0 0 auto">Remove from cohort</button>` : ""}
            </div>`
          )
          .join("")
      : `<p class="thread-empty">No students in this cohort.</p>`;

    // Owner-only manage panel: rename the cohort + move all students elsewhere.
    const otherCohorts = allCohorts.filter((x) => String(x.id) !== String(c.id));
    const moveOptions = otherCohorts
      .map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`)
      .join("");
    // Auto-assignment strategy (owner-only). Pre-select from cohort.assignStrategy.
    const strategy = c.assignStrategy || "none";
    const STRATEGIES = [
      ["none", "None"],
      ["round_robin", "Round-robin"],
      ["least_loaded", "Least-loaded"],
    ];
    const strategyOptions = STRATEGIES.map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}"${value === strategy ? " selected" : ""}>${escapeHtml(label)}</option>`
    ).join("");

    const ownerManagePanel = isOwner
      ? `<section class="panel" style="padding:1.1rem; margin:0 0 .9rem">
          <h2 style="font-size:.95rem; margin-bottom:.7rem">Manage cohort</h2>
          <div style="${CTRL.replace("margin-top:.8rem", "margin-top:0")}">
            <input type="text" id="renameInput" value="${escapeHtml(c.name)}" autocomplete="off" style="${FIELD}" />
            <button type="button" class="btn btn-ghost" id="renameBtn" style="flex:0 0 auto">Rename</button>
          </div>
          <div style="${CTRL}">
            <select id="moveSelect" class="row-select" style="${FIELD}">${
              moveOptions || `<option value="">No other cohorts</option>`
            }</select>
            <button type="button" class="btn btn-ghost" id="moveBtn" style="flex:0 0 auto"${
              otherCohorts.length ? "" : " disabled"
            }>Move students</button>
          </div>
          <div style="${CTRL}">
            <label for="strategySelect" style="flex:0 0 auto">Auto-assignment</label>
            <select id="strategySelect" class="row-select" style="${FIELD}">${strategyOptions}</select>
          </div>
          <p class="blk-meta" style="margin:.5rem 0 0">New blockages in this cohort are auto-assigned to instructors.</p>
        </section>`
      : "";

    const ownerInsControl = isOwner
      ? `<div style="${CTRL}">
          <select id="insSelect" style="${FIELD}"></select>
          <button type="button" class="btn btn-ghost" id="assignInsBtn" style="flex:0 0 auto">Assign</button>
        </div>`
      : "";

    const ownerBriefControl = isOwner
      ? `<form id="briefForm" style="${CTRL}">
          <input type="text" id="briefName" placeholder="New brief name" autocomplete="off" style="${FIELD}" />
          <button type="submit" class="btn btn-ghost" style="flex:0 0 auto">Add brief</button>
        </form>`
      : "";

    cohortModalContent.innerHTML = `
      <div class="modal-header">
        <h2 id="cohortModalTitle">${escapeHtml(c.name)}</h2>
        <button class="close" type="button" data-close="cohortModal" aria-label="Close">&times;</button>
      </div>
      <div style="padding:1.6rem; display:flex; flex-direction:column; gap:.4rem">
        <div class="blk-meta" style="margin:0 0 .6rem">${escapeHtml(c.students)} students · ${escapeHtml(c.openBlockages)} open blockages</div>

        ${ownerManagePanel}

        <section class="panel" style="padding:1.1rem; margin:0">
          <h2 style="font-size:.95rem; margin-bottom:.7rem">Instructors</h2>
          <div class="row-list">${insRows}</div>
          ${ownerInsControl}
        </section>

        <section class="panel" style="padding:1.1rem; margin:.9rem 0 0">
          <h2 style="font-size:.95rem; margin-bottom:.7rem">Briefs</h2>
          <div class="row-list">${briefRows}</div>
          ${ownerBriefControl}
        </section>

        <section class="panel" style="padding:1.1rem; margin:.9rem 0 0">
          <h2 style="font-size:.95rem; margin-bottom:.7rem">Students</h2>
          <div class="row-list">${studentRows}</div>
        </section>
      </div>`;

    if (isOwner) wireOwnerControls(c, instructors);
  }

  function wireOwnerControls(c, assigned) {
    // Rename the cohort.
    const renameBtn = cohortModalContent.querySelector("#renameBtn");
    if (renameBtn) {
      renameBtn.addEventListener("click", async () => {
        const input = cohortModalContent.querySelector("#renameInput");
        const name = input.value.trim();
        if (!name || name === c.name) return;
        try {
          await API.put(`/api/cohorts/${encodeURIComponent(currentId)}`, { name });
          toast("Cohort renamed.", "success");
          await loadGrid();
          await renderCohortDetail();
        } catch (err) {
          toast(err.message || "Couldn't rename cohort.", "error");
        }
      });
    }

    // Update the auto-assignment strategy. Revert the <select> on failure.
    const strategySelect = cohortModalContent.querySelector("#strategySelect");
    if (strategySelect) {
      let lastStrategy = strategySelect.value;
      strategySelect.addEventListener("change", async () => {
        const value = strategySelect.value;
        strategySelect.disabled = true;
        try {
          await API.put(`/api/cohorts/${encodeURIComponent(currentId)}`, { assignStrategy: value });
          lastStrategy = value;
          toast("Auto-assignment updated.", "success");
        } catch (err) {
          strategySelect.value = lastStrategy;
          toast(err.message || "Couldn't update auto-assignment.", "error");
        } finally {
          strategySelect.disabled = false;
        }
      });
    }

    // Move all students (and their blockages) to another cohort.
    const moveBtn = cohortModalContent.querySelector("#moveBtn");
    if (moveBtn) {
      moveBtn.addEventListener("click", async () => {
        const sel = cohortModalContent.querySelector("#moveSelect");
        const toCohortId = sel && sel.value;
        if (!toCohortId) return;
        try {
          const r = await API.post(
            `/api/cohorts/${encodeURIComponent(currentId)}/move-students`,
            { toCohortId: Number(toCohortId) }
          );
          toast(`Moved ${r.movedStudents} student${r.movedStudents === 1 ? "" : "s"}.`, "success");
          await loadGrid();
          await renderCohortDetail();
        } catch (err) {
          toast(err.message || "Couldn't move students.", "error");
        }
      });
    }

    // Populate the assign <select> with org instructors/owners not already assigned.
    const select = cohortModalContent.querySelector("#insSelect");
    const assignedIds = new Set(assigned.map((i) => String(i.id)));

    async function fillSelect() {
      if (!orgInstructors) {
        try {
          const { members } = await API.get("/api/members");
          orgInstructors = (members || []).filter(
            (m) => m.role === "instructor" || m.role === "owner"
          );
        } catch (e) {
          orgInstructors = [];
        }
      }
      const options = orgInstructors
        .filter((m) => !assignedIds.has(String(m.id)))
        .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
        .join("");
      select.innerHTML = options || `<option value="">No one available</option>`;
    }
    fillSelect();

    // Assign instructor
    cohortModalContent.querySelector("#assignInsBtn").addEventListener("click", async () => {
      const userId = select.value;
      if (!userId) return;
      try {
        await API.post(`/api/cohorts/${encodeURIComponent(currentId)}/instructors`, { userId });
        toast("Instructor assigned.", "success");
        await renderCohortDetail();
      } catch (err) {
        toast(err.message || "Couldn't assign instructor.", "error");
      }
    });

    // Remove instructor
    cohortModalContent.querySelectorAll(".ins-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.closest("[data-uid]").dataset.uid;
        try {
          await API.del(`/api/cohorts/${encodeURIComponent(currentId)}/instructors/${encodeURIComponent(uid)}`);
          toast("Instructor removed.", "success");
          await renderCohortDetail();
        } catch (err) {
          toast(err.message || "Couldn't remove instructor.", "error");
        }
      });
    });

    // Add brief
    cohortModalContent.querySelector("#briefForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.target.querySelector("#briefName");
      const name = input.value.trim();
      if (!name) return;
      try {
        await API.post(`/api/cohorts/${encodeURIComponent(currentId)}/briefs`, { name });
        toast("Brief added.", "success");
        await renderCohortDetail();
      } catch (err) {
        toast(err.message || "Couldn't add brief.", "error");
      }
    });

    // Delete brief
    cohortModalContent.querySelectorAll(".brief-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const bid = btn.closest("[data-bid]").dataset.bid;
        try {
          await API.del(`/api/briefs/${encodeURIComponent(bid)}`);
          toast("Brief deleted.", "success");
          await renderCohortDetail();
        } catch (err) {
          toast(err.message || "Couldn't delete brief.", "error");
        }
      });
    });

    // Brief Insights panel — lazy loads impact + suggestions + version history.
    cohortModalContent.querySelectorAll("[data-bid]").forEach((row) => {
      const insightsBtn = row.querySelector(".brief-insights");
      const insightsPanel = row.querySelector(".brief-insights-panel");
      if (!insightsBtn || !insightsPanel) return;
      let loaded = false;

      insightsBtn.addEventListener("click", async () => {
        const isOpen = insightsPanel.style.display !== "none";
        if (isOpen) { insightsPanel.style.display = "none"; insightsBtn.textContent = "✦ Insights"; return; }
        insightsPanel.style.display = "";
        insightsBtn.textContent = "✦ Hide";
        if (loaded) return;
        loaded = true;
        insightsPanel.innerHTML = `<span style="color:var(--muted)">Loading…</span>`;
        const bid = row.dataset.bid;
        try {
          const [impact, sugg] = await Promise.all([
            API.get(`/api/briefs/${encodeURIComponent(bid)}/impact`),
            API.get(`/api/briefs/${encodeURIComponent(bid)}/suggestions?status=pending`),
          ]);
          const im = impact || {};
          const pending = (sugg && sugg.suggestions) || [];
          insightsPanel.innerHTML = `
            <div style="display:flex;gap:1.25rem;margin-bottom:.65rem;flex-wrap:wrap">
              <div><span style="font-family:var(--font-mono);font-size:1.1rem;font-weight:700;color:var(--flow)">${im.resolveRate != null ? im.resolveRate + "%" : "—"}</span><div style="color:var(--muted);font-size:.75rem">Resolve rate</div></div>
              <div><span style="font-family:var(--font-mono);font-size:1.1rem;font-weight:700">${im.totalBlockages != null ? im.totalBlockages : "—"}</span><div style="color:var(--muted);font-size:.75rem">Total blockages</div></div>
              <div><span style="font-family:var(--font-mono);font-size:1.1rem;font-weight:700">${im.avgResolveHours != null ? im.avgResolveHours + "h" : "—"}</span><div style="color:var(--muted);font-size:.75rem">Avg resolve time</div></div>
            </div>
            ${pending.length ? `<div style="margin-bottom:.5rem;font-weight:600;font-size:.8rem">AI suggestions for this brief</div>
              ${pending.map((sg) => `<div class="brief-sugg" data-sid="${escapeHtml(sg.id)}" style="background:#fff;border:1px solid var(--line);border-radius:var(--r-sm);padding:.6rem .8rem;margin-bottom:.45rem">
                <div style="font-weight:600;margin-bottom:.25rem">${escapeHtml(sg.topic)}</div>
                <div style="color:var(--muted);font-size:.8rem;margin-bottom:.4rem">${escapeHtml(sg.rationale || "")}</div>
                <div style="display:flex;gap:.5rem">
                  <button type="button" class="btn-mini sugg-accept">Accept</button>
                  <button type="button" class="btn-mini sugg-dismiss" style="color:var(--muted)">Dismiss</button>
                </div>
              </div>`).join("")}` : `<div style="color:var(--muted);font-size:.8rem;margin-bottom:.5rem">No pending AI suggestions.</div>`}
            <button type="button" class="btn btn-ghost" style="font-size:.8rem;padding:.3rem .65rem" data-gen-sugg="${escapeHtml(bid)}">Generate AI suggestion</button>`;

          // Wire accept / dismiss
          insightsPanel.querySelectorAll(".brief-sugg").forEach((sg) => {
            const sid = sg.dataset.sid;
            sg.querySelector(".sugg-accept").addEventListener("click", async () => {
              try {
                await API.patch(`/api/briefs/${encodeURIComponent(bid)}/suggestions/${encodeURIComponent(sid)}`, { status: "accepted" });
                sg.remove();
                toast("Suggestion accepted.", "success");
              } catch (err) { toast(err.message || "Couldn't accept.", "error"); }
            });
            sg.querySelector(".sugg-dismiss").addEventListener("click", async () => {
              try {
                await API.patch(`/api/briefs/${encodeURIComponent(bid)}/suggestions/${encodeURIComponent(sid)}`, { status: "dismissed" });
                sg.remove();
                toast("Suggestion dismissed.", "info");
              } catch (err) { toast(err.message || "Couldn't dismiss.", "error"); }
            });
          });

          // Wire generate suggestion
          const genBtn = insightsPanel.querySelector("[data-gen-sugg]");
          if (genBtn) {
            genBtn.addEventListener("click", async () => {
              genBtn.disabled = true; genBtn.textContent = "Generating…";
              try {
                await API.post(`/api/briefs/${encodeURIComponent(bid)}/suggestions`, {});
                toast("AI suggestion generated — refresh Insights to see it.", "success");
                loaded = false;
              } catch (err) {
                toast(err.message || "Couldn't generate suggestion.", "error");
              } finally {
                genBtn.disabled = false; genBtn.textContent = "Generate AI suggestion";
              }
            });
          }
        } catch (err) {
          insightsPanel.innerHTML = `<span style="color:var(--blocked)">Couldn't load insights.</span>`;
        }
      });
    });

    // Rename brief — Edit swaps the label for an input, Save persists.
    cohortModalContent.querySelectorAll("[data-bid]").forEach((row) => {
      const nameEl = row.querySelector(".brief-name");
      const input = row.querySelector(".brief-rename-input");
      const editBtn = row.querySelector(".brief-edit");
      const saveBtn = row.querySelector(".brief-save");
      const delBtn = row.querySelector(".brief-delete");
      if (!editBtn || !saveBtn || !input) return;

      editBtn.addEventListener("click", () => {
        nameEl.style.display = "none";
        if (delBtn) delBtn.style.display = "none";
        editBtn.style.display = "none";
        input.style.display = "";
        saveBtn.style.display = "";
        input.focus();
        input.select();
      });

      saveBtn.addEventListener("click", async () => {
        const bid = row.dataset.bid;
        const name = input.value.trim();
        if (!name) return;
        saveBtn.textContent = "Saving…";
        saveBtn.disabled = true;
        try {
          await API.put(`/api/briefs/${encodeURIComponent(bid)}`, { name });
          toast("Brief renamed.", "success");
          await renderCohortDetail();
        } catch (err) {
          saveBtn.textContent = "Save";
          saveBtn.disabled = false;
          toast(err.message || "Couldn't rename brief.", "error");
        }
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveBtn.click();
        }
      });
    });

    // Remove a student from this cohort (empties their cohort_id).
    cohortModalContent.querySelectorAll(".student-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const sid = btn.closest("[data-sid]").dataset.sid;
        try {
          await API.put(`/api/members/${encodeURIComponent(sid)}`, { cohortId: null });
          toast("Student removed from cohort.", "success");
          await loadGrid();
          await renderCohortDetail();
        } catch (err) {
          toast(err.message || "Couldn't remove student.", "error");
        }
      });
    });
  }

  await loadGrid();
})();
