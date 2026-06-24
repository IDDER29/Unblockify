/* Plan & billing page — owner only. Shows current plan, usage, and upgrade path. */

(async function () {
  const s = await requireRole("owner");
  if (!s) return;

  const view = renderShell({
    user: s.user, org: s.org, active: "billing.html",
    title: "Plan & billing", crumb: "Owner / Billing",
  });

  // Load usage stats to show against plan limits.
  let a = null;
  try { a = await API.get("/api/analytics"); } catch (_) {}

  const students = a ? ((a.byCohort || []).reduce((sum, c) => sum + (c.open || 0) + (c.in_support || 0) + (c.resolved || 0), 0)) : "—";
  const cohorts = a ? (a.byCohort || []).length : "—";
  const instructors = a ? (a.byInstructor || []).length : "—";
  const totalBlk = a ? (a.total || 0) : "—";

  view.innerHTML = `
    <div class="page-head">
      <h1>Plan &amp; billing</h1>
      <p>Your current plan, usage, and how to grow when you're ready.</p>
    </div>

    <div class="panel" style="margin-bottom:1.25rem;border-left:3px solid var(--flow,#12B886)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:1rem">
        <div>
          <div class="mono" style="font-size:.78rem;color:var(--muted,#666);margin-bottom:.25rem">CURRENT PLAN</div>
          <div style="font-size:1.5rem;font-weight:700;font-family:var(--font-display,'Space Grotesk'),sans-serif">Free</div>
          <div style="color:var(--muted,#666);font-size:.9rem;margin-top:.25rem">Everything you need to get started — unlimited, no card required.</div>
        </div>
        <div>
          <span class="pill pill-resolved" style="font-size:.8rem;padding:.3rem .7rem">Active</span>
        </div>
      </div>
    </div>

    <section class="stat-row" style="margin-bottom:1.5rem">
      <div class="stat"><div class="k">Cohorts</div><div class="v">${cohorts}</div></div>
      <div class="stat"><div class="k">Instructors</div><div class="v">${instructors}</div></div>
      <div class="stat is-resolved"><div class="k">Total blockages</div><div class="v">${totalBlk}</div></div>
    </section>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin-bottom:1.5rem">

      <div class="panel">
        <div class="mono" style="font-size:.72rem;color:var(--muted,#666);margin-bottom:.5rem">FREE</div>
        <div style="font-size:1.3rem;font-weight:700;margin-bottom:.25rem">$0 / month</div>
        <div style="color:var(--muted,#666);font-size:.85rem;margin-bottom:1rem">Forever. No credit card.</div>
        <ul class="timeline" style="margin:0 0 1rem;font-size:.9rem">
          <li class="ev-resolved"><div class="ev-t">Unlimited blockages</div></li>
          <li class="ev-resolved"><div class="ev-t">AI Teaching Assistant</div></li>
          <li class="ev-resolved"><div class="ev-t">Resolution library</div></li>
          <li class="ev-resolved"><div class="ev-t">Analytics dashboard</div></li>
          <li class="ev-resolved"><div class="ev-t">Student growth fingerprint</div></li>
        </ul>
        <span class="pill pill-resolved" style="font-size:.8rem">Your current plan</span>
      </div>

      <div class="panel" style="border:2px solid var(--flow,#12B886)">
        <div class="mono" style="font-size:.72rem;color:var(--flow,#12B886);margin-bottom:.5rem">PRO — COMING SOON</div>
        <div style="font-size:1.3rem;font-weight:700;margin-bottom:.25rem">$300–800 / month</div>
        <div style="color:var(--muted,#666);font-size:.85rem;margin-bottom:1rem">Per cohort. Cancel any time.</div>
        <ul class="timeline" style="margin:0 0 1rem;font-size:.9rem">
          <li class="ev-resolved"><div class="ev-t">Everything in Free</div></li>
          <li class="ev-resolved"><div class="ev-t">Cross-cohort benchmarking</div></li>
          <li class="ev-resolved"><div class="ev-t">Predictive dropout alerts</div></li>
          <li class="ev-resolved"><div class="ev-t">SLA enforcement + escalation</div></li>
          <li class="ev-resolved"><div class="ev-t">Priority AI model (Claude Opus)</div></li>
          <li class="ev-resolved"><div class="ev-t">CSV / API data export</div></li>
          <li class="ev-resolved"><div class="ev-t">Slack + webhook integrations</div></li>
          <li class="ev-resolved"><div class="ev-t">Custom brief AI grounding</div></li>
        </ul>
        <button class="btn btn-primary" id="notifyBtn" type="button">Notify me when Pro launches</button>
      </div>

      <div class="panel">
        <div class="mono" style="font-size:.72rem;color:var(--muted,#666);margin-bottom:.5rem">ENTERPRISE</div>
        <div style="font-size:1.3rem;font-weight:700;margin-bottom:.25rem">Custom</div>
        <div style="color:var(--muted,#666);font-size:.85rem;margin-bottom:1rem">For institutions with 10+ cohorts.</div>
        <ul class="timeline" style="margin:0 0 1rem;font-size:.9rem">
          <li class="ev-resolved"><div class="ev-t">Everything in Pro</div></li>
          <li class="ev-resolved"><div class="ev-t">SSO / SAML</div></li>
          <li class="ev-resolved"><div class="ev-t">LMS integration (Canvas, Moodle)</div></li>
          <li class="ev-resolved"><div class="ev-t">Data residency options</div></li>
          <li class="ev-resolved"><div class="ev-t">Dedicated support SLA</div></li>
          <li class="ev-resolved"><div class="ev-t">Hiring signal marketplace (opt-in)</div></li>
        </ul>
        <a class="btn btn-ghost" href="mailto:hello@unblockify.app?subject=Enterprise%20inquiry">Contact us</a>
      </div>
    </div>

    <div class="panel" style="background:var(--surface-2,#f8f9fb)">
      <h3 style="margin-bottom:.5rem">Why upgrade?</h3>
      <p style="color:var(--muted,#666);font-size:.9rem;max-width:600px">
        A generic queue tool is $30–50/month. A platform that predicts dropout and proves curriculum ROI is worth $300–800/month per cohort — same codebase, completely different positioning.
        The Pro tier turns your blockage data into evidence that justifies your tuition. <strong>The work is in the proof, not the features.</strong>
      </p>
    </div>

    <div class="modal" id="notifyModal" role="dialog" aria-modal="true" aria-labelledby="notifyModalTitle" style="display:none">
      <div class="modal-panel">
        <div class="modal-head"><h2 id="notifyModalTitle">Get notified when Pro launches</h2></div>
        <div class="modal-body">
          <p style="color:var(--muted,#666);margin-bottom:1rem">We'll email you as soon as Pro is available. No spam — one email, that's it.</p>
          <div class="form-row">
            <label for="notifyEmail">Email</label>
            <input type="email" id="notifyEmail" value="${escapeHtml(s.user.email)}" />
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-primary" id="notifySubmit" type="button">Notify me</button>
          <button class="btn btn-ghost" id="notifyClose" type="button">Cancel</button>
        </div>
      </div>
    </div>`;

  const modal = document.getElementById("notifyModal");

  document.getElementById("notifyBtn").addEventListener("click", () => {
    modal.style.display = "flex";
  });
  document.getElementById("notifyClose").addEventListener("click", () => {
    modal.style.display = "none";
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });

  document.getElementById("notifySubmit").addEventListener("click", async () => {
    const email = document.getElementById("notifyEmail").value.trim();
    if (!email) { toast("Enter your email.", "error"); return; }
    // Store interest locally (no backend needed for a placeholder).
    localStorage.setItem("unblockify_pro_notify", email);
    modal.style.display = "none";
    toast("We'll let you know when Pro launches. 🎉", "success");
  });
})();
