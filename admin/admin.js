/* Shared admin shell — auth guard + nav for all admin pages. */
(function () {
  const secret = sessionStorage.getItem("admin_secret");
  if (!secret) { location.href = "/admin/index.html"; return; }

  window.ADMIN = {
    secret,
    async fetch(path) {
      const r = await fetch("/admin/api" + path, {
        headers: { Authorization: "Bearer " + secret }
      });
      if (r.status === 401) { sessionStorage.removeItem("admin_secret"); location.href = "/admin/index.html"; }
      if (!r.ok) throw new Error((await r.json()).error || "Request failed");
      return r.json();
    },
    nav() {
      const page = location.pathname.split("/").pop();
      const links = [
        { href: "metrics.html", label: "Platform metrics" },
        { href: "orgs.html", label: "Organizations" },
        { href: "flags.html", label: "Ops flags" },
      ];
      return `<nav style="background:var(--ink,#0C111B);color:#fff;padding:.75rem 1.5rem;display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap">
        <a href="metrics.html" style="color:var(--flow,#12B886);font-weight:700;text-decoration:none;display:flex;align-items:center;gap:.5rem">
          <svg width="22" height="22" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="9" fill="#12B886"/><path d="M6 16h4l2.5-6 4 12 2.5-6h7" fill="none" stroke="#05281d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Admin
        </a>
        ${links.map(l => `<a href="${l.href}" style="color:${page===l.href?'#fff':'rgba(255,255,255,.6)'};text-decoration:none;font-size:.9rem;${page===l.href?'font-weight:600':''}">${l.label}</a>`).join("")}
        <button onclick="sessionStorage.removeItem('admin_secret');location.href='/admin/index.html'" style="margin-left:auto;background:none;border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:6px;padding:.3rem .75rem;cursor:pointer;font-size:.82rem">Sign out</button>
      </nav>`;
    },
    escapeHtml(s) {
      return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    },
    fmtRelative(d) {
      if (!d) return "—";
      const diff = Date.now() - new Date(d).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1) return "just now";
      if (m < 60) return m + "m ago";
      const h = Math.floor(m / 60);
      if (h < 24) return h + "h ago";
      return Math.floor(h / 24) + "d ago";
    }
  };

  document.getElementById("admin-nav").outerHTML = ADMIN.nav();
})();
