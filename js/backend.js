// Cliente del panel: sesión activa en memoria y traspaso temporal de un solo uso.
(() => {
  const config = window.PORTFOLIO_BACKEND || {};
  const url = (config.url || "").replace(/\/$/, "");
  const key = config.publishableKey || "";
  const ready =
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && key.startsWith("sb_publishable_");
  let session = null;
  let refreshing = null;
  let accessDetails = null;
  let accountLinkType = null;
  const applicationRoot = new URL("../", document.currentScript.src);
  const accountPage = new URL("cuenta/", applicationRoot).href;
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
    if (options.body && !headers["Content-Type"])
      headers["Content-Type"] = "application/json";
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

  async function readAccess() {
    try {
      const response = await authenticated("/rest/v1/rpc/panel_access", {
        method: "POST",
        body: "{}",
      });
      const details = await response.json();
      if (!details || !["admin", "consultant"].includes(details.role)) {
        const error = new Error("Tu cuenta no está autorizada.");
        error.status = 403;
        throw error;
      }
      accessDetails = details;
    } catch (error) {
      // Compatibilidad con el panel anterior mientras se ejecuta la nueva migración.
      if (error.status !== 404) throw error;
      const check = await authenticated("/rest/v1/rpc/is_panel_owner", {
        method: "POST",
        body: "{}",
      });
      if ((await check.json()) !== true) throw new Error("Tu cuenta no está autorizada.");
      const user = await (await authenticated("/auth/v1/user")).json();
      accessDetails = {
        role: "admin",
        profile_enabled: false,
        profile_complete: true,
        needs_password: false,
        email: user.email,
        profile: null,
      };
    }
    return structuredClone(accessDetails);
  }

  function validatePassword(password) {
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      throw new Error("Utiliza una contraseña de entre 12 y 128 caracteres.");
    }
  }

  window.PortfolioBackend = Object.freeze({
    ready,
    get panelAccess() {
      return accessDetails ? structuredClone(accessDetails) : null;
    },
    getPanelAccess: readAccess,
    async listClients(search = "", page = 0) {
      return (
        await authenticated("/rest/v1/rpc/list_my_clients", {
          method: "POST",
          body: JSON.stringify({ p_search: search, p_page: page }),
        })
      ).json();
    },
    async importClients(rows, preview = true) {
      return (
        await authenticated("/rest/v1/rpc/import_my_clients", {
          method: "POST",
          body: JSON.stringify({ p_rows: rows, p_preview: preview }),
        })
      ).json();
    },
    async teamClientCounts() {
      return (
        await authenticated("/rest/v1/rpc/get_team_client_counts", {
          method: "POST",
          body: "{}",
        })
      ).json();
    },
    async deleteClients(ids) {
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 25 ||
        ids.some(
          (id) =>
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
        )
      )
        throw Error("Selección no válida.");
      const query = new URLSearchParams({
        id: "in.(" + ids.join(",") + ")",
        select: "id",
      });
      const response = await authenticated("/rest/v1/portfolio_clients?" + query, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      return (await response.json()).length;
    },
    async getMyTeamProfile() {
      return (
        await authenticated("/rest/v1/rpc/get_my_team_profile", {
          method: "POST",
          body: "{}",
        })
      ).json();
    },
    async listTeam() {
      return (
        await authenticated("/rest/v1/rpc/get_team_directory", {
          method: "POST",
          body: "{}",
        })
      ).json();
    },
    async saveTeamAssignment(userId, position, managerId) {
      await authenticated("/rest/v1/rpc/save_team_assignment", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: userId,
          p_position_code: position || null,
          p_manager_id: managerId || null,
        }),
      });
    },
    async readTeamPhoto(path) {
      if (!/^[0-9a-f-]{36}\/portrait\.webp$/i.test(path))
        throw new Error("Foto no válida.");
      const response = await authenticated(
        "/storage/v1/object/authenticated/consultant-avatars/" + path,
      );
      return response.blob();
    },
    async uploadTeamPhoto(blob) {
      const me = await this.getMyTeamProfile();
      if (!me?.user_id) throw new Error("Perfil no disponible.");
      await authenticated(
        "/storage/v1/object/consultant-avatars/" + me.user_id + "/portrait.webp",
        {
          method: "POST",
          headers: { "Content-Type": "image/webp", "x-upsert": "true" },
          body: blob,
        },
      );
    },
    async removeTeamPhoto() {
      const me = await this.getMyTeamProfile();
      await authenticated("/storage/v1/object/consultant-avatars", {
        method: "DELETE",
        body: JSON.stringify({ prefixes: [me.user_id + "/portrait.webp"] }),
      });
    },
    async listConsultants() {
      const response = await authenticated("/rest/v1/rpc/list_consultants", {
        method: "POST",
        body: "{}",
      });
      return response.json();
    },
    async deletePendingInvitation(userId) {
      const response = await authenticated("/functions/v1/invite-consultant", {
        method: "POST",
        body: JSON.stringify({ action: "delete_pending", user_id: userId }),
      });
      return response.json();
    },
    async inviteConsultant(email) {
      const response = await authenticated("/functions/v1/invite-consultant", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      return response.json();
    },
    async saveProfile(fields) {
      const response = await authenticated("/rest/v1/rpc/save_my_profile", {
        method: "POST",
        body: JSON.stringify({
          p_first_name: fields.first_name,
          p_last_name: fields.last_name,
          p_phone: fields.phone,
        }),
      });
      accessDetails = await response.json();
      return structuredClone(accessDetails);
    },
    async changePassword(currentPassword, newPassword) {
      validatePassword(newPassword);
      if (currentPassword === newPassword)
        throw new Error("La nueva contraseña debe ser diferente.");
      const user = await (await authenticated("/auth/v1/user")).json();
      const fresh = await (
        await request("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify({ email: user.email, password: currentPassword }),
        })
      ).json();
      if (fresh.user?.id !== user.id || !fresh.access_token || !fresh.refresh_token)
        throw new Error("No se ha podido verificar la contraseña actual.");
      session = { ...fresh, expiresAt: Date.now() + fresh.expires_in * 1000 };
      await authenticated("/auth/v1/user", {
        method: "PUT",
        body: JSON.stringify({ password: newPassword }),
      });
      await this.signOut();
    },
    async requestPasswordRecovery(email) {
      await request(`/auth/v1/recover?redirect_to=${encodeURIComponent(accountPage)}`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    },
    async acceptAccountLink(link) {
      if (!["invite", "recovery"].includes(link?.type))
        throw new Error("El enlace no es válido.");
      if (link.token_hash) {
        const response = await request("/auth/v1/verify", {
          method: "POST",
          body: JSON.stringify({ token_hash: link.token_hash, type: link.type }),
        });
        const result = await response.json();
        session = { ...result, expiresAt: Date.now() + Number(result.expires_in) * 1000 };
      } else if (link.access_token && link.refresh_token) {
        session = {
          access_token: link.access_token,
          refresh_token: link.refresh_token,
          expiresAt: Date.now() + Math.min(Number(link.expires_in) || 300, 3600) * 1000,
        };
      } else throw new Error("El enlace no es válido o ha caducado.");
      try {
        await authenticated("/auth/v1/user");
        const details = await readAccess();
        accountLinkType = link.type;
        return details;
      } catch (error) {
        await this.signOut();
        throw error;
      }
    },
    async setPasswordFromLink(password) {
      validatePassword(password);
      if (!["invite", "recovery"].includes(accountLinkType))
        throw new Error("Abre el enlace de invitación o recuperación.");
      await authenticated("/auth/v1/user", {
        method: "PUT",
        body: JSON.stringify({ password }),
      });
      accountLinkType = null;
      return readAccess();
    },
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
        await readAccess();
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
        await readAccess();
      } catch (error) {
        await this.signOut();
        throw error;
      }
    },
    async signOut() {
      clearRedirect();
      const previous = session;
      session = null;
      accessDetails = null;
      accountLinkType = null;
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
