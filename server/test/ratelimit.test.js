"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient } = require("./helpers");

let srv;

before(async () => {
  // Turn the limiter ON with a small ceiling BEFORE the server is built,
  // so the auth routes pick up AUTH_RATELIMIT_MAX when constructing the limiter.
  process.env.AUTH_RATELIMIT = "on";
  process.env.AUTH_RATELIMIT_MAX = "5";
  srv = await startServer();
});

after(async () => {
  // Restore the suite-wide default so other tests/instances stay unaffected.
  process.env.AUTH_RATELIMIT = "off";
  if (srv) await srv.close();
});

test("login is rate-limited after too many attempts", async () => {
  const client = makeClient(srv.base);
  const statuses = [];
  let saw429 = false;

  for (let i = 0; i < 10; i++) {
    const r = await client.post("/api/auth/login", {
      email: "nobody@example.com",
      password: "wrong-password",
    });
    statuses.push(r.status);
    if (r.status === 429) {
      saw429 = true;
      break;
    }
  }

  // Early attempts are real auth failures (bad creds → 401), not throttled.
  assert.equal(statuses[0], 401, "first attempt should be a 401 (bad creds), not throttled");
  // With max=5, the 6th request crosses the threshold and must be throttled.
  assert.ok(saw429, "expected a 429 once the per-IP attempt ceiling is exceeded");
});
