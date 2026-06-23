# Unblockify — Phased Roadmap to 10x → 100x
*Sequenced by dependency. Each Epoch → multiple Phases → each Phase is independently shippable.*
*Grounded in `10x-100x-plan.md` (adversarial research) and an audit of what already exists.*

---

## Legend

- 🟢 **EXISTS** — already shipped; this work *extends* it
- 🟡 **PARTIAL** — foundation exists, needs real capability layered on
- 🔴 **NEW** — net-new build
- `⟶` **depends on** — must ship after the named phase
- Each Phase lists: **Scope · Backend · Frontend · Schema · Tests · Done-when**

---

## What already exists (audit, so we don't re-plan it)

| Capability | Status | Where |
|---|---|---|
| AI first response (Socratic, brief-grounded) | 🟢 | `ai.js unblock()` |
| AI multi-turn follow-up (bounded, capped) | 🟢 | `ai.js followup()` |
| AI triage (difficulty/topics/urgency) | 🟢 | `ai.js triage()` |
| Thread summary for instructors | 🟢 | `ai.js summarize()` |
| Resolved-blockage clustering | 🟢 | `retrieval.js clusterResolved()` |
| Weekly digest (theme clusters) | 🟢 | `analytics.js /analytics/digest` |
| At-risk students (list + reasons) | 🟡 | `analytics.js atRisk` — **list only, no actions** |
| Topic counts | 🟡 | `analytics.js byTopic` — **counts only, no hot-spot intelligence** |
| Similar-resolved retrieval (instructor side) | 🟡 | `retrieval.js similarResolved()` — **not student-facing** |

**The insight:** we are not starting from zero. The AI engine is built. The 10x is mostly about
**surfacing existing intelligence into action**, and the 100x is about **closing loops** the
engine already has the data for.

---

# EPOCH 1 — Close the Action Gaps (10x)
*Theme: every piece of intelligence the system already computes must become a one-click action.*
*This is the highest-ROI epoch because the backend largely exists — we're wiring it to outcomes.*

### Phase 1.1 — At-Risk Action Workflow 🟡⟶ nothing (start here)
> Research, 3-of-3 votes: *prediction without workflow moves zero outcomes.* We already predict.

- **Scope:** Turn the read-only at-risk panel into an intervention queue with tracked outcomes.
- **Backend:**
  - `POST /api/students/:id/nudge` — writes a notification (+ optional email via existing outbox).
  - `POST /api/students/:id/flag` — creates a private instructor task (`check_ins` table).
  - `GET /api/analytics/at-risk` — extend existing payload with `lastInterventionAt`, `recovered` bool.
  - Recovery detection: at-risk student who resolves a blockage within N days of a flag → `recovered=true`.
- **Frontend:** each at-risk row gets `[Send nudge] [View blockages] [Flag for check-in]`; owner sees recovery rate.
- **Schema:** 🔴 `check_ins(id, org_id, student_id, instructor_id, note, status, created_at, resolved_at)`.
- **Tests:** nudge writes notification; flag creates check-in; recovery flips on timely resolve; cross-tenant 404.
- **Done-when:** an owner can act on every at-risk student in one tap and see who recovered.

### Phase 1.2 — Curriculum Hot-Spots 🟡 ⟶ 1.1 (reuses clustering)
> Research: mistake-pattern data is the most adoptable analytics (students accept it).

- **Scope:** Promote `byTopic` counts + `clusterResolved` into a real "where the cohort breaks" surface.
- **Backend:**
  - `GET /api/analytics/hotspots?cohortId=&windowDays=` — cluster *open + resolved* by topic, return
    `{topic, count, medianResolveHours, reopenRate, trend[]}`.
  - Threshold trigger: 3+ blockages on one topic in 7 days → owner notification (dedup per topic/week).
- **Frontend:** owner dashboard "Curriculum hot-spots" card (ranked, with sparkline); cohort detail per-topic weekly sparkline.
- **Schema:** 🔴 `hotspot_alerts(id, org_id, cohort_id, topic, week, created_at)` (dedup key: org+cohort+topic+week).
- **Tests:** clustering groups correctly; threshold fires once per topic/week; trend array shape.
- **Done-when:** owner opens dashboard and sees "7 students stuck on async this week" without asking.

