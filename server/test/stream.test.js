"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, buildOrg } = require("./helpers");

// AI auto-respond is gated off by default in startServer (AI_AUTORESPOND=0),
// so the only stream event in this test is the instructor's "new blockage"
// notification — keeps the assertion deterministic.

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv.close();
});

// Read the SSE response body, accumulating decoded chunks, until `predicate`
// matches the accumulated text or `timeoutMs` elapses. Returns the accumulated
// text (whether or not the predicate matched — caller asserts).
async function readUntil(res, predicate, timeoutMs) {
  let acc = "";
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });

  async function consume() {
    for await (const chunk of res.body) {
      acc += decoder.decode(Buffer.from(chunk), { stream: true });
      if (predicate(acc) || Date.now() >= deadline) return;
    }
  }

  try {
    await Promise.race([consume(), timeout]);
  } catch (_) {
    // Aborting the request rejects the async iterator; swallow it.
  } finally {
    clearTimeout(timer);
  }
  return acc;
}

test("SSE stream delivers a notification when a blockage is reported", async () => {
  const org = await buildOrg(srv.base, "Stream", "stream");
  const cookie = org.instructor.getCookie();
  assert.ok(cookie, "instructor has a session cookie");

  const ac = new AbortController();
  let res;
  try {
    res = await fetch(srv.base + "/api/stream", {
      headers: { cookie },
      signal: ac.signal,
    });
    assert.equal(res.status, 200, "stream opened");
    assert.match(
      res.headers.get("content-type") || "",
      /text\/event-stream/,
      "SSE content-type"
    );

    // Start reading first, then trigger the notification in parallel: the
    // student reports a blockage, which notifies the assigned instructor.
    const reading = readUntil(
      res,
      (t) => t.includes("event: notification"),
      3000
    );

    // Give the stream a tick to subscribe before publishing.
    await new Promise((r) => setTimeout(r, 100));
    const rep = await org.student.post("/api/blockages", {
      title: "Stuck on auth",
      cohortId: org.cohortId,
      briefId: org.briefId,
      difficulty: "high",
      details: "401 on every request",
    });
    assert.equal(rep.status, 201, "blockage reported");

    const text = await reading;
    assert.ok(
      text.includes("event: notification"),
      "stream emitted a notification event within 3s"
    );
  } finally {
    ac.abort();
  }
});
