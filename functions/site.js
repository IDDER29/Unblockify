/* Shared marketing-site chrome: pulse mark + sticky nav + rich footer.
   Each marketing page drops <div id="site-nav"></div> and <div id="site-footer"></div>
   placeholders and loads this script — keeping the public site consistent + DRY. */
(function () {
  var MARK =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="mark" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="9" fill="#12B886"/><path d="M6 16h4l2.5-6 4 12 2.5-6h7" fill="none" stroke="#05281d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol></svg>';

  var NAV = [
    { href: "features.html", label: "Product" },
    { href: "solutions.html", label: "Solutions" },
    { href: "pricing.html", label: "Pricing" },
    { href: "security.html", label: "Security" },
    { href: "about.html", label: "About" },
  ];
  var active = location.pathname.split("/").pop() || "index.html";

  function navHtml() {
    var links = NAV.map(function (n) {
      return '<li><a href="' + n.href + '"' + (active === n.href ? ' class="active"' : "") + ">" + n.label + "</a></li>";
    }).join("");
    return (
      '<nav class="site-nav"><div class="container">' +
      '<a href="index.html" class="brand"><svg class="brand-mark" aria-hidden="true"><use href="#mark"/></svg>Unblockify</a>' +
      '<ul class="nav-links">' + links + "</ul>" +
      '<div class="nav-cta"><a href="login.html" class="btn btn-ghost-dark">Log in</a><a href="signup.html" class="btn btn-flow">Get started</a></div>' +
      "</div></nav>"
    );
  }

  function col(title, items) {
    return (
      '<div class="footer-col"><h4>' + title + "</h4>" +
      items.map(function (i) { return '<a href="' + i.href + '">' + i.label + "</a>"; }).join("") +
      "</div>"
    );
  }
  function footerHtml() {
    return (
      '<footer class="site-footer-xl"><div class="container">' +
      '<div class="footer-brand"><a href="index.html" class="brand" style="color:#fff"><svg class="brand-mark" aria-hidden="true"><use href="#mark"/></svg>Unblockify</a>' +
      "<p>Turn “I'm stuck” into shipped. The support platform that keeps your students moving — with an AI Teaching Assistant at its core.</p></div>" +
      col("Product", [
        { href: "features.html", label: "Features" },
        { href: "pricing.html", label: "Pricing" },
        { href: "security.html", label: "Security" },
        { href: "solutions.html", label: "Solutions" },
      ]) +
      col("Company", [
        { href: "about.html", label: "About" },
        { href: "contact.html", label: "Contact" },
        { href: "signup.html", label: "Get started" },
      ]) +
      col("Get started", [
        { href: "signup.html", label: "Create a workspace" },
        { href: "login.html", label: "Log in" },
        { href: "contact.html", label: "Request a demo" },
      ]) +
      "</div>" +
      '<div class="container footer-bottom"><span>© Unblockify · built for momentum</span><span>Made for organizations that refuse to let people stay stuck.</span></div>' +
      "</footer>"
    );
  }

  if (!document.getElementById("mark")) document.body.insertAdjacentHTML("afterbegin", MARK);
  var navSlot = document.getElementById("site-nav");
  if (navSlot) navSlot.outerHTML = navHtml();
  else document.body.insertAdjacentHTML("afterbegin", navHtml());
  var footSlot = document.getElementById("site-footer");
  if (footSlot) footSlot.outerHTML = footerHtml();
  else document.body.insertAdjacentHTML("beforeend", footerHtml());
})();
