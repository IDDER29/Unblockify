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
  details,
  formattedDate,
  formattedTime
) {
  return {
    userId,
    title,
    formateur,
    bootcamp,
    brief,
    dificculte,
    details,
    formattedDate,
    formattedTime,
  };
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
    const currentDate = new Date();
    const formattedDate = currentDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const formattedTime = currentDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    });

    saveBlockageInfo(
      creatNewBlockageObj(
        userId,
        title,
        admin,
        bootcamp,
        Brief,
        problem,
        problemDetails,
        formattedDate,
        formattedTime
      )
    );
    modalBackGround.style.display = "none";
    formAddNewBlockage.style.display = "none";
    addBlockagesInfoCards();
    detailButton = document.querySelectorAll(".details_btn");
    formAddNewBlockage.reset();
    updateStutusButtons()
  }
});

function addBlockagesInfoCards() {
  if (!usersBlockages[userId]) {
    return 0;
  }
  table_body.innerHTML = "";
  for (let i = 0; i < usersBlockages[userId].length || 0; i++) {
    table_body.innerHTML += `
    <div class="blockage-detail flex-column">
    <h2>${usersBlockages[userId][i].title}</h2>
    <button class="details_btn btn" class="Details_model_btn" data-id="${i}" >Details</button>
    <div class="status_date flex-row">
        <div class="flex-row flex-center status_info">
            <span class="status_btn btn" data-id="${i}">Block</span>
            <button class="details_btn btn" data-id="${i}">Details</button>
        </div>
        <div class="blockage-date">
            <p>5 days ago</p>
        </div>
    </div>
    <div class="blockage-date-complet">
        <p>${usersBlockages[userId][i].formattedDate}</p>
        <p>${usersBlockages[userId][i].formattedTime}</p>
    </div>
    <div class="buttons">
        <div class="Edit">
            <i class="fa-solid fa-pen-to-square edit-btn" data-id="${i}" ></i>
        </div>
        <div class="Delete">
            <i class=" Delete fa-solid fa-trash" data-id="${i}" ></i>
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

function displayDetiesContent(id, modal) {
  modal.querySelector(".formator").textContent =
    usersBlockages[userId][id].formateur;
  modal.querySelector(".bootcamp").textContent =
    usersBlockages[userId][id].bootcamp;
  modal.querySelector(".Brief").textContent = usersBlockages[userId][id].brief;
  modal.querySelector(".BlockageTitle").textContent =
    usersBlockages[userId][id].title;
  modal.querySelector(".blockageDiscription").textContent =
    usersBlockages[userId][id].details;
}

// Attach event listener to the table_body
table_body.addEventListener("click", function (e) {
  // Check if the clicked element is a .details_btn
  if (e.target.classList.contains("details_btn")) {
    let id = e.target.dataset.id;
    console.log("hi how are you " + id);
    modalBackGround.style.display = "flex";
    modalDetiesContent.style.display = "block";
    modalDetiesContent.querySelector(".Delete").dataset.id = `${id}`;
    modalDetiesContent.querySelector(".edit-btn").dataset.id = `${id}`;
    displayDetiesContent(id, modalDetiesContent);
  }
  if (e.target.classList.contains("status_btn")) {
    let id = e.target.dataset.id;
  
    
    if (
      usersBlockages[userId][id].isVerfied == true
    ) {
      const verfiedDetiesModal = document.querySelector(".modal_Verefied");
      verfiedDetiesModal.style.display = "block";
      // Corrected line: Use document.getElementById to access elements by their ID
      document.getElementById("selectedMethod").textContent =
      usersBlockages[userId][id].VerfiedDeties.type;
  
      document.getElementById("adminNotes").textContent =
      usersBlockages[userId][id].VerfiedDeties.note;
    }
  }
});

// Attach event listener to the table_body for the delete button
table_body.addEventListener("click", function (e) {
  // Check if the clicked element is a .details_btn
  if (e.target.classList.contains("Delete")) {
    let id = e.target.dataset.id;
    usersBlockages[userId].splice(id, 1);
    addBlockagesInfoCards();
    localStorage.setItem("userBlockageObjects", JSON.stringify(usersBlockages));
  }
});

// Attach event listener to the table_body for the delete button
modalDetiesContent.addEventListener("click", function (e) {
  // Check if the clicked element is a .details_btn
  if (e.target.classList.contains("Delete")) {
    let id = e.target.dataset.id;
    usersBlockages[userId].splice(id, 1);
    modalBackGround.style.display = "none";
    modalDetiesContent.style.display = "none";
    addBlockagesInfoCards();
    localStorage.setItem("userBlockageObjects", JSON.stringify(usersBlockages));
  }
  if (e.target.classList.contains("edit-btn")) {
    editId = e.target.dataset.id;
    console.log(1234);
    modalBackGround.style.display = "flex";
    modalDetiesContent.style.display= "none";
    editForm.style.display = "block";
    console.log(usersBlockages[userId][editId]);
    editForm.querySelector("#title").value =
      usersBlockages[userId][editId].title;

    editForm.querySelector("#Brief").value =
      usersBlockages[userId][editId].brief;
    editForm.querySelector("#problem").value =
      usersBlockages[userId][editId].dificculte;
    editForm.querySelector("#problemDetails").value =
      usersBlockages[userId][editId].details;
  }
});



modalDetiesContent
  .querySelector(".close-modal")
  .addEventListener("click", () => {
    modalBackGround.style.display = "none";
    modalDetiesContent.style.display = "none";
  });

formAddNewBlockage
  .querySelector(".close-modal")
  .addEventListener("click", () => {
    modalBackGround.style.display = "none";
    formAddNewBlockage.style.display = "none";
  });

let editForm = document.querySelector(".edit_blockage");
let editId;
// Attach event listener to the table_body
table_body.addEventListener("click", function (e) {
  // Check if the clicked element is a .details_btn
  if (e.target.classList.contains("edit-btn")) {
    editId = e.target.dataset.id;
    console.log(1234);
    modalBackGround.style.display = "flex";
    editForm.style.display = "block";
    console.log(usersBlockages[userId][editId]);
    editForm.querySelector("#title").value =
      usersBlockages[userId][editId].title;

    editForm.querySelector("#Brief").value =
      usersBlockages[userId][editId].brief;
    editForm.querySelector("#problem").value =
      usersBlockages[userId][editId].dificculte;
    editForm.querySelector("#problemDetails").value =
      usersBlockages[userId][editId].details;
  }
});

editForm.addEventListener("submit", (e) => {
  e.preventDefault();
  console.log("click");
  const title = editForm.querySelector("#title").value.trim();
  const Brief = editForm.querySelector("#Brief").value.trim();
  const problem = editForm.querySelector("#problem").value.trim();
  const problemDetails = editForm.querySelector("#problemDetails").value.trim();

  const currentDate = new Date();
  const formattedDate = currentDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = currentDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  });

  // Update the existing blockage with the new information
  usersBlockages[userId][editId].title = title;

  usersBlockages[userId][editId].brief = Brief;
  usersBlockages[userId][editId].dificculte = problem;
  usersBlockages[userId][editId].details = problemDetails;

  // Save the updated blockage information
  localStorage.setItem("userBlockageObjects", JSON.stringify(usersBlockages));
  addBlockagesInfoCards();
  modalBackGround.style.display = "none";
  editForm.style.display = "none";
});



function updateStutusButtons(){
  let status_btn = table_body.querySelectorAll(".status_btn");
  status_btn.forEach(btn => {
      let id = btn.dataset.id;
      console.log("ooo");
      console.log(btn);
      
  if (
    usersBlockages[userId][id].isVerfied == true
  ) {
    btn.style.background = "green";
  }
  })
}

updateStutusButtons()


