# Unblockify — 10x → 100x Plan
*Grounded in adversarially-verified research · June 2026*

---

## What the research actually confirmed

107 agents searched, fetched, and challenged 25 sources. Five claims survived 2-of-3 adversarial
rejection. Everything else — leaderboard engagement, gamification streaks, 85%+ dropout-prediction
accuracy, generic chatbot deployment — was killed. What's left:

1. **Pedagogically-engineered AI produces 0.73–1.3 SD learning gains** (Kestin et al., Harvard RCT,
   N=194). The differentiator is *prompt architecture and interaction design*, not model choice.
   Unblockify already has this foundation — the AI Teaching Assistant is the wedge.

2. **Instructors must supervise AI, not be replaced by it.** In the LearnLM RCT, tutors intervened
   on 25.6% of AI messages — 44% to fix pedagogical pacing, 19% to add social-emotional nuance.
   The highest-ROI instructor feature is an *AI oversight dashboard*, not automation.

3. **Predictive analytics only move outcomes when paired with intervention workflows.** Accurate
   at-risk prediction that produces a list no one acts on does nothing. The UI for taking action
   is the entire value of the analytics feature.

4. **Gamification harms lower-performing students.** No leaderboards, streaks, or social
   comparison mechanics. Personal progress only.

5. **Students accept mistake-pattern data, reject surveillance data.** Build around what they got
   stuck on and how they solved it — not attention tracking or engagement scores.

---

## The current loop (baseline)

```
Student reports blockage
  → AI responds instantly (Socratic, brief-grounded)
  → Instructor claims → resolves
  → Analytics show org health
```

This is a 1x loop. Good bones. The 10x and 100x come from tightening and deepening each stage.

---

## 10x: Make every stage of the existing loop dramatically better

### 10x-1 · Multi-turn Socratic AI (not one shot)
**What:** Instead of one AI reply and wait, the AI conducts a proper dialogue — hint → question →
example → worked solution — progressing only when the student signals they're still stuck.

**Why:** The Harvard RCT gain came from *scaffolded, multi-turn* AI with progressive reveal. A
single Socratic question is not enough.

**How to build:**
- Add `ai_turn` counter to blockage thread. AI holds back the full answer until turn 3+.
- Track student replies — if reply contains "still don't get it" / "I'm confused" → escalate
  scaffold level automatically.
- Add "Show me more" button in the AI featured card. Each click advances one scaffold level.
- Brief defines max scaffold levels per topic. Owner can configure.

**Metric:** AI deflection rate. Currently ~X%. Target: 60%+.

---

### 10x-2 · Instructor AI supervision dashboard
**What:** A dedicated view showing instructors *where the AI is losing students* — not just
which blockages exist, but which AI responses are failing and need human pickup.

**Why:** LearnLM study found tutors primarily intervene for *pacing* (AI too fast/slow) and
*social-emotional nuance*. Build the tools to make those interventions fast.

**How to build:**
- New queue segment: **"AI needs backup"** — blockages where student replied to the AI but is
  still marked blocked 30+ mins later.
- AI confidence score per response (via self-evaluation prompt): show a `·` amber indicator on
  cards where the AI flagged low confidence.
- One-click "Take over" button on the AI featured card — claims the blockage and focuses the
  composer in one tap.
- Instructor sees: "AI handled 18 of 23 blockages this week. These 5 need you."

**Metric:** Instructor time-to-first-human-reply on flagged blockages.

---

### 10x-3 · Mistake pattern intelligence (hot spots)
**What:** Automatically cluster blockages by topic/concept. Show owners and instructors where
students *consistently* get blocked across the cohort — not just individual blockages but
structural gaps in the curriculum.

**Why:** Students accept process/mistake data (research confirmed). This is the highest-value
analytics feature with the least privacy friction.

**How to build:**
- Backend: keyword + embedding clustering of blockage titles/details on resolve. Group into
  topic clusters (e.g., "async/await", "authentication", "SQL joins").
- Owner dashboard: **Curriculum hot spots** card — ranked list of topics by blockage frequency
  and resolution difficulty this month.
- Cohort detail page: sparkline showing blockage rate week-by-week per topic.
- When 3+ students get stuck on the same concept in 7 days → automatic owner notification:
  "7 students stuck on async this week — your brief may need updating."

**Metric:** Brief update rate driven by hot-spot alerts. Curriculum iteration velocity.

---

### 10x-4 · At-risk action workflow (not just a list)
**What:** Every at-risk student gets one-click intervention actions inline. The list becomes a
queue with outcomes tracked.

**Why:** Research (3-of-3 adversarial votes) confirmed: prediction without workflow does nothing.
The at-risk panel currently shows names and tags. That's prediction without workflow.

