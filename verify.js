/* Verify email — confirms the token from the URL on load. */

const verifyToken = new URLSearchParams(window.location.search).get("token") || "";

const titleEl = document.getElementById("verify-title");
const subEl = document.getElementById("verify-sub");
const actionsEl = document.getElementById("verify-actions");

function show(title, sub, actionsHtml) {
  titleEl.textContent = title;
  subEl.textContent = sub;
  actionsEl.innerHTML = actionsHtml || "";
}

const continueBtn =
  '<a class="btn btn-primary btn-block btn-lg" href="login.html" style="margin-top:18px">Continue to log in</a>';

(async () => {
  if (!verifyToken) {
    show("Link not valid", "This verification link is invalid.",
      '<a class="sub" href="login.html" style="display:inline-block;margin-top:18px">Back to log in</a>');
    return;
  }
  try {
    const { email } = await API.get("/api/auth/verify?token=" + encodeURIComponent(verifyToken));
    show("Email verified", email ? email + " is confirmed. You're all set." : "Your email is confirmed. You're all set.",
      continueBtn);
  } catch (err) {
    show("Link not valid", err.message || "This verification link is invalid.",
      '<a class="sub" href="login.html" style="display:inline-block;margin-top:18px">Back to log in</a>');
  }
})();
