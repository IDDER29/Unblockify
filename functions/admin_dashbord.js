let usersBlockages =
  JSON.parse(localStorage.getItem("userBlockageObjects")) || {};
let users = JSON.parse(localStorage.getItem("users")) || [];
let userActiveIndex = JSON.parse(localStorage.getItem("userActiveIndex"));

const userId = users[userActiveIndex].name;

let welcomePara = document.querySelectorAll(".userName");
welcomePara.forEach(
  (userName) => (userName.textContent = `${users[userActiveIndex].name}`)
);



console.log(usersBlockages);
let filteredObjects = [];

for (let key in usersBlockages) {
    let filteredArray = usersBlockages[key].filter(item => item.formateur === "admin1");
    filteredObjects.push(...filteredArray);
}

console.log(filteredObjects);
let table_body = document.querySelector(".table_body");
for(let blockage of filteredObjects){
    table_body.innerHTML += ` <div>
    <div class="blockage-detail flex-column">

        <h2>${blockage.userId}</h2>
        <h2>${blockage.title}</h2>

        <button class="details_btn btn" id="Details_model_btn">Details</button>
        <div class="status_date flex-row" ">
    <div class=" flex-row flex-center status_info">
            <span class="status_btn btn">Block</span>
            <button class="details_btn btn">Details</button>
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
`
}