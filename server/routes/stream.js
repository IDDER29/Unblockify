"use strict";

const express = require("express");
const { requireAuth } = require("../auth");
const { subscribe } = require("../lib/bus");

// GET /api/stream — per-user Server-Sent Events feed. The browser sends the
// httpOnly cookie on the EventSource request (same-origin), so requireAuth works.
module.exports = function streamRoutes(db) {
  const router = express.Router();

  router.get("/stream", requireAuth, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let open = true;
    const write = (event, data) => {
      if (!open) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    write("ready", {});

    const unsubscribe = subscribe(req.user.userId, (payload) =>
      write(payload.event, payload.data)
    );
    const heartbeat = setInterval(() => {
      if (open) res.write(":ping\n\n");
    }, 25000);

    req.on("close", () => {
      open = false;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
};
