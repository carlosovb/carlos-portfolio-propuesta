(() => {
  const loading = document.getElementById("login-loading");
  const label = document.getElementById("login-loading-label");
  const name = document.getElementById("login-loading-name");
  const minimumDuration = 2500;
  const introDuration = 900;
  const greetingDuration = 680;
  const handoffKey = "portfolio-login-transition-start";
  let startedAt = null;
  let greetedAt = 0;

  loading.addEventListener("cancel", (event) => event.preventDefault());

  if (document.documentElement.classList.contains("portfolio-handoff")) {
    startedAt = performance.now();
    try {
      const savedStart = Number(sessionStorage.getItem(handoffKey));
      sessionStorage.removeItem(handoffKey);
      if (savedStart > 0 && savedStart <= performance.timeOrigin + startedAt)
        startedAt = savedStart - performance.timeOrigin;
    } catch {}
  }

  function waitUntil(time) {
    const remaining = time - performance.now();
    return remaining > 0
      ? new Promise((resolve) => setTimeout(resolve, Math.ceil(remaining)))
      : Promise.resolve();
  }

  function reset() {
    loading.close();
    loading.classList.remove("is-entering", "is-greeting", "is-leaving");
    label.textContent = "Preparando tu panel…";
    name.hidden = true;
    name.textContent = "";
    startedAt = null;
    greetedAt = 0;
    try {
      sessionStorage.removeItem(handoffKey);
    } catch {}
  }

  window.LoginTransition = {
    start(button) {
      const { top, right, bottom, left } = button.getBoundingClientRect();
      const insets = [top, innerWidth - right, innerHeight - bottom, left];
      loading.style.setProperty(
        "--login-origin",
        insets.map((inset) => `${Math.max(0, inset)}px`).join(" "),
      );
      loading.classList.add("is-entering");
      loading.showModal();
      startedAt = performance.now();
    },
    waitForIntro() {
      return waitUntil(startedAt + introDuration);
    },
    rememberStart() {
      // Compartir el instante de inicio entre documentos sin guardar datos del perfil.
      try {
        sessionStorage.setItem(handoffKey, String(performance.timeOrigin + startedAt));
      } catch {}
    },
    greet(profile) {
      if (!loading.open) return;
      const fullName = [profile?.first_name?.trim(), profile?.last_name?.trim()].filter(Boolean).join(" ");
      label.textContent = fullName ? "Te damos la bienvenida" : "Te damos la bienvenida a tu panel";
      name.textContent = fullName;
      name.hidden = !fullName;
      loading.classList.add("is-greeting");
      greetedAt = performance.now();
    },
    async playExit() {
      const minimumEnd = startedAt === null ? 0 : startedAt + minimumDuration;
      await waitUntil(Math.max(minimumEnd, greetedAt + greetingDuration));
      if (!loading.open) return;
      loading.classList.add("is-leaving");
      const departure = loading.getAnimations().find(
        (animation) => animation.animationName === "login-departure",
      );
      await departure?.finished.catch(() => {});
    },
    reset,
  };
})();
