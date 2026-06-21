/* Forgot password — requests a reset link. Always shows the same message
   (never reveals whether the email exists). */

getSession().then((s) => { if (s) window.location.href = dashboardFor(s.user.role); });

function showError(input, message) {
  const next = input.nextElementSibling;
  if (next && next.tagName.toLowerCase() === "p") next.remove();
  const p = document.createElement("p");
  p.textContent = message;
  input.after(p);
  input.focus();
}

const card = document.querySelector(".auth-card");
const forgotBtn = document.getElementById("forgot-btn");

forgotBtn.addEventListener("click", async (event) => {
  event.preventDefault();
  const emailInput = document.getElementById("email");
  const email = emailInput.value.trim().toLowerCase();
  if (!email) return showError(emailInput, "Enter your email.");

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
    showError(emailInput, err.message || "Something went wrong. Try again.");
    forgotBtn.disabled = false;
    forgotBtn.textContent = original;
  }
});

document.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", () => {
    const next = input.nextElementSibling;
    if (next && next.tagName.toLowerCase() === "p") next.remove();
  });
});
