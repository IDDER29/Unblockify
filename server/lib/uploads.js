"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

// mime -> canonical extension. Allowlist only: images, plain text, pdf.
const ALLOWED_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "text/plain": "txt",
  "application/pdf": "pdf",
};

function extForMime(mime) {
  return ALLOWED_MIME[String(mime || "").toLowerCase()] || null;
}

function uploadsDir() {
  const dir = path.join(__dirname, "..", "uploads");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function storedPathFor(ext) {
  const name = crypto.randomBytes(16).toString("hex") + "." + ext;
  return { abs: path.join(uploadsDir(), name), rel: name };
}

function decodeBase64({ dataB64, mime }) {
  const ext = extForMime(mime);
  if (!ext) return { error: "Unsupported file type." };
  if (typeof dataB64 !== "string" || !dataB64) return { error: "Empty file." };
  let buffer;
  try {
    buffer = Buffer.from(dataB64, "base64");
  } catch (_) {
    return { error: "Could not read the file." };
  }
  if (!buffer.length) return { error: "Empty file." };
  if (buffer.length > MAX_UPLOAD_BYTES) return { error: "File is larger than 5MB." };
  return { buffer, size: buffer.length };
}

module.exports = {
  MAX_UPLOAD_BYTES,
  ALLOWED_MIME,
  extForMime,
  uploadsDir,
  storedPathFor,
  decodeBase64,
};
