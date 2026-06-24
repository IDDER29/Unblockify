/* Shared front-end runtime: API client, auth guards, app shell, helpers. */

const API = {
  async request(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(p) { return this.request(p); },
  post(p, b) { return this.request(p, { method: "POST", body: b }); },
  put(p, b) { return this.request(p, { method: "PUT", body: b }); },
  del(p) { return this.request(p, { method: "DELETE" }); },
};

// --- Auth ------------------------------------------------------------
async function getSession() {
  try { return await API.get("/api/auth/me"); } catch (_) { return null; }
}
function dashboardFor(role) {
  return role === "owner" ? "owner_dashboard.html"
    : role === "instructor" ? "instructor_queue.html"
    : "student_dashbord.html";
}
async function logout() {
  try { await API.post("/api/auth/logout"); } catch (_) {}
  window.location.href = "login.html";
}
// Guard a page: returns {user, org} or redirects.
async function requireRole(...roles) {
  const s = await getSession();
  if (!s) { window.location.href = "login.html"; return null; }
  if (!roles.includes(s.user.role)) { window.location.href = dashboardFor(s.user.role); return null; }
  return s;
}

// --- Formatting + safety --------------------------------------------
function escapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Safe markdown subset. ESCAPE FIRST, then render — never trust raw HTML.
function renderMarkdown(raw) {
  const source = String(raw == null ? "" : raw);
  // 1) Pull out fenced code blocks first so their contents are never formatted.
  const blocks = [];
  let escaped = source.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    const i = blocks.length;
    const label = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : "";
    blocks.push(
      `<pre class="md-code">${label}<code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`
    );
    return ` BLOCK${i} `;
  });
  // 2) Escape everything else.
  escaped = escapeHtml(escaped);
  // 3) Inline code (inner text is already escaped).
  escaped = escaped.replace(/`([^`\n]+)`/g, (m, c) => `<code class="md-inline">${c}</code>`);
  // 4) Bold then italic (bold first to avoid * collisions).
  escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  // 5) Links — only http/https. Text was already escaped above.
  escaped = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (m, text, url) => `<a href="${url}" rel="noopener noreferrer" target="_blank">${text}</a>`
  );
  // 6) Bullet lists: consecutive lines starting with - or * .
  escaped = escaped.replace(/(?:^|\n)((?:[-*] .*(?:\n|$))+)/g, (m, list) => {
    const items = list
      .trim()
      .split("\n")
      .map((l) => `<li>${l.replace(/^[-*]\s+/, "")}</li>`)
      .join("");
    return `\n<ul class="md-list">${items}</ul>`;
  });
  // 7) Remaining newlines -> <br>.
  escaped = escaped.replace(/\n/g, "<br>");
  // 8) Re-insert code blocks (strip any <br> we added around them).
  escaped = escaped.replace(/(?:<br>)? BLOCK(\d+) (?:<br>)?/g, (m, i) => blocks[Number(i)]);
  return escaped;
}

// --- Attachment upload (client mirrors the server allowlist for fast errors) ---
const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
const ATTACH_ALLOWED = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "text/plain", "application/pdf",
];
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",").pop());
    fr.onerror = () => reject(new Error("Could not read the file."));
    fr.readAsDataURL(file);
  });
}
async function uploadAttachment(file, opts = {}) {
  if (file.size > ATTACH_MAX_BYTES) throw new Error(file.name + " is larger than 5MB.");
  if (!ATTACH_ALLOWED.includes(file.type)) throw new Error(file.name + " is not a supported type.");
  const dataB64 = await fileToBase64(file);
  const body = { filename: file.name, mime: file.type, dataB64 };
  if (opts.blockageId) body.blockageId = opts.blockageId;
  const { attachment } = await API.post("/api/attachments", body);
  return attachment;
}
function parseDate(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).replace(" ", "T") + "Z");
  return isNaN(d) ? null : d;
}
function fmtDate(iso) {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";
}
function fmtTime(iso) {
  const d = parseDate(iso);
  return d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";
}
function fmtRelative(iso) {
  const d = parseDate(iso); if (!d) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return fmtDate(iso);
}

// --- Status mapping (lifecycle -> UI) -------------------------------
const STATUS = {
  open: { cls: "blocked", label: "Blocked" },
  in_support: { cls: "pending", label: "In support" },
  resolved: { cls: "resolved", label: "Resolved" },
};
function statusMeta(s) { return STATUS[s] || STATUS.open; }

// --- Tags + CSAT -----------------------------------------------------
function tagPills(tags) {
  if (!tags || !tags.length) return "";
  return tags
    .map((t) => {
      const c = t.color ? `style="--tag:${escapeHtml(t.color)}"` : "";
      return `<span class="tag-pill" ${c}>${escapeHtml(t.name)}</span>`;
    })
    .join("");
}
function csatStars(n) {
  const r = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  let out = "";
  for (let i = 1; i <= 5; i++) out += `<span class="csat-star${i <= r ? " on" : ""}">★</span>`;
  return out;
}

// --- Toasts ----------------------------------------------------------
function toast(message, type = "info") {
  let c = document.querySelector(".toast-container");
  if (!c) { c = document.createElement("div"); c.className = "toast-container"; document.body.appendChild(c); }
  const el = document.createElement("div");
  el.className = "toast toast-" + type;
  const assertive = type === "error" || type === "warning";
  el.setAttribute("role", assertive ? "alert" : "status");
  el.setAttribute("aria-live", assertive ? "assertive" : "polite");
  el.textContent = message;
  c.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 250); }, 3500);
}

// --- Styled confirm dialog (replaces window.confirm) -----------------
function confirmModal(message, { confirmLabel = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal confirm-modal";
    overlay.style.display = "flex";
    overlay.innerHTML = `<div class="modal-panel confirm-panel" role="dialog" aria-modal="true">
      <p class="confirm-msg">${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button class="btn btn-ghost" id="_cmCancel">Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="_cmConfirm">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector("#_cmConfirm").addEventListener("click", () => cleanup(true));
    overlay.querySelector("#_cmCancel").addEventListener("click", () => cleanup(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false); });
    const onKey = (e) => { if (e.key === "Escape") { document.removeEventListener("keydown", onKey); cleanup(false); } };
    document.addEventListener("keydown", onKey);
    overlay.querySelector("#_cmConfirm").focus();
  });
}

