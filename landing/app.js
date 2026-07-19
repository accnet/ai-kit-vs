const menuButton = document.querySelector("[data-menu-toggle]");
const nav = document.querySelector("[data-nav]");

menuButton?.addEventListener("click", () => {
  const open = nav?.classList.toggle("is-open") ?? false;
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.textContent = open ? "Close" : "Menu";
});

nav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("is-open");
    menuButton?.setAttribute("aria-expanded", "false");
    if (menuButton) menuButton.textContent = "Menu";
  });
});

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

const copyButton = document.querySelector("[data-copy]");
const copyFeedback = document.querySelector("[data-copy-feedback]");
copyButton?.addEventListener("click", async () => {
  const command = copyButton.dataset.copy ?? "";
  try {
    await navigator.clipboard.writeText(command);
    copyButton.textContent = "Copied";
    copyFeedback.textContent = "Command copied to clipboard.";
  } catch {
    copyFeedback.textContent = "Select the command above to copy it.";
  }
  window.setTimeout(() => {
    copyButton.textContent = "Copy command";
    copyFeedback.textContent = "";
  }, 2200);
});

const header = document.querySelector("[data-header]");
const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 20);
window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();
