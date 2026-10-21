// Pruebas de integración de interfaz y cliente con Auth/DB simulados.
// No se envían correos ni se utilizan cuentas o contraseñas reales.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const root = path.resolve(__dirname, "..");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(
    root,
    url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname,
  );
  fs.readFile(file, (error, data) => {
    res.writeHead(error ? 404 : 200, {
      "Content-Type": types[path.extname(file)] || "text/plain",
    });
    res.end(error ? "Not found" : data);
  });
});

async function mock(context, state) {
  await context.route("https://*.supabase.co/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const body = request.headers()["content-type"]?.includes("application/json")
      ? request.postDataJSON()
      : null;
    const json = (result, status = 200, headers = {}) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "Access-Control-Expose-Headers": "Content-Range", ...headers },
        body: JSON.stringify(result),
      });
    const access = () => ({
      role: state.role,
      profile_enabled: true,
      profile_complete: !!state.profile && !state.needsPassword,
      needs_password: state.needsPassword,
      email: "consultor@example.invalid",
      profile: state.profile,
    });
    const session = {
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_in: 3600,
      user: { id: "test-user", email: "consultor@example.invalid" },
    };
    if (url.pathname === "/auth/v1/token")
      return body.password === "incorrecta" ? json({}, 400) : json(session);
    if (url.pathname === "/auth/v1/verify") {
      state.verifications++;
      return state.invalidLink ? json({}, 403) : json(session);
    }
    if (url.pathname === "/auth/v1/logout") return json({});
    if (url.pathname.includes("/team_resources")) return json([]);
    if (url.pathname.endsWith("/rpc/list_my_clients"))
      return json({ rows: [], total: 0, stats: { clients: 0, interested: 0 } });

    if (url.pathname.includes("premeeting_responses")) return json([]);
    if (url.pathname === "/auth/v1/recover") {
      state.recoveries++;
      return json({});
    }
    if (url.pathname === "/auth/v1/user" && request.method() === "PUT") {
      state.passwordChanges++;
      state.needsPassword = false;
      return json(session.user);
    }
    if (url.pathname === "/auth/v1/user") return json(session.user);
    if (url.pathname.endsWith("/rpc/panel_access"))
      return state.legacy ? json({}, 404) : json(state.unauthorized ? null : access());
    if (url.pathname.endsWith("/rpc/is_panel_owner")) return json(state.role === "admin");
    if (url.pathname.endsWith("/rpc/save_my_profile")) {
      assert.deepEqual(Object.keys(body).sort(), [
        "p_first_name",
        "p_last_name",
        "p_phone",
      ]);
      state.profile = {
        first_name: body.p_first_name,
        last_name: body.p_last_name,
        phone: body.p_phone,
      };
      return json(access());
    }
    if (url.pathname.endsWith("/rpc/get_team_client_counts"))
      return json({ total: 0, by_consultant: [], consultants_with_clients: 0 });
    if (url.pathname.endsWith("/rpc/get_my_team_profile")) {
      const member = state.team?.find(
        (person) =>
          person.user_id === (state.teamUserId || "22222222-2222-4222-8222-222222222222"),
      );
      return json({
        user_id: state.teamUserId || "22222222-2222-4222-8222-222222222222",
        is_root: member?.is_root || false,
        position_code: member?.position_code || null,
        position: member?.position || null,
        multiplier: member?.multiplier || null,
        manager_id: member?.manager_id || null,
        manager_name: "Responsable de prueba",
        avatar_path: state.photoUploaded
          ? "22222222-2222-4222-8222-222222222222/portrait.webp"
          : null,
      });
    }
    if (url.pathname.endsWith("/rpc/get_team_directory")) return json(state.team || []);
    if (url.pathname.endsWith("/rpc/save_team_assignment")) {
      assert.equal(state.role, "admin");
      state.assignmentSaved = body;
      const member = state.team.find((person) => person.user_id === body.p_user_id);
      member.position_code = body.p_position_code;
      member.position = {
        financial_trainee: "Financial Trainee",
        financial_consultant: "Financial Consultant",
        team_manager: "Gestor de Equipo",
      }[body.p_position_code];
      member.multiplier = {
        financial_trainee: 2,
        financial_consultant: 2.5,
        team_manager: 3.5,
      }[body.p_position_code];
      member.manager_id = body.p_manager_id;
      return json(null);
    }
    if (url.pathname.startsWith("/storage/v1/object/")) {
      if (request.method() === "POST") {
        state.photoUploaded = true;
        state.photoBytes = request.postDataBuffer();
        return json({});
      }
      if (request.method() === "DELETE") {
        state.photoUploaded = false;
        return json({});
      }
      return route.fulfill({
        status: 200,
        contentType: state.photoBytes ? "image/webp" : "image/png",
        body:
          state.photoBytes ||
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9hsAAAAASUVORK5CYII=",
            "base64",
          ),
      });
    }
    if (url.pathname.endsWith("/rpc/list_consultants")) {
      assert.equal(state.role, "admin");
      return json(
        state.members || [
          { email: "invitado@ovb.es", name: "", enabled: true, complete: false },
        ],
      );
    }
    if (url.pathname === "/functions/v1/invite-consultant") {
      assert.equal(state.role, "admin");
      if (body.action === "delete_pending") {
        const member = state.members?.find((member) => member.user_id === body.user_id);
        assert.equal(member?.can_delete, true);
        state.members = state.members.filter((member) => member.user_id !== body.user_id);
        return json({ message: "Deleted" });
      }
      state.invites = (state.invites || 0) + 1;
      assert.equal(body.email, "invitado@ovb.es");
      return json({
        invitation_url:
          "https://carlosovb.github.io/carlos-portfolio-propuesta/cuenta/#token_hash=test-hash&type=invite",
      });
    }
    if (url.pathname.includes("contact_requests")) {
      state.requestReads++;
      assert.equal(state.role, "admin", "Un consultor intentó consultar solicitudes");
      if (request.method() === "HEAD") {
        const status = url.searchParams.get("status")?.replace("eq.", "");
        const count = (state.requests || []).filter(
          (item) => !status || item.status === status,
        ).length;
        return route.fulfill({
          status: 200,
          headers: {
            "Content-Range": "*/" + count,
            "Access-Control-Expose-Headers": "Content-Range",
          },
        });
      }
      if (request.method() === "DELETE") {
        const id = url.searchParams.get("id").slice(3);
        if (id === state.deleteFail) return json({}, 500);
        const found = state.requests.find((item) => item.id === id);
        state.requests = state.requests.filter((item) => item.id !== id);
        return json(found ? [{ id }] : []);
      }
      if (request.method() === "PATCH" && state.requests?.length) {
        state.requests[0].status = body.status;
        return json([{ id: state.requests[0].id }]);
      }
      return json(state.requests || [], 200, {
        "Content-Range": "*/" + (state.requests?.length || 0),
      });
    }
    throw new Error(`Petición no prevista: ${request.method()} ${url.pathname}`);
  });
}