### Phase 1.3 — Instructor "AI Needs Backup" Segment 🟡 ⟶ nothing (parallel to 1.1/1.2)
> Research: tutors intervene on 25.6% of AI messages — for pacing & social-emotional nuance.

- **Scope:** A queue segment surfacing blockages where the AI engaged but the student is still stuck.
- **Backend:**
  - Derive "needs backup": blockage `open`, has ≥1 AI comment, student commented *after* the AI, no
    instructor reply, age > 30 min. Add as a computed flag on the existing `/api/blockages` payload.
  - Optional AI self-confidence: `followup`/`unblock` returns a `confidence` 0–1; persist on the comment.
- **Frontend:** new filter chip "AI needs backup (N)"; amber dot on low-confidence cards; one-click
  "Take over" on the AI featured card (claims + focuses composer).
- **Schema:** 🔴 add `ai_confidence REAL` to `comments` (nullable, idempotent ALTER).
- **Tests:** backup flag logic (all four conditions); confidence persisted; take-over claims atomically.
- **Done-when:** instructor sees "AI handled 18 of 23 this week — these 5 need you" and acts in one tap.

**Epoch 1 ships:** the three existing-but-inert intelligences (at-risk, topics, AI involvement)
become action surfaces. No new AI models. Pure leverage.

---

# EPOCH 2 — Deflect Before It's Reported (10x)
*Theme: stop duplicate blockages at the source; give students a reason to return.*

### Phase 2.1 — Resolution Summaries (data foundation) 🔴 ⟶ nothing
- **Scope:** Every resolve generates a durable "what finally worked" summary — the KB atom.
- **Backend:** on resolve, `ai.js resolutionSummary({thread})` → 1–2 sentences; store on blockage.
  Deterministic fallback = last instructor comment, trimmed.
- **Schema:** 🔴 `resolution_summary TEXT` on `blockages`.
- **Tests:** summary written on resolve; fallback path with no key; not overwritten on reopen→resolve.
- **Done-when:** every resolved blockage carries a one-glance summary.

### Phase 2.2 — Student-Facing Knowledge Search 🟡 ⟶ 2.1 (needs summaries)
> Highest-leverage deflection: the duplicate never gets filed.

- **Scope:** Make `similarResolved` student-facing as live pre-search in the report form.
- **Backend:** `GET /api/knowledge?q=` — semantic+keyword over `resolution_summary` (org-scoped, resolved only).
  Respect visibility: a student sees their cohort's resolutions (reuse `canSeeBlockage` rules).
- **Frontend:** report-blockage form — as the student types the title, show "3 students had this →
  here's what worked"; one click opens the resolved blockage read-only.
- **Schema:** none (reads 2.1).
- **Tests:** search ranks by overlap; respects cohort visibility; excludes open blockages; cross-tenant 404.
- **Done-when:** typing a title surfaces prior fixes *before* the student submits.

### Phase 2.3 — Knowledge Base Browse Page 🔴 ⟶ 2.2
- **Scope:** A browsable, org-internal KB of resolved blockages by topic.
- **Backend:** `GET /api/knowledge/browse?topic=` paginated.
- **Frontend:** new `knowledge.html` + `knowledge.js` (shell page, role-aware); topic filter; search box.
- **Schema:** none.
- **Tests:** pagination; topic filter; visibility scoping.
- **Done-when:** students/instructors can browse "everything we've already solved."

### Phase 2.4 — Student Momentum View 🔴 ⟶ nothing (parallel)
> Research: personal progress = adoptable. Social comparison = harmful. Personal-only by design.

- **Scope:** Each student sees their own unblocking trajectory. No rankings, ever.
- **Backend:** `GET /api/me/momentum` — total cleared, fastest resolve, active days, top stuck-topics.
- **Frontend:** student dashboard stats strip + "Your history" tab (timeline of past blockages).
- **Schema:** none (aggregates existing rows).
- **Tests:** counts correct; only own data; no cross-student leakage.
- **Done-when:** student sees "You've cleared 14 this term" — and comes back to watch it grow.

**Epoch 2 ships:** the self-building knowledge base becomes a deflection engine and a student
habit surface. Duplicate-rate and DAU/WAU become the tracked metrics.

---

# EPOCH 3 — Deepen the AI Dialogue (10x→100x bridge)
*Theme: the AI stops being one-shot-plus-followup and becomes a real progressive tutor.*

