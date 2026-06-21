"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { publish, subscribe } = require("../lib/bus");

test("bus delivers to a subscriber and stops after unsubscribe", () => {
  const got = [];
  const off = subscribe(7, (p) => got.push(p));
  publish(7, "ping", { x: 1 });
  assert.deepEqual(got, [{ event: "ping", data: { x: 1 } }]);
  off();
  publish(7, "ping", { x: 2 });
  assert.equal(got.length, 1, "no delivery after unsubscribe");
});

test("bus is per-user (no cross-channel delivery)", () => {
  const got = [];
  const off = subscribe(1, (p) => got.push(p));
  publish(2, "ping", { x: 1 });
  assert.equal(got.length, 0);
  off();
});
