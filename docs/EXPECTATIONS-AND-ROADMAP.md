# Unblockify — The Promise & the Roadmap

> What each persona *expects* the moment they hear "Unblockify" — before they see anything —
> and the phased plan to make the product live up to it.

The product name is a promise: **you will not stay stuck.** Everything below measures the gap
between that promise and what we ship.

> **Progress:** ✅ **Phase 1 (content fidelity)**, ✅ **Phase 2 (reach & recovery)**, and
> ✅ **Phase 3 (AI depth)** are shipped and verified — markdown/code + attachments; transactional
> email, password reset, email verification, invite emails, notification digest; real-time SSE
> (live bell + thread/board/queue); and the deeper AI wedge: multi-turn follow-up, auto-triage
> (difficulty/topics/urgency), instructor thread summary, owner weekly digest (emailable via
> Phase 2), and proven live-key wiring. ✅ **Phase 4 (success layer)** — Student 360 profiles,
> org tags + tag filtering, saved views, post-resolution CSAT, owner nudges, and canned responses.
> 🟡 **Phase 5 (ops & trust) — core done:** immutable audit log + owner viewer/CSV export, GDPR
> org/user export + right-to-erasure, observability (`/healthz`, structured logs, counters), and CI.
> Remaining (Phase 5b): SLA/escalation, auto-assign, list pagination, full accessibility pass.
> Backend suite at 83/83. Phase 6 + Phase 5b remain.

---

## 1. The Student — "I will never lose a day stuck again"

**What they hear:** something removes my blocks, fast.

**What they imagine before seeing it:**
- Instant help — not "wait for office hours tomorrow." 24/7.
- Judgment-free — I can ask a "dumb" question to an AI without a human watching.
- It *gets my context* — my course, my project, my brief — not generic Google answers.
- It actually unblocks me — a solution, not a ticket number in a void.
- I can *show* my problem — paste my code, screenshot the red error.
- It remembers me — my history, what I already tried.
- It tells me when someone answers — I don't have to keep checking.

**The implicit promise:** *Hit a wall → get moving again in minutes, day or night.*

**We deliver today:** instant AI first response ✅, grounded in cohort/brief ✅, deflection ✅,
thread + status ✅.
**We break the promise where:** can't paste code/screenshots (Phase 1), no notifications outside
the tab / no live updates (Phase 2), AI answers once but can't hold a back-and-forth (Phase 3), no
"my progress" view (Phase 4), can't recover a forgotten password (Phase 2).

---

## 2. The Instructor — "My expertise goes to the 20% that needs a human"

**What they hear:** the AI handles the repetitive stuff; I get leverage.

**What they imagine before seeing it:**
- One prioritized queue — not blocks scattered across Slack, DMs, and hallway questions.
- The trivial 80% already deflected before it reaches me.
- Full context when I open a block — history + what the AI already tried.
- Fast tools to respond — drafts, canned answers, and *code that renders as code*.
- I only see *my* cohorts; work is routed and fairly shared.
- I can see who's drowning and prove my impact.

**The implicit promise:** *Stop answering "how do I center a div" for the 40th time; spend your
hours where they matter.*

**We deliver today:** single queue ✅, claim/resolve/reassign/reopen ✅, AI deflection ✅, AI
copilot draft ✅, cohort scoping ✅.
**We break the promise where:** replies can't format code/markdown (Phase 1), no 5-second AI
catch-up summary of a long thread (Phase 3), no SLA/assignment rules / fairness automation
(Phase 5), no canned responses (Phase 4), queue doesn't update live (Phase 2).

---

## 3. The Organization — "Higher completion, lower support cost, and the proof"

**What they hear:** fewer drop-outs, instructors that scale, numbers for the board.

**What they imagine before seeing it:**
- Visibility — how is each cohort really doing?
- Early warning — catch a student *before* they quit.
- ROI in numbers — hours saved, deflection rate, faster unblock, retention lift.
- A system of record — audit trail, exports, reports for stakeholders/investors.
- Painless onboarding of staff and students; control over roles and data.
- Trust — data isolated per org, secure, compliant, recoverable, billable.

**The implicit promise:** *Measurably higher completion rates and lower cost-to-support — with a
dashboard you can show your board.*

**We deliver today:** analytics + resolve rate + median time ✅, at-risk radar ✅, deflection +
hours-saved ✅, activity feed ✅, roles + true tenant isolation ✅, CSV export ✅, onboarding via
invites ✅.
**We break the promise where:** no weekly "what blocked your cohort" digest / outcomes tracking
(Phase 3/4), no audit log / GDPR data tools / hardened security (Phase 5), no billing/seats
(Phase 6), no SSO (Phase 6), no email or integrations (Phase 2/6).

---

## 4. Roadmap — phases in order, each mapped to the promise it keeps

| Phase | Name | Keeps the promise for | Headline gaps closed |
|---|---|---|---|
| **1** | Content fidelity | Student, Instructor | Markdown + code blocks in threads; file/image/screenshot attachments |
| **2** | Reach & recovery | Student, Instructor, Org | Transactional email (password reset, verify, invite, notif digests); real-time (SSE) live updates |
| **3** | AI depth | All — *the wedge* | Multi-turn AI; AI triage/auto-tag; instructor thread summary; owner weekly cohort digest; live Claude key |
| **4** | Success layer | Student, Org | Student 360 profile; tags/custom fields; saved views; CSAT; nudges/campaigns; canned responses |
| **5** | Ops & trust | Instructor, Org | SLA + business hours + assignment rules; audit log; GDPR export/delete; observability; accessibility; pagination; CI |
| **6** | Commercial | Org | Billing/subscriptions (Stripe); SSO + 2FA; public API + webhooks + API keys; help center; integrations (Slack/LMS/calendar) |

**Principle for "keep it local":** external services (email, Stripe, SSO) follow the AI pattern —
a **local-first default** (console/file email transport, mock billing) that becomes real when the
relevant env var is set. The app always runs and demos with zero external dependencies.

Detailed implementation plans for each phase live in `docs/superpowers/plans/`.
