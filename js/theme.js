// Selector de tema y confirmación del formulario de demostración.
const root = document.documentElement;
const preference = matchMedia("(prefers-color-scheme: dark)");
let chosen = null;
try {
  chosen = localStorage.getItem("carlos-theme");
} catch {}
if (!["light", "dark"].includes(chosen)) chosen = null;
const themeButton = document.querySelector(".theme");
function theme() {
  const dark = (chosen || (preference.matches ? "dark" : "light")) === "dark";
  root.dataset.theme = dark ? "dark" : "light";
  themeButton.textContent = dark ? "☀" : "☾";
  themeButton.setAttribute(
    "aria-label",
    dark ? "Activar modo claro" : "Activar modo oscuro",
  );
  themeButton.title = dark ? "Activar modo claro" : "Activar modo oscuro";
  themeButton.setAttribute("aria-pressed", String(dark));
  document
    .querySelector("meta[name=theme-color]")
    ?.setAttribute("content", dark ? "#101c2c" : "#f6f1e8");
}
theme();
preference.addEventListener("change", theme);
themeButton.addEventListener("click", () => {
  chosen = root.dataset.theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("carlos-theme", chosen);
  } catch {}
  theme();
});
addEventListener("storage", (e) => {
  if (e.key === "carlos-theme") {
    chosen = ["light", "dark"].includes(e.newValue) ? e.newValue : null;
    theme();
  }
});
document.getElementById("demo-submit").addEventListener("click", () => {
  document.getElementById("demo-feedback").hidden = false;
});
