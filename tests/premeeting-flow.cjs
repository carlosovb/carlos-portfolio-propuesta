// Recorrido público completo y recepción privada con datos ficticios.
const { chromium, webkit, devices } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  http = require("http");
const root = path.resolve(__dirname, ".."),
  server = http.createServer((req, res) => {
    let p = new URL(req.url, "http://localhost").pathname;
    p = p.endsWith("/") ? p + "index.html" : p;
    const f = path.join(root, p);
    fs.readFile(f, (e, data) => {
      res.writeHead(e ? 404 : 200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".png": "image/png",
          }[path.extname(f)] || "text/plain",
      });
      res.end(e ? "missing" : data);
    });
  });
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const safari = process.env.MOBILE_BROWSER === "webkit";
  const mobile = safari || process.env.MOBILE_BROWSER === "android";
  const browser = await (safari ? webkit : chromium).launch({
    ...(!safari && { executablePath: process.env.CHROME_EXECUTABLE || undefined }),
    headless: true,
  });
  const context = await browser.newContext({
    ...(mobile
      ? devices[safari ? "iPhone 13" : "Pixel 7"]
      : { viewport: { width: 1440, height: 1000 } }),
    ...(!safari && { permissions: ["clipboard-read", "clipboard-write"] }),
  });
  const page = await context.newPage();
  let saved = null,
    attempts = 0,
    role = "admin",
    removed = false,
    delayDetail = null;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await require("./ui-confirm.cjs").auto(page);
  await context.route("https://*.supabase.co/**", async (route) => {
    const r = route.request(),
      url = new URL(r.url()),
      body = r.postData() ? r.postDataJSON() : null;
    const json = (v, headers = {}) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(v),
        headers: {
          "Access-Control-Allow-Origin": r.headers().origin || new URL(base).origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers":
            "authorization, apikey, content-type, x-client-info",
          "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Expose-Headers": "Content-Range",
          ...headers,
        },
      });
    if (r.method() === "OPTIONS") return json(null);
    if (url.pathname.endsWith("/rpc/get_panel_activity"))
      return json({ rows: [], total: 0 });
    if (url.pathname.endsWith("/rpc/get_panel_notifications"))
      return json({ rows: [], unread: 0 });
    if (url.pathname.endsWith("/rpc/get_client_view_preference")) return json("list");
    if (url.pathname.endsWith("/rpc/save_client_view_preference")) return json(null);
    if (url.pathname.endsWith("/rpc/submit_premeeting")) {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, body: "unavailable" });
      saved = body;
      return json(true);
    }
    if (url.pathname.endsWith("/rpc/update_panel_presence")) return json([]);
    if (url.pathname === "/auth/v1/token")
      return json({
        access_token: "fake",
        refresh_token: "fake-refresh",
        expires_in: 3600,
        user: { id: "11111111-1111-4111-8111-111111111111" },
      });
    if (url.pathname === "/auth/v1/logout") return json({});
    if (url.pathname.includes("/team_resources")) return json([]);
    if (url.pathname.endsWith("/rpc/search_my_clients"))
      return json({ rows: [], total: 0, stats: { clients: 0, interested: 0 } });
    if (url.pathname.endsWith("/rpc/premeeting_consultant"))
      return json({
        id: body.p_consultant || "11111111-1111-4111-8111-111111111111",
        name: "Consultor Prueba",
        is_root: true,
      });

    if (url.pathname.endsWith("/rpc/panel_access"))
      return json({
        role,
        profile_enabled: true,
        profile_complete: true,
        needs_password: false,
        email: "admin@example.invalid",
        profile: { first_name: "Consultor", last_name: "Prueba", phone: "000000000" },
      });
    if (url.pathname.includes("contact_requests"))
      return r.method() === "HEAD"
        ? route.fulfill({
            status: 200,
            headers: {
              "Content-Range": "*/0",
              "Access-Control-Expose-Headers": "Content-Range",
            },
          })
        : json([]);
    if (url.pathname.includes("premeeting_responses")) {
      if (r.method() === "DELETE") {
        removed = true;
        return json([{ id: saved.p_id }]);
      }
      if (url.searchParams.get("select") === "payload") {
        if (delayDetail) await delayDetail;
        return json([{ payload: saved.p_payload }]);
      }
      return json(
        removed
          ? []
          : [
              {
                id: saved.p_id,
                full_name: "Ana Prueba",
                email: "ana@example.invalid",
                created_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
              },
            ],
        { "Content-Range": removed ? "*/0" : "0-0/1" },
      );
    }
    if (url.pathname.endsWith("/rpc/get_team_directory")) return json([]);
    if (url.pathname.endsWith("/rpc/get_my_team_profile"))
      return json({
        user_id: "11111111-1111-4111-8111-111111111111",
        position_code: "financial_trainee",
        position: "Financial Trainee",
        multiplier: 2,
        manager_id: null,
        is_root: false,
      });
    if (url.pathname.endsWith("/rpc/get_team_client_counts"))
      return json({
        by_consultant: [],
        total: 0,
        interested: 0,
        consultants_with_clients: 0,
      });
    throw Error("Unexpected API " + url.pathname);
  });
  try {
    await page.goto(base + "/previo/");
    await page.locator("#premeeting-success").waitFor({ state: "hidden" });
    const next = () => page.locator("#premeeting-next").click();
    await next();
    assert.equal(
      await page.locator("#premeeting-content h2").textContent(),
      "Vuestros datos",
    );
    await page.getByLabel("En pareja", { exact: true }).check();
    for (let i = 0; i < 2; i++) {
      const p = page.locator(".premeeting-person").nth(i);
      await p.getByLabel("Nombre *", { exact: true }).fill(i ? "Luis" : "Ana");
      await p.getByLabel("Apellidos *").fill("Prueba");
      await p.getByLabel("Edad *").fill("30");
      await p.getByLabel("Ocupación *").fill("Profesional");
      const employment = p.getByRole("combobox", {
        name: "Situación laboral *",
        exact: true,
      });
      if (i === 0) {
        await employment.focus();
        await employment.press("ArrowDown");
        await employment.press("ArrowDown");
        await employment.press("Enter");
        assert.match(await employment.textContent(), /Por cuenta ajena/);
        await employment.click();
        await employment.press("Escape");
        assert.equal(await employment.getAttribute("aria-expanded"), "false");
      } else {
        await employment.click();
        await p.getByRole("option", { name: "Por cuenta ajena", exact: true }).click();
      }
    }
    await page.getByLabel("Correo electrónico *").fill("ana@example.invalid");
    await page.getByLabel("Teléfono *").fill("000000000");
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "Formulario sin desbordamientos",
        );
      }
    }
    await page.screenshot({
      path: path.join(process.env.TEMP || "/tmp", "premeeting-start.png"),
      fullPage: true,
    });
    await next();
    await page
      .locator(".premeeting-person")
      .first()
      .getByRole("button", { name: "Crear un colchón de emergencia", exact: true })
      .click();
    await page
      .locator(".premeeting-person")
      .first()
      .getByRole("button", { name: "Alta", exact: true })
      .click();
    assert.equal(
      await page
        .locator('.premeeting-priority[data-priority="Alta"]')
        .first()
        .getAttribute("aria-pressed"),
      "true",
    );
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        );
      }
    }
    await page.screenshot({
      path: path.join(process.env.TEMP || "/tmp", "premeeting-goals-visual.png"),
      fullPage: true,
    });
    await next();
    async function amount(group, label, value) {
      await group
        .getByRole("group", { name: label + " · opción", exact: true })
        .getByRole("button", { name: /^Indicar/ })
        .click();
      await group
        .getByRole("spinbutton", { name: label, exact: true })
        .fill(String(value));
    }
    const persons = page.locator(".premeeting-person");
    await amount(persons.nth(0), "Ingreso neto mensual habitual", 2000);
    await amount(persons.nth(0), "Pagas extra · total anual (opcional)", 2400);
    await amount(persons.nth(1), "Ingreso neto mensual habitual", 1500);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "Ingresos sin desbordar",
      );
    }
    await page.screenshot({
      path: path.join(process.env.TEMP || "/tmp", "premeeting-income-visual.png"),
      fullPage: true,
    });
    await next();
    await amount(persons.nth(2), "Cuota mensual de hipoteca", 700);
    await persons
      .nth(0)
      .getByRole("button", { name: "+ Añadir préstamo", exact: true })
      .click();
    await persons.nth(0).getByLabel("Tipo o nombre del préstamo").fill("Coche");
    await amount(persons.nth(0), "Cuota mensual", 200);
    await amount(persons.nth(0), "Meses aproximados pendientes", 24);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "Gastos y préstamos sin desbordar",
      );
    }
    await next();
    await page.setViewportSize({ width: 320, height: 1000 });
    await persons
      .nth(0)
      .getByRole("button", { name: "+ Añadir cuenta o producto" })
      .click();
    await persons
      .nth(0)
      .getByRole("combobox", { name: "Qué producto tienes", exact: true })
      .click();
    await persons
      .nth(0)
      .getByRole("option", { name: "No sé qué producto tengo", exact: true })
      .click();
    await amount(persons.nth(0), "Cantidad depositada o valor actual aproximado", 5000);
    assert.equal(
      await page.locator("select:visible").count(),
      0,
      "Los selectores visibles deben usar el diseño de la web",
    );
    await persons.nth(0).getByRole("checkbox").check();
    await persons.nth(1).getByRole("checkbox").check();
    await persons.nth(2).getByRole("checkbox").check();
    await next();
    assert.match(await page.locator(".premeeting-warning").textContent(), /incompleto/);
    assert.equal(
      await page.locator(".premeeting-totals strong").nth(0).textContent(),
      "3700,00 €",
    );
    assert.equal(
      await page.locator(".premeeting-totals strong").nth(1).textContent(),
      "900,00 €",
    );
    assert.equal(await page.locator(".premeeting-person-total").count(), 2);
    assert.match(
      await page.locator(".premeeting-shared-total strong").textContent(),
      /700/,
    );
    assert.equal(
      new Set(
        await page
          .locator(".premeeting-totals strong")
          .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).color)),
      ).size,
      3,
      "Ingresos, gastos y disponible tienen colores distintos",
    );
    await page
      .locator(".premeeting-summary details")
      .first()
      .getByRole("button", { name: "Corregir este apartado" })
      .click();
    await page.getByLabel("Teléfono *").fill("000000001");
    await page.locator("#premeeting-progress button").last().click();
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "Resumen responsive",
      );
    }
    await page.screenshot({
      path: path.join(process.env.TEMP || "/tmp", "premeeting-review.png"),
      fullPage: true,
    });
    await page.locator(".premeeting-consent input").check();
    await next();
    await page.locator("#premeeting-error").waitFor();
    await next();
    await page.locator("#premeeting-success").waitFor();
    assert.equal(saved.p_payload.people.length, 2);
    assert.equal(saved.p_payload.people[0].assets.length, 0);
    assert.equal(saved.p_payload.contact.phone, "000000001");
    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), []);
    assert.equal(await page.locator("#premeeting-content").textContent(), "");
    async function login() {
      await page.goto(base + "/panel/");
      await page.locator('#login-form [name="email"]').fill("admin@example.invalid");
      await page.locator('#login-form [name="password"]').fill("example password");
      await page.locator("#login-button").click();
      await page.locator("#panel-screen").waitFor();
    }
    await login();
    await page.locator('#panel-navigation [data-view="premeeting"]').click();
    await page.getByRole("button", { name: "Ver respuestas ↗", exact: true }).click();
    await page.locator("#premeeting-detail").waitFor();
    assert.match(await page.locator("#premeeting-private-summary").textContent(), /3700/);
    await page.mouse.click(2, 2);
    await page.locator("#premeeting-detail").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.getElementById("premeeting-private-summary").textContent === "",
    );
    assert.equal(await page.locator("#premeeting-bulk").isVisible(), false);
    await page.locator("[data-response-id]").first().check();
    await page.locator("#premeeting-select-all").check();
    await page.locator("#premeeting-delete-selected").click();
    await page
      .getByText("Todavía no hay formularios recibidos.", { exact: false })
      .waitFor();
    assert(removed);
    await page.locator("#logout-button").click();
    assert.equal(await page.locator("#premeeting-response-list").textContent(), "");
    role = "consultant";
    await login();
    assert.equal(
      await page.locator('#panel-navigation [data-view="premeeting"]').isVisible(),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Formulario previo: pareja, edición, cálculos, móvil, reintento, envío, panel privado, eliminación y cierre exterior verificados.",
    );
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
