/* Join via invite code (?code=...). */

const params = new URLSearchParams(location.search);
const code = params.get("code") || "";

const sub = document.getElementById("joinSub");
const form = document.getElementById("joinForm");
const fallback = document.getElementById("joinFallback");
const heading = document.getElementById("joinHeading");

function showError(input, message) {
  const next = input.nextElementSibling;
  if (next && next.tagName.toLowerCase() === "p") next.remove();
  const p = document.createElement("p");
  p.textContent = message;
  input.after(p);
  input.focus();
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
  } catch (err) {
    sub.textContent = err.message || "This invite is no longer valid.";
    fallback.hidden = false;
  }
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("name");
  const email = document.getElementById("email");
  const password = document.getElementById("password");
  if (!name.value.trim()) return showError(name, "Enter your name.");
  if (!email.value.trim()) return showError(email, "Enter your email.");
  if (password.value.length < 6) return showError(password, "Password must be at least 6 characters.");

  const btn = document.getElementById("joinBtn");
  btn.disabled = true;
  btn.textContent = "Joining…";
  try {
    const { user } = await API.post("/api/auth/join", {
      code,
      name: name.value.trim(),
      email: email.value.trim().toLowerCase(),
      password: password.value,
    });
    window.location.href = dashboardFor(user.role);
  } catch (err) {
    showError(email, err.message || "Could not join.");
    btn.disabled = false;
    btn.textContent = "Join organization";
  }
});
