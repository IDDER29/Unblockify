# Phase 6: Commercial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every backend task is strict TDD: write the failing test, run it and watch it fail for the right reason, write the *minimal real* code, run it and watch it pass, then commit.

**Goal:** Turn Unblockify into a sellable company. Add billing/subscriptions with seat & plan limits, SSO (Google) + TOTP 2FA, a public REST API with org-scoped API keys + signed webhooks, a public per-org help center / knowledge base, and integrations (Slack notifications, calendar office-hours links, LMS roster import). Every external service follows the established AI pattern — a deterministic **local-first mock** that works with zero config so the app still runs and demos fully offline, with the real provider activating only when its env var is set.

**Architecture:** One Express app (`createApp(db)`) serves the vanilla-JS front-end and the JSON API. Phase 6 adds new `(db) => router` factories mounted under `/api` in `server/index.js`, plus a **new `/api/public` surface authenticated by API key** (not the cookie) via a dedicated `requireApiKey` middleware that lives alongside `requireAuth`/`requireRole`/`requireStaff`. A small `lib/` of provider adapters (`billing.js`, `sso.js`, `totp.js`, `webhooks.js`, `slack.js`, `lms.js`) each expose a stable interface whose implementation switches on an env var: a pure-JS deterministic mock by default, the real SDK/HTTP call when configured. New tables are added through `migrate()` in `server/db.js`, all `org_id`-scoped. Public KB pages are served as static HTML that fetch a **no-auth, read-only** `/api/public/kb/...` endpoint scoped by org slug. Front-end uses `renderShell` + helpers + `escapeHtml`, with new owner-only pages (`billing.html`, `developers.html`, `integrations.html`) and a public `kb.html`; adding any nav-linked page requires updating `NAV` in `functions/api.js` (called out per task).

**Tech Stack:** Node 22+ (`node:sqlite`, `node:test`, `node:crypto` for HMAC/TOTP/base32), Express, bcryptjs, jsonwebtoken, cookie-parser; vanilla HTML/CSS/JS. **No new native dependencies.** TOTP, base32, HMAC-SHA1/256 webhook signatures, and the Slack/webhook HTTP posts are implemented with `node:crypto` + `fetch` (both built in). Real Stripe / Google OAuth are reached over `fetch` against their REST endpoints only when their env vars are set — no SDK required, so `npm install` stays pure-JS.

## Global Constraints
- Runs entirely LOCAL; no cloud DB. Node ≥22 node:sqlite (--experimental-sqlite); pure-JS deps only (no native build).
- Every external service (Stripe, Google, Slack) follows the AI pattern: a deterministic local-first default that works with zero config; the real integration activates only when its env var is set. The app must always run + demo offline.
- Backend: Express factories `(db)=>router` mounted under /api in server/index.js; JWT httpOnly cookie {userId,orgId,role}; requireAuth/requireRole/requireStaff. (API-key auth is a NEW middleware alongside the cookie auth — design it explicitly.)
- Multi-tenant: every row org_id; every query filters by caller org; cross-tenant → 404; new tables via migrate() in server/db.js.
- Front-end: vanilla HTML/CSS/JS; renderShell + helpers; escapeHtml; "Signal" tokens; a nav-linked page requires updating NAV in functions/api.js (call it out).
- Tests: node:test, in-memory DB via test/helpers.js (buildOrg/joinMember); npm test auto-discovers; gate AI with AI_AUTORESPOND.
- Commit messages end with: Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## File Structure

New and modified files for Phase 6 (all paths relative to repo root):

```
server/
  db.js                          (MODIFY) migrate() adds: subscriptions, api_keys,
                                   webhook_endpoints, webhook_deliveries, kb_articles,
                                   integrations, totp_secrets; + new user/org columns.
  index.js                       (MODIFY) mount billingRoutes, apiKeyRoutes,
                                   publicApiRoutes (/api/public), webhookRoutes,
                                   kbRoutes, integrationRoutes, ssoRoutes; extend authRoutes.
  auth.js                        (MODIFY) export requireApiKey + apiKeyContext helpers.
  lib/
    billing.js                   (NEW) plan catalog, mock + Stripe-when-configured checkout,
                                   seat/usage limit enforcement.
    sso.js                       (NEW) Google OAuth — mock stub flow + real when GOOGLE_* set.
    totp.js                      (NEW) pure-JS base32 + HOTP/TOTP generate & verify.
    webhooks.js                  (NEW) HMAC signing + delivery (mock-capture default).
    slack.js                     (NEW) incoming-webhook post (mock-capture default).
    lms.js                       (NEW) CSV roster parse + bulk student create.
  routes/
    billing.js                   (NEW) plans, subscription state, checkout, portal, webhook in.
    apikeys.js                   (NEW) create/list/revoke org-scoped API keys.
    public_api.js                (NEW) /api/public/* — key-authed read/write REST subset.
    webhooks.js                  (NEW) endpoint CRUD + delivery log (cookie-authed admin).
    kb.js                        (NEW) publish/unpublish articles (admin) + /api/public/kb (no auth).
    integrations.js              (NEW) Slack/calendar config + LMS import.
    sso.js                       (NEW) /api/auth/google/start + /callback (stub or real).
    auth.js                      (MODIFY) add TOTP enroll/verify/disable + 2FA login challenge.
  test/
    billing.test.js              (NEW)
    apikeys.test.js              (NEW)
    public_api.test.js           (NEW)
    webhooks.test.js             (NEW)
    kb.test.js                   (NEW)
    integrations.test.js         (NEW)
    sso.test.js                  (NEW)
    totp.test.js                 (NEW)
    twofactor.test.js            (NEW)
    helpers.js                   (MODIFY) add asKey() helper (raw-key fetch client).

functions/
  api.js                         (MODIFY) add owner NAV items: Billing, Developers,
                                   Integrations; add helper plan-badge + apiKey() raw client.
  billing.js                     (NEW)   billing.html controller
  developers.js                  (NEW)   developers.html controller (API keys + webhooks)
  integrations.js                (NEW)   integrations.html controller (Slack/calendar/LMS)
  kb.js                          (NEW)   public kb.html controller (no shell, no auth)
  twofactor.js                   (NEW)   settings 2FA section controller (loaded by settings.html)
  login.js                       (MODIFY) handle 2FA challenge step + Google button
  singUp.js                      (MODIFY) Google sign-up button

billing.html        (NEW)  owner — plan, seats, usage, upgrade/checkout
developers.html     (NEW)  owner — API keys, webhook endpoints, delivery log, API docs
integrations.html   (NEW)  owner — Slack webhook, calendar links, LMS CSV import
kb.html             (NEW)  PUBLIC — per-org help center (?org=slug), no auth, no shell
settings.html       (MODIFY) add 2FA enroll/disable card (loads functions/twofactor.js)
docs/
  PUBLIC-API.md       (NEW)  the documented public REST subset (key auth, endpoints, webhooks)
```

