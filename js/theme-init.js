// Aplicar el tema antes de mostrar la página para evitar destellos.
try {
  const t = localStorage.getItem("carlos-theme");
  document.documentElement.dataset.theme = ["light", "dark"].includes(t)
    ? t
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
} catch {
  document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)")
    .matches
    ? "dark"
    : "light";
}
