// Cliente del panel: sesión activa en memoria y traspaso temporal de un solo uso.
(() => {
  const config = window.PORTFOLIO_BACKEND || {};
  const url = (config.url || "").replace(/\/$/, "");
  const key = config.publishableKey || "";
  const ready =
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && key.startsWith("sb_publishable_");
  let session = null;
  let refreshing = null;
  const redirectKey = `portfolio-panel-login:${url}`;

  function clearRedirect() {
    try {
      sessionStorage.removeItem(redirectKey);
    } catch {}
  }

  // El traspaso entre documentos se consume una sola vez y caduca en 30 segundos.
  // No contiene la contraseña ni datos de clientes; no se utiliza localStorage.
  try {
    const pending = JSON.parse(sessionStorage.getItem(redirectKey) || "null");
    if (pending && Date.now() - pending.issuedAt > 30000) clearRedirect();
  } catch {
    clearRedirect();
  }

  async function request(route, options = {}, accessToken) {
    if (!ready) throw new Error("El almacenamiento privado todavía no está conectado.");
    const headers = { apikey: key, ...options.headers };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (options.body) headers["Content-Type"] = "application/json";
    const response = await fetch(`${url}${route}`, {
      ...options,
      headers,
      cache: "no-store",
      signal: options.signal || AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const error = new Error(
        response.status === 401
          ? "La sesión ha caducado. Vuelve a entrar."
          : "No se ha podido completar la operación.",
      );
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async function token() {
    if (!session) throw new Error("Inicia sesión para continuar.");
    if (session.expiresAt > Date.now() + 60000) return session.access_token;
    if (!refreshing) {
      const current = session;
      refreshing = request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      })
        .then((r) => r.json())
        .then((result) => {
          if (session !== current) throw new Error("La sesión ha finalizado.");
          session = { ...result, expiresAt: Date.now() + result.expires_in * 1000 };
          return session.access_token;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  }

  async function authenticated(route, options) {
    return request(route, options, await token());
  }

  window.PortfolioBackend = Object.freeze({
    ready,
    async preparePanelRedirect() {
      await token();
      const issuedAt = Date.now();
      sessionStorage.setItem(
        redirectKey,
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expiresAt: session.expiresAt,
          issuedAt,
        }),
      );
      // Si la navegación no llega a producirse, limpiar también desde la portada.
      setTimeout(() => {
        try {
          const saved = JSON.parse(sessionStorage.getItem(redirectKey) || "null");
          if (saved?.issuedAt === issuedAt) clearRedirect();
        } catch {
          clearRedirect();
        }
      }, 30000);
    },
    async resumePanelRedirect() {
      let saved;
      try {
        saved = JSON.parse(sessionStorage.getItem(redirectKey) || "null");
      } catch {
        return false;
      } finally {
        clearRedirect();
      }
      if (
        !saved ||
        !Number.isFinite(saved.issuedAt) ||
        !Number.isFinite(saved.expiresAt) ||
        Date.now() < saved.issuedAt ||
        Date.now() - saved.issuedAt > 30000 ||
        saved.expiresAt <= Date.now() ||
        typeof saved.access_token !== "string" ||
        typeof saved.refresh_token !== "string"
      )
        return false;
      session = saved;
      try {
        // Verificación real con el servidor: el contenido del navegador no otorga acceso.
        await authenticated("/auth/v1/user");
        const check = await authenticated("/rest/v1/rpc/is_panel_owner", {
          method: "POST",
          body: "{}",
        });
        if ((await check.json()) !== true) throw new Error("Acceso no autorizado.");
        return true;
      } catch {
        await this.signOut();
        return false;
      }
    },
    async submitContact(fields, requestId) {
      const response = await request("/rest/v1/rpc/submit_contact_request", {
        method: "POST",
        body: JSON.stringify({
          p_id: requestId,
          p_full_name: fields.full_name,
          p_phone: fields.phone,
          p_email: fields.email,
          p_reasons: fields.reasons,
          p_call_time: fields.call_time,
          p_comment: fields.comment,
        }),
      });
      if ((await response.json()) !== true)
        throw new Error("No se confirmó el registro.");
    },
    async signIn(email, password) {
      const response = await request("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!result.access_token || !result.refresh_token)
        throw new Error("Acceso no disponible.");
      session = { ...result, expiresAt: Date.now() + result.expires_in * 1000 };
      try {
        const check = await authenticated("/rest/v1/rpc/is_panel_owner", {
          method: "POST",
          body: "{}",
        });
        if ((await check.json()) !== true)
          throw new Error("Tu cuenta no tiene acceso a las solicitudes.");
      } catch (error) {
        await this.signOut();
        throw error;
      }
    },
    async signOut() {
      clearRedirect();
      const previous = session;
      session = null;
      if (previous) {
        try {
          await request("/auth/v1/logout", { method: "POST" }, previous.access_token);
        } catch {}
      }
    },
    async listRequests({ name = "", page = 0, pageSize = 25 } = {}) {
      const query = new URLSearchParams({
        select:
          "id,full_name,phone,email,reasons,call_time,comment,status,created_at,expires_at",
        order: "created_at.desc,id.desc",
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      const search = name
        .replace(/[%_*\\]/g, "")
        .trim()
        .slice(0, 120);
      if (search) query.set("full_name", `ilike.*${search}*`);
      const response = await authenticated(`/rest/v1/contact_requests?${query}`, {
        headers: { Prefer: "count=exact" },
      });
      const total = Number(response.headers.get("Content-Range")?.split("/")[1] || 0);
      return { rows: await response.json(), total };
    },
    async counts() {
      const entries = await Promise.all(
        ["pending", "contacted", "scheduled"].map(async (status) => {
          const response = await authenticated(
            `/rest/v1/contact_requests?select=id&status=eq.${status}`,
            {
              method: "HEAD",
              headers: { Prefer: "count=exact" },
            },
          );
          return [
            status,
            Number(response.headers.get("Content-Range")?.split("/")[1] || 0),
          ];
        }),
      );
      return Object.fromEntries(entries);
    },
    async updateStatus(id, status) {
      if (!["pending", "contacted", "scheduled"].includes(status))
        throw new Error("Estado no válido.");
      const response = await authenticated(
        `/rest/v1/contact_requests?id=eq.${encodeURIComponent(id)}&select=id`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ status }),
        },
      );
      if ((await response.json()).length !== 1)
        throw new Error("La solicitud ya no está disponible.");
    },
    async deleteRequest(id) {
      const response = await authenticated(
        `/rest/v1/contact_requests?id=eq.${encodeURIComponent(id)}&select=id`,
        {
          method: "DELETE",
          headers: { Prefer: "return=representation" },
        },
      );
      if ((await response.json()).length !== 1)
        throw new Error("La solicitud ya no está disponible.");
    },
  });
})();