Env vars introduced (all optional; absent → local-first mock):
`STRIPE_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_SCALE`, `STRIPE_WEBHOOK_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`APP_URL` (default `http://localhost:5050`), `BILLING_TRIAL_DAYS` (default 14).

---

## Phase A — Schema & API-key foundation

### Task A.1: Phase 6 schema migration
**Files:** Modify `server/db.js` (extend `migrate()`); Modify `server/test/helpers.js` (no change needed beyond re-export, confirm in-memory still migrates).
**Interfaces:** Adds tables (all carry `org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE` unless noted):
- `subscriptions(id, org_id UNIQUE, plan TEXT CHECK(plan IN ('free','pro','scale')) DEFAULT 'free', status TEXT CHECK(status IN ('trialing','active','past_due','canceled')) DEFAULT 'trialing', seats INTEGER DEFAULT 3, trial_ends_at TEXT, provider TEXT DEFAULT 'mock', provider_customer_id TEXT, provider_sub_id TEXT, created_at, updated_at)`
- `api_keys(id, org_id, name TEXT, prefix TEXT, key_hash TEXT NOT NULL, last_used_at TEXT, revoked INTEGER DEFAULT 0, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at)`
- `webhook_endpoints(id, org_id, url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL, active INTEGER DEFAULT 1, created_at)`
- `webhook_deliveries(id, org_id, endpoint_id INTEGER REFERENCES webhook_endpoints(id) ON DELETE CASCADE, event TEXT, payload TEXT, status_code INTEGER, ok INTEGER DEFAULT 0, error TEXT, created_at)`
- `kb_articles(id, org_id, blockage_id INTEGER REFERENCES blockages(id) ON DELETE SET NULL, slug TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, published INTEGER DEFAULT 1, created_at)`
- `integrations(id, org_id UNIQUE, slack_webhook_url TEXT, calendar_url TEXT, office_hours TEXT, created_at, updated_at)`
- `totp_secrets(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, org_id INTEGER, secret TEXT NOT NULL, enabled INTEGER DEFAULT 0, created_at)`
- New columns: `users.auth_provider TEXT DEFAULT 'password'`, `users.google_sub TEXT`. (Add via `ALTER TABLE ... ADD COLUMN` guarded by a column-existence check, since `migrate()` runs on existing `data.db`.)
- Indexes: `idx_apikeys_org`, `idx_webhook_ep_org`, `idx_kb_org_pub`, `idx_subs_org`.