### Phase 3.1 — Progressive Scaffold Levels 🟢 ⟶ Epoch 1 (extends `followup`)
> Harvard RCT: gains came from *graduated reveal* — hint → question → example → solution.

- **Scope:** Formalize follow-up into explicit scaffold levels with a student-driven "Show me more."
- **Backend:** `followup` takes a `scaffoldLevel`; level controls how much the AI reveals.
  Brief can cap max level per topic. Persist level on each AI comment.
- **Frontend:** "Show me more" button on the AI card advances one level; "I'm still stuck" jumps to
  human (ties into Epoch 1.3 backup).
- **Schema:** 🔴 `scaffold_level INTEGER` on `comments`; optional `max_scaffold` on `briefs`.
- **Tests:** level monotonic; respects brief cap; final level offers human handoff.
- **Done-when:** a student can climb from hint to full solution at their own pace.

### Phase 3.2 — Self-Confidence & Auto-Escalation 🟡 ⟶ 3.1 + 1.3
- **Scope:** AI rates its own answer; low confidence auto-flags for backup (no student action needed).
- **Backend:** confidence from 3.1 feeds the 1.3 backup flag automatically; threshold configurable.
- **Schema:** reuses `ai_confidence` from 1.3.
- **Tests:** low-confidence auto-enters backup queue; high-confidence does not.
- **Done-when:** the AI knows when it's out of its depth and hands off proactively.

**Epoch 3 ships:** the wedge (AI TA) reaches the *engineered* quality the research says produces
real learning gains — and it self-supervises into the human queue.

---

# EPOCH 4 — The Self-Improving Curriculum (100x)
*Theme: the product stops being a support tool and becomes a curriculum feedback loop.*
*Every epoch before this fed the data this one consumes.*

### Phase 4.1 — Brief Versioning 🔴 ⟶ Epoch 1.2 (hot-spots) + Epoch 2.1 (summaries)
- **Scope:** Briefs become versioned documents with history and diffs.
- **Backend:** `PUT /briefs/:id` snapshots prior version; `GET /briefs/:id/history`.
- **Schema:** 🔴 `brief_versions(id, brief_id, org_id, content, created_at, created_by)`.
- **Tests:** every edit snapshots; history ordered; restore works.
- **Done-when:** an owner can see how a brief evolved and roll back.

### Phase 4.2 — AI Brief-Update Suggestions 🔴 ⟶ 4.1
- **Scope:** When a hot-spot fires, AI drafts a brief addition grounded in the resolutions that worked.
- **Backend:** `ai.js suggestBriefAddition({topic, resolutions, currentBrief})` → paragraph + rationale.
  Stored as a suggestion, never auto-applied.
- **Schema:** 🔴 `brief_suggestions(id, brief_id, org_id, topic, content, status, created_at)`.
- **Frontend:** brief editor "Suggested additions" panel — `[Preview] [Accept] [Edit] [Dismiss]`.
- **Tests:** suggestion drafted on hot-spot; accept appends + versions; dismiss records; fallback path.
- **Done-when:** owner gets "Add this to your brief? students keep getting stuck here" with one-click accept.

### Phase 4.3 — Brief Impact Tracking 🔴 ⟶ 4.2
- **Scope:** Measure resolution-rate / hot-spot change before vs after each brief version.
- **Backend:** `GET /briefs/:id/impact` — per-version resolve rate, blockage volume on covered topics.
- **Frontend:** "Your brief v12 vs v11 — async blockages −40%" panel.
- **Tests:** impact attributes blockages to the version active at report time.
- **Done-when:** owners *see their brief getting smarter* — the flywheel becomes visible.

### Phase 4.4 — Instructor Teaching Intelligence 🔴 ⟶ Epoch 2.1 (summaries) + CSAT (exists)
> Private to the instructor. Owner sees only aggregate. (Trust constraint.)

- **Scope:** Show each instructor which explanations work (per topic: resolve rate, reopen rate, CSAT).
- **Backend:** `GET /api/me/teaching` — per-topic stats for the calling instructor only.
- **Frontend:** instructor "Teaching" page; copilot suggests their best-performing style on claim.
- **Schema:** none (aggregates existing rows).
- **Tests:** only own data; owner cannot read another instructor's detail; aggregate-only for owner.
- **Done-when:** an instructor learns "your closure explanations get reopened 40% — here's what works."

