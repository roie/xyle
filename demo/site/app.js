const demoContactForm = document.querySelector("[data-demo-contact]");
const demoContactStatus = document.querySelector("#demo-form-status");

if (demoContactForm instanceof HTMLFormElement && demoContactStatus) {
  demoContactForm.addEventListener("submit", (event) => {
    event.preventDefault();
    demoContactForm.reset();
    demoContactStatus.textContent = "Demo complete. No information was sent.";
  });
}