**How to build:**
- Each at-risk row: `[Send nudge]` `[View blockages]` `[Flag for check-in]` action buttons.
- Nudge goes directly to their notifications feed + optional email.
- "Flag for check-in" creates a private instructor task (not visible to student).
- Track outcome: was a check-in done? Did the student become unblocked?
- Owner analytics: intervention response rate, % of at-risk students who recovered.

**Metric:** At-risk → recovered conversion rate.

---

### 10x-5 · Resolution knowledge base (searchable, student-facing)
**What:** Every resolved blockage becomes a permanent, searchable knowledge base. Students search
before reporting. Instructors see "similar blockages resolved before" while working.

**Why:** The current retrieval.js is instructor-side only. Making it student-facing eliminates
duplicate blockages before they're reported — the highest-leverage deflection mechanic.

**How to build:**
- Student "report blockage" form: live search as they type the title — shows "3 students had
  this before. Here's what worked ↗" with link to similar resolved blockages.
- Resolution page: when instructor resolves, AI generates a 2-sentence "what finally worked"
  summary (stored as `resolution_summary`).
- Search endpoint: `/api/knowledge?q=` — keyword + semantic search over resolution_summaries.
- Knowledge base page: public within the org — student can browse all resolved blockages by topic.

**Metric:** Duplicate blockage rate (target: -40%). Student self-resolve rate.

---

### 10x-6 · Student momentum view (personal, no social comparison)
**What:** Each student sees their own unblocking trajectory — not against others, just their
own growth arc. "You've cleared 14 blockages this term. Your fastest resolve was 2h."

**Why:** Personal progress is adoptable (research: students accept process data). Social
comparison (leaderboards) is harmful (research confirmed). This is the stickiness mechanic that
won't backfire.

**How to build:**
- Student dashboard stats strip: Total cleared · Fastest resolve · Current streak (days with
  a resolve) · Topics you get stuck on most.
- "Your history" tab on the student board: timeline of all past blockages with resolution notes.
- Personal pattern message: "You've had 4 blockages about async this month — here are 2
  resources that helped other students."
- No rankings, no "X is doing better than you", no points.

**Metric:** Student DAU/WAU ratio. Return visits to the platform.

---

## 100x: Structural shifts that change what the product IS

### 100x-1 · The Curriculum Intelligence Loop
**What:** Every blockage is a signal that the curriculum broke down at this point. Unblockify
becomes a system that makes curricula self-improving.

**Current:** Owner writes a brief → AI uses it as context → AI responds → resolved.

**100x:** Blockages cluster → AI identifies the curriculum gap → AI *drafts a brief update* →
owner reviews and approves in one click → brief improves → AI gets better → fewer blockages.

The product stops being a support tool and becomes a **curriculum feedback loop**. The brief is
the interface between support and teaching. Improving the brief is the highest-leverage action
an org owner can take, and Unblockify becomes the only tool that tells them how.

**How to build:**
- `briefs` table gets `version_history` (JSON array of past versions).
- When hot-spot threshold triggers (3+ blockages on same topic), AI drafts a `suggested_brief_addition` — a paragraph addressing the gap, grounded in the resolutions that worked.
- Owner sees a diff: "Add this to your brief? [Preview] [Accept] [Edit]"
- Track resolution rate before/after brief update. Show owners their brief is getting smarter.

**Metric:** Brief update rate, resolution rate improvement per brief version.

---

### 100x-2 · Proactive unblocking (before students report)
**What:** The system detects students who are *about to get stuck* and offers help proactively,
before they hit the friction of reporting a blockage.

**Current:** Reactive. Student must decide they're stuck, navigate to the app, fill a form.

**100x:** Pattern matching against similar students in past cohorts predicts where *this* student
is likely to get stuck next. Proactive prompt arrives before they're fully blocked.

**How to build:**
- Store cohort-level blockage progression patterns: "students working on assignment 3 tend to
  get stuck on topic X within 48 hours."
- Match current student's resolved blockage history to the pattern.
- Trigger: "A lot of students in your position got stuck on async next — here's a primer before
  you hit it." Delivered as a notification, not a push.
- Student can dismiss ("I've got this") or engage ("tell me more").
- No behavioral surveillance (research: students reject attention tracking). Triggered only by
  temporal patterns from *other* students' blockage histories.

**Metric:** Pre-emptive deflection rate (problems addressed before blockage reported).

---

### 100x-3 · Instructor teaching intelligence
**What:** Show instructors which of their explanations work and which don't. Make every
instructor a better teacher, not just a faster queue-worker.

**Current:** Instructor resolves blockages. No feedback on quality of their explanations.

**100x:** "Your explanations of recursion have a 95% same-session resolve rate. Your explanations
of closures get reopened 40% of the time. Here's what the difference looks like."

**How to build:**
- Track per-instructor, per-topic: resolution rate, reopen rate, time-to-resolve, student
  satisfaction (optional CSAT).
