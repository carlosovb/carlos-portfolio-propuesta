(() => {
  const password = document.getElementById("login-password");
  const toggle = document.getElementById("login-password-toggle");
  const screen = document.getElementById("login-screen");

  function setVisibility(visible) {
    password.type = visible ? "text" : "password";
    toggle.textContent = visible ? "Ocultar" : "Mostrar";
    toggle.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
  }

  toggle.addEventListener("click", () => setVisibility(password.type === "password"));
  new MutationObserver(() => {
    if (screen.hidden) setVisibility(false);
  }).observe(screen, { attributes: true, attributeFilter: ["hidden"] });
  setVisibility(false);
  toggle.hidden = false;
})();
