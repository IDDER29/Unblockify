let usersBlockages =
  JSON.parse(localStorage.getItem("userBlockageObjects")) || {};
let users = JSON.parse(localStorage.getItem("users")) || [];
let userActiveIndex = JSON.parse(localStorage.getItem("userActiveIndex"));
const modalBackGround = document.getElementById("details_model");

const modalDetiesContent = document.querySelector(".modal-content");

const userId = users[userActiveIndex].name;

let welcomePara = document.querySelectorAll(".userName");
welcomePara.forEach(
  (userName) => (userName.textContent = `${users[userActiveIndex].name}`)
);

console.log(usersBlockages);
let filteredObjects = [];

for (let key in usersBlockages) {
  let filteredArray = usersBlockages[key].filter(
    (item) => item.formateur === "admin1"
  );
  filteredObjects.push(...filteredArray);
}

console.log(filteredObjects);
let table_body = document.querySelector(".table_body");
for (let blockage of filteredObjects) {
  table_body.innerHTML += ` <div>
    <div class="blockage-detail flex-column">

        <h2>${blockage.userId}</h2>
        <h2>${blockage.title}</h2>

        <button class="details_btn btn" id="Details_model_btn" data-id="${filteredObjects.indexOf(
          blockage
        )}">Details</button>
        <div class="status_date flex-row" ">
    <div class=" flex-row flex-center status_info">
            <span class="status_btn btn" data-id="${filteredObjects.indexOf(
              blockage
            )}">Block</span>
            <button class="details_btn btn" data-id="${filteredObjects.indexOf(
              blockage
            )}">Details</button>
        </div>
        <div class="blockage-date">
            <p>5 days ago</p>
        </div>
    </div>
    <div class="blockage-date-complet">
        <p>${blockage.formattedDate}</p>
        <p>${blockage.formattedTime}</p>
    </div>

</div>
`;
}

function displayDetiesContent(id, modal) {
  modal.querySelector(".name").textContent = filteredObjects[id].userId;
  modal.querySelector(".bootcamp").textContent = filteredObjects[id].bootcamp;
  modal.querySelector(".Brief").textContent = filteredObjects[id].brief;
  modal.querySelector(".BlockageTitle").textContent = filteredObjects[id].title;
  modal.querySelector(".blockageDiscription").textContent =
    filteredObjects[id].details;
  modal.querySelector("#supportForm").dataset.id = id;
}

// Attach event listener to the table_body
table_body.addEventListener("click", function (e) {
  // Check if the clicked element is a .details_btn
  if (e.target.classList.contains("details_btn")) {
    let id = e.target.dataset.id;
    console.log("hi how are you " + id);
    modalBackGround.style.display = "flex";
    modalDetiesContent.style.display = "block";

    displayDetiesContent(id, modalDetiesContent);
  }
  if (e.target.classList.contains("status_btn")) {
    let id = e.target.dataset.id;

    let userId = filteredObjects[id].userId;
    if (
      usersBlockages[userId][
        usersBlockages[userId].indexOf(filteredObjects[id])
      ].hasOwnProperty('isVerfied')
    ) {
      const verfiedDetiesModal = document.querySelector(".modal_Verefied");
      verfiedDetiesModal.style.display = "block";
      // Corrected line: Use document.getElementById to access elements by their ID
      document.getElementById("selectedMethod").textContent =
        usersBlockages[userId][
          usersBlockages[userId].indexOf(filteredObjects[id])
        ].VerfiedDeties.type;

      document.getElementById("adminNotes").textContent =
        usersBlockages[userId][
          usersBlockages[userId].indexOf(filteredObjects[id])
        ].VerfiedDeties.note;
    }
  }
});


  

const radioButtons = document.querySelectorAll(
  'input[type="radio"][name="supportMethod"]'
);

// Function to insert text area under the selected radio button
function insertTextArea(radio) {
  // Remove existing text areas
  const containers = document.querySelectorAll(".supportDetailsContainer");
  containers.forEach((container) => container.remove());

  // Create a new text area
  const textArea = document.createElement("textarea");
  textArea.classList.add("supportDetailsContainer");
  textArea.placeholder = "Enter details here...";

  // Insert the text area after the selected radio button
  radio.parentNode.appendChild(textArea);
}

// Add event listeners to all radio buttons
radioButtons.forEach((radio) => {
  radio.addEventListener("change", () => insertTextArea(radio));
});

document
  .getElementById("supportForm")
  .addEventListener("submit", function (event) {
    // Prevent default form submission
    event.preventDefault();
    let id = event.target.dataset.id;

    // Get selected radio button value
    const selectedRadio = document.querySelector(
      'input[name="supportMethod"]:checked'
    );
    const selectedValue = selectedRadio ? selectedRadio.value : null;

    // Get text area content
    const textArea = document.querySelector(".supportDetailsContainer");
    const textAreaContent = textArea ? textArea.value : "";
    if (textAreaContent == "") {
      alert("fill the deties section");
    } else {
      let userId = filteredObjects[id].userId;
      usersBlockages[userId][
        usersBlockages[userId].indexOf(filteredObjects[id])
      ].isVerfied = true;
      usersBlockages[userId][
        usersBlockages[userId].indexOf(filteredObjects[id])
      ].VerfiedDeties = {
        type: selectedValue,
        note: textAreaContent,
      };
      let object =
        usersBlockages[userId][
          usersBlockages[userId].indexOf(filteredObjects[id])
        ];

      localStorage.setItem(
        "userBlockageObjects",
        JSON.stringify(usersBlockages)
      );

      console.log(object);
      modalBackGround.style.display = "none";
      modalDetiesContent.style.display = "none";
      updateStutusButtons();
    }
    // Process or send data
  });

function updateStutusButtons() {
  let status_btn = table_body.querySelectorAll(".status_btn");
  status_btn.forEach((btn) => {
    let id = btn.dataset.id;
    console.log("ooo");
    console.log(btn);
    let userId = filteredObjects[id].userId;

    if (
      usersBlockages[userId][
        usersBlockages[userId].indexOf(filteredObjects[id])
      ].hasOwnProperty('isVerfied')
    ) {
      btn.style.background = "green";
    }
  });
}

updateStutusButtons();

let logOut = document.querySelector(".logOut");
logOut.addEventListener("click",()=>{
  localStorage.setItem(
    "userActiveIndex",
    "-1"
  );
  window.location.href = "./../index.html";
})
