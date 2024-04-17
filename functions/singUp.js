let users = JSON.parse(localStorage.getItem("users")) || [{ name: "admin 1", email: "admin1@school.com", userPassword: "123456789admin", role:"admin"}];

// Function to create a user object (using object destructuring)
function createUser({ name, email, userPassword,role }) {
  return { name, email, userPassword, role};
}

// Function to save user to localStorage
function saveUser(user) {
  users.push(user);
  alert("awdi");
  alert(users);
  localStorage.setItem("users", JSON.stringify(users));
}
// Function to validate form inputs
function validateForm(form) {
  const inputs = form.querySelectorAll("input");
  const passwordInputs = form.querySelectorAll("input[type=password]");

  // Check all inputs are filled
  for (const input of inputs) {
    if (!input.value) {
      displayError(input, "Please fill in this field.");
      return false;
    }
  }

  // Check passwords match
  if (passwordInputs[0].value !== passwordInputs[1].value) {
    displayError(passwordInputs[1], "Passwords do not match.");
    return false;
  }

  // Validate username is unique
  const usernameInput = inputs[0];
  const emailInput = inputs[1];
  for (let user of users) {
    if (usernameInput.value === user.name) {
      displayError(usernameInput, "This username is already taken.");
      return false;
    }
    if (emailInput.value === user.email) {
      displayError(emailInput, "This email is already taken.");
      return false;
    }
  }

  return true;
}

// Function to display error messages
function displayError(input, message) {
  const existingParagraph = input.nextElementSibling;
  if (existingParagraph && existingParagraph.tagName.toLowerCase() === "p") {
    existingParagraph.remove();
  }

  const newp = document.createElement("p");
  newp.textContent = message;
  newp.style.color = "red";
  newp.style.fontSize = "14px";
  newp.style.marginTop = "5px";
  newp.style.fontWeight = "bold";

  input.after(newp);
  input.focus();
}
const form = document.querySelector("form");

let submitForm = document.querySelector(".submit-button");
submitForm.addEventListener("click", (e) => {
  e.preventDefault();
  console.log("click");
  const userName = document.querySelector("#name").value.trim();
  const userEmail = document.querySelector("#email").value.trim().toLowerCase();
  const userPassword = document.querySelector("#password").value.trim();
  if (validateForm(form) === true) {
    saveUser(createUser({ name: userName, email: userEmail, userPassword, role:"student"}));

    window.location.href = "index.html";
  }
});

// Event listener for input changes
document.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", () => {
    // Clear specific error message on input change
    const existingParagraph = input.nextElementSibling;
    if (existingParagraph && existingParagraph.tagName.toLowerCase() === "p") {
      existingParagraph.remove();
    }
  });
});


