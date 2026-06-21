/* Sign up — creates an organization and its owner. */

getSession().then((s) => { if (s) window.location.href = dashboardFor(s.user.role); });

function showError(input, message) {
  const next = input.nextElementSibling;
  if (next && next.tagName.toLowerCase() === "p") next.remove();
  const p = document.createElement("p");
  p.textContent = message;
  input.after(p);
  input.focus();
}

const form = document.querySelector("form");
const submitBtn = document.querySelector(".submit-button");

submitBtn.addEventListener("click", async (e) => {
  e.preventDefault();
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

  if (!orgName) return showError(refs.orgName, "Name your organization.");
  if (!name) return showError(refs.name, "Enter your name.");
  if (!email) return showError(refs.email, "Enter your email.");
  if (password.length < 6) return showError(refs.password, "Password must be at least 6 characters.");
  if (password !== confirm) return showError(refs.confirm, "Passwords do not match.");

  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = "Creating workspace…";
  try {
    const { user } = await API.post("/api/auth/signup", { orgName, name, email, password });
    window.location.href = dashboardFor(user.role);
  } catch (err) {
    const target = /email/i.test(err.message) ? refs.email : refs.orgName;
    showError(target, err.message || "Could not create your workspace.");
    submitBtn.disabled = false;
    submitBtn.textContent = original;
  }
});

document.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", () => {
    const next = input.nextElementSibling;
    if (next && next.tagName.toLowerCase() === "p") next.remove();
  });
});
