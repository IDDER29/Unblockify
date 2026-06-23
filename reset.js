/* Reset password — consumes a token from the URL and sets a new password. */

const resetToken = new URLSearchParams(window.location.search).get("token") || "";

const card = document.querySelector(".auth-card");
const resetForm = document.getElementById("resetForm");
const resetBtn = document.getElementById("reset-btn");
const errorDiv = document.getElementById("resetError");

function showResetError(message, focusEl) {
  if (!errorDiv) return;
  errorDiv.textContent = message;
  errorDiv.classList.toggle("show", !!message);
  if (focusEl) focusEl.focus();
}

function clearResetError() {
  if (!errorDiv) return;
  errorDiv.textContent = "";
  errorDiv.classList.remove("show");
}

if (!resetToken) {
  card.innerHTML =
    '<h1>Link not valid</h1>' +
    '<p class="sub">This reset link is invalid or has expired.</p>' +
    '<p class="sub" style="margin-top:18px"><a href="forgot.html">Request a new link</a></p>';
} else {
  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearResetError();

    const passwordInput = document.getElementById("password");
    const confirmInput = document.getElementById("confirm-password");
    const password = passwordInput.value;
    const confirm = confirmInput.value;

    if (password.length < 6) return showResetError("Password must be at least 6 characters.", passwordInput);
    if (password !== confirm) return showResetError("Passwords do not match.", confirmInput);

    resetBtn.disabled = true;
    const original = resetBtn.textContent;
    resetBtn.textContent = "Saving…";
    try {
      await API.post("/api/auth/reset", { token: resetToken, password });
      toast("Password updated — please log in.", "success");
      setTimeout(() => { window.location.href = "login.html"; }, 900);
    } catch (err) {
      showResetError(err.message || "This reset link is invalid or has expired.", passwordInput);
      resetBtn.disabled = false;
      resetBtn.textContent = original;
    }
  });

  resetForm.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", clearResetError);
  });
}
