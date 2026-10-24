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

  // Caché limitada a esta sesión y a consultas de datos. Nunca persiste en disco.
  const readCache = new Map();
  let cacheVersion = 0;
  const cachedRpcs = new Set([
    "list_my_clients",
    "search_my_clients",
    "get_client_view_preference",
    "get_my_team_profile",
    "get_my_office",
    "get_team_directory",
    "get_team_client_counts",
    "list_consultants",
    "get_unit_statistics",
    "get_unit_statistics_range",
    "get_client_pias_budget",
  ]);
  function invalidateCache() {
    cacheVersion++;
    readCache.clear();
  }
  function cacheable(route, options = {}) {
    const method = options.method || "GET";
    if (method === "POST") return cachedRpcs.has(route.split("/").pop());
    return (
      ["GET", "HEAD"].includes(method) &&
      /^\/rest\/v1\/(team_resources|premeeting_responses|contact_requests|client_products)(\?|$)/.test(
        route,
      )
    );
  }
  function mutation(route, options = {}) {
    if (["GET", "HEAD"].includes(options.method || "GET")) return false;
    if (route.startsWith("/auth/v1/token")) return false;
    if (
      route.startsWith("/rest/v1/rpc/") &&
      [
        ...cachedRpcs,
        "get_career_progress",
        "get_my_clients_without_products",
        "update_panel_presence",
        "get_panel_presence",
        "panel_access",
        "is_panel_owner",
        "premeeting_consultant",
      ].includes(route.split("/").pop())
    )
      return false;
    return true;
  }
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
    const write = mutation(route, options);
    if (write) invalidateCache();
    const response = await fetch(`${url}${route}`, {
      ...options,
      headers,
      cache: "no-store",
      signal: options.signal || AbortSignal.timeout(20000),
    });
    if (write || [401, 403].includes(response.status)) invalidateCache();
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

  async function authenticated(route, options = {}) {
    const identity = await token();
    if (!cacheable(route, options)) return request(route, options, identity);
    const owner = session?.user?.id,
      revision = cacheVersion;
    const key = JSON.stringify([
      owner,
      route,
      options.method || "GET",
      options.body || "",
      options.headers || {},
    ]);
    let entry = readCache.get(key);
    if (!entry || entry.expires <= Date.now()) {
      entry = { expires: Date.now() + 60000, promise: null };
      entry.promise = (async () => {
        const response = await request(route, options, identity);
        const body =
          options.method === "HEAD" ? null : new Uint8Array(await response.arrayBuffer());
        return {
          body,
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers],
        };
      })();
      readCache.set(key, entry);
      if (readCache.size > 100) readCache.delete(readCache.keys().next().value);
    }
    try {
      const result = await entry.promise;
      if (!session || session.user?.id !== owner || cacheVersion !== revision)
        throw Error("Los datos han cambiado. Actualiza el apartado.");
      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      });
    } catch (error) {
      if (readCache.get(key) === entry) readCache.delete(key);
      throw error;
    }
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
    invalidateCache,
    get panelAccess() {
      return accessDetails ? structuredClone(accessDetails) : null;
    },
    getPanelAccess: readAccess,
    async listResources() {
      const response = await authenticated(
        "/rest/v1/team_resources?select=id,company,product,title,kind,url,storage_path,archived,created_at&order=archived.asc,company.asc,product.asc,created_at.desc&limit=1000",
      );
      return response.json();
    },
    async addResource(fields, file) {
      const identity = await token(),
        current = session;
      const scoped = (route, options) => {
        if (session !== current) throw Error("La sesión ha finalizado.");
        return request(route, options, identity);
      };
      const id = crypto.randomUUID();
      let path = null;
      if (["file", "html"].includes(fields.kind)) {
        const html = fields.kind === "html";
        if (
          !file ||
          file.size > 10485760 ||
          file.size < 5 ||
          (html
            ? !/\.html?$/i.test(file.name) ||
              !/<(?:!doctype\s+html|html|head|body)[\s>]/i.test(
                await file.slice(0, 8192).text(),
              )
            : new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== "%PDF-")
        )
          throw Error("Selecciona un PDF o HTML válido de hasta 10 MB.");
        path = id + (html ? ".html" : ".pdf");
        await scoped("/storage/v1/object/team-resources/" + path, {
          method: "POST",
          headers: { "Content-Type": html ? "text/html" : "application/pdf" },
          body: file,
        });
      }
      try {
        await scoped("/rest/v1/team_resources", {
          method: "POST",
          body: JSON.stringify({
            id,
            company: fields.company,
            product: fields.product,
            title: fields.title,
            kind: fields.kind,
            url: ["link", "web"].includes(fields.kind) ? fields.url : null,
            storage_path: path,
          }),
        });
      } catch (error) {
        if (path) {
          try {
            await scoped("/storage/v1/object/team-resources", {
              method: "DELETE",
              body: JSON.stringify({ prefixes: [path] }),
            });
          } catch {}
        }
        throw error;
      }
    },
    async resourceFile(path) {
      if (!/^[0-9a-f-]{36}\.(pdf|html)$/i.test(path)) throw Error("Documento no válido.");
      const response = await authenticated(
        "/storage/v1/object/authenticated/team-resources/" + path,
      );
      return new Blob([await response.arrayBuffer()], {
        type: path.endsWith(".html") ? "text/html" : "application/pdf",
      });
    },
    async archiveResource(id, archived) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error("Recurso no válido.");
      await authenticated("/rest/v1/team_resources?id=eq." + id, {
        method: "PATCH",
        body: JSON.stringify({ archived }),
      });
    },
    async deleteResource(row) {
      const identity = await token(),
        current = session;
      const scoped = (route, options) => {
        if (session !== current) throw Error("La sesión ha finalizado.");
        return request(route, options, identity);
      };
      if (!/^[0-9a-f-]{36}$/i.test(row.id)) throw Error("Recurso no válido.");
      if (["file", "html"].includes(row.kind))
        await scoped("/storage/v1/object/team-resources", {
          method: "DELETE",
          body: JSON.stringify({
            prefixes: [row.id + (row.kind === "html" ? ".html" : ".pdf")],
          }),
        });
      const response = await scoped(
        "/rest/v1/team_resources?id=eq." + row.id + "&select=id",
        { method: "DELETE", headers: { Prefer: "return=representation" } },
      );
      return (await response.json()).length === 1;
    },
    async listPremeetings(page = 0) {
      const query = new URLSearchParams({
        select: "id,full_name,email,created_at,expires_at",
        order: "created_at.desc,id",
        limit: "25",
        offset: String(page * 25),
      });
      const response = await authenticated("/rest/v1/premeeting_responses?" + query, {
        headers: { Prefer: "count=exact" },
      });
      return {
        rows: await response.json(),
        total: Number(response.headers.get("Content-Range")?.split("/")[1] || 0),
      };
    },
    async getPremeeting(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error("Identificador no válido.");
      const query = new URLSearchParams({ select: "payload", id: "eq." + id });
      const rows = await (
        await authenticated("/rest/v1/premeeting_responses?" + query)
      ).json();
      if (!rows[0]) throw Error("Esta respuesta ya no está disponible.");
      return rows[0].payload;
    },
    async deletePremeetings(ids) {
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 25 ||
        ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))
      )
        throw Error("Selección no válida.");
      const query = new URLSearchParams({
        select: "id",
        id: "in.(" + ids.join(",") + ")",
      });
      return (
        await (
          await authenticated("/rest/v1/premeeting_responses?" + query, {
            method: "DELETE",
            headers: { Prefer: "return=representation" },
          })
        ).json()
      ).length;
    },
    async listClients(search = "", page = 0, filters = {}) {
      return (
        await authenticated("/rest/v1/rpc/search_my_clients", {
          method: "POST",
          body: JSON.stringify({ p_search: search, p_page: page, p_filters: filters }),
        })
      ).json();
    },
    async getClientViewPreference() {
      return (
        await authenticated("/rest/v1/rpc/get_client_view_preference", {
          method: "POST",
          body: "{}",
        })
      ).json();
    },
    async saveClientViewPreference(view) {
      await authenticated("/rest/v1/rpc/save_client_view_preference", {
        method: "POST",
        body: JSON.stringify({ p_view: view }),
      });
    },
    async setClientActive(clientId, active) {
      if (!/^[0-9a-f-]{36}$/i.test(clientId) || typeof active !== "boolean")
        throw Error("Cliente no válido.");
      return (
        await authenticated("/rest/v1/rpc/set_client_active", {
          method: "POST",
          body: JSON.stringify({ p_client: clientId, p_active: active }),
        })
      ).json();
    },
    async setClientProductArchived(productId, archived) {
      if (!/^[0-9a-f-]{36}$/i.test(productId) || typeof archived !== "boolean")
        throw Error("Producto no válido.");
      await authenticated("/rest/v1/rpc/set_client_product_archived", {
        method: "POST",
        body: JSON.stringify({ p_product: productId, p_archived: archived }),
      });
    },
    async listClientProducts(clientId) {
      if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw Error("Cliente no válido.");
      const query = new URLSearchParams({
        select:
          "id,client_id,company,product,portfolio,payment_type,amount,units,created_at,signed_on,signed_multiplier,archived_at,is_apex,parent_product_id",
        client_id: "eq." + clientId,
        order: "created_at.desc,id",
      });
      return (await authenticated("/rest/v1/client_products?" + query)).json();
    },
    async getPiasBudget(clientId, year, exclude = null) {
      return (
        await authenticated("/rest/v1/rpc/get_client_pias_budget", {
          method: "POST",
          body: JSON.stringify({ p_client: clientId, p_year: year, p_exclude: exclude }),
        })
      ).json();
    },
    async saveClientProduct(clientId, fields, id = null) {
      if (!/^[0-9a-f-]{36}$/i.test(clientId) || (id && !/^[0-9a-f-]{36}$/i.test(id)))
        throw Error("Cliente o producto no válido.");
      const body = {
        company: fields.company,
        product: fields.product,
        portfolio: fields.portfolio,
        payment_type: fields.payment_type,
        amount: fields.amount,
        units: fields.units,
        signed_on: fields.signed_on,
        signed_multiplier: fields.signed_multiplier,
      };
      const query = new URLSearchParams({ select: "id" });
      if (id) {
        query.set("id", "eq." + id);
        query.set("client_id", "eq." + clientId);
      } else {
        body.id = crypto.randomUUID();
        body.client_id = clientId;
        body.is_apex = !!fields.is_apex;
        body.parent_product_id = fields.parent_product_id || null;
      }
      const response = await authenticated("/rest/v1/client_products?" + query, {
        method: id ? "PATCH" : "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      if ((await response.json()).length !== 1)
        throw Error("No se ha confirmado el guardado.");
    },
    async deleteClientProducts(clientId, ids) {
      if (
        !/^[0-9a-f-]{36}$/i.test(clientId) ||
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 100 ||
        ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))
      )
        throw Error("Selección no válida.");
      const query = new URLSearchParams({
        client_id: "eq." + clientId,
        id: "in.(" + ids.join(",") + ")",
        select: "id",
      });
      return (
        await (
          await authenticated("/rest/v1/client_products?" + query, {
            method: "DELETE",
            headers: { Prefer: "return=representation" },
          })
        ).json()
      ).length;
    },
    async updatePresence(sessionId, connected) {
      return (
        await authenticated("/rest/v1/rpc/update_panel_presence", {
          method: "POST",
          body: JSON.stringify({ p_session: sessionId, p_connected: connected }),
          keepalive: !connected,
          signal: AbortSignal.timeout(5000),
        })
      ).json();
    },
    async clientsWithoutProducts() {
      return (
        await authenticated("/rest/v1/rpc/get_my_clients_without_products", {
          method: "POST",
          body: "{}",
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
      return (
        await authenticated("/rest/v1/rpc/trash_my_clients", {
          method: "POST",
          body: JSON.stringify({ p_ids: ids }),
        })
      ).json();
    },
    async deletedClients(page = 0) {
      return (
        await authenticated("/rest/v1/rpc/list_deleted_clients", {
          method: "POST",
          body: JSON.stringify({ p_page: page }),
        })
      ).json();
    },
    async restoreDeletedClient(id) {
      await authenticated("/rest/v1/rpc/restore_deleted_client", {
        method: "POST",
        body: JSON.stringify({ p_id: id }),
      });
    },
    async purgeDeletedClient(id) {
      await authenticated("/rest/v1/rpc/purge_deleted_client", {
        method: "POST",
        body: JSON.stringify({ p_id: id }),
      });
    },
    async adminSetConsultantSince(userId, date) {
      return (
        await authenticated("/rest/v1/rpc/admin_set_consultant_since", {
          method: "POST",
          body: JSON.stringify({ p_user: userId, p_since: date }),
        })
      ).json();
    },
    async getMyOffice() {
      return (
        await authenticated("/rest/v1/rpc/get_my_office", { method: "POST", body: "{}" })
      ).json();
    },
    async saveMyOffice(code) {
      return (
        await authenticated("/rest/v1/rpc/save_my_office", {
          method: "POST",
          body: JSON.stringify({ p_office: code }),
        })
      ).json();
    },
    async createOffice(code) {
      return (
        await authenticated("/rest/v1/rpc/create_consultant_office", {
          method: "POST",
          body: JSON.stringify({ p_code: code }),
        })
      ).json();
    },
    async getMyTeamProfile() {
      return (
        await authenticated("/rest/v1/rpc/get_my_team_profile", {
          method: "POST",
          body: "{}",
        })
      ).json();
    },
    async getUnitStatistics(month, to) {
      return (
        await authenticated(
          to
            ? "/rest/v1/rpc/get_unit_statistics_range"
            : "/rest/v1/rpc/get_unit_statistics",
          {
            method: "POST",
            body: JSON.stringify(
              to
                ? { p_from: month + "-01", p_to: to + "-01" }
                : { p_month: month + "-01" },
            ),
          },
        )
      ).json();
    },
    async getCareerProgress(userId) {
      if (!/^[0-9a-f-]{36}$/i.test(userId)) throw Error("Consultor no válido.");
      return (
        await authenticated("/rest/v1/rpc/get_career_progress", {
          method: "POST",
          body: JSON.stringify({ p_user_id: userId }),
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
    async saveProfileDetails(fields) {
      const response = await authenticated("/rest/v1/rpc/save_profile_details", {
        method: "POST",
        body: JSON.stringify({
          p_first_name: fields.first_name,
          p_last_name: fields.last_name,
          p_phone: fields.phone,
          p_consultant_since: fields.consultant_since || null,
          p_office: fields.office,
          p_position: fields.position ?? null,
        }),
      });
      accessDetails = await response.json();
      return structuredClone(accessDetails);
    },
    async saveProfile(fields) {
      const response = await authenticated("/rest/v1/rpc/save_my_profile", {
        method: "POST",
        body: JSON.stringify({
          p_first_name: fields.first_name,
          p_last_name: fields.last_name,
          p_phone: fields.phone,
          p_consultant_since: fields.consultant_since || null,
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
      invalidateCache();
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
      invalidateCache();
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