**Epoch 4 ships:** the brief becomes living institutional memory; the curriculum self-improves;
instructors get better, not just faster. This is the 100x.

---

# EPOCH 5 — Predict & Pre-empt (100x ceiling)
*Theme: shift from reactive to predictive. Only attempt after Epochs 1–4 have produced the data.*

### Phase 5.1 — Cohort Progression Patterns 🔴 ⟶ Epoch 4
- **Scope:** Learn the temporal sequence of where cohorts get stuck ("after assignment 3 → async, ~48h").
- **Backend:** offline-computable progression model from historical blockage timing per cohort/brief.
- **Schema:** 🔴 `progression_patterns(id, org_id, cohort_id, from_topic, to_topic, median_lag_hours, support)`.
- **Tests:** pattern extraction deterministic; min-support threshold respected.
- **Done-when:** the system knows what tends to come next.

### Phase 5.2 — Proactive Unblock Prompts 🔴 ⟶ 5.1
> No behavioral surveillance (research). Triggered only by *other students'* temporal patterns.

- **Scope:** Notify a student "students in your position got stuck on X next — here's a primer."
- **Backend:** match student's resolved history to 5.1 patterns; emit a dismissible notification.
- **Frontend:** notification card with `[Tell me more] [I've got this]`.
- **Tests:** trigger fires on pattern match; dismiss suppresses; no surveillance signals used.
- **Done-when:** problems get addressed *before* they're reported.

### Phase 5.3 — Org Teaching-Quality Intelligence 🔴 ⟶ Epoch 4
- **Scope:** Multi-cohort analysis isolating *why* blockage rates differ (instructor vs brief vs assignment).
- **Backend:** `GET /api/analytics/quality` — controlled comparison with honest confidence intervals.
- **Frontend:** owner "What's driving your blockage rate?" ranked-factor panel; CSV export.
- **Tests:** controls for cohort size & program week; no false precision (CIs present).
- **Done-when:** a VP of Learning can make curriculum decisions at scale from one screen.

---

## Dependency map (build order at a glance)

```
EPOCH 1 (action gaps)        EPOCH 2 (deflection)
  1.1 at-risk actions          2.1 resolution summaries ──┐
  1.2 hot-spots ───┐           2.2 student KB search       │
  1.3 AI backup    │           2.3 KB browse               │
        │          │           2.4 momentum view           │
        │          │                                       │
        ▼          ▼                                       ▼
EPOCH 3 (deeper AI)          EPOCH 4 (self-improving curriculum)
  3.1 scaffold levels          4.1 brief versioning  ⟵ 1.2 + 2.1
  3.2 self-confidence ⟵ 1.3    4.2 AI brief suggestions ⟵ 4.1
                               4.3 brief impact ⟵ 4.2
                               4.4 teaching intelligence ⟵ 2.1
                                       │
                                       ▼
                               EPOCH 5 (predict & pre-empt)
                                 5.1 progression patterns
                                 5.2 proactive prompts ⟵ 5.1
                                 5.3 org quality intelligence
```

## Sequencing principle
- **Epoch 1 first, always** — it's near-pure leverage on built backend; fastest visible value.
- **Epochs 2 & 3 can run in parallel** (different surfaces, no shared schema collisions).
- **Epoch 4 is gated** on real resolution-summary + hot-spot data existing (so 2.1 + 1.2 must land).
- **Epoch 5 is gated** on Epoch 4 producing enough historical signal — do not attempt early; the
  research is explicit that thin data + prediction = noise.

## Global constraints (carry forward, unchanged)
- Runs entirely LOCAL; Node ≥22 `node:sqlite`; pure-JS deps only.
- All AI via real Claude API when `ANTHROPIC_API_KEY` set, else deterministic fallback; never throws.
- Every row `org_id`-scoped; cross-tenant → 404; new columns via idempotent `migrate()`.
- Front-end: vanilla HTML/CSS/JS, `renderShell` + helpers, `escapeHtml`, "Signal" tokens.
- Every phase is TDD and independently shippable behind its own commit.
- **No leaderboards, streaks-vs-others, badges, or behavioral surveillance — research-prohibited.**
