/* Sign up — creates an organization and its owner. */

getSession().then((s) => { if (s) window.location.href = dashboardFor(s.user.role); });

const errorDiv = document.getElementById("signupError");

function showSignupError(message, focusEl) {
  errorDiv.textContent = message;
  errorDiv.classList.toggle("show", !!message);
  if (focusEl) focusEl.focus();
}

function clearSignupError() {
  errorDiv.textContent = "";
  errorDiv.classList.remove("show");
}

const form = document.getElementById("signupForm");
const submitBtn = document.querySelector(".submit-button");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearSignupError();

  const refs = {
    orgName: document.querySelector("#orgName"),
    name: document.querySelector("#name"),
    email: document.querySelector("#email"),
    password: document.querySelector("#password"),
    confirm: document.querySelector("#confirm-password"),
  };
  const orgName = refs.orgName.value.trim();
  const name = refs.name.value.trim();
  const email = refs.email.value.trim().toLowerCase();
  const password = refs.password.value;
  const confirm = refs.confirm.value;

  if (!orgName) return showSignupError("Name your organization.", refs.orgName);
  if (!name) return showSignupError("Enter your name.", refs.name);
  if (!email) return showSignupError("Enter your email.", refs.email);
  if (password.length < 6) return showSignupError("Password must be at least 6 characters.", refs.password);
  if (password !== confirm) return showSignupError("Passwords do not match.", refs.confirm);

  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = "Creating workspace…";
  try {
    const { user } = await API.post("/api/auth/signup", { orgName, name, email, password });
    window.location.href = dashboardFor(user.role);
  } catch (err) {
    const focusEl = /email/i.test(err.message) ? refs.email : refs.orgName;
    showSignupError(err.message || "Could not create your workspace.", focusEl);
    submitBtn.disabled = false;
    submitBtn.textContent = original;
  }
});

document.querySelectorAll("#signupForm input").forEach((input) => {
  input.addEventListener("input", clearSignupError);
});
