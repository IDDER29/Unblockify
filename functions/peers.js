/* Peer support — opt-in peer mentor matching for students. */
(async function () {
  const s = await requireRole("student");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "peers.html",
    title: "Peer support",
    crumb: "Peer support",
  });

  // Load opt-in status and peer list
  let optIn = false;
  let peers = [];
  try {
    const data = await API.get("/api/me/peers");
    optIn = !!data.optedIn;
    peers = data.peers || [];
  } catch (_) {}

  function render() {
    view.innerHTML = `
      <div class="page-head">
        <h1>Peer support</h1>
        <p>Connect with cohort members who've opted in to help each other through blockages. No instructor needed.</p>
      </div>

      <div class="chart-card" style="margin-bottom:1.25rem">
        <h3>Your peer mentor status</h3>
        <p style="font-size:.9rem;color:var(--muted);margin:.5rem 0 1rem">
          Opt in to appear as a peer supporter for other students in your cohort. You choose who to help and when — no commitment required.
          ${optIn ? `<br><strong style="color:var(--flow,#12B886)">You're currently opted in.</strong> Other students can see you're available.` : ""}
        </p>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap">
          ${optIn
            ? `<button class="btn btn-ghost" id="optOutBtn">Opt out of peer support</button>`
            : `<button class="btn btn-primary" id="optInBtn">Opt in as a peer supporter</button>`}
        </div>
      </div>

      <div class="chart-card">
        <h3>Available peer supporters in your cohort</h3>
        ${peers.length
          ? `<div class="blk-grid" style="margin-top:.75rem">
              ${peers.map(p => `
                <div class="blk-card" style="display:flex;align-items:center;gap:1rem">
                  <div style="width:40px;height:40px;border-radius:50%;background:var(--flow,#12B886);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;flex-shrink:0">
                    ${escapeHtml((p.name || "?")[0].toUpperCase())}
                  </div>
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:600">${escapeHtml(p.name)}</div>
                    <div style="font-size:.8rem;color:var(--muted)">Available for peer support</div>
                  </div>
                </div>`).join("")}
            </div>`
          : `<p class="muted" style="margin-top:.75rem">No peer supporters have opted in yet${s.user.cohortName ? ` in ${escapeHtml(s.user.cohortName)}` : ""}. Be the first!</p>`}
        <p style="font-size:.82rem;color:var(--muted);margin-top:1rem">Reach out to peer supporters directly via your cohort's communication channel (Slack, Discord, etc.).</p>
      </div>

      <div class="chart-card" style="margin-top:1.25rem;background:var(--surface-2,#f8f9fb)">
        <h3>How peer support works</h3>
        <ul style="font-size:.9rem;color:var(--muted);margin:.5rem 0 0;padding-left:1.25rem">
          <li>Opt in to let cohort members know you're willing to help.</li>
          <li>Nobody can see your blockage history — just your name and availability.</li>
          <li>Opt out any time, instantly.</li>
          <li>If a blockage needs an instructor, it still goes through the normal queue — peer support is additional, not a replacement.</li>
        </ul>
      </div>`;

    if (document.getElementById("optInBtn")) {
      document.getElementById("optInBtn").addEventListener("click", async () => {
        try {
          await API.post("/api/me/peers/opt-in", {});
          optIn = true;
          toast("You're now visible as a peer supporter.", "success");
          const data = await API.get("/api/me/peers");
          peers = data.peers || [];
          render();
        } catch (e) { toast(e.message || "Couldn't opt in.", "error"); }
      });
    }
    if (document.getElementById("optOutBtn")) {
      document.getElementById("optOutBtn").addEventListener("click", async () => {
        try {
          await API.post("/api/me/peers/opt-out", {});
          optIn = false;
          toast("You've opted out of peer support.", "success");
          const data = await API.get("/api/me/peers");
          peers = data.peers || [];
          render();
        } catch (e) { toast(e.message || "Couldn't opt out.", "error"); }
      });
    }
  }

  render();
})();
