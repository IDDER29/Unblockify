/* Join via invite code (?code=...). */

const params = new URLSearchParams(location.search);
const code = params.get("code") || "";

const sub = document.getElementById("joinSub");
const form = document.getElementById("joinForm");
const fallback = document.getElementById("joinFallback");
const heading = document.getElementById("joinHeading");
const errorDiv = document.getElementById("joinError");

function showJoinError(message, focusEl) {
  errorDiv.textContent = message;
  errorDiv.classList.toggle("show", !!message);
  if (focusEl) focusEl.focus();
}

function clearJoinError() {
  errorDiv.textContent = "";
  errorDiv.classList.remove("show");
}

(async function init() {
  if (!code) {
    sub.textContent = "This invite link is missing its code.";
    fallback.hidden = false;
    return;
  }
  try {
    const info = await API.get("/api/auth/invite/" + encodeURIComponent(code));
    heading.textContent = `Join ${info.orgName}`;
    sub.innerHTML = `You're invited as a <strong>${escapeHtml(info.role)}</strong>.`;
    document.getElementById("asideTitle").textContent = `Welcome to ${info.orgName}.`;
    form.hidden = false;
    // Autofocus first visible input once form is shown
    const firstInput = form.querySelector("input");
    if (firstInput) firstInput.focus();
  } catch (err) {
    sub.textContent = err.message || "This invite is no longer valid.";
    fallback.hidden = false;
  }
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearJoinError();

  const nameInput = document.getElementById("name");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");

  if (!nameInput.value.trim()) return showJoinError("Enter your name.", nameInput);
  if (!emailInput.value.trim()) return showJoinError("Enter your email.", emailInput);
  if (passwordInput.value.length < 6) return showJoinError("Password must be at least 6 characters.", passwordInput);

  const btn = document.getElementById("joinBtn");
  btn.disabled = true;
  btn.textContent = "Joining…";
  try {
    const { user } = await API.post("/api/auth/join", {
      code,
      name: nameInput.value.trim(),
      email: emailInput.value.trim().toLowerCase(),
      password: passwordInput.value,
    });
    window.location.href = dashboardFor(user.role);
  } catch (err) {
    showJoinError(err.message || "Could not join.", emailInput);
    btn.disabled = false;
    btn.textContent = "Join organization";
  }
});

form.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", clearJoinError);
});
