/* Login — authenticates and routes by role. */

getSession().then((s) => { if (s) window.location.href = dashboardFor(s.user.role); });

function showError(input, message) {
  const next = input.nextElementSibling;
  if (next && next.tagName.toLowerCase() === "p") next.remove();
  const p = document.createElement("p");
  p.textContent = message;
  input.after(p);
  input.focus();
}

const loginBtn = document.getElementById("login-form-btn");
loginBtn.addEventListener("click", async (event) => {
  event.preventDefault();
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  if (!email || !password) return showError(passwordInput, "Enter your email and password.");

  loginBtn.disabled = true;
  const original = loginBtn.textContent;
  loginBtn.textContent = "Signing in…";
  try {
    const { user } = await API.post("/api/auth/login", { email, password });
    window.location.href = dashboardFor(user.role);
  } catch (err) {
    showError(passwordInput, err.message || "Incorrect email or password.");
    loginBtn.disabled = false;
    loginBtn.textContent = original;
  }
});

document.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", () => {
    const next = input.nextElementSibling;
    if (next && next.tagName.toLowerCase() === "p") next.remove();
  });
});