- AI generates "teaching pattern" profile per instructor per topic: what phrasing, what examples,
  what sequence works.
- Instructor copilot: when they claim a blockage on a weak topic, AI suggests their best-
  performing explanation style for this student profile.
- Private to the instructor — not visible to owner (trust). Owner only sees aggregate team health.

**Metric:** Per-instructor reopen rate over time. Should trend toward zero.

---

### 100x-4 · The Brief becomes a living intelligence document
**What:** The brief stops being a static text box that the owner updates manually. It becomes a
continuously-enriched knowledge document that grows with every resolved blockage.

**Current:** Owner writes brief once. It may never be updated.

**100x:** Brief has sections: `[written by owner]` + `[learned from resolved blockages]`. The
AI-learned section grows automatically, attributed to real resolutions. Owner can promote,
demote, or edit suggestions. The brief is the living memory of everything the AI has learned
about what students in this cohort get stuck on and what helps.

**How to build:**
- Brief `content` field becomes structured: owner-written section + AI-generated knowledge
  section (stored separately, rendered together).
- On resolve: AI extracts "what finally worked" → checks if brief already covers this → if not,
  queues as `suggested_brief_learning`.
- Owner's brief editor shows a "Suggested additions" panel — approve/reject each.
- Version diff UI: "Your brief v12 vs v11 — 3 additions, resolution rate +8%."

**Metric:** Brief knowledge depth score (length + coverage of top hot-spot topics).

---

### 100x-5 · Org-level teaching quality intelligence
**What:** Multi-cohort analysis that tells owners *why* their blockage rates differ — content,
instructor, cohort composition, or brief quality.

**Current:** Analytics show what happened. Not why.

**100x:** "Cohort A has 2.3x more blockages on week 4 than Cohort B. They have different
instructors and different briefs. The gap correlates with brief coverage depth, not instructor."
This is what a VP of Learning needs to make curriculum decisions at scale.

**How to build:**
- Regression analysis backend: hold constant student cohort size, control for week of program,
  isolate: `instructor_effect`, `brief_effect`, `assignment_effect`.
- Owner analytics: "What's driving your blockage rate?" with ranked factors.
- Week-over-week cohort comparison with confidence intervals (not false precision).
- Export to CSV for program directors who need it in their own tools.

**Metric:** Owner dashboard engagement. Are owners coming back to make decisions?

---

## What NOT to build (research-killed ideas)

| Idea | Why not |
|---|---|
| Leaderboards / rankings | Documented harm to lower-performing students |
| Streak mechanics | High-variance; gamification harms unless carefully designed |
| Attention/engagement tracking | Students reject surveillance data; regulatory risk |
| Badge systems | Same as leaderboards — harm tails are real |
| "85%+ accuracy" dropout prediction | Prediction without workflow = no outcome improvement |
| Generic chatbot deployment | Generic ≠ pedagogically engineered; doesn't produce learning gains |
| Social comparison features | Any form of "X is doing better than you" harms adoption |

---

## Implementation sequence

### Phase 1 — 10x foundation (8–12 weeks)
1. Multi-turn AI scaffold (10x-1) — highest leverage, builds on existing AI
2. Resolution knowledge base + student pre-search (10x-5) — deflects duplicates
3. At-risk action workflow (10x-4) — closes the prediction→intervention gap
4. Instructor "AI needs backup" segment (10x-2) — immediate instructor value

### Phase 2 — 10x stickiness (6–8 weeks)
5. Mistake pattern / hot-spot intelligence (10x-3) — owner retention
6. Student momentum view (10x-6) — student stickiness
7. Brief update notifications from hot-spots — starts the 100x loop

### Phase 3 — 100x structural (ongoing)
8. Curriculum intelligence loop (100x-1) — brief becomes self-improving
9. Proactive unblocking (100x-2) — shifts from reactive to predictive
10. Instructor teaching intelligence (100x-3) — makes every instructor better
11. Living brief (100x-4) — product becomes the org's institutional memory
12. Org teaching quality intelligence (100x-5) — VP-level analytics

---

## The compound effect

Each of these layers feeds the next:

```
Students report blockages
  → AI handles 60%+ (multi-turn scaffold)
  → Knowledge base deflects 20%+ before they're reported
  → Instructor supervises the 20% that need humans (AI oversight dashboard)
  → Every resolution enriches the knowledge base
  → Knowledge base enriches the brief
  → Better brief → AI answers better → deflection rate climbs
  → Hot-spots feed curriculum intelligence
  → Curriculum improves → fewer blockages at source
  → Proactive unblocking catches the remaining gaps before they're reported
```

At steady state: students spend less time blocked, instructors spend less time on repeat
questions, and the org's curriculum gets measurably better every cohort — automatically.

That is the 100x.
