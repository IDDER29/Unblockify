/* Help & FAQ — available to all logged-in roles. */
(async function () {
  const s = await requireRole("owner", "instructor", "student");
  if (!s) return;
  const role = s.user.role;

  const view = renderShell({
    user: s.user,
    org: s.org,
    active: "help.html",
    title: "Help & FAQ",
    crumb: "Help",
  });

  function faq(q, a) {
    return `<details class="faq-item" style="border-bottom:1px solid var(--line,#e8e8e8);padding:.75rem 0">
      <summary style="font-weight:600;cursor:pointer;font-size:.97rem;list-style:none;display:flex;justify-content:space-between;align-items:center">
        ${escapeHtml(q)}
        <span style="font-size:1.2rem;color:var(--flow,#12B886);flex-shrink:0;margin-left:.5rem">+</span>
      </summary>
      <div style="margin-top:.6rem;font-size:.92rem;color:var(--muted,#555);line-height:1.65">${a}</div>
    </details>`;
  }

  view.innerHTML = `
    <div class="page-head">
      <h1>Help &amp; FAQ</h1>
      <p>Quick answers to the most common questions — no ticket required.</p>
    </div>

    ${role === "student" ? `
    <div class="chart-card" style="margin-bottom:1.25rem">
      <h3>How to write a great blockage</h3>
      <ol style="font-size:.92rem;color:var(--muted);padding-left:1.25rem;line-height:1.7;margin:.5rem 0 0">
        <li><strong>State what you expected to happen</strong> and what actually happened instead.</li>
        <li><strong>Share what you've already tried.</strong> "I've tried X and Y" tells the AI and your instructor exactly where you are.</li>
        <li><strong>Include the error message</strong> if there is one — the exact text, not a paraphrase.</li>
        <li><strong>Be specific about where in the curriculum you are.</strong> "Week 3, React module, lesson on useEffect" gives the AI the right context.</li>
        <li><strong>Keep it to one blockage at a time.</strong> If you're stuck on two things, report two blockages.</li>
      </ol>
      <div style="margin-top:1rem;padding:.75rem 1rem;background:var(--surface-2);border-radius:8px;font-size:.88rem">
        <strong>Example:</strong> "I'm trying to fetch data from an API on component mount using useEffect. I expected the data to appear after the component renders, but the array is always empty. I've tried adding the URL to the dependency array and removing it — same result. Error: none, but console.log shows the fetch runs before the state updates."
      </div>
    </div>` : ""}

    <div class="chart-card" style="margin-bottom:1.25rem">
      <h3>Frequently asked questions</h3>
      <div style="margin-top:.25rem">

        ${role === "student" ? `
        ${faq("What does the AI Teaching Assistant do?", "The AI responds to every new blockage within minutes with a Socratic question — designed to help you think through the problem rather than just give you the answer. It's grounded in your cohort's specific curriculum and tech stack. If it unblocks you, click 'This unblocked me'. If not, keep the thread open — your instructor will see it.")}
        ${faq("Can I ask the AI follow-up questions?", "Yes. After the AI's first response, you can click 'Ask a follow-up' up to two times to continue the conversation. After that, the blockage escalates to an instructor automatically.")}
        ${faq("What if I don't want to use my name?", "When reporting a blockage, check the 'Report anonymously' box. Your name will be hidden from instructors in list views. The blockage is still attached to your account and you'll still receive notifications about it.")}
        ${faq("How long does it take for an instructor to respond?", "The AI responds in under 5 minutes. If it doesn't unblock you, an instructor typically claims and responds within a few hours during learning hours. You'll get a notification when your blockage is claimed or resolved.")}
        ${faq("Can I reopen a resolved blockage?", "Yes. If a blockage is marked as resolved by an instructor but you're still stuck, click 'Reopen' on the blockage detail page. If it was AI-resolved, you can also reopen it if the AI's answer wasn't enough.")}
        ${faq("What is the Knowledge Library?", "The Library shows resolved blockages from your cohort — with the original question and the resolution — as a searchable Q&A. It's built automatically from every blockage your cohort has resolved. Check it before reporting a new one; someone may have hit the same wall.")}
        ${faq("What is the Growth page?", "The Growth page shows your personal stats: how many blockages you've resolved, how long they took, your most common topics, and a growth fingerprint. It also shows a weekly digest of your progress and a preview of what topics are coming up for your cohort.")}
        ` : ""}

        ${role === "instructor" ? `
        ${faq("How does claiming a blockage work?", "When you claim a blockage, it moves from the unclaimed queue into 'In support' and is assigned to you. Other instructors can see it's claimed. You can unclaim it if needed, or resolve it with a closing comment.")}
        ${faq("What is the AI copilot draft?", "When you're writing a resolution or comment, click 'Draft a reply' to get an AI-suggested response based on the blockage, the thread, and past resolutions for similar problems. You can edit it freely before sending.")}
        ${faq("How do I flag a student for a check-in?", "Open the student's profile page (click their name from the queue or blockage detail). Click 'Flag for check-in' and add an optional note. The check-in appears in the Check-ins page and on the owner dashboard's at-risk list.")}
        ${faq("Can I write internal notes on a blockage?", "Yes. When posting a comment, check 'Internal note'. The comment is visible to staff but not to the student — useful for flagging concerns or coordinating with the owner.")}
        ${faq("How are blockages assigned to me?", "The queue shows all unclaimed blockages for your assigned cohorts. You claim them yourself. Owners can also reassign specific blockages to you directly.")}
        ` : ""}

        ${role === "owner" ? `
        ${faq("How do I invite instructors and students?", "Go to Members → Invite. Generate an invite link or code for each role. Instructors and students open the link to create their account and join your org automatically.")}
        ${faq("What is a cohort brief?", "A brief is a text document that grounds the AI Teaching Assistant in your specific curriculum. Include the current week, the tech stack, what students are working on, and any common pitfalls. The AI reads it before responding to any blockage in that cohort.")}
        ${faq("How does the at-risk radar work?", "The radar flags students with 3+ open blockages, multiple blockages on the same topic, or a long average resolution time. These students appear in the owner dashboard and in each student's profile. Flag them for a check-in or send a nudge from their profile page.")}
        ${faq("How do I export blockage data?", "Owner Blockages → Export CSV to download all blockages with their status, timestamps, and resolution types. You can also filter by date range first.")}
        ${faq("Can I change a member's role or cohort?", "Yes. Go to Members, find the member, and use the edit options to change their cohort assignment or role. Role changes take effect on their next login.")}
        ` : ""}

        ${faq("How do I change my password?", `Go to <a href="settings.html">Settings</a> to change your password. You'll need your current password.`)}
        ${faq("How do I report a bug or give feedback?", `Email <a href="mailto:hello@unblockify.app">hello@unblockify.app</a> — we read every message.`)}
      </div>
    </div>

    <div class="chart-card" style="background:var(--surface-2,#f8f9fb)">
      <h3>Still stuck?</h3>
      <p style="font-size:.9rem;color:var(--muted);margin:.5rem 0 1rem">We're here. Email us and we'll get back to you — usually within a day.</p>
      <a class="btn btn-primary" href="mailto:hello@unblockify.app">Email support</a>
    </div>`;

  // Animate the + on open/close
  document.querySelectorAll(".faq-item").forEach(d => {
    d.addEventListener("toggle", () => {
      const ico = d.querySelector("summary span");
      if (ico) ico.textContent = d.open ? "−" : "+";
    });
  });
})();