// --- Accessible modal helpers (used by app pages with modals) --------
let _modalLastFocus = null;
function trapFocus(container) {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function onKey(e) {
    if (e.key !== "Tab") return;
    const items = Array.from(container.querySelectorAll(sel)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  container.addEventListener("keydown", onKey);
  container._releaseTrap = () => container.removeEventListener("keydown", onKey);
}
function openModal(overlay, opts = {}) {
  if (!overlay) return;
  _modalLastFocus = document.activeElement;
  overlay.style.display = "flex";
  const panel = overlay.querySelector(".modal-content, form, .panel") || overlay;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  if (opts.labelledby) panel.setAttribute("aria-labelledby", opts.labelledby);
  trapFocus(overlay);
  overlay._escHandler = (e) => { if (e.key === "Escape") closeModal(overlay); };
  document.addEventListener("keydown", overlay._escHandler);
  const focusTarget = overlay.querySelector("input,select,textarea,button");
  if (focusTarget) focusTarget.focus();
}
function closeModal(overlay) {
  if (!overlay) return;
  overlay.style.display = "none";
  if (overlay._releaseTrap) overlay._releaseTrap();
  if (overlay._escHandler) document.removeEventListener("keydown", overlay._escHandler);
  if (_modalLastFocus && _modalLastFocus.focus) _modalLastFocus.focus();
}

// --- App shell -------------------------------------------------------
const MARK = '<svg width="0" height="0" style="position:absolute"><symbol id="mark" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="9" fill="#12B886"/><path d="M6 16h4l2.5-6 4 12 2.5-6h7" fill="none" stroke="#05281d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol></svg>';

const ICONS = {
  grid: '<svg fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="13" width="7" height="4" rx="1.5"/><rect x="13" y="3" width="4" height="7" rx="1.5"/><rect x="13" y="13" width="4" height="4" rx="1.5"/></svg>',
  list: '<svg fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h14M3 10h14M3 15h9" stroke-linecap="round"/></svg>',
  chart: '<svg fill="none" stroke="currentColor" stroke-width="2"><path d="M3 16V9M8 16V4M13 16v-5M18 16V7" stroke-linecap="round"/></svg>',
  people: '<svg fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="6" r="3"/><path d="M2 17a5 5 0 0110 0M13 4a3 3 0 010 6M14 17a5 5 0 00-3-4.6" stroke-linecap="round"/></svg>',
  layers: '<svg fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2l8 4-8 4-8-4 8-4zM2 10l8 4 8-4M2 14l8 4 8-4" stroke-linejoin="round"/></svg>',
  cog: '<svg fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="3"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3" stroke-linecap="round"/></svg>',
  shield: '<svg fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z" stroke-linejoin="round"/><path d="M7 10l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bell: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2a5 5 0 00-5 5c0 5-2 6-2 6h14s-2-1-2-6a5 5 0 00-5-5zM8.5 17a1.8 1.8 0 003 0" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  book: '<svg fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2h12a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M8 2v18M4 7h4M4 11h4" stroke-linecap="round"/></svg>',
};

const NAV = {
  owner: [
    { href: "owner_dashboard.html", icon: "chart", label: "Dashboard" },
    { href: "owner_blockages.html", icon: "grid", label: "Blockages" },
    { href: "cohorts.html", icon: "layers", label: "Cohorts" },
    { href: "members.html", icon: "people", label: "Members" },
    { href: "ops.html", icon: "shield", label: "Ops & trust" },
    { href: "settings.html", icon: "cog", label: "Settings" },
  ],
  instructor: [
    { href: "instructor_queue.html", icon: "grid", label: "Queue" },
    { href: "cohorts.html", icon: "layers", label: "Cohorts" },
    { href: "settings.html", icon: "cog", label: "Settings" },
  ],
  student: [
    { href: "student_dashbord.html", icon: "grid", label: "My blockages" },
    { href: "growth.html", icon: "chart", label: "My growth" },
    { href: "knowledge.html", icon: "book", label: "Library" },
    { href: "settings.html", icon: "cog", label: "Settings" },
  ],
};

const ROLE_LABEL = { owner: "Owner", instructor: "Instructor", student: "Student" };

/**
 * Render the sidebar + topbar into <div id="app">. Returns the #view element
 * (the content area) and a topbar actions slot. Pages render into #view.
 */
function renderShell({ user, org, active, title, crumb, actions = "" }) {
  if (!document.getElementById("mark")) {
    document.body.insertAdjacentHTML("afterbegin", MARK);
  }
  const items = (NAV[user.role] || [])
    .map(
      (n) => `<li><a href="${n.href}" class="${active === n.href ? "active" : ""}"${active === n.href ? ' aria-current="page"' : ""}>
        <span class="ic" aria-hidden="true">${ICONS[n.icon]}</span><span>${escapeHtml(n.label)}</span></a></li>`
    )
    .join("");

  const app = document.getElementById("app");
  app.className = "app";
  app.innerHTML = `
    <a class="skip-link" href="#view">Skip to content</a>
    <div class="sidebar-overlay" id="sidebarOverlay" aria-hidden="true"></div>
    <aside class="sidebar" id="sidebar" aria-label="Sidebar">
      <a href="${dashboardFor(user.role)}" class="brand"><svg class="brand-mark" aria-hidden="true"><use href="#mark"/></svg><span>Unblockify</span></a>
      <div class="side-section">${escapeHtml(org.name)}</div>
      <nav aria-label="Main"><ul class="side-nav">${items}</ul></nav>
      <div class="side-user">
        <div class="avatar">${escapeHtml((user.name || "?").charAt(0).toUpperCase())}</div>
        <div class="who"><div class="nm">${escapeHtml(user.name)}</div><div class="rl">${ROLE_LABEL[user.role]}</div></div>
        <button class="logout-btn" id="logoutBtn" title="Log out"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3H4a1 1 0 00-1 1v10a1 1 0 001 1h3M12 13l3-3-3-3M15 10H7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </aside>
    <div class="app-main">
      <header class="topbar">
        <div style="display:flex;align-items:center;gap:0.5rem;min-width:0">
          <button class="hamburger" id="hamburger" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 5h14M3 10h14M3 15h14" stroke-linecap="round"/></svg>
          </button>
          <div style="min-width:0"><div class="crumb">${escapeHtml(crumb || ROLE_LABEL[user.role])}</div><div class="page-title">${escapeHtml(title || "")}</div></div>
        </div>
        <div class="topbar-actions">
          ${actions}
          <a class="icon-btn notif-bell" href="notifications.html" title="Notifications" style="position:relative">${ICONS.bell}<span class="notif-count" id="notifCount" hidden>0</span></a>
        </div>
      </header>
      <main class="content" id="view" tabindex="-1"></main>
    </div>`;
  document.getElementById("logoutBtn").addEventListener("click", logout);
  // Mobile sidebar drawer
  const _ham = document.getElementById("hamburger");
  const _ov = document.getElementById("sidebarOverlay");
  if (_ham && _ov) {
    function _closeSidebar() {
      document.body.classList.remove("sidebar-open");
      _ham.setAttribute("aria-expanded", "false");
    }
    _ham.addEventListener("click", () => {
      const open = document.body.classList.toggle("sidebar-open");
      _ham.setAttribute("aria-expanded", String(open));
    });
    _ov.addEventListener("click", _closeSidebar);
    // Close drawer when a nav link is clicked (SPA navigation)
    document.getElementById("sidebar").querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", _closeSidebar);
    });
  }
  refreshNotifDot();
  ensureStream();
  return document.getElementById("view");
}

