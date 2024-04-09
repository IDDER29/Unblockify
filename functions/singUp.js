let users = [];
function user(name, email, userPassword) {
  return { name, email, userPassword };
}
function save() {

  let userName = document.querySelector("#name").value;
  let userEmail = document.querySelector("#email").value;
  let userPassword = document.querySelector("#password").value;
  users.push(user(userName, userEmail, userPassword));
  localStorage.setItem("users",JSON.stringify(users));
}

function checkValidation() {
  let inputs = document.querySelectorAll("input");
  let passwordInputs = document.querySelectorAll("input[type=password]");

  for (let input of inputs) {
    // Remove existing paragraph if it exists
    let existingParagraph = input.nextElementSibling;
    if (existingParagraph && existingParagraph.tagName.toLowerCase() === "p") {
      existingParagraph.remove();
    }

    if (input.value == "") {
      let newp = document.createElement("p");
      newp.textContent = "Please fill in this field.";
      newp.style.color = "red";
      newp.style.fontSize = "14px"; // Example styling
      newp.style.marginTop = "5px"; // Example styling
      newp.style.fontWeight = "bold"; // Example styling

      // Insert the new paragraph after the existing input
      input.after(newp);

      input.focus();
      return false; // This will exit the checkValidation function
    }
  }

  // Check if password inputs match
  if (passwordInputs[0].value != passwordInputs[1].value) {
    // Remove existing paragraph if it exists
    let existingParagraph = passwordInputs[1].nextElementSibling;
    if (existingParagraph && existingParagraph.tagName.toLowerCase() === "p") {
      existingParagraph.remove();
    }

    let newp = document.createElement("p");
    newp.textContent = "Passwords do not match.";
    newp.style.color = "red";
    newp.style.fontSize = "14px"; // Example styling
    newp.style.marginTop = "5px"; // Example styling
    newp.style.fontWeight = "bold"; // Example styling

    // Insert the new paragraph after the second password input
    passwordInputs[1].after(newp);

    passwordInputs[1].focus();
    return false;
  }

  return true;
}

let submitForm = document.querySelector(".submit-button");
submitForm.addEventListener("click", (e) => {
  e.preventDefault();
  console.log("click");

  if (checkValidation() === true) {
    save();
  }
});
