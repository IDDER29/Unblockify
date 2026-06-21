# Unblockify

The system of record for "I'm stuck." A **multi-tenant** platform where any learning
organization turns student blockages into resolved, measured momentum — instead of questions
lost in a chat channel.

Full-stack but fully local: **Express + SQLite** backend, plain HTML/CSS/vanilla-JS front-end.
No cloud, no build step, no native dependencies.

## Run it

```bash
cd server
npm install
npm start      # http://localhost:5050
npm test       # backend test suite
```

The first person to sign up creates an organization and becomes its **owner**. There is no
default account. Data lives in `server/data.db` (delete to reset).

## What it does

- **Multi-tenant SaaS** — each organization gets an isolated workspace; data is scoped by
  `org_id` and isolation is enforced server-side.
- **Three roles** — Owner (manage workspace, members, cohorts, analytics), Instructor (work a
  support queue, claim & resolve), Student (report blockages, follow status).
- **Invite-based onboarding** — owners generate shareable invite links/codes (no email server).
- **Blockage lifecycle** — Blocked → In support → Resolved, with a **conversation thread** and a
  **status timeline** on every blockage.
- **In-app notifications** and an **analytics dashboard** (volume, resolve rate, median
  time-to-unblock, by cohort & instructor) with inline SVG charts.
- A distinctive **"Signal"** design language: status is the brand, with a pulse-line signature.

See [docs/VISION.md](./docs/VISION.md) and [CLAUDE.md](./CLAUDE.md) for the full picture.
