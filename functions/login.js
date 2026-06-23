/* Login — authenticates and routes by role. */

getSession().then((s) => { if (s) window.location.href = dashboardFor(s.user.role); });

const errorDiv = document.getElementById("loginError");

function showLoginError(message) {
  errorDiv.textContent = message;
  errorDiv.classList.toggle("show", !!message);
}

function clearLoginError() {
  errorDiv.textContent = "";
  errorDiv.classList.remove("show");
}

const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("login-form-btn");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearLoginError();

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!email || !password) {
    showLoginError("Enter your email and password.");
    (email ? passwordInput : emailInput).focus();
    return;
  }

  loginBtn.disabled = true;
  const original = loginBtn.textContent;
  loginBtn.textContent = "Signing in…";
  try {
    const { user } = await API.post("/api/auth/login", { email, password });
    window.location.href = dashboardFor(user.role);
  } catch (err) {
    showLoginError(err.message || "Incorrect email or password.");
    loginBtn.disabled = false;
    loginBtn.textContent = original;
    passwordInput.focus();
  }
});

document.querySelectorAll("#loginForm input").forEach((input) => {
  input.addEventListener("input", clearLoginError);
});
