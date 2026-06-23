/* Shared blockage-detail page — used by owner, instructor and student. */

(async function () {
  const id = new URLSearchParams(location.search).get("id");

  const s = await requireRole("owner", "instructor", "student");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: dashboardFor(s.user.role),
    title: "Blockage",
    crumb: s.user.role === "student" ? "My blockages" : "Support queue",
  });

  const role = s.user.role;
  let blk = null; // latest fetched blockage

  // ---- Difficulty labels ------------------------------------------------
  const DIFFICULTY = {
    low: "Low",
    medium: "Medium",
    high: "High",
    blocker: "Blocker",
  };

  // ---- Resolution method labels ----------------------------------------
  const RES_METHODS = [
    { value: "guidedSupport", label: "Guided support in finding solutions" },
    { value: "peerAssistedHelp", label: "Peer-assisted help" },
    { value: "directIntervention", label: "Direct intervention by the instructor" },
  ];
  function resMethodLabel(v) {
    const m = RES_METHODS.find((x) => x.value === v);
    return m ? m.label : v || "";
  }

  // ---- Fetch + render ---------------------------------------------------
  async function load() {
    let data;
    try {
      data = await API.get("/api/blockages/" + encodeURIComponent(id));
    } catch (e) {
      if (e.status === 404) {
        view.innerHTML = `<div class="blk-empty">
          <p>Blockage not found — it may have been deleted or you may not have access.</p>
          <a class="btn btn-ghost" href="${dashboardFor(role)}">Back to dashboard</a>
        </div>`;
        return false;
      }
      view.innerHTML = `<div class="blk-empty">
        <p>Couldn't load this blockage. Check your connection and try again.</p>
        <button class="btn btn-ghost" onclick="location.reload()">Retry</button>
      </div>`;
      return false;
    }
    blk = data.blockage;
    render();
    return true;
  }

  function avatarChar(name) {
    return escapeHtml((String(name || "?").charAt(0) || "?").toUpperCase());
  }

  // ---- Difficulty badge -------------------------------------------------
  function difficultyBadge(d) {
    const L = { low: "Low", medium: "Medium", high: "High", blocker: "Blocker" };
    if (!d || !L[d]) return "";
    const color = { low: "#5d6675", medium: "#F59F00", high: "#F59F00", blocker: "#FF5A4D" }[d];
    return `<span class="blk-id" style="border-color:${color};color:${color}">${L[d]}</span>`;
  }

  // ---- Attachments ------------------------------------------------------
  function attachmentsHtml(list) {
    if (!list || !list.length) return "";
    const items = list
      .map((a) => {
        const href = "/api/attachments/" + a.id;
        if (String(a.mime).startsWith("image/") && a.mime !== "image/svg+xml") {
          return `<a class="att-thumb" href="${href}" target="_blank" rel="noopener noreferrer"
            title="${escapeHtml(a.filename)}"><img src="${href}" alt="${escapeHtml(a.filename)}" loading="lazy"></a>`;
        }
        return `<a class="att-chip" href="${href}" target="_blank" rel="noopener noreferrer">
          <span class="att-ic">📎</span><span class="att-nm">${escapeHtml(a.filename)}</span></a>`;
      })
      .join("");
    return `<div class="attachments">${items}</div>`;
  }

  // ---- AI triage panel --------------------------------------------------
  function aiTriageHtml() {
    if (!blk.aiDifficulty && !(blk.aiTopics || []).length) return "";
    const urgColor = { high: "#FF5A4D", normal: "#F59F00", low: "#5d6675" }[blk.aiUrgency] || "#5d6675";
    const tags = (blk.aiTopics || []).map((t) => `<span class="triage-tag">${escapeHtml(t)}</span>`).join("");
    return `<div class="panel">
      <h2>AI triage</h2>
      <ul class="meta-list">
        <li><span class="k">Difficulty</span><span class="v">${escapeHtml(DIFFICULTY[blk.aiDifficulty] || blk.aiDifficulty || "—")}</span></li>
        <li><span class="k">Urgency</span><span class="v"><span class="urg-dot" style="background:${urgColor}"></span>${escapeHtml(blk.aiUrgency || "—")}</span></li>
        ${tags ? `<li><span class="k">Topics</span><span class="v triage-tags">${tags}</span></li>` : ""}
      </ul></div>`;
  }

  // ---- Comments thread --------------------------------------------------
  function threadHtml(comments) {
    if (!comments || !comments.length) {
      return `<div class="thread-empty">No messages yet.</div>`;
    }
    return comments
      .map((c) => {
        const isAi = c.is_ai || c.author_role === "ai";
        const unblock =
          isAi && role === "student" && blk.status !== "resolved"
            ? `<button type="button" class="btn btn-flow ai-unblock">✓ This unblocked me</button>`
            : "";
        const mine = !isAi && c.authorId === s.user.id;
        const ownerActions = mine
          ? `<div class="cmt-actions">
              <button type="button" class="btn btn-ghost cmt-edit" data-cid="${c.id}">Edit</button>
              <button type="button" class="btn btn-ghost cmt-del" data-cid="${c.id}">Delete</button>
            </div>`
          : "";
        return `<div class="comment role-${escapeHtml(c.author_role)}">
          <div class="av">${isAi ? "✦" : avatarChar(c.author)}</div>
          <div class="bubble">
            <div class="head">
              <span class="who">${escapeHtml(c.author)}${isAi ? ' <span class="ai-badge">AI</span>' : ""}</span>
              <span class="when">${fmtRelative(c.created_at)}</span>
            </div>
            <div class="body md" data-cid="${c.id}" data-raw="${escapeHtml(c.body)}">${renderMarkdown(c.body)}</div>
            ${attachmentsHtml(c.attachments)}
            ${unblock}
            ${ownerActions}
          </div>
        </div>`;
      })
      .join("");
  }

  function similarHtml(similar) {
    if (!similar || !similar.length) return "";
    const items = similar
      .map(
        (s) => `<a class="kb-item" href="blockage.html?id=${s.id}">
          <span class="kb-id">BLK-${String(s.id).padStart(3, "0")}</span>
          <span class="kb-title">${escapeHtml(s.title)}</span>
        </a>`
      )
      .join("");
    return `<div class="panel"><h2>Solved before</h2>
      <p class="kb-sub">From this workspace's knowledge base.</p>
      <div class="kb-list">${items}</div></div>`;
  }

  // ---- Timeline ---------------------------------------------------------
  function eventLabel(ev) {
    const actor = escapeHtml(ev.actor || "Someone");
    switch (ev.type) {
      case "created":
        return `${actor} reported it`;
      case "claimed":
        return `${actor} started helping`;
      case "comment":
        return `${actor} replied`;
      case "ai_reply":
        return `${escapeHtml(blk.aiName || "AI")} responded`;
      case "resolved": {
        const method = ev.meta ? ` · ${escapeHtml(resMethodLabel(ev.meta))}` : "";
        return `${actor} resolved it${method}`;
      }
      default:
        return `${actor} · ${escapeHtml(ev.type)}`;
    }
  }
  function timelineHtml(events) {
    if (!events || !events.length) {
      return `<div class="thread-empty">No activity yet.</div>`;
    }
    return `<ul class="timeline">${events
      .map(
        (ev) => `<li class="ev-${escapeHtml(ev.type)}">
          <div class="ev-t">${eventLabel(ev)}</div>
          <div class="ev-m">${fmtRelative(ev.created_at)}</div>
        </li>`
      )
      .join("")}</ul>`;
  }

  // ---- Role action buttons ---------------------------------------------
  function actionsHtml() {
    const btns = [];
    if (role === "student" && blk.canEdit) {
      btns.push(`<button class="btn btn-ghost" id="editBtn">Edit</button>`);
      btns.push(`<button class="btn btn-ghost" id="deleteBtn">Delete</button>`);
    }
    if (role === "instructor" || role === "owner") {
      if (blk.status === "open") {
        btns.push(`<button class="btn btn-primary" id="claimBtn">Claim</button>`);
      }
      if (blk.status !== "resolved") {
        btns.push(`<button class="btn btn-flow" id="resolveBtn">Resolve</button>`);
        btns.push(`<button class="btn btn-ghost" id="reassignBtn">Reassign</button>`);
      }
      if (blk.status === "resolved") {
        btns.push(`<button class="btn btn-ghost" id="reopenBtn">Reopen</button>`);
      }
    }
    if (
      role === "student" &&
      blk.resolutionType === "ai" &&
      blk.status === "resolved"
    ) {
      btns.push(
        `<button class="btn btn-flow" id="studentReopenBtn">I'm still stuck — reopen</button>`
      );
    }
    if (!btns.length) return "";
    return `<div class="page-actions" style="margin-bottom:1.25rem">${btns.join("")}</div>`;
  }

  const isStaff = role === "owner" || role === "instructor";

  // ---- Tags -------------------------------------------------------------
  function tagsBlock() {
    const pills = (blk.tags || [])
      .map((t) => {
        const c = t.color ? ` style="--tag:${escapeHtml(t.color)}"` : "";
        const x = isStaff
          ? `<button type="button" class="tag-x" data-tag-id="${t.id}" title="Remove tag" aria-label="Remove tag">×</button>`
          : "";
        return `<span class="tag-pill"${c}>${escapeHtml(t.name)}${x}</span>`;
      })
      .join("");
    const adder = isStaff
      ? `<div class="tag-add">
          <select class="row-select" id="tagSelect"><option value="">Add tag…</option></select>
          <button type="button" class="btn btn-ghost" id="tagAddBtn">Add</button>
          ${role === "owner" ? '<button type="button" class="btn btn-ghost" id="tagNewBtn">+ new tag</button>' : ""}
        </div>`
      : "";
    if (!pills && !isStaff) return "";
    return `<div class="tag-row">${pills}${adder}</div>`;
  }

  // ---- CSAT -------------------------------------------------------------
  function csatBlock() {
    if (blk.status !== "resolved") return "";
    if (blk.csat) {
      return role === "student" || isStaff
        ? `<div class="csat-prompt">
            <span class="csat-label">Student rating</span>
            <span class="csat-stars">${csatStars(blk.csat.rating)}</span>
          </div>`
        : "";
    }
    if (role !== "student") return "";
    return `<div class="csat-prompt" id="csatPrompt">
      <span class="csat-label">Did this help?</span>
      <span class="csat-stars" id="csatStars">
        ${[1, 2, 3, 4, 5]
          .map(
            (i) =>
              `<button type="button" class="csat-star" data-rating="${i}" title="${i} star${i > 1 ? "s" : ""}" aria-label="${i} star${i > 1 ? "s" : ""}">★</button>`
          )
          .join("")}
      </span>
    </div>`;
  }

  // ---- Featured AI response (student view — first AI comment, promoted) ----
  function aiFeaturedHtml() {
    if (role !== "student") return "";
    const aiComment = (blk.comments || []).find((c) => c.is_ai || c.author_role === "ai");
    if (!aiComment) return "";
    const canUnblock = blk.status !== "resolved";
    return `<div class="ai-featured">
      <div class="ai-featured-head">
        <div class="ai-featured-av">✦</div>
        <div>
          <div class="ai-featured-who">${escapeHtml(blk.aiName || "AI Teaching Assistant")}</div>
          <div class="ai-featured-sub">Responded ${fmtRelative(aiComment.created_at)}</div>
        </div>
      </div>
      <div class="ai-featured-body md">${renderMarkdown(aiComment.body)}</div>
      ${canUnblock ? `<div class="ai-cta-row">
        <button type="button" class="btn btn-flow ai-unblock" data-cid="${aiComment.id}">✓ This unblocked me</button>
        <button type="button" class="btn btn-ghost" id="aiStillStuck">Still stuck — add context</button>
      </div>` : ""}
    </div>`;
  }

  // ---- Main render ------------------------------------------------------
  function render() {
    const meta = statusMeta(blk.status);
    const num = String(blk.id).padStart(3, "0");

    let resolutionBlock = "";
    if (blk.status === "resolved") {
      resolutionBlock = `<div class="resolution-readout">
        <h3>Resolution method</h3>
        <p>${escapeHtml(resMethodLabel(blk.resolutionType))}</p>
        ${
          blk.resolutionNote
            ? `<h3>Note</h3><p>${escapeHtml(blk.resolutionNote)}</p>`
            : ""
        }
      </div>`;
    }

    // For students: filter the first AI comment out of the thread — it renders
    // as the featured card above, so don't show it again in the flat thread.
    const featuredAiId = role === "student"
      ? ((blk.comments || []).find((c) => c.is_ai || c.author_role === "ai") || {}).id
      : null;
    const threadComments = featuredAiId
      ? (blk.comments || []).filter((c) => c.id !== featuredAiId)
      : (blk.comments || []);

    view.innerHTML = `
      ${actionsHtml()}
      <div class="detail-grid">
        <div>
          <div class="panel">
            <div class="detail-head">
              <div>
                <span class="blk-id">BLK-${num}</span>
                ${difficultyBadge(blk.difficulty)}
                <h1>${escapeHtml(blk.title)}</h1>
              </div>
              <span class="pill pill-${meta.cls}">${meta.label}</span>
            </div>
            <div class="detail-desc md">${renderMarkdown(blk.details)}</div>
            ${attachmentsHtml(blk.attachments)}
            ${tagsBlock()}
            ${resolutionBlock}
            ${csatBlock()}
          </div>

          ${aiFeaturedHtml()}

          <div class="panel">
            <h2>Conversation</h2>
            ${role !== "student" ? '<button type="button" class="btn btn-ghost" id="summarizeBtn" style="margin-bottom:.6rem">✦ Summarize thread</button>' : ""}
            <div id="summaryCard"></div>
            <div class="thread" id="thread">${threadHtml(threadComments)}</div>
            <form class="composer" id="composer">
              <textarea id="commentBody" placeholder="Write a reply…" rows="1"></textarea>
              <label class="btn btn-ghost attach-btn" title="Attach a file">📎
                <input type="file" id="commentFiles" multiple hidden
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,text/plain,application/pdf">
              </label>
              ${role !== "student" ? '<button type="button" class="btn btn-ghost" id="draftBtn" title="Draft a reply with AI">✦ Draft</button>' : ""}
              ${isStaff ? '<button type="button" class="btn btn-ghost" id="cannedBtn" title="Insert a canned response">Canned ▾</button>' : ""}
              <button type="submit" class="btn btn-primary">Send</button>
            </form>
            ${isStaff ? '<div class="canned-menu" id="cannedMenu" hidden></div>' : ""}
            <div class="attach-pending" id="attachPending"></div>
            ${role === "student" && blk.status !== "resolved" && (blk.comments || []).some((c) => c.is_ai || c.author_role === "ai")
              ? '<button type="button" class="btn btn-ghost" id="askAgainBtn" style="margin-top:.5rem">✦ Ask AI again</button>'
              : ""}
          </div>
        </div>

        <div>
          <div class="panel">
            <ul class="meta-list">
              <li><span class="k">Student</span><span class="v">${escapeHtml(
                blk.studentName || "—"
              )}</span></li>
              <li><span class="k">Cohort</span><span class="v">${escapeHtml(
                blk.cohortName || "—"
              )}</span></li>
              <li><span class="k">Brief</span><span class="v">${escapeHtml(
                blk.briefName || "—"
              )}</span></li>
              <li><span class="k">Difficulty</span><span class="v">${escapeHtml(
                DIFFICULTY[blk.difficulty] || blk.difficulty || "—"
              )}</span></li>
              <li><span class="k">Instructor</span><span class="v">${escapeHtml(
                blk.assigneeName || "Unassigned"
              )}</span></li>
              <li><span class="k">Reported</span><span class="v">${escapeHtml(
                fmtDate(blk.createdAt)
              )} · ${escapeHtml(fmtTime(blk.createdAt))}</span></li>
            </ul>
          </div>

          ${aiTriageHtml()}

          <div class="panel">
            <h2>Timeline</h2>
            ${timelineHtml(blk.events)}
          </div>

          ${similarHtml(blk.similar)}
        </div>
      </div>`;

    wireActions();
    wireComposer();
    wireSuccessLayer();
  }

  // ---- Tags / CSAT / Canned wiring --------------------------------------
  function wireSuccessLayer() {
    // Tags: populate the add-tag <select> with org tags not already attached.
    const tagSelect = document.getElementById("tagSelect");
    if (tagSelect) {
      API.get("/api/tags")
        .then(({ tags }) => {
          const have = new Set((blk.tags || []).map((t) => t.id));
          (tags || [])
            .filter((t) => !have.has(t.id))
            .forEach((t) => {
              const opt = document.createElement("option");
              opt.value = String(t.id);
              opt.textContent = t.name;
              tagSelect.appendChild(opt);
            });
        })
        .catch(() => {});
    }

    const tagAddBtn = document.getElementById("tagAddBtn");
    if (tagAddBtn) {
      tagAddBtn.addEventListener("click", async () => {
        const tagId = Number(tagSelect && tagSelect.value);
        if (!tagId) {
          toast("Pick a tag to add.", "warning");
          return;
        }
        try {
          await API.post("/api/blockages/" + encodeURIComponent(id) + "/tags", { tagId });
          toast("Tag added.", "success");
          await load();
        } catch (err) {
          toast(err.message || "Couldn't add that tag.", "error");
        }
      });
    }

    // Owner: create a brand-new tag inline, then attach it.
    const tagNewBtn = document.getElementById("tagNewBtn");
    if (tagNewBtn) {
      tagNewBtn.addEventListener("click", () => {
        // Replace the button with an inline input row (idempotent — only one at a time).
        if (document.getElementById("tagNewForm")) return;
        const form = document.createElement("form");
        form.id = "tagNewForm";
        form.style.cssText = "display:flex;align-items:center;gap:.4rem;margin-top:.4rem";
        form.innerHTML =
          `<input id="tagNewInput" type="text" placeholder="Tag name" autocomplete="off" style="flex:1;padding:.35rem .6rem;border:1px solid var(--line-2);border-radius:var(--r-sm);font-size:.88rem" />` +
          `<button type="submit" class="btn btn-ghost" style="flex:0 0 auto">Create</button>` +
          `<button type="button" class="btn btn-ghost" id="tagNewCancel" style="flex:0 0 auto">✕</button>`;
        tagNewBtn.insertAdjacentElement("afterend", form);
        document.getElementById("tagNewInput").focus();
        document.getElementById("tagNewCancel").addEventListener("click", () => form.remove());
        form.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const name = (document.getElementById("tagNewInput").value || "").trim();
          if (!name) return;
          try {
            const { tag } = await API.post("/api/tags", { name });
            await API.post("/api/blockages/" + encodeURIComponent(id) + "/tags", {
              tagId: tag.id,
            });
            toast("Tag created and added.", "success");
            form.remove();
            await load();
          } catch (err) {
            if (err.status === 403) {
              toast("Only owners can create tags.", "warning");
            } else {
              toast(err.message || "Couldn't create that tag.", "error");
            }
          }
        });
      });
    }

    // Detach a tag via the × on its pill.
    const tagRow = document.querySelector(".tag-row");
    if (tagRow) {
      tagRow.addEventListener("click", async (e) => {
        const x = e.target.closest(".tag-x");
        if (!x) return;
        const tagId = x.getAttribute("data-tag-id");
        try {
          await API.del(
            "/api/blockages/" + encodeURIComponent(id) + "/tags/" + encodeURIComponent(tagId)
          );
          await load();
        } catch (err) {
          if (err.status === 403) {
            toast("You can't change tags here.", "warning");
          } else {
            toast(err.message || "Couldn't remove that tag.", "error");
          }
        }
      });
    }

    // CSAT: student rates a resolved blockage.
    const csatStarsEl = document.getElementById("csatStars");
    if (csatStarsEl) {
      csatStarsEl.addEventListener("click", async (e) => {
        const btn = e.target.closest(".csat-star");
        if (!btn) return;
        const rating = Number(btn.getAttribute("data-rating"));
        if (!rating) return;
        try {
          await API.post("/api/blockages/" + encodeURIComponent(id) + "/csat", { rating });
          toast("Thanks for the feedback!", "success");
          await load();
        } catch (err) {
          toast(err.message || "Couldn't save your rating.", "error");
        }
      });
    }

    // Canned: staff insert / create / delete saved snippets.
    const cannedBtn = document.getElementById("cannedBtn");
    const cannedMenu = document.getElementById("cannedMenu");
    if (cannedBtn && cannedMenu) {
      // Re-fetch the list and (re)render the menu contents.
      async function renderCannedMenu() {
        let list = [];
        try {
          const r = await API.get("/api/canned");
          list = r.canned || [];
        } catch (err) {
          toast(err.message || "Couldn't load canned responses.", "error");
          return false;
        }
        const items = list.length
          ? list
              .map(
                (c) =>
                  `<div class="canned-row">
                    <button type="button" class="canned-item" data-body="${escapeHtml(
                      c.body
                    )}">${escapeHtml(c.title)}</button>
                    <button type="button" class="canned-del" data-canned-id="${escapeHtml(
                      c.id
                    )}" title="Delete canned response" aria-label="Delete canned response">×</button>
                  </div>`
              )
              .join("")
          : `<div class="canned-empty">No canned responses yet.</div>`;
        cannedMenu.innerHTML =
          items +
          `<button type="button" class="canned-new" id="cannedNew">+ New canned response</button>`;
        return true;
      }

      cannedBtn.addEventListener("click", async () => {
        if (!cannedMenu.hidden) {
          cannedMenu.hidden = true;
          return;
        }
        if (await renderCannedMenu()) cannedMenu.hidden = false;
      });

      cannedMenu.addEventListener("click", async (e) => {
        // Create a new canned response — inline form inside the menu.
        const newBtn = e.target.closest(".canned-new");
        if (newBtn) {
          if (cannedMenu.querySelector(".canned-create-form")) return;
          const formEl = document.createElement("form");
          formEl.className = "canned-create-form";
          formEl.style.cssText = "display:flex;flex-direction:column;gap:.4rem;padding:.5rem .6rem;border-top:1px solid var(--line)";
          formEl.innerHTML =
            `<input class="canned-title-input" type="text" placeholder="Title" autocomplete="off" required style="padding:.35rem .6rem;border:1px solid var(--line-2);border-radius:var(--r-sm);font-size:.88rem" />` +
            `<textarea class="canned-body-input" rows="3" placeholder="Response body" required style="padding:.35rem .6rem;border:1px solid var(--line-2);border-radius:var(--r-sm);font-size:.88rem;font-family:inherit;resize:vertical"></textarea>` +
            `<div style="display:flex;gap:.4rem">` +
            `<button type="submit" class="btn btn-primary" style="flex:1">Save</button>` +
            `<button type="button" class="canned-create-cancel btn btn-ghost">Cancel</button>` +
            `</div>`;
          newBtn.insertAdjacentElement("beforebegin", formEl);
          formEl.querySelector(".canned-title-input").focus();
          formEl.querySelector(".canned-create-cancel").addEventListener("click", () => formEl.remove());
          formEl.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const title = (formEl.querySelector(".canned-title-input").value || "").trim();
            const body = (formEl.querySelector(".canned-body-input").value || "").trim();
            if (!title || !body) return;
            try {
              await API.post("/api/canned", { title, body });
              toast("Canned response saved.", "success");
              formEl.remove();
              await renderCannedMenu();
            } catch (err) {
              toast(err.message || "Couldn't save that canned response.", "error");
            }
          });
          return;
        }

        // Delete a canned response.
        const delBtn = e.target.closest(".canned-del");
        if (delBtn) {
          const cid = delBtn.getAttribute("data-canned-id");
          if (!await confirmModal("Delete this canned response?", { confirmLabel: "Delete", danger: true })) return;
          try {
            await API.del("/api/canned/" + encodeURIComponent(cid));
            toast("Canned response deleted.", "success");
            await renderCannedMenu();
          } catch (err) {
            toast(err.message || "Couldn't delete that canned response.", "error");
          }
          return;
        }

        // Insert a saved snippet into the composer.
        const item = e.target.closest(".canned-item");
        if (!item) return;
        const ta = document.getElementById("commentBody");
        if (ta) {
          const body = item.getAttribute("data-body") || "";
          ta.value = ta.value ? ta.value + "\n\n" + body : body;
          ta.focus();
        }
        cannedMenu.hidden = true;
      });
    }
  }

  // ---- Composer ---------------------------------------------------------
  function wireComposer() {
    const form = document.getElementById("composer");
    if (!form) return;

    // Files attached to the in-progress reply (uploaded, awaiting send).
    let pending = []; // [{ id, filename }]
    const fileInput = document.getElementById("commentFiles");
    const pendingEl = document.getElementById("attachPending");
    function renderPending() {
      if (!pendingEl) return;
      pendingEl.innerHTML = pending
        .map((p) => `<span class="att-chip">📎 ${escapeHtml(p.filename)}</span>`)
        .join("");
    }
    if (fileInput) {
      fileInput.addEventListener("change", async () => {
        for (const file of Array.from(fileInput.files)) {
          try {
            const att = await uploadAttachment(file, { blockageId: Number(id) });
            pending.push({ id: att.id, filename: att.filename });
          } catch (err) {
            toast(err.message || "Couldn't attach that file.", "error");
          }
        }
        fileInput.value = "";
        renderPending();
      });
    }

    // Ctrl+Enter / Cmd+Enter submits the composer.
    const composerTa = form.querySelector("#commentBody");
    if (composerTa) {
      composerTa.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
      });
      // Auto-grow textarea.
      composerTa.addEventListener("input", () => {
        composerTa.style.height = "auto";
        composerTa.style.height = Math.min(composerTa.scrollHeight, 200) + "px";
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ta = form.querySelector("#commentBody");
      const body = ta.value.trim();
      if (!body && !pending.length) {
        toast("Write something or attach a file.", "warning");
        return;
      }
      try {
        await API.post("/api/blockages/" + encodeURIComponent(id) + "/comments", {
          body: body || "(attachment)",
          attachmentIds: pending.map((p) => p.id),
        });
        ta.value = "";
        pending = [];
        renderPending();
        await load();
      } catch (err) {
        toast(err.message || "Couldn't send your message.", "error");
      }
    });

    // Student: ask the AI for another turn
    const askAgainBtn = document.getElementById("askAgainBtn");
    if (askAgainBtn) {
      askAgainBtn.addEventListener("click", async () => {
        askAgainBtn.disabled = true;
        askAgainBtn.textContent = "Thinking…";
        try {
          const r = await API.post("/api/blockages/" + encodeURIComponent(id) + "/ai-followup");
          if (!r.posted) toast("Reply to the AI first, then ask again.", "info");
          await load();
        } catch (err) {
          toast(err.message || "Couldn't ask the AI.", "error");
          askAgainBtn.disabled = false;
        }
      });
    }

    // Staff: AI thread summary (read-only, dismissible card)
    const summarizeBtn = document.getElementById("summarizeBtn");
    if (summarizeBtn) {
      summarizeBtn.addEventListener("click", async () => {
        summarizeBtn.disabled = true;
        summarizeBtn.textContent = "Summarizing…";
        try {
          const { summary } = await API.get("/api/blockages/" + encodeURIComponent(id) + "/summary");
          const card = document.getElementById("summaryCard");
          if (card) {
            card.innerHTML = `<div class="summary-card"><span class="ai-badge">AI</span>
              <span class="summary-text">${escapeHtml(summary)}</span>
              <button type="button" class="summary-x" title="Dismiss">×</button></div>`;
            const x = card.querySelector(".summary-x");
            if (x) x.addEventListener("click", () => { card.innerHTML = ""; });
          }
        } catch (err) {
          toast(err.message || "Couldn't summarize.", "error");
        } finally {
          summarizeBtn.disabled = false;
          summarizeBtn.textContent = "✦ Summarize thread";
        }
      });
    }

    // Instructor copilot: draft a reply with AI
    const draftBtn = document.getElementById("draftBtn");
    if (draftBtn) {
      draftBtn.addEventListener("click", async () => {
        draftBtn.disabled = true;
        const orig = draftBtn.textContent;
        draftBtn.textContent = "Drafting…";
        try {
          const { draft } = await API.get("/api/blockages/" + encodeURIComponent(id) + "/suggest");
          const ta = form.querySelector("#commentBody");
          ta.value = draft;
          ta.focus();
        } catch (err) {
          toast(err.message || "Couldn't draft a reply.", "error");
        } finally {
          draftBtn.disabled = false;
          draftBtn.textContent = orig;
        }
      });
    }

    // Student deflection: "this unblocked me" on an AI reply
    const thread = document.getElementById("thread");
    if (thread) {
      thread.addEventListener("click", async (e) => {
        const unblockBtn = e.target.closest(".ai-unblock");
        if (unblockBtn) {
          try {
            await API.post("/api/blockages/" + encodeURIComponent(id) + "/ai-resolve");
            toast("Nice — marked as unblocked by AI.", "success");
            await load();
          } catch (err) {
            toast(err.message || "Couldn't update.", "error");
          }
          return;
        }

        // Delete own comment
        const delBtn = e.target.closest(".cmt-del");
        if (delBtn) {
          const cid = delBtn.getAttribute("data-cid");
          if (!await confirmModal("Delete this message? This can't be undone.", { confirmLabel: "Delete message", danger: true })) return;
          try {
            await API.del(
              "/api/blockages/" + encodeURIComponent(id) + "/comments/" + encodeURIComponent(cid)
            );
            toast("Message deleted.", "success");
            await load();
          } catch (err) {
            toast(err.message || "Couldn't delete this message.", "error");
          }
          return;
        }

        // Edit own comment — swap the body for an inline textarea
        const editBtn = e.target.closest(".cmt-edit");
        if (editBtn) {
          const cid = editBtn.getAttribute("data-cid");
          const bubble = editBtn.closest(".bubble");
          const bodyEl = bubble && bubble.querySelector('.body[data-cid="' + cid + '"]');
          if (!bodyEl || bubble.querySelector(".cmt-edit-form")) return;
          const current = bodyEl.getAttribute("data-raw") || bodyEl.textContent;
          const formEl = document.createElement("form");
          formEl.className = "composer cmt-edit-form";
          const ta = document.createElement("textarea");
          ta.value = current;
          ta.rows = 2;
          const save = document.createElement("button");
          save.type = "submit";
          save.className = "btn btn-primary";
          save.textContent = "Save";
          const cancel = document.createElement("button");
          cancel.type = "button";
          cancel.className = "btn btn-ghost";
          cancel.textContent = "Cancel";
          formEl.appendChild(ta);
          formEl.appendChild(save);
          formEl.appendChild(cancel);
          bodyEl.style.display = "none";
          bodyEl.after(formEl);
          ta.focus();
          cancel.addEventListener("click", () => {
            formEl.remove();
            bodyEl.style.display = "";
          });
          formEl.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const body = ta.value.trim();
            if (!body) {
              toast("Write something before saving.", "warning");
              return;
            }
            try {
              await API.put(
                "/api/blockages/" + encodeURIComponent(id) + "/comments/" + encodeURIComponent(cid),
                { body }
              );
              toast("Message updated.", "success");
              await load();
            } catch (err) {
              toast(err.message || "Couldn't save your changes.", "error");
            }
          });
        }
      });
    }
  }

  // ---- Role actions wiring ---------------------------------------------
  function wireActions() {
    const editBtn = document.getElementById("editBtn");
    const deleteBtn = document.getElementById("deleteBtn");
    const claimBtn = document.getElementById("claimBtn");
    const resolveBtn = document.getElementById("resolveBtn");

    if (editBtn) editBtn.addEventListener("click", openEditModal);
    if (deleteBtn) deleteBtn.addEventListener("click", doDelete);
    if (claimBtn) claimBtn.addEventListener("click", doClaim);
    if (resolveBtn) resolveBtn.addEventListener("click", openResolveModal);
    const reopenBtn = document.getElementById("reopenBtn");
    if (reopenBtn)
      reopenBtn.addEventListener("click", async () => {
        try {
          await API.post("/api/blockages/" + encodeURIComponent(id) + "/reopen");
          toast("Blockage reopened.", "success");
          await load();
        } catch (err) {
          toast(err.message || "Couldn't reopen this blockage.", "error");
        }
      });

    const reassignBtn = document.getElementById("reassignBtn");
    if (reassignBtn) reassignBtn.addEventListener("click", openReassign);

    const studentReopenBtn = document.getElementById("studentReopenBtn");
    if (studentReopenBtn)
      studentReopenBtn.addEventListener("click", async () => {
        try {
          await API.post(
            "/api/blockages/" + encodeURIComponent(id) + "/student-reopen"
          );
          toast("Reopened — someone will help you.", "success");
          await load();
        } catch (err) {
          toast(err.message || "Couldn't reopen this blockage.", "error");
        }
      });

    // Featured AI card: "This unblocked me" and "Still stuck" buttons
    const aiFeatured = document.querySelector(".ai-featured");
    if (aiFeatured) {
      const aiUnblockBtn = aiFeatured.querySelector(".ai-unblock");
      if (aiUnblockBtn) {
        aiUnblockBtn.addEventListener("click", async () => {
          try {
            await API.post("/api/blockages/" + encodeURIComponent(id) + "/ai-resolve");
            toast("Nice — marked as unblocked by AI.", "success");
            await load();
          } catch (err) {
            toast(err.message || "Couldn't update.", "error");
          }
        });
      }
      const stillStuckBtn = document.getElementById("aiStillStuck");
      if (stillStuckBtn) {
        stillStuckBtn.addEventListener("click", () => {
          const ta = document.getElementById("commentBody");
          if (ta) { ta.focus(); ta.scrollIntoView({ behavior: "smooth", block: "center" }); }
        });
      }
    }
  }

  // Staff: inline reassign control — fetch eligible instructors then POST on confirm.
  async function openReassign(e) {
    const btn = e.currentTarget;
    if (document.getElementById("reassignRow")) {
      document.getElementById("reassignRow").remove();
      return;
    }
    let assignees;
    try {
      const data = await API.get(
        "/api/blockages/" + encodeURIComponent(id) + "/assignees"
      );
      assignees = data.assignees || [];
    } catch (err) {
      toast(err.message || "Couldn't load instructors.", "error");
      return;
    }
    if (!assignees.length) {
      toast("No instructors available to assign.", "warning");
      return;
    }
    const opts = assignees
      .map(
        (a) =>
          `<option value="${a.id}" ${
            a.id === blk.assigneeId ? "selected" : ""
          }>${escapeHtml(a.name)}</option>`
      )
      .join("");
    const row = document.createElement("div");
    row.id = "reassignRow";
    row.className = "page-actions";
    row.style.marginBottom = "1.25rem";
    row.innerHTML = `<select class="row-select" id="reassignSelect">${opts}</select>
      <button class="btn btn-primary" id="reassignConfirm">Assign</button>`;
    btn.closest(".page-actions").after(row);
    row
      .querySelector("#reassignConfirm")
      .addEventListener("click", async () => {
        const assigneeId = Number(row.querySelector("#reassignSelect").value);
        try {
          await API.post(
            "/api/blockages/" + encodeURIComponent(id) + "/assign",
            { assigneeId }
          );
          toast("Blockage reassigned.", "success");
          await load();
        } catch (err) {
          toast(err.message || "Couldn't reassign this blockage.", "error");
        }
      });
  }

  async function doDelete() {
    if (!await confirmModal("Delete this blockage? This can't be undone.", { confirmLabel: "Delete blockage", danger: true })) return;
    try {
      await API.del("/api/blockages/" + encodeURIComponent(id));
      toast("Blockage deleted.", "success");
      window.location.href = dashboardFor("student");
    } catch (err) {
      toast(err.message || "Couldn't delete this blockage.", "error");
    }
  }

  async function doClaim() {
    try {
      await API.post("/api/blockages/" + encodeURIComponent(id) + "/claim");
      toast("You're now helping with this.", "success");
      await load();
    } catch (err) {
      toast(err.message || "Couldn't claim this blockage.", "error");
    }
  }

  // ---- Modals (siblings of #app) ---------------------------------------
  function closeModals() {
    document.querySelectorAll(".blk-modal").forEach((m) => m.remove());
  }

  function mountModal(html) {
    closeModals();
    const wrap = document.createElement("div");
    wrap.className = "modal blk-modal";
    wrap.style.display = "flex";
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    // Overlay click closes
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) closeModals();
    });
    wrap.querySelectorAll("[data-close]").forEach((b) =>
      b.addEventListener("click", closeModals)
    );
    return wrap;
  }

  // Edit modal -----------------------------------------------------------
  function openEditModal() {
    const diffOptions = ["low", "medium", "high", "blocker"]
      .map(
        (d) =>
          `<option value="${d}" ${
            blk.difficulty === d ? "selected" : ""
          }>${DIFFICULTY[d]}</option>`
      )
      .join("");

    const wrap = mountModal(`
      <div class="edit_blockage" style="display:block">
        <div class="header">
          <h1>Edit blockage</h1>
          <button type="button" class="close" data-close>&times;</button>
        </div>
        <form id="editForm">
          <label for="editTitle">Title</label>
          <input id="editTitle" type="text" value="${escapeHtml(blk.title)}" required />

          <label for="editDifficulty">Difficulty</label>
          <select id="editDifficulty">${diffOptions}</select>

          <label for="editDetails">Details</label>
          <textarea id="editDetails" required>${escapeHtml(blk.details)}</textarea>

          <input type="submit" value="Save changes" />
        </form>
      </div>`);

    const form = wrap.querySelector("#editForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = form.querySelector("#editTitle").value.trim();
      const difficulty = form.querySelector("#editDifficulty").value;
      const details = form.querySelector("#editDetails").value.trim();
      if (!title || !details) {
        toast("Title and details are required.", "warning");
        return;
      }
      try {
        await API.put("/api/blockages/" + encodeURIComponent(id), {
          title,
          difficulty,
          details,
        });
        closeModals();
        toast("Blockage updated.", "success");
        await load();
      } catch (err) {
        toast(err.message || "Couldn't save your changes.", "error");
      }
    });
  }

  // Resolve modal --------------------------------------------------------
  function openResolveModal() {
    const options = RES_METHODS.map(
      (m, i) => `<div class="flex-column">
        <div>
          <input type="radio" name="resType" id="res-${m.value}" value="${m.value}" ${
        i === 0 ? "checked" : ""
      } />
          <label for="res-${m.value}">${escapeHtml(m.label)}</label>
        </div>
      </div>`
    ).join("");

    const wrap = mountModal(`
      <div class="add_new_blockage" style="display:block">
        <div class="header">
          <h1>Resolve blockage</h1>
          <button type="button" class="close" data-close>&times;</button>
        </div>
        <form id="supportForm">
          <fieldset>
            <legend>How was this resolved?</legend>
            ${options}
          </fieldset>
          <label for="resNote">Note</label>
          <textarea class="supportDetailsContainer" id="resNote" placeholder="Add a short note (optional)…"></textarea>
          <button type="submit">Mark resolved</button>
        </form>
      </div>`);

    const form = wrap.querySelector("#supportForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const checked = form.querySelector('input[name="resType"]:checked');
      const type = checked ? checked.value : RES_METHODS[0].value;
      const note = form.querySelector("#resNote").value.trim();
      try {
        await API.post("/api/blockages/" + encodeURIComponent(id) + "/resolve", {
          type,
          note,
        });
        closeModals();
        toast("Blockage resolved.", "success");
        await load();
      } catch (err) {
        toast(err.message || "Couldn't resolve this blockage.", "error");
      }
    });
  }

  // ---- Go ---------------------------------------------------------------
  if (!id) {
    view.innerHTML = `<div class="blk-empty">Blockage not found.</div>`;
    return;
  }
  await load();

  // Live updates: when an event lands for THIS blockage (new comment, AI reply,
  // claim, resolve, reopen…) refresh the thread + timeline. Debounced so a burst
  // of events triggers a single reload.
  let liveTimer = null;
  onStreamEvent("notification", (data) => {
    if (!data || String(data.blockageId) !== String(id)) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { load(); }, 300);
  });

  // The AI Teaching Assistant replies in the background just after a blockage is
  // reported. Poll briefly so its first response appears without a manual refresh.
  if (blk && blk.status === "open" && !(blk.comments || []).some((c) => c.is_ai)) {
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      await load();
      if (!blk || blk.status !== "open" || (blk.comments || []).some((c) => c.is_ai)) break;
    }
  }
})();
