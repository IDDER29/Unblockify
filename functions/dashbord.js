let usersBlockages =
  JSON.parse(localStorage.getItem("userBlockageObjects")) || {};
let users = JSON.parse(localStorage.getItem("users")) || [];
let userActiveIndex = JSON.parse(localStorage.getItem("userActiveIndex"));

const userId = users[userActiveIndex].name;
let welcomePara = document.querySelectorAll(".userName");
let formAddNewBlockage = document.querySelector(".add_new_blockage");
const modalBackGround = document.getElementById("details_model");

const modalDetiesContent = document.querySelector(".modal-content");
welcomePara.forEach(
  (userName) => (userName.textContent = `${users[userActiveIndex].name}`)
);

function creatNewBlockageObj(
    userId,
  title,
  formateur,
  bootcamp,
  brief,
  dificculte,
  details
) {
  return {userId, title, formateur, bootcamp, brief, dificculte, details };
}

function saveBlockageInfo(blockageInfo) {
  
  // Check if the user's array exists, if not, initialize it
  if (!usersBlockages[userId]) {
    usersBlockages[userId] = [];
  }
  // Push the new blockage object to the user's array
  usersBlockages[userId].push(blockageInfo);

  localStorage.setItem("userBlockageObjects", JSON.stringify(usersBlockages));
}

function validateForm(form) {
  const inputs = form.querySelectorAll("input");

  // Check all inputs are filled
  for (const input of inputs) {
    if (!input.value) {
      displayError(input, "Please fill in this field.");
      return false;
    }
  }
  
  for (const blockage of usersBlockages[userId] || []) {
    if (inputs[0].value == blockage.title) {
      displayError(inputs[0], "This title is eardy exist please change it");
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

let addNewBlockageButton = document.querySelector(".add_btn");

addNewBlockageButton.addEventListener("click", () => {
  modalBackGround.style.display = "flex";
  formAddNewBlockage.style.display = "block";
});
const table_body = document.querySelector(".table_body");
addBlockagesInfoCards();

let detailButton = document.querySelectorAll(".details_btn");

formAddNewBlockage.addEventListener("submit", (e) => {
  e.preventDefault();
  console.log("click");
  const title = document.querySelector("#title").value.trim();
  const admin = document.querySelector("#admin").value.trim();
  const bootcamp = document.querySelector("#bootcamp").value.trim();
  const Brief = document.querySelector("#Brief").value.trim();
  const problem = document.querySelector("#problem").value.trim();
  const problemDetails = document.querySelector("#problemDetails").value.trim();

  if (validateForm(formAddNewBlockage) === true) {
    saveBlockageInfo(
      creatNewBlockageObj(
        userId,
        title,
        admin,
        bootcamp,
        Brief,
        problem,
        problemDetails
      )
    );
    modalBackGround.style.display = "none";
    formAddNewBlockage.style.display = "none";
    addBlockagesInfoCards();
    detailButton = document.querySelectorAll(".details_btn");
    formAddNewBlockage.reset();
  }
});




function addBlockagesInfoCards(){
  table_body.innerHTML = "";
    for(let i = 0; i< usersBlockages[userId].length ;i++){
        table_body.innerHTML += `
    <div class="blockage-detail flex-column">
    <h2>${usersBlockages[userId][i].title}</h2>
    <button class="details_btn btn" class="Details_model_btn" data-id="${i}" >Details</button>
    <div class="status_date flex-row">
        <div class="flex-row flex-center status_info">
            <span class="status_btn btn">Block</span>
            <button class="details_btn btn">Details</button>
        </div>
        <div class="blockage-date">
            <p>5 days ago</p>
        </div>
    </div>
    <div class="blockage-date-complet">
        <p>April 14,2024</p>
        <p>5:20 PM</p>
    </div>
    <div class="buttons">
        <div class="Edit">
            <i class="fa-solid fa-pen-to-square"></i>
        </div>
        <div class="Delete">
            <i class=" Delete fa-solid fa-trash" ></i>
        </div>
    </div>
</div>
    `;
    }
    
}


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



function displayDetiesContent(id,modal){
modal.querySelector(".formator").textContent = usersBlockages[userId][id].formateur;
modal.querySelector(".bootcamp").textContent = usersBlockages[userId][id].bootcamp;
modal.querySelector(".Brief").textContent = usersBlockages[userId][id].brief;
modal.querySelector(".BlockageTitle").textContent = usersBlockages[userId][id].title;
modal.querySelector(".blockageDiscription").textContent = usersBlockages[userId][id].details;

}


// Attach event listener to the table_body
table_body.addEventListener('click', function(e) {
  // Check if the clicked element is a .details_btn
  if (e.target.classList.contains('details_btn')) {
      let id = e.target.dataset.id;
      console.log("hi how are you " + id);
      modalBackGround.style.display = "flex";
      modalDetiesContent.style.display = "block";
      displayDetiesContent(id, modalDetiesContent);
  }
});

modalDetiesContent.querySelector(".close-modal").addEventListener("click", ()=>{
  modalBackGround.style.display = "none";
  modalDetiesContent.style.display= "none";
})