- [ ] Write `server/test/schema_phase6.test.js`: `openDb(':memory:')`; assert each new table exists (query `sqlite_master`); insert a `subscriptions` row and assert a bad `plan` value is rejected by the CHECK; assert `ALTER` columns `auth_provider`/`google_sub` exist on `users`.
- [ ] Run `npm test`; expect FAIL (tables missing).
- [ ] Add the `CREATE TABLE`/index DDL to `migrate()`. Implement an `addColumnIfMissing(db, table, col, ddl)` helper (reads `PRAGMA table_info`) and call it for the two `users` columns. Keep all DDL idempotent (`IF NOT EXISTS`).
- [ ] Run `npm test`; expect PASS. Commit (`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).

### Task A.2: API-key middleware + helpers
**Files:** Modify `server/auth.js`; Create `server/lib/keys.js`.
**Interfaces:**
- `lib/keys.js`: `generateApiKey()` → `{ raw, prefix, hash }` where `raw = "ubk_" + 24 hex bytes`, `prefix = raw.slice(0,12)`, `hash = sha256(raw)` (hex, via `node:crypto`); `hashKey(raw)` → hex string.
- `auth.js` adds `requireApiKey(db)` → middleware factory: reads `Authorization: Bearer ubk_...` (or `X-Api-Key`), looks up `api_keys WHERE key_hash=? AND revoked=0`, on miss → `401 {error:"Invalid API key"}`. On hit sets `req.apiOrgId = row.org_id` and `req.apiKeyId = row.id`, updates `last_used_at`, calls `next()`. Exported as `requireApiKey` (curried with `db` at mount time).

- [ ] Write `server/test/apikeys.test.js` step 1: unit-test `generateApiKey()` returns a `ubk_`-prefixed raw, a 12-char prefix that is a slice of raw, and `hashKey(raw) === hash`; two calls differ.
- [ ] Run; expect FAIL (module missing).
- [ ] Implement `lib/keys.js` with `crypto.randomBytes` + `crypto.createHash('sha256')`.
- [ ] Run; expect PASS. Commit.
- [ ] Write step 2: in `apikeys.test.js`, insert an `api_keys` row directly with a known hash and call a tiny app mounting `app.get('/api/public/ping', requireApiKey(db), (req,res)=>res.json({orgId:req.apiOrgId}))`; assert Bearer with the raw key → 200 + correct `orgId`; missing/garbage key → 401; revoked key → 401.
- [ ] Run; expect FAIL.
- [ ] Implement `requireApiKey(db)` in `auth.js` and export it.
- [ ] Run; expect PASS. Commit.

---

## Phase B — Billing / subscriptions

### Task B.1: Plan catalog + billing adapter (local-first)
**Files:** Create `server/lib/billing.js`.
**Interfaces:**
- `PLANS` const: `{ free:{ seats:3, aiMonthly:50, price:0 }, pro:{ seats:20, aiMonthly:1000, price:49 }, scale:{ seats:100, aiMonthly:10000, price:199 } }`.
- `getSubscription(db, orgId)` → row, creating a default `free`/`trialing` row (`trial_ends_at = now + BILLING_TRIAL_DAYS`) on first read.
- `isStripe()` → `!!process.env.STRIPE_SECRET`.
- `startCheckout(db, orgId, plan)` → when mock: returns `{ url: "/billing.html?mock_checkout=" + plan + "&session=" + token }` and records nothing yet. When Stripe: POSTs to `https://api.stripe.com/v1/checkout/sessions` via `fetch` and returns the real `url`. (Stripe path is *designed* here; tests only exercise mock.)
- `applyCheckout(db, orgId, plan)` → upgrades the subscription row to `plan`, `status='active'`, sets `seats = PLANS[plan].seats`, `provider='mock'`. Used by the mock confirm and (later) the webhook.
- `seatUsage(db, orgId)` → `{ used: count(users in org), limit: sub.seats }`.
- `canAddMember(db, orgId)` → boolean (`used < limit`).
- `aiUsageThisMonth(db, orgId)` → count of AI comments (`comments.is_ai=1`) this calendar month for the org; `canUseAi(db, orgId)` → `aiUsage < PLANS[plan].aiMonthly`.

- [ ] Write `server/test/billing.test.js` step 1 (pure unit, no HTTP): `getSubscription` auto-creates a `free` trial row; `seatUsage` reflects member count from a `buildOrg`; `canAddMember` true under limit; after inserting users up to the free `seats`, `canAddMember` false. `aiUsageThisMonth` counts only `is_ai=1` rows in the current month.
- [ ] Run; expect FAIL.
- [ ] Implement `lib/billing.js` (mock branch only needs real code; Stripe branch behind `isStripe()`).
- [ ] Run; expect PASS. Commit.

### Task B.2: Billing routes (state, checkout, portal, webhook-in)
**Files:** Create `server/routes/billing.js`; Modify `server/index.js` (mount `app.use("/api", billingRoutes(db))`).
**Interfaces (cookie-authed, owner-only except the Stripe webhook):**
- `GET /api/billing` → `{ plan, status, seats, trialEndsAt, usage:{ seats:{used,limit}, ai:{used,limit} }, plans:PLANS, provider }`.
- `POST /api/billing/checkout {plan}` (owner) → `{ url }` from `startCheckout`; rejects unknown plan (400).
- `POST /api/billing/confirm {plan, session}` (owner; **mock-only**, refuses when `isStripe()`) → calls `applyCheckout`, returns updated `GET /api/billing` body. This is the offline "fake checkout completed" hook.
- `POST /api/billing/portal` (owner) → mock returns `{ url: "/billing.html" }`; Stripe returns a billing-portal session URL.
- `POST /api/billing/cancel` (owner) → sets `status='canceled'`, `plan='free'`, `seats=PLANS.free.seats`.
- `POST /api/billing/stripe-webhook` (NO cookie; verifies `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET` via HMAC; **no-op 200 when not configured**) → on `checkout.session.completed`/`customer.subscription.updated` calls `applyCheckout`.

- [ ] Write `billing.test.js` step 2 (HTTP via `buildOrg`): owner `GET /api/billing` → `free`/`trialing` with seat usage; student/instructor `GET` → 403; `POST /api/billing/checkout {plan:'pro'}` → `{url}` containing `mock_checkout=pro`; `POST /api/billing/confirm {plan:'pro'}` → plan now `pro`, `seats` 20, `status:'active'`; `cancel` → back to `free`; cross-org owner can't read another org's billing (its own row only).
- [ ] Run; expect FAIL.
- [ ] Implement `routes/billing.js`; mount in `index.js`.
- [ ] Run; expect PASS. Commit.

### Task B.3: Enforce seat & AI limits with upgrade prompts
**Files:** Modify `server/routes/members.js` (gate invite creation), Modify `server/routes/blockages.js` (gate AI autorespond), reuse `lib/billing.js`.
**Interfaces:**
- In `POST /api/invites`: before creating, if `!canAddMember(db, orgId)` → `402 {error:"Seat limit reached for your plan.", upgrade:true, code:"seat_limit"}`. (402 Payment Required is the upgrade-prompt signal the front-end keys on.)
- In `POST /api/auth/join`: same `canAddMember` check (a used invite still consumes a seat) → `402` if over.
- AI gate: where the blockage report triggers `unblock()` (the `setImmediate`/`AI_AUTORESPOND` path), wrap with `if (canUseAi(db, orgId))`; when over, skip the AI reply silently (no error to the student) and record nothing. This caps AI cost per plan.

- [ ] Write `billing.test.js` step 3: fill an org's free seats (3), then `POST /api/invites` → 402 with `code:"seat_limit"`; after `confirm {plan:'pro'}`, the same invite create → 201. (AI gate is asserted indirectly: with `AI_AUTORESPOND=1` and `aiMonthly` patched low via a `pro→free` downgrade, reporting a blockage adds no `is_ai=1` comment — assert count unchanged.)
- [ ] Run; expect FAIL.
- [ ] Implement the gates (import `billing.js` helpers).
- [ ] Run; expect PASS. Commit.

### Task B.4: Billing page (front-end)
**Files:** Create `billing.html`, `functions/billing.js`; Modify `functions/api.js` (add owner NAV item `{ href:"billing.html", icon:"cog"... }` — reuse an existing icon or add a `card` icon to `ICONS`; **NAV update required**).
**Interfaces:** Owner page using `requireRole("owner")` + `renderShell({active:"billing.html", title:"Billing"})`. Renders: current plan card, trial countdown, seat usage bar (`used/limit`), AI usage bar, a plan grid (free/pro/scale) with "Upgrade" buttons that call `POST /api/billing/checkout` then (in mock) auto-`confirm` on return (`?mock_checkout=` query handled on load), a "Manage billing" (portal) and "Cancel plan" button. All user values through `escapeHtml`. A 402 from any API call (seat/AI limit) anywhere shows a `toast` linking to `billing.html`.
- [ ] Build the page; verify by running the server (`npm start`), signing up, visiting `billing.html`, clicking Upgrade → mock checkout → plan reflects `pro`. (Manual/Playwright check — no node:test for static pages.)
- [ ] Commit.

---

## Phase C — SSO (Google) + 2FA (TOTP)

### Task C.1: Pure-JS TOTP library
**Files:** Create `server/lib/totp.js`.
**Interfaces:**
- `base32Encode(buf)` / `base32Decode(str)` (RFC 4648, no padding) via `node:crypto` byte ops.
- `generateSecret()` → base32 string (20 random bytes).
- `hotp(secret, counter)` → 6-digit string (HMAC-SHA1, dynamic truncation).
- `totp(secret, t = Date.now())` → 6-digit code for the 30s window.
- `verifyTotp(secret, code, t = Date.now(), window = 1)` → boolean, accepting ±`window` 30s steps.
- `otpauthUrl({ secret, label, issuer })` → `otpauth://totp/...` string (for QR / manual entry).

- [ ] Write `server/test/totp.test.js`: round-trip `base32Decode(base32Encode(x)) === x`; an RFC 6238 test vector (secret `"12345678901234567890"` base32 → known code at a fixed timestamp) verifies; `verifyTotp(secret, totp(secret))` true; a wrong code false; a code one step stale passes with `window=1`, fails with `window=0`.
- [ ] Run; expect FAIL.
- [ ] Implement `lib/totp.js` with `crypto.createHmac('sha1', ...)` and Buffer math.
- [ ] Run; expect PASS. Commit.

### Task C.2: 2FA enroll / verify / disable + login challenge
**Files:** Modify `server/routes/auth.js`.
**Interfaces (cookie-authed except the login challenge step):**
- `POST /api/auth/2fa/enroll` (requireAuth) → creates/overwrites a disabled `totp_secrets` row, returns `{ secret, otpauthUrl }` (never returns secret again after enable).
- `POST /api/auth/2fa/verify {code}` (requireAuth) → if `verifyTotp` passes, set `enabled=1`; returns `{ enabled:true }`; bad code → 400.
- `POST /api/auth/2fa/disable {code}` (requireAuth) → requires a valid code, deletes the row.
- `GET /api/auth/2fa` (requireAuth) → `{ enabled:boolean }`.
- **Login change:** `POST /api/auth/login` — when the user has `totp_secrets.enabled=1`, do NOT issue the cookie; instead return `200 { twofa:true, challenge: <signed short-lived JWT of userId, 5m> }`. New `POST /api/auth/login/2fa {challenge, code}` verifies the challenge JWT + the TOTP code, then `issueToken` + returns `{user, org}`. Wrong code → 401.

- [ ] Write `server/test/twofactor.test.js`: a member enrolls → `{secret, otpauthUrl}`; verify with `totp(secret)` → enabled; `GET /2fa` → `{enabled:true}`; now `login` with correct password returns `{twofa:true, challenge}` and sets NO cookie (assert a follow-up `/api/auth/me` is 401); `login/2fa` with the right code → `{user}` and `/me` now 200; disable with a valid code → subsequent login is a normal one-step login.
- [ ] Run; expect FAIL.
- [ ] Implement the routes (import `lib/totp.js`; sign the challenge with the existing JWT SECRET, distinct short TTL).
- [ ] Run; expect PASS. Commit.

### Task C.3: Google SSO (local-first stub)
**Files:** Create `server/lib/sso.js`, `server/routes/sso.js`; Modify `server/index.js` (mount `app.use("/api/auth", ssoRoutes(db))` — note it shares the `/api/auth` prefix, so mount alongside `authRoutes`).
**Interfaces:**
- `lib/sso.js`: `isGoogle()` → `!!process.env.GOOGLE_CLIENT_ID`. `authUrl(state)` → mock returns `/api/auth/google/callback?state=...&mock=1`; real returns the Google consent URL. `exchange(code, mockEmail?)` → mock returns a deterministic profile `{ sub:"mock-"+email, email, name }` (email from a signed `state` payload); real exchanges the code at Google's token endpoint + fetches userinfo via `fetch`.
- `routes/sso.js`:
  - `GET /api/auth/google/start?mode=login|signup&email=&orgName=` → sets a signed `state` cookie (carrying mode + email + orgName) and 302-redirects to `authUrl(state)`. In mock mode `email` is required so the flow is deterministic offline.
  - `GET /api/auth/google/callback` → validates `state`, resolves a profile. **signup mode:** create org + owner with `auth_provider='google'`, `google_sub`, random password hash; issue cookie; redirect to the owner dashboard. **login mode:** find user by `google_sub` or `email`; issue cookie; redirect to role dashboard. Unknown login → redirect to `login.html?sso=unknown`.

- [ ] Write `server/test/sso.test.js` (mock path; no `GOOGLE_*` env): `GET /api/auth/google/start?mode=signup&email=a@b.com&orgName=Acme` → 302 to the mock callback (assert `Location` contains `/google/callback`); following the callback (carry the `state` cookie) creates an org + owner and sets the auth cookie (a subsequent `/api/auth/me` is 200 with role `owner`); a second `start?mode=login&email=a@b.com` callback logs the *same* user in (same `org`, no duplicate org created). Assert `users.auth_provider='google'`.
- [ ] Run; expect FAIL.
- [ ] Implement `lib/sso.js` + `routes/sso.js`; mount in `index.js`.
- [ ] Run; expect PASS. Commit.

### Task C.4: SSO buttons + 2FA settings (front-end)
**Files:** Modify `login.html`/`functions/login.js`, `signup.html`/`functions/singUp.js` (add "Continue with Google" button → `window.location = "/api/auth/google/start?mode=login"`; handle a `{twofa:true}` login response by showing a code input that POSTs `login/2fa`); Modify `settings.html` + Create `functions/twofactor.js` (2FA card: show enroll → display `otpauthUrl` as text + manual secret, code input to verify/enable, disable button). No new nav page.
**Interfaces:** Reuse `API`, `toast`, `escapeHtml`. 2FA card injected into the existing settings page (loaded after `settings.js`).
- [ ] Build; manual/Playwright verify: enroll 2FA in settings, log out, log back in → prompted for code; Google button signs in via mock. Commit.

---

## Phase D — Public API, API keys, webhooks

### Task D.1: API-key management routes
**Files:** Create `server/routes/apikeys.js`; Modify `server/index.js` (mount `app.use("/api", apiKeyRoutes(db))`).
**Interfaces (cookie-authed, owner-only):**
- `POST /api/keys {name}` → generates a key, stores `prefix` + `key_hash`, returns `{ key:{ id, name, prefix }, raw }` — **`raw` returned exactly once**.
- `GET /api/keys` → list `{ id, name, prefix, lastUsedAt, revoked, createdAt }` (never the raw/hash).
- `DELETE /api/keys/:id` → set `revoked=1` (org-scoped; cross-org → 404).

- [ ] Extend `server/test/apikeys.test.js` step 3 (HTTP via `buildOrg`): owner creates a key → gets `raw` once + a `prefix`; `GET /api/keys` lists it without `raw`; instructor create → 403; revoke → list shows `revoked:true` and the raw key now fails `requireApiKey` on a public route; cross-org owner can't revoke another org's key (404).
- [ ] Run; expect FAIL.
- [ ] Implement `routes/apikeys.js`; mount.
- [ ] Run; expect PASS. Commit.

### Task D.2: Public REST surface (key-authed)
**Files:** Create `server/routes/public_api.js`; Modify `server/index.js` (mount `app.use("/api/public", publicApiRoutes(db))` **before** the `/api` 404 catch-all — order matters); Create `docs/PUBLIC-API.md`.
**Interfaces:** Router uses `requireApiKey(db)` for all routes except the no-auth KB (Phase E mounts separately). Every query filters by `req.apiOrgId`; cross-tenant → 404.
- `GET /api/public/v1/blockages?status=&cohortId=&limit=` → list (id, title, status, cohort, created_at, resolved_at).
- `GET /api/public/v1/blockages/:id` → detail incl. comments (no internal-only fields).
- `POST /api/public/v1/blockages {cohortId, title, details, studentEmail}` → creates a blockage on behalf of a student in the org (resolves student by email within the org; 404 if not found). Triggers the same notifications + (gated) AI path + `blockage.created` webhook.
- `GET /api/public/v1/analytics` → the org's headline metrics (resolveRate, deflectionRate, hoursSaved, totals).
- `GET /api/public/v1/cohorts` → id + name list.
Document all of the above + auth header + rate behavior in `docs/PUBLIC-API.md`.

- [ ] Write `server/test/public_api.test.js`: create a key via the cookie API, then drive a **raw-key client** (new `asKey(base, raw)` helper in `test/helpers.js` that sends `Authorization: Bearer`); `GET /api/public/v1/blockages` returns only that org's blockages; a key from org A cannot read org B's blockage (`/blockages/:id` → 404); `POST /api/public/v1/blockages {studentEmail}` creates one visible to that student in the cookie API; unknown email → 404; no key → 401.
- [ ] Run; expect FAIL.
- [ ] Add `asKey()` to `test/helpers.js`; implement `routes/public_api.js`; mount before the catch-all; write `docs/PUBLIC-API.md`.
- [ ] Run; expect PASS. Commit.

### Task D.3: Webhook endpoints + signed delivery
**Files:** Create `server/lib/webhooks.js`, `server/routes/webhooks.js`; Modify `server/index.js` (mount `app.use("/api", webhookRoutes(db))`); wire emit calls into `server/routes/blockages.js`.
**Interfaces:**
- `lib/webhooks.js`: `sign(secret, body)` → `"sha256=" + HMAC_SHA256_hex(secret, body)`. `emit(db, orgId, event, payload)` → for each active endpoint subscribed to `event`: build the JSON body, compute the signature header `X-Unblockify-Signature`, **POST via `fetch`** (real), but when `WEBHOOKS_MOCK !== "off"` *and* the URL host is not reachable / or in tests, capture into `webhook_deliveries` without a live network call. Default behavior records a `webhook_deliveries` row every time (status_code, ok, error) so deliveries are inspectable offline. Runs in `setImmediate` so it never blocks the request.
- `routes/webhooks.js` (cookie-authed, owner-only): `POST /api/webhooks {url, events[]}` → creates endpoint with a generated `secret`, returns it once; `GET /api/webhooks` → list (with `secret` masked except a short suffix); `DELETE /api/webhooks/:id`; `GET /api/webhooks/deliveries?endpointId=` → recent delivery log.
- Emit points in `blockages.js`: `blockage.created` (on report), `blockage.claimed`, `blockage.resolved`, `blockage.reopened` — each `emit(db, orgId, event, {...})`.

- [ ] Write `server/test/webhooks.test.js`: `sign(secret, body)` is deterministic + matches an independent `crypto.createHmac` computation (unit). Then HTTP: owner registers an endpoint (mock URL `http://localhost:1/hook`), reports a blockage as a student, and a `webhook_deliveries` row for `blockage.created` exists for that org with a stored payload + a signature; resolving adds a `blockage.resolved` delivery; an endpoint NOT subscribed to an event records nothing for it; cross-org owner sees no deliveries from the other org.
- [ ] Run; expect FAIL.
- [ ] Implement `lib/webhooks.js` + `routes/webhooks.js`; mount; add `emit` calls in `blockages.js` (gate them so tests without endpoints stay no-op; never throw into the request).
- [ ] Run; expect PASS. Commit.

### Task D.4: Developers page (front-end)
**Files:** Create `developers.html`, `functions/developers.js`; Modify `functions/api.js` (add owner NAV `{ href:"developers.html", icon:"list", label:"Developers" }` — **NAV update required**).
**Interfaces:** Owner page (`requireRole("owner")` + `renderShell`). Sections: API keys table (create modal → shows `raw` once with a copy button + a "store it now" warning; revoke), webhook endpoints (create with URL + event checkboxes; show `secret` once; delete; deliveries log per endpoint), and an inline API reference (curl examples mirroring `docs/PUBLIC-API.md`). All injected values `escapeHtml`; modal follows the `.modal` overlay convention.
- [ ] Build; manual verify: create a key, copy it, hit `/api/public/v1/analytics` with `curl -H "Authorization: Bearer <raw>"`; register a webhook to `http://localhost:9999/x`, report a blockage, see the delivery row. Commit.

---

## Phase E — Help center / public KB

### Task E.1: KB publish + public read API
**Files:** Create `server/routes/kb.js`; Modify `server/index.js` (mount `app.use("/api", kbRoutes(db))` for admin AND `app.use("/api/public", ...)` for the no-auth read — implement both in the one factory, or split; mount the public part before the catch-all).
**Interfaces:**
- Admin (cookie, owner/staff): `POST /api/kb/from-blockage/:id` → publishes a resolved blockage as an article (title from blockage, body = details + the resolving comment/resolution_note), generates a unique `slug` (`slugify(title)`-N), `published=1`. `POST /api/kb {title, body}` → manual article. `GET /api/kb` → org's articles. `PUT /api/kb/:id {published}` (un/publish). `DELETE /api/kb/:id`.
- **Public, NO auth:** `GET /api/public/kb?org=<slug>` → `{ org:{name}, articles:[{slug,title,createdAt}] }` for `published=1` only; unknown slug → 404. `GET /api/public/kb/:slug?org=<slug>` → one article `{title, body, createdAt}` (published only). Read-only; no `org_id` leak — resolve org by slug, return only published rows for that org.

- [ ] Write `server/test/kb.test.js`: owner publishes a resolved blockage → article exists with a slug; public `GET /api/public/kb?org=<slug>` (a fresh client, **no cookie**) lists it; `GET /api/public/kb/:slug?org=<slug>` returns the body; an unpublished article (`PUT {published:false}`) disappears from the public list; another org's slug never returns this article; student can't publish (403).
- [ ] Run; expect FAIL.
- [ ] Implement `routes/kb.js`; mount admin + public parts (public before the `/api` 404).
- [ ] Run; expect PASS. Commit.

### Task E.2: Public KB page + publish controls (front-end)
**Files:** Create `kb.html`, `functions/kb.js` (PUBLIC — no `renderShell`, no auth; reads `?org=` and optional `?article=`); Modify `blockage.html`/`functions/blockage.js` (add a "Publish to help center" button for owner/staff on resolved blockages) and `developers.html`/an owner KB list (or a small `kb` section on `integrations.html`). `kb.html` uses the "Signal" tokens + the public marketing styling, escapes all article content.
**Interfaces:** `kb.html` standalone page; lists published articles for the org slug, renders one article when `?article=slug`. Linkable/shareable, indexable (no auth wall).
- [ ] Build; manual verify: resolve a blockage, publish it, open `kb.html?org=<slug>` in a logged-out browser, see + open the article. Commit.

---

## Phase F — Integrations (Slack / calendar / LMS)

### Task F.1: Slack notifications (incoming webhook, local-first)
**Files:** Create `server/lib/slack.js`; Create `server/routes/integrations.js` (Slack + calendar config live here); Modify `server/index.js` (mount `app.use("/api", integrationRoutes(db))`); wire a Slack post into `blockages.js` resolve/report.
**Interfaces:**
- `lib/slack.js`: `isConfigured(url)` → `!!url`. `post(url, text)` → real: `fetch(url, {method:"POST", body: JSON.stringify({text})})`; mock/no-url: resolve a captured `{url, text}` (for tests) without a network call. `notifyOrg(db, orgId, text)` → reads `integrations.slack_webhook_url`; if set, `post`. Never throws into a request (`setImmediate` + try/catch).
- `routes/integrations.js` (owner-only, cookie): `GET /api/integrations` → `{ slackWebhookUrl, calendarUrl, officeHours }`; `PUT /api/integrations {slackWebhookUrl?, calendarUrl?, officeHours?}` → upsert the org's row; `POST /api/integrations/slack/test` → sends a test message via `notifyOrg`, returns `{ sent:boolean }` (mock returns `sent:true` and the captured text for assertion).
- Wire: on `blockage.resolved` and (optionally) `blockage.created`, call `notifyOrg(db, orgId, "...")`.

- [ ] Write `server/test/integrations.test.js` step 1: owner `PUT /api/integrations {slackWebhookUrl:"http://localhost:1/slack"}` then `GET` returns it; `POST /api/integrations/slack/test` → `{sent:true}`; without a configured URL, `notifyOrg` is a no-op (`sent:false`); cross-org isolation (one row per org). Use a test seam: `lib/slack.js` exposes a `_captured` array (only populated when mock) so the test asserts the message text without real HTTP.
- [ ] Run; expect FAIL.
- [ ] Implement `lib/slack.js` + the integrations route; mount.
- [ ] Run; expect PASS. Commit.

### Task F.2: Calendar office-hours links
**Files:** (Reuse `server/routes/integrations.js` — `calendarUrl`/`officeHours` already in the `PUT`/`GET`.) Modify `functions/api.js`/student + instructor pages later to surface the link.
**Interfaces:** `officeHours` stored as a JSON string of `[{label, calendarUrl}]` (e.g. a Google Calendar event link). Surfaced read-only to students/instructors via a new `GET /api/integrations/public` (org-scoped, any authed member) → `{ calendarUrl, officeHours }` so non-owners can see the schedule without exposing the Slack URL.
- [ ] Extend `integrations.test.js` step 2: owner sets `officeHours` JSON + `calendarUrl`; a student (`buildOrg`'s `student`) `GET /api/integrations/public` sees `calendarUrl`+`officeHours` but NOT `slackWebhookUrl`; owner `PUT` with malformed `officeHours` (not JSON-array) → 400.
- [ ] Run; expect FAIL.
- [ ] Implement the public read + validation.
- [ ] Run; expect PASS. Commit.

### Task F.3: LMS roster import (CSV bulk student create)
**Files:** Create `server/lib/lms.js`; add a route to `server/routes/integrations.js`.
**Interfaces:**
- `lib/lms.js`: `parseRoster(csvText)` → `[{name, email}]` (header-aware: `name,email`; trims; skips blanks; validates email; throws/returns errors list on malformed). Pure-JS, no dep.
- Route `POST /api/integrations/lms/import {csv, cohortId}` (owner) → parses; for each valid row, **respects `canAddMember`** (stops + reports when the seat limit is hit, returning `{created, skipped, seatLimitHit:true}` and a 402-style `upgrade` flag in the body); creates `users` (role `student`, `auth_provider='password'`, random password hash, the given `cohort_id`); idempotent on existing email (skip, count as `skipped`). Returns `{ created, skipped, errors:[{email,reason}] }`.

- [ ] Write `integrations.test.js` step 3: `parseRoster("name,email\nA,a@x.com\nB,bad\n,c@x.com")` → 1 valid + 2 errors (unit). HTTP: owner imports a 2-student CSV into a cohort → `created:2`, the students appear in `GET /api/members`; re-import the same CSV → `skipped:2`; importing past the free seat limit returns `seatLimitHit:true` + partial `created`; instructor import → 403.
- [ ] Run; expect FAIL.
- [ ] Implement `lib/lms.js` + the import route (reuse bcrypt + `billing.canAddMember`).
- [ ] Run; expect PASS. Commit.

### Task F.4: Integrations page (front-end)
**Files:** Create `integrations.html`, `functions/integrations.js`; Modify `functions/api.js` (add owner NAV `{ href:"integrations.html", icon:"layers", label:"Integrations" }` — **NAV update required**); add the office-hours link to `student_dashbord.html`/instructor pages (read `GET /api/integrations/public`).
**Interfaces:** Owner page: Slack webhook URL field + "Send test"; calendar URL + office-hours JSON editor (or a small repeating row UI); LMS import (paste CSV or file input → preview → import → result toast). All values `escapeHtml`; reuse the modal convention for the import preview.
- [ ] Build; manual verify: set a Slack URL + send test (mock toast), paste a roster CSV → import → students appear in Members, set office hours → student sees the link. Commit.

---

## Phase G — Wiring, docs, polish

### Task G.1: Mount-order + 404 audit
**Files:** Modify `server/index.js`.
**Interfaces:** Confirm every new public route group (`/api/public/*`, `/api/public/kb`, `/api/billing/stripe-webhook`) is mounted **before** the `/api` JSON-404 catch-all and the static handler. Confirm the body-size cap (100kb) is acceptable for CSV import (raise the JSON limit on the LMS route to e.g. 1mb via a route-level `express.json({limit:"1mb"})` if needed).
- [ ] Write a small `server/test/mount.test.js`: `GET /api/public/kb?org=<slug>` (no auth) returns 200/404 JSON (not the static index HTML), proving the public mount precedes the catch-all + static; `GET /api/nonexistent` → JSON 404.
- [ ] Run; expect FAIL if ordering is wrong; fix ordering; PASS. Commit.

### Task G.2: NAV + plan badge in the shell
**Files:** Modify `functions/api.js`.
**Interfaces:** Owner NAV now includes Billing, Developers, Integrations (added in B.4/D.4/F.4 — verify the final order is sensible: Dashboard, Blockages, Cohorts, Members, Integrations, Developers, Billing, Settings). Add a tiny `planBadge(plan)` helper + a 402-aware global API error toast (when any `API.request` throws `status===402`, toast "Upgrade required" linking to `billing.html`). Add an `apiKey()`-style raw client only if needed by docs examples (else skip).
- [ ] Manual verify the owner sidebar shows all pages and a 402 surfaces an upgrade toast. Commit.

### Task G.3: README + PUBLIC-API docs + env table
**Files:** Modify `README.md` (or `CLAUDE.md`) Phase 6 section; ensure `docs/PUBLIC-API.md` is complete.
**Interfaces:** Document the new env vars (Stripe/Google/Slack), the local-first defaults, the API-key + webhook usage, and the public KB URL pattern (`kb.html?org=<slug>`).
- [ ] Update docs. Commit.

---

## Self-review checklist

- [ ] **Offline-first:** With **zero** env vars set, `npm start` runs and the full demo works — mock checkout upgrades a plan, Google button signs in via the stub, webhooks/Slack are captured into the DB without network, LMS import + KB publish work. No code path requires Stripe/Google/Slack to be reachable.
- [ ] **Provider switch:** Each adapter (`billing`, `sso`, `slack`, `webhooks`) gates real behavior behind exactly its env var (`STRIPE_SECRET`, `GOOGLE_CLIENT_ID`, configured webhook/Slack URLs); the mock branch is the default and is the only branch exercised by `node:test`.
- [ ] **API-key auth is separate:** `requireApiKey(db)` is a distinct middleware from `requireAuth`; public routes never read the cookie, cookie routes never read the key. Keys are stored hashed (`sha256`), the raw key is returned exactly once, revoked keys 401.
- [ ] **Tenant isolation everywhere:** every new query filters by `org_id` (`req.user.orgId` for cookie routes, `req.apiOrgId` for key routes, org-by-slug for public KB). Tests prove cross-org access → 404 for blockages, keys, webhooks, billing, KB.
- [ ] **Seat/plan limits enforced server-side:** invite create, join, and LMS import all return 402 (`code`/`upgrade`) at the seat limit; AI autorespond is gated by monthly plan usage. The front-end surfaces 402 as an upgrade prompt.
- [ ] **2FA correctness:** TOTP verified against an RFC 6238 vector; an enabled account cannot complete login in one step (cookie withheld until the code step); disable requires a valid code.
- [ ] **Webhooks signed + logged:** every delivery is HMAC-SHA256 signed (`X-Unblockify-Signature`), recorded in `webhook_deliveries`, fired in `setImmediate`, and never throws into the originating request; only subscribed events are delivered.
- [ ] **Public KB leaks nothing:** the no-auth endpoints return only `published=1` rows for the resolved org slug, never `org_id`, drafts, or other orgs' data; the page escapes all article HTML.
- [ ] **Schema migration is safe on an existing `data.db`:** all DDL is `IF NOT EXISTS`; the two `users` columns are added via the guarded `addColumnIfMissing` helper; running `migrate()` twice is a no-op.
- [ ] **No new native deps:** `package.json` dependencies unchanged except possibly none; TOTP/base32/HMAC/HTTP all use `node:crypto` + built-in `fetch`. `npm install` still pure-JS.
- [ ] **Mount order:** `/api/public/*`, `/api/public/kb`, and the Stripe webhook are mounted before the `/api` 404 catch-all and the static file handler (proved by `mount.test.js`).
- [ ] **Front-end conventions:** new owner pages use `renderShell` + `requireRole("owner")`; `kb.html` is intentionally shell-less + auth-less; all injected values pass through `escapeHtml`; modals follow the single-panel `.modal` overlay convention; `NAV` updated for Billing/Developers/Integrations.
- [ ] **Tests green:** `npm test` auto-discovers all new `*.test.js`, runs with `AI_AUTORESPOND=0` (gated up explicitly where the AI path is asserted) and `AUTH_RATELIMIT=off`, and passes; every backend task followed failing-test → minimal-real-code → passing-test → commit.
- [ ] **Commits:** each ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