function state(role = "admin") {
  return {
    role,
    profile: { first_name: "Nombre", last_name: "De prueba", phone: "000000000" },
    needsPassword: false,
    passwordChanges: 0,
    requestReads: 0,
    verifications: 0,
    recoveries: 0,
  };
}

async function login(page, base) {
  await page.goto(base + "panel/");
  await page.locator('#login-form [name="email"]').fill("consultor@example.invalid");
  await page.locator('#login-form [name="password"]').fill("contraseña de prueba");
  await page.locator("#login-button").click();
  await page.locator("#panel-screen").waitFor();
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_EXECUTABLE
      ? { executablePath: process.env.CHROME_EXECUTABLE }
      : {}),
  });
  try {
    for (const width of [320, 768, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const data = state();
      await mock(context, data);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await login(page, base);
      if (width <= 850) await page.locator(".panel-menu-toggle").click();
      await page.locator('#panel-navigation [data-view="consultants"]').click();
      await page.locator("#consultant-list").getByText("Pendiente de activar").waitFor();
      await page
        .locator('#invite-consultant-form [name="email"]')
        .fill("invitado@ovb.es");
      await page.locator("#invite-consultant-button").click();
      await page.waitForFunction(() =>
        document.querySelector("#invite-notice").textContent.includes("Enlace generado"),
      );
      assert.equal(data.invites, 1);
      assert.equal(
        await page.locator("#invitation-url").inputValue(),
        "https://carlosovb.github.io/carlos-portfolio-propuesta/cuenta/#token_hash=test-hash&type=invite",
      );
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.copiedInvitation = text;
            },
          },
        }),
      );
      await page.locator("#copy-invitation").click();
      assert.equal(
        await page.evaluate(() => window.copiedInvitation),
        await page.locator("#invitation-url").inputValue(),
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      if (width <= 850) await page.locator(".panel-menu-toggle").click();
      await page.locator('#panel-navigation [data-view="profile"]').click();
      await page.waitForFunction(
        () => !document.querySelector("#refresh-button").disabled,
      );
      assert.equal(await page.locator("#invitation-url").inputValue(), "");
      await page.locator('#profile-form [name="first_name"]').fill("Nombre actualizado");
      await page.locator('#profile-form [name="last_name"]').fill("Apellidos de prueba");
      await page.locator('#profile-form [name="phone"]').fill("000000001");
      await page.locator("#save-profile").click();
      await page.waitForFunction(() =>
        document.querySelector("#profile-notice").textContent.includes("guardado"),
      );
      assert.equal(data.profile.first_name, "Nombre actualizado");
      assert.equal(await page.locator("#profile-role").getAttribute("readonly"), "");
      await page.locator('[name="current_password"]').fill("incorrecta");
      await page.locator('[name="new_password"]').fill("contraseña nueva de prueba");
      await page.locator('[name="confirm_password"]').fill("contraseña nueva de prueba");
      await page.locator("#change-password").click();
      await page.waitForFunction(() =>
        document
          .querySelector("#password-notice")
          .textContent.includes("No se ha confirmado"),
      );
      assert.equal(data.passwordChanges, 0);
      await page
        .locator('[name="current_password"]')
        .fill("contraseña anterior de prueba");
      await page.locator('[name="new_password"]').fill("contraseña nueva de prueba");
      await page.locator('[name="confirm_password"]').fill("contraseña nueva de prueba");
      await page.locator("#change-password").click();
      await page.locator("#login-screen").waitFor();
      assert.equal(data.passwordChanges, 1);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.deepEqual(errors, []);
      console.log(`${width}px: perfil y cambio de contraseña comprobados.`);
      await context.close();
    }

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const data = state("consultant");
    data.profile = null;
    // Reproduce la situación real: Auth ya marcó contraseña pero falta el perfil.
    // La contraseña elegida en el formulario debe guardarse de todos modos.
    data.needsPassword = false;
    await mock(context, data);
    const page = await context.newPage();
    await page.goto(base + "cuenta/#token_hash=token-de-prueba&type=invite");
    assert.equal(new URL(page.url()).hash, "");
    assert.equal(data.verifications, 0, "El enlace debe validarse solo al pulsar");
    await page.locator("#verify-account-link").click();
    await page.locator("#account-form").waitFor();
    if (process.env.ACCOUNT_SCREENSHOT)
      await page.screenshot({ path: process.env.ACCOUNT_SCREENSHOT, fullPage: true });
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (theme) => document.documentElement.setAttribute("data-theme", theme),
          theme,
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[name="first_name"]').fill("Consultor");
    await page.locator('[name="last_name"]').fill("De prueba");
    await page.locator('[name="phone"]').fill("000000000");
    await page.locator('[name="password"]').fill("contraseña personal de prueba");
    await page.locator('[name="confirm_password"]').fill("contraseña personal de prueba");
    await page.locator("#complete-account").click();
    await page.waitForURL("**/panel/");
    await page.locator("#panel-screen").waitFor();
    assert.equal(data.passwordChanges, 1);
    assert.equal(data.requestReads, 0);
    assert.equal(
      await page.locator('#panel-navigation [data-view="consultants"]').isVisible(),
      false,
    );
    assert.equal(
      await page.locator('#panel-navigation [data-view="requests"]').isVisible(),
      false,
    );
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    console.log(
      "Invitación: datos, contraseña, entrada directa y aislamiento de solicitudes comprobados.",
    );
    await context.close();

    const statusContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const statusData = state();
    statusData.requests = [
      {
        id: "test-request",
        full_name: "Solicitud ficticia",
        phone: "000000000",
        email: "test@example.invalid",
        reasons: [],
        call_time: "indiferente",
        status: "pending",
        created_at: "2026-10-21T00:00:00Z",
        expires_at: "2026-12-20T00:00:00Z",
      },
    ];
    await mock(statusContext, statusData);
    const statusPage = await statusContext.newPage();
    await login(statusPage, base);
    for (const width of [320, 768, 1440]) {
      await statusPage.setViewportSize({ width, height: 900 });
      assert.equal(
        await statusPage.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    await statusPage.locator('#panel-navigation [data-view="requests"]').click();
    await statusPage.locator("#request-list .request-row").waitFor();
    await statusPage.waitForFunction(
      () => document.querySelector("#requests-pending-count").textContent === "1",
    );
    assert.equal(
      await statusPage.locator("#requests-scheduled-count").textContent(),
      "0",
    );
    assert.equal(
      await statusPage.locator("#request-list .request-contact-preview").textContent(),
      "000000000test@example.invalid",
    );
    for (const width of [320, 768, 1440]) {
      await statusPage.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await statusPage.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        assert.equal(
          await statusPage.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          "El listado de solicitudes debe ajustarse a la pantalla",
        );
      }
      if (width === 320 && process.env.REQUESTS_MOBILE_SCREENSHOT)
        await statusPage.screenshot({
          path: process.env.REQUESTS_MOBILE_SCREENSHOT,
          fullPage: true,
        });
    }
    if (process.env.REQUESTS_SCREENSHOT)
      await statusPage.screenshot({
        path: process.env.REQUESTS_SCREENSHOT,
        fullPage: true,
      });
    await statusPage.locator('#panel-navigation [data-view="home"]').click();
    await statusPage.locator("#recent-requests .request-row").click();
    assert.equal(
      await statusPage.locator('#request-status input[value="pending"]').isChecked(),
      true,
    );
    for (const width of [320, 768, 1440]) {
      await statusPage.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await statusPage.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        assert.equal(
          await statusPage.evaluate(
            () =>
              document.querySelector("#request-dialog").scrollWidth >
              document.querySelector("#request-dialog").clientWidth,
          ),
          false,
        );
      }
    }
    await statusPage.locator('#request-status label[data-status="scheduled"]').click();
    assert.equal(
      await statusPage.locator('#request-status input[value="scheduled"]').isChecked(),
      true,
    );
    await statusPage.waitForTimeout(500);
    if (process.env.STATUS_SCREENSHOT)
      await statusPage.screenshot({ path: process.env.STATUS_SCREENSHOT });
    await statusPage.locator("#save-status").click();
    await statusPage.waitForFunction(
      () => !document.querySelector("#request-dialog").open,
    );
    assert.equal(statusData.requests[0].status, "scheduled");
    await statusPage
      .locator('#recent-requests .request-status[data-status="scheduled"]')
      .waitFor();
    statusData.requests.push({
      ...statusData.requests[0],
      id: "test-request-2",
      full_name: "Segunda solicitud ficticia",
    });
    statusData.deleteFail = "test-request-2";
    await statusPage.locator("#refresh-button").click();
    await statusPage.waitForFunction(
      () => !document.querySelector("#refresh-button").disabled,
    );
    await statusPage.locator('[data-bulk-all="recent-requests"]').check();
    statusPage.once("dialog", (dialog) => dialog.dismiss());
    await statusPage.locator('[data-bulk-delete="recent-requests"]').click();
    assert.equal(statusData.requests.length, 2, "Cancelar no elimina nada");
    statusPage.once("dialog", (dialog) => dialog.accept());
    await statusPage.locator('[data-bulk-delete="recent-requests"]').click();
    await statusPage.waitForFunction(() =>
      document.querySelector("#panel-notice").textContent.includes("No se ha confirmado"),
    );
    assert.equal(
      statusData.requests.length,
      1,
      "Las eliminaciones parciales conservan los fallos",
    );
    assert.equal(statusData.requests[0].id, "test-request-2");
    assert.equal(
      await statusPage.locator("#recent-requests .bulk-checkbox:checked").count(),
      0,
    );
    statusData.members = [
      {
        user_id: "pending-test",
        email: "pendiente@ovb.es",
        enabled: true,
        complete: false,
        can_delete: true,
      },
      {
        user_id: "active-test",
        email: "activo@ovb.es",
        enabled: true,
        complete: true,
        can_delete: false,
      },
    ];
    await statusPage.locator('#panel-navigation [data-view="consultants"]').click();
    await statusPage.locator("#consultant-list .bulk-checkbox").waitFor();
    assert.equal(await statusPage.locator("#consultant-list .bulk-checkbox").count(), 1);
    await statusPage.locator('[data-bulk-all="consultant-list"]').check();
    statusPage.once("dialog", (dialog) => dialog.accept());
    await statusPage.locator('[data-bulk-delete="consultant-list"]').click();
    await statusPage.waitForFunction(() =>
      document.querySelector("#panel-notice").textContent.includes("1 eliminada"),
    );
    assert.equal(statusData.members.length, 1);
    assert.equal(statusData.members[0].user_id, "active-test");
    await statusContext.close();
    console.log("Estados: selección horizontal, guardado y tamaños comprobados.");

    const treeContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const treeData = state("consultant");
    treeData.team = [
      {
        user_id: "11111111-1111-4111-8111-111111111111",
        is_root: true,
        first_name: "Responsable",
        last_name: "De prueba",
        position_code: "team_manager",
        position: "Gestor de Equipo",
        multiplier: 3.5,
        manager_id: null,
      },
      {
        user_id: "22222222-2222-4222-8222-222222222222",
        first_name: "Consultor",
        last_name: "De prueba",
        position_code: "financial_consultant",
        position: "Financial Consultant",
        multiplier: 2.5,
        manager_id: "11111111-1111-4111-8111-111111111111",
      },
      {
        user_id: "33333333-3333-4333-8333-333333333333",
        first_name: "Compañera",
        last_name: "De prueba",
        position_code: "financial_trainee",
        position: "Financial Trainee",
        multiplier: 2,
        manager_id: "22222222-2222-4222-8222-222222222222",
      },
    ];
    await mock(treeContext, treeData);
    const treePage = await treeContext.newPage();
    await login(treePage, base);
    await treePage.locator(".panel-menu-toggle").click();
    await treePage.locator('#panel-navigation [data-view="team"]').click();
    await treePage.locator(".team-node-self").waitFor();
    assert.equal(await treePage.locator(".team-node").count(), 3);
    assert.equal(treeData.requestReads, 0);
    for (const width of [320, 768, 1440]) {
      await treePage.setViewportSize({ width, height: 900 });
      await treePage.locator("#team-locate-mini").click();
      assert.equal(
        await treePage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      const centered = await treePage.evaluate(() => {
        const viewport = document.querySelector("#team-viewport").getBoundingClientRect(),
          self = document.querySelector(".team-node-self").getBoundingClientRect();
        return (
          self.left >= viewport.left &&
          self.right <= viewport.right &&
          self.top < viewport.bottom &&
          self.bottom > viewport.top
        );
      });
      assert.equal(centered, true, "El árbol debe situarse en el puesto del usuario");
      if (width === 320 && process.env.TEAM_MOBILE_SCREENSHOT)
        await treePage.screenshot({ path: process.env.TEAM_MOBILE_SCREENSHOT });
    }
    if (process.env.TEAM_SCREENSHOT)
      await treePage.screenshot({ path: process.env.TEAM_SCREENSHOT });
    await treePage.locator(".team-node-self").click();
    await treePage.locator("#team-member-dialog").waitFor();
    assert.equal(await treePage.locator("#team-assignment-form").isVisible(), false);
    assert.equal(await treePage.locator("#team-member-multiplier").textContent(), "×2,5");
    for (const width of [320, 768, 1440]) {
      await treePage.setViewportSize({ width, height: 900 });
      assert.equal(
        await treePage
          .locator("#team-member-dialog")
          .evaluate(
            (dialog) =>
              dialog.scrollWidth <= dialog.clientWidth &&
              dialog.getBoundingClientRect().width <= innerWidth,
          ),
        true,
        "La ficha debe ajustarse sin desbordamiento horizontal",
      );
    }
    await treePage.locator("#team-member-close").click();
    await treePage.locator("#team-zoom-out").click();
    assert.equal(await treePage.locator("#team-zoom-label").textContent(), "90 %");
    await treePage.locator('#panel-navigation [data-view="profile"]').click();
    await treePage.waitForFunction(
      () => !document.querySelector("#refresh-button").disabled,
    );
    assert.equal(await treePage.locator("#my-team-position").isDisabled(), true);
    assert.equal(
      await treePage.locator("#my-team-position").inputValue(),
      "financial_consultant",
    );
    const photo = await treePage.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 80;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ed5948";
      ctx.fillRect(0, 0, 80, 80);
      ctx.fillStyle = "#246ecc";
      ctx.fillRect(80, 0, 80, 80);
      return c.toDataURL("image/png").split(",")[1];
    });
    await treePage.locator("#team-photo-input").setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from(photo, "base64"),
    });
    await treePage.locator("#photo-crop-dialog").waitFor();
    assert.equal(treeData.photoUploaded, undefined, "No se sube antes de confirmar");
    await treePage.locator("#photo-crop-zoom").evaluate((input) => {
      input.value = "1.6";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const beforePan = await treePage
      .locator("#photo-crop-canvas")
      .evaluate((canvas) =>
        Array.from(canvas.getContext("2d").getImageData(256, 256, 1, 1).data),
      );
    await treePage.locator("#photo-crop-canvas").focus();
    await treePage.keyboard.press("ArrowRight");
    const afterPan = await treePage
      .locator("#photo-crop-canvas")
      .evaluate((canvas) =>
        Array.from(canvas.getContext("2d").getImageData(256, 256, 1, 1).data),
      );
    assert.notDeepEqual(beforePan, afterPan, "El desplazamiento cambia el encuadre real");
    await treePage.locator("#photo-crop-rotate").click();
    if (process.env.PHOTO_SCREENSHOT)
      await treePage.screenshot({ path: process.env.PHOTO_SCREENSHOT });
    await treePage.locator("#photo-crop-save").click();
    await treePage.waitForFunction(() =>
      document
        .querySelector("#team-profile-notice")
        .textContent.includes("encuadre actualizados"),
    );
    assert.equal(treeData.photoUploaded, true);
    await treePage.locator("#team-photo-options > summary").click();
    await treePage.locator("#team-photo-adjust").click();
    await treePage.locator("#photo-crop-dialog").waitFor();
    await treePage.locator("#photo-crop-cancel").click();
    assert.equal(treeData.photoUploaded, true, "Cancelar conserva la foto");
    await treePage.locator("#team-photo-remove").click();
    await treePage.waitForFunction(
      () => document.querySelector("#team-photo-remove").hidden,
    );
    assert.equal(treeData.photoUploaded, false);
    treeData.role = "admin";
    treeData.teamUserId = "11111111-1111-4111-8111-111111111111";
    await treePage.locator("#logout-button").click();
    await login(treePage, base);
    await treePage.locator('#panel-navigation [data-view="profile"]').click();
    await treePage.waitForFunction(
      () => !document.querySelector("#refresh-button").disabled,
    );
    assert.equal(await treePage.locator("#my-team-position").isEnabled(), true);
    await treePage.locator("#my-team-position").selectOption("financial_trainee");
    assert.equal(await treePage.locator("#my-team-multiplier").inputValue(), "×2");
    await treePage.locator("#team-save-own-position").click();
    await treePage.waitForFunction(() =>
      document.querySelector("#team-profile-notice").textContent.includes("Tu puesto"),
    );
    assert.equal(
      treeData.assignmentSaved.p_user_id,
      "11111111-1111-4111-8111-111111111111",
    );
    await treePage.locator('#panel-navigation [data-view="team"]').click();
    await treePage.locator(".team-node-self").click();
    await treePage.locator("#team-assignment-form").waitFor();
    await treePage
      .locator('#team-assignment-form [name="position"]')
      .selectOption("team_manager");
    await treePage.locator("#team-save-assignment").click();
    await treePage.waitForFunction(() =>
      document.querySelector("#team-notice").textContent.includes("actualizados"),
    );
    assert.equal(treeData.assignmentSaved.p_position_code, "team_manager");
    treeData.teamUserId = "ee1355b0-7a6c-4559-87a6-fa72a7d8f73b";
    treeData.photoUploaded = true;
    await treePage.locator('#panel-navigation [data-view="profile"]').click();
    await treePage.locator('#my-team-photo img[src="../assets/carlos.png"]').waitFor();
    assert.equal(
      await treePage.locator("#my-team-photo img").count(),
      1,
      "El perfil de Carlos debe usar el mismo retrato sin fondo que el equipo",
    );
    await treeContext.close();
    console.log(
      "Equipo: centrado propio, navegación, ficha, foto y edición exclusiva de administrador comprobados.",
    );

    const recoveryContext = await browser.newContext();
    const recoveryData = state();
    await mock(recoveryContext, recoveryData);
    const recoveryPage = await recoveryContext.newPage();
    await recoveryPage.goto(base + "cuenta/?modo=recuperar");
    await recoveryPage
      .locator('#recovery-form [name="email"]')
      .fill("consultor@example.invalid");
    await recoveryPage.locator("#request-recovery").click();
    await recoveryPage.waitForFunction(() =>
      document.querySelector("#account-notice").textContent.includes("Si existe"),
    );
    assert.equal(recoveryData.recoveries, 1);
    await recoveryContext.close();
    console.log(
      "Recuperación: petición explícita y respuesta sin revelar cuentas comprobadas.",
    );

    const legacyContext = await browser.newContext();
    const legacy = state();
    legacy.legacy = true;
    await mock(legacyContext, legacy);
    const legacyPage = await legacyContext.newPage();
    await login(legacyPage, base);
    await legacyPage.locator('#panel-navigation [data-view="profile"]').click();
    await legacyPage.waitForFunction(() =>
      document
        .querySelector("#profile-setup-notice")
        .textContent.includes("Falta activar"),
    );
    assert.equal(await legacyPage.locator("#save-profile").isDisabled(), true);
    await legacyContext.close();
    console.log(
      "Migración pendiente: el acceso existente del administrador sigue funcionando.",
    );

    const invalidContext = await browser.newContext();
    const invalid = state("consultant");
    invalid.invalidLink = true;
    await mock(invalidContext, invalid);
    const invalidPage = await invalidContext.newPage();
    await invalidPage.goto(base + "cuenta/#token_hash=token-no-valido&type=invite");
    await invalidPage.locator("#verify-account-link").click();
    await invalidPage.waitForFunction(() =>
      document
        .querySelector("#account-notice")
        .textContent.includes("No se ha podido validar"),
    );
    assert.equal(await invalidPage.locator("#account-form").isVisible(), false);
    await invalidContext.close();
    console.log("Invitación caducada o inválida: no abre el formulario de activación.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
