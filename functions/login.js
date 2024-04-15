let users = JSON.parse(localStorage.getItem("users")) || [];
let userIdL = JSON.parse(localStorage.getItem("userActiveIndex"));
let userRole;
console.log(userIdL);
if(userIdL >=0){
  
  userRole = users[userIdL].role;

  switch (userRole) {
    case "admin":
      
      window.location.href = "admin_dashbord.html";
      break;
    case "student":
      window.location.href = "student_dashbord.html";
      break;
  }
}


console.log("hi i started");
function validateUserIsExiste(email, password) {
  for (const user of users) {
    console.log("dkhlt l for loop");
    if (user.email == email) {
      console.log("l9it l email");
      if (user.userPassword == password.value.trim()) {
        console.log("l9it l password");
        user.online = true;
        userRole = user.role;
        localStorage.setItem(
          "userActiveIndex",
          JSON.stringify(users.indexOf(user))
        );
        localStorage.setItem("users", JSON.stringify(users));
        return true;
      }
    }
  }
  displayError(password, "incorect email or password");

  return false;
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

const logInForm = document.getElementById("login-form-btn");

logInForm.addEventListener("click", (event) => {
  event.preventDefault(); // Prevent default form submission

  const email = document.getElementById("email").value.trim().toLowerCase();
  const password = document.getElementById("password");
  if (validateUserIsExiste(email, password) === true) {
    console.log("dkhl l dashbord");
    switch (userRole) {
      case "admin":
        
        window.location.href = "admin_dashbord.html";
        break;
      case "student":
        window.location.href = "student_dashbord.html";
        break;
    }
    
  }
});
