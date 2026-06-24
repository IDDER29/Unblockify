/* Student portfolio page — preview and export full learning history as JSON. */
(async function () {
  const s = await requireRole("student");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "portfolio.html",
    title: "My portfolio",
    crumb: "My portfolio",
  });

  view.innerHTML = `<div id="port-root"><p class="thread-empty">Loading your portfolio…</p></div>`;
  const el = document.getElementById("port-root");

  let portfolio;
  try {
    portfolio = await API.get("/api/auth/me/export.json");
  } catch (e) {
    el.innerHTML = `<div class="blk-empty">Couldn't load portfolio data.</div>`;
    return;
  }

  const st = portfolio.stats || {};
  const blk = portfolio.blockages || [];

  function statCard(k, v) {
    return `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${v}</div></div>`;
  }

  const topTopics = (st.topTopics || []).slice(0, 5);

  el.innerHTML = `
    <div class="page-head">
      <h1>My portfolio</h1>
      <p>Your complete learning journey — every blockage, every resolution, exported as a shareable record of what you've pushed through.</p>
    </div>

    <section class="profile-grid" style="margin-bottom:1.5rem">
      ${statCard("Total blockages", st.total || 0)}
      ${statCard("Resolved", st.resolved || 0)}
      ${statCard("AI-resolved", st.aiResolved || 0)}
      ${statCard("Median time to unblock", `${st.medianHours || 0}h`)}
      ${st.avgCsat ? statCard("Avg satisfaction", `${st.avgCsat}★`) : statCard("Satisfaction", "—")}
    </section>

    ${topTopics.length ? `
    <div class="chart-card" style="margin-bottom:1.25rem">
      <h3>Your top topics</h3>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem">
        ${topTopics.map(t => `<span class="atrisk-tag">${escapeHtml(t)}</span>`).join("")}
      </div>
      <p style="font-size:.83rem;color:var(--muted);margin-top:.75rem">These are the concepts you've worked hardest to master. They belong in your portfolio — they show depth, not weakness.</p>
    </div>` : ""}

    <div class="chart-card" style="margin-bottom:1.25rem">
      <h3>What this portfolio shows</h3>
      <p style="font-size:.9rem;color:var(--muted);margin-top:.5rem">
        This isn't just a list of bugs — it's evidence of how you approach being stuck. Every blockage shows you identified the problem, reached for help, and kept going.
        Share it with employers to demonstrate that you debug methodically, learn from every obstacle, and don't give up.
      </p>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem">
        <button class="btn btn-primary" id="downloadBtn">Download JSON portfolio</button>
        <a class="btn btn-ghost" href="history.html">View all blockages</a>
        <a class="btn btn-ghost" href="growth.html">See my growth</a>
      </div>
    </div>

    ${blk.length ? `
    <div class="chart-card">
      <h3>Recent blockages (preview)</h3>
      <div class="blk-grid" style="margin-top:.75rem">
        ${blk.slice(0, 6).map(b => {
          const m = statusMeta(b.status);
          return `<a class="blk-card linkish" href="blockage.html?id=${encodeURIComponent(b.id)}" style="text-decoration:none;color:inherit">
            <div class="blk-card-top">
              <span class="blk-id">BLK-${escapeHtml(String(b.id))}</span>
              <span class="pill pill-${m.cls}">${escapeHtml(m.label)}</span>
            </div>
            <h3>${escapeHtml(b.title)}</h3>
            <div class="blk-meta">
              ${escapeHtml(fmtRelative(b.created_at))}
              ${b.resolved_at ? ` · resolved ${escapeHtml(fmtRelative(b.resolved_at))}` : ""}
            </div>
          </a>`;
        }).join("")}
      </div>
      ${blk.length > 6 ? `<p style="font-size:.85rem;color:var(--muted);margin-top:.75rem">+ ${blk.length - 6} more in the full export.</p>` : ""}
    </div>` : ""}`;

  document.getElementById("downloadBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(portfolio, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `unblockify-portfolio-${(s.user.name || "student").replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Portfolio downloaded.", "success");
  });
})();
