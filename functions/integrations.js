/* Integrations — owner-only: Slack, webhooks, future LMS integrations. */
(async function () {
  const s = await requireRole("owner");
  if (!s) return;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "integrations.html",
    title: "Integrations",
    crumb: "Owner / Integrations",
  });

  view.innerHTML = `<div id="int-root"><p class="thread-empty">Loading…</p></div>`;
  const el = document.getElementById("int-root");

  let current = {};
  try {
    current = await API.get("/api/org/integrations");
  } catch (_) {}

  el.innerHTML = `
    <div class="page-head">
      <h1>Integrations</h1>
      <p>Connect Unblockify to the tools your team already uses.</p>
    </div>

    <!-- Slack -->
    <div class="chart-card" style="margin-bottom:1.25rem">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem">
        <div style="width:40px;height:40px;border-radius:8px;background:#4A154B;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem">S</div>
        <div>
          <div style="font-weight:600;font-size:1.05rem">Slack</div>
          <div style="font-size:.82rem;color:var(--muted)">Post a message to a Slack channel when a new blockage is reported.</div>
        </div>
        <div style="margin-left:auto">
          ${current.slackWebhookUrl
            ? `<span class="pill pill-resolved" style="font-size:.78rem">Connected</span>`
            : `<span class="pill pill-blocked" style="font-size:.78rem">Not connected</span>`}
        </div>
      </div>
      <div class="form-row">
        <label for="slackUrl">Slack Incoming Webhook URL</label>
        <input type="url" id="slackUrl" placeholder="https://hooks.slack.com/services/…" value="${escapeHtml(current.slackWebhookUrl || "")}" />
        <p class="form-hint">Create a webhook at <a href="https://api.slack.com/apps" target="_blank" rel="noopener">api.slack.com/apps</a> → Incoming Webhooks → Add New Webhook to Workspace.</p>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="slackSave">Save Slack webhook</button>
        ${current.slackWebhookUrl ? `<button class="btn btn-ghost btn-sm" id="slackClear">Remove</button>` : ""}
      </div>
      <div id="slackMsg" style="font-size:.85rem;margin-top:.5rem"></div>
    </div>

    <!-- Webhook (coming soon) -->
    <div class="chart-card" style="margin-bottom:1.25rem;opacity:.65">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem">
        <div style="width:40px;height:40px;border-radius:8px;background:var(--ink,#0C111B);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">⇢</div>
        <div>
          <div style="font-weight:600;font-size:1.05rem">Custom webhooks <span class="pill" style="font-size:.72rem;background:var(--surface-2);color:var(--muted)">Coming soon</span></div>
          <div style="font-size:.82rem;color:var(--muted)">POST to your own endpoint on blockage events — for Zapier, Make, or your own pipeline.</div>
        </div>
      </div>
    </div>

    <!-- LMS (coming soon) -->
    <div class="chart-card" style="opacity:.65">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem">
        <div style="width:40px;height:40px;border-radius:8px;background:#E66000;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:.9rem">LMS</div>
        <div>
          <div style="font-weight:600;font-size:1.05rem">Canvas / Moodle <span class="pill" style="font-size:.72rem;background:var(--surface-2);color:var(--muted)">Enterprise</span></div>
          <div style="font-size:.82rem;color:var(--muted)">Sync cohorts and students from your LMS. Available on the Enterprise plan.</div>
        </div>
      </div>
      <a class="btn btn-ghost btn-sm" href="mailto:hello@unblockify.app?subject=Enterprise%20LMS%20integration">Contact us about Enterprise</a>
    </div>`;

  async function saveSlack() {
    const url = document.getElementById("slackUrl").value.trim();
    const msg = document.getElementById("slackMsg");
    try {
      await API.put("/api/org/integrations/slack", { webhookUrl: url });
      msg.textContent = url ? "Slack webhook saved." : "Slack webhook removed.";
      msg.style.color = "var(--flow,#12B886)";
      toast(url ? "Slack connected." : "Slack disconnected.", "success");
      // Refresh to update the connected/not-connected pill
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      msg.textContent = e.message || "Couldn't save.";
      msg.style.color = "var(--blocked)";
    }
  }

  document.getElementById("slackSave").addEventListener("click", saveSlack);
  const clearBtn = document.getElementById("slackClear");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      document.getElementById("slackUrl").value = "";
      await saveSlack();
    });
  }
})();
