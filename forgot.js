/* Forgot password — requests a reset link. Always shows the same message
   (never reveals whether the email exists). */

getSession().then((s) => { if (s) window.location.href = dashboardFor(s.user.role); });

const card = document.querySelector(".auth-card");
const forgotForm = document.getElementById("forgotForm");
const forgotBtn = document.getElementById("forgot-btn");
const errorDiv = document.getElementById("forgotError");

function showForgotError(message) {
  errorDiv.textContent = message;
  errorDiv.classList.toggle("show", !!message);
}

function clearForgotError() {
  errorDiv.textContent = "";
  errorDiv.classList.remove("show");
}

forgotForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearForgotError();

  const emailInput = document.getElementById("email");
  const email = emailInput.value.trim().toLowerCase();
  if (!email) {
    showForgotError("Enter your email.");
    emailInput.focus();
    return;
  }

  forgotBtn.disabled = true;
  const original = forgotBtn.textContent;
  forgotBtn.textContent = "Sending…";
  try {
    await API.post("/api/auth/forgot", { email });
    card.innerHTML =
      '<h1>Check your inbox</h1>' +
      '<p class="sub">If that email exists, a reset link is on its way.</p>' +
      '<p class="sub" style="margin-top:18px"><a href="login.html">Back to log in</a></p>';
  } catch (err) {
    showForgotError(err.message || "Something went wrong. Try again.");
    forgotBtn.disabled = false;
    forgotBtn.textContent = original;
    emailInput.focus();
  }
});

document.getElementById("email").addEventListener("input", clearForgotError);
