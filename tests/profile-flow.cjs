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
    const body = request.postDataJSON();
    const json = (result, status = 200, headers = {}) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers,
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
    if (url.pathname.includes("contact_requests")) {
      state.requestReads++;
      assert.equal(state.role, "admin", "Un consultor intentó consultar solicitudes");
      if (request.method() === "HEAD")
        return route.fulfill({ status: 200, headers: { "Content-Range": "*/0" } });
      return json([], 200, { "Content-Range": "*/0" });
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
      await page.locator('#panel-navigation [data-view="profile"]').click();
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
    data.needsPassword = true;
    await mock(context, data);
    const page = await context.newPage();
    await page.goto(base + "cuenta/#token_hash=token-de-prueba&type=invite");
    assert.equal(new URL(page.url()).hash, "");
    assert.equal(data.verifications, 0, "El enlace debe validarse solo al pulsar");
    await page.locator("#verify-account-link").click();
    await page.locator("#account-form").waitFor();
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
      await page.locator('#panel-navigation [data-view="requests"]').isVisible(),
      false,
    );
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    console.log(
      "Invitación: datos, contraseña, entrada directa y aislamiento de solicitudes comprobados.",
    );
    await context.close();

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
