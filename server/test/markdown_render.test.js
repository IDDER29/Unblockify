"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Load escapeHtml + renderMarkdown out of the browser file into a sandbox.
const src = fs.readFileSync(
  path.join(__dirname, "..", "..", "functions", "api.js"), "utf8"
);
const ctx = { document: undefined };
vm.createContext(ctx);
vm.runInContext(
  src.match(/function escapeHtml[\s\S]*?\n}\n/)[0] +
  src.match(/function renderMarkdown[\s\S]*?\n}\n/)[0] +
  "this.escapeHtml = escapeHtml; this.renderMarkdown = renderMarkdown;",
  ctx
);
const { renderMarkdown } = ctx;

test("renderMarkdown escapes HTML before formatting (XSS-safe)", () => {
  const out = renderMarkdown('<img src=x onerror=alert(1)> **bold**');
  assert.ok(!out.includes("<img"), "raw HTML is neutralised");
  assert.ok(out.includes("&lt;img"), "tags are escaped");
  assert.ok(out.includes("<strong>bold</strong>"));
});

test("renderMarkdown renders fenced code blocks with a language label", () => {
  const out = renderMarkdown("```js\nconst x = 1;\n```");
  assert.ok(out.includes('class="md-code"'));
  assert.ok(out.includes("const x = 1;"));
  assert.ok(out.includes("js"));
});

test("renderMarkdown renders inline code and keeps it escaped", () => {
  const out = renderMarkdown("run `rm -rf <x>` now");
  assert.ok(out.includes('<code class="md-inline">rm -rf &lt;x&gt;</code>'));
});

test("renderMarkdown only allows http(s) links", () => {
  assert.ok(renderMarkdown("[site](https://ex.com)").includes('rel="noopener noreferrer"'));
  assert.ok(!renderMarkdown("[x](javascript:alert(1))").includes("<a "));
});

test("renderMarkdown renders simple bullet lists", () => {
  const out = renderMarkdown("- one\n- two");
  assert.ok(out.includes('<ul class="md-list">'));
  assert.equal((out.match(/<li>/g) || []).length, 2);
});