async function refreshNotifDot() {
  try {
    const res = await API.get("/api/notifications");
    const count = res.unread || 0;
    const badge = document.getElementById("notifCount");
    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = count > 9 ? "9+" : String(count);
    }
    // Legacy dot support
    const dot = document.querySelector(".notif-dot");
    if (dot) dot.hidden = count === 0;
  } catch (_) {}
}

// --- Real-time stream (Server-Sent Events) ---------------------------
/**
 * Open an EventSource to /api/stream and route named events to handlers.
 * `handlers` is a map of { eventName: (data) => void }. Reconnects with a
 * capped backoff if the connection drops. Returns { close } to stop it.
 * No-ops gracefully if EventSource is unavailable.
 */
function subscribe(handlers) {
  if (!window.EventSource) return { close() {} };
  let es = null;
  let stopped = false;
  let backoff = 1000; // grows to a cap on repeated failures
  let retryTimer = null;

  function open() {
    if (stopped) return;
    es = new EventSource("/api/stream", { withCredentials: true });
    es.addEventListener("open", () => { backoff = 1000; });
    for (const key of Object.keys(handlers)) {
      es.addEventListener(key, (e) => {
        let data = null;
        try { data = JSON.parse(e.data); } catch (_) {}
        try { handlers[key](data); } catch (_) {}
      });
    }
    es.addEventListener("error", () => {
      if (stopped) return;
      // Only reconnect when the browser has actually closed the connection;
      // a transient error leaves the native EventSource to retry on its own.
      if (es && es.readyState === EventSource.CLOSED) {
        try { es.close(); } catch (_) {}
        clearTimeout(retryTimer);
        retryTimer = setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    });
  }

  open();
  return {
    close() {
      stopped = true;
      clearTimeout(retryTimer);
      if (es) { try { es.close(); } catch (_) {} }
    },
  };
}

// Shared per-page stream: one connection dispatched to many handlers.
const __streamRegistry = {}; // { eventName: Set<fn> }

/** Register a handler for a stream event. Returns an unregister fn. */
function onStreamEvent(event, fn) {
  if (!__streamRegistry[event]) __streamRegistry[event] = new Set();
  __streamRegistry[event].add(fn);
  return () => { if (__streamRegistry[event]) __streamRegistry[event].delete(fn); };
}

function __dispatchStream(event, data) {
  const set = __streamRegistry[event];
  if (!set) return;
  set.forEach((fn) => { try { fn(data); } catch (_) {} });
}

// Open the single shared stream once per page (called from renderShell).
function ensureStream() {
  if (!window.EventSource) return;
  if (window.__unblockifyStream) return;
  window.__unblockifyStream = subscribe({
    notification(data) {
      const dot = document.querySelector(".notif-dot");
      if (dot) dot.hidden = false;
      refreshNotifDot();
      __dispatchStream("notification", data);
    },
  });
}
