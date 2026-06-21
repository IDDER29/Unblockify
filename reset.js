/* Reset password — consumes a token from the URL and sets a new password. */

const resetToken = new URLSearchParams(window.location.search).get("token") || "";

function showError(input, message) {
  const next = input.nextElementSibling;
  if (next && next.tagName.toLowerCase() === "p") next.remove();
  const p = document.createElement("p");
  p.textContent = message;
  input.after(p);
  input.focus();
}

const card = document.querySelector(".auth-card");
const resetBtn = document.getElementById("reset-btn");

if (!resetToken) {
  card.innerHTML =
    '<h1>Link not valid</h1>' +
    '<p class="sub">This reset link is invalid or has expired.</p>' +
    '<p class="sub" style="margin-top:18px"><a href="forgot.html">Request a new link</a></p>';
} else {
  resetBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    const passwordInput = document.getElementById("password");
    const password = passwordInput.value;
    if (password.length < 6)
      return showError(passwordInput, "Password must be at least 6 characters.");

    resetBtn.disabled = true;
    const original = resetBtn.textContent;
    resetBtn.textContent = "Saving…";
    try {
      await API.post("/api/auth/reset", { token: resetToken, password });
      toast("Password updated — please log in.", "success");
      setTimeout(() => { window.location.href = "login.html"; }, 900);
    } catch (err) {
      showError(passwordInput, err.message || "This reset link is invalid or has expired.");
      resetBtn.disabled = false;
      resetBtn.textContent = original;
    }
  });

  document.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      const next = input.nextElementSibling;
      if (next && next.tagName.toLowerCase() === "p") next.remove();
    });
  });
}
