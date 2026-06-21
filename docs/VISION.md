# Unblockify — Product Vision

## One line
Unblockify is the system of record for "I'm stuck." Any learning organization can run it
to turn student blockages into resolved, measured, momentum — instead of questions lost in a
chat channel.

## The problem
In bootcamps, coding schools, and training orgs, students get blocked constantly. Today that
help happens in noisy chat channels and DMs: requests get buried, no one owns them, nothing is
measured, and the same blocker gets re-solved ten times. Instructors firefight blind; program
leads have no idea where their cohort is actually stuck.

## The product
A focused, multi-tenant SaaS where:
- **Students** report a blockage in seconds — tied to their cohort and brief — and watch it move
  from **Blocked → In support → Resolved**, with a conversation thread to their instructor.
- **Instructors** work a single, owned queue: pick up a blockage, talk it through, choose a
  support method, and resolve it. Never triage, never wonder who owns what.
- **Owners** (program leads) run the workspace: invite instructors and students, define cohorts
  and briefs, assign instructors, and see analytics — volume, time-to-unblock, resolution rate,
  and where the cohort is stuck.

## Who it's for
Any organization that teaches: coding bootcamps, universities, corporate L&D, accelerators.
The product is org-agnostic — each org self-registers, gets an isolated workspace, and brings
its own people, cohorts, and brand.

## Principles
1. **Status is the brand.** Every object answers one question: blocked, in support, or flowing?
   The "Signal" identity (pulse line, signal green / coral) makes state legible at a glance.
2. **Owned, not pooled.** Every blockage has exactly one queue and (when picked up) one owner.
3. **Measured by default.** If it happened in Unblockify, it's in the analytics. Time-to-unblock
   is the north-star metric.
4. **Local and yours.** Runs entirely on the org's own machine (Express + SQLite), no cloud
   dependency. Architected cleanly so it can later move to Postgres without a rewrite.
5. **Fast to truth.** Report in 30s; resolve in a few clicks; understand the cohort in one screen.

## Roles
- **Owner** — creates the org (first signup), manages members, cohorts, briefs, instructor
  assignments, settings, and sees org-wide analytics. Can also act as an instructor.
- **Instructor** — assigned to cohorts; works the support queue for those cohorts; resolves
  blockages and replies in threads.
- **Student** — belongs to a cohort; reports blockages, follows status, replies in threads.

## Multi-tenancy & onboarding
- One app, many organizations; every row is scoped by `org_id` and isolation is enforced
  server-side. A user belongs to one org.
- **Sign up = create an organization** (you become its Owner).
- Owners generate **invite links / join codes** (no email server needed). An invite carries the
  org, the role, and optionally a cohort. Opening the link → set name + password → you're in.

## Feature set (this build)
- Org creation, auth (bcrypt + JWT cookie), role- and org-scoped authorization.
- Invites: create, list, revoke; join via code/link.
- Cohorts & briefs management; instructor↔cohort assignment.
- Blockages: report, edit, delete (while open), status lifecycle Blocked → In support → Resolved.
- **Conversation thread** per blockage + a **status timeline**.
- **In-app notifications** (assigned, replied, resolved) with a notification center.
- **Analytics**: totals by status, resolution rate, median time-to-unblock, volume over time,
  breakdown by cohort and instructor (charts).
- Settings/profile for every role; org settings for owners.

## Pages
Marketing: Landing. Auth: Sign up (create org), Log in, Join via invite.
App shell (role-aware sidebar):
- **Student**: Overview, My Blockages (board), Blockage detail (thread + timeline),
  Notifications, Settings.
- **Instructor**: Queue, Blockage detail (resolve + thread), My Cohorts, Notifications, Settings.
- **Owner**: Dashboard/Analytics, Blockages, Cohorts & Briefs, Members & Invites, Notifications,
  Org Settings.

## Success criteria
- A brand-new org can: sign up → invite an instructor and a student → student reports a blockage
  → instructor picks it up, threads, and resolves → student sees it resolved → owner sees it in
  analytics. End-to-end, in one running local app, verified by automated browser tests.
- Data from two different orgs is never visible across the tenant boundary (proven by tests).
- Every page is responsive, keyboard-accessible, and on the "Signal" design language.
- No console/page errors across the core flows.

## Explicitly out of scope (for now)
Email/SMS, real-time websockets (notifications poll/refresh), file uploads, SSO, billing,
mobile-native apps. Architected so these can be added later.
