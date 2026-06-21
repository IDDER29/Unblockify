"use strict";

// In-process per-user pub/sub for SSE. One EventEmitter per process — the
// real-time layer is in-memory by design (no external broker; stays local).
const { EventEmitter } = require("node:events");

const bus = new EventEmitter();
bus.setMaxListeners(0); // many concurrent SSE clients; don't warn

// Emit `{ event, data }` on the caller's private channel.
function publish(userId, event, data) {
  bus.emit("u:" + userId, { event, data });
}

// Register a listener on a user's channel; returns an unsubscribe fn.
function subscribe(userId, listener) {
  const ch = "u:" + userId;
  bus.on(ch, listener);
  return () => bus.off(ch, listener);
}

module.exports = { bus, publish, subscribe };
