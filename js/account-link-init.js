// Leer el enlace y retirarlo inmediatamente de la barra de direcciones.
(() => {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const pick = (name) => hash.get(name) || query.get(name) || "";
  window.PORTFOLIO_ACCOUNT_LINK = {
    type: pick("type"),
    token_hash: pick("token_hash"),
    access_token: pick("access_token"),
    refresh_token: pick("refresh_token"),
    expires_in: pick("expires_in"),
    error: pick("error"),
    recovery_request: query.get("modo") === "recuperar",
  };
  if (location.hash || location.search) history.replaceState(null, "", location.pathname);
})();
