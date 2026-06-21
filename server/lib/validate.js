"use strict";
// Returns an error string if `value` (already trimmed) exceeds max, else null.
function tooLong(value, max, label) {
  if (value && String(value).length > max) return `${label} is too long (max ${max} characters).`;
  return null;
}
module.exports = { tooLong };
