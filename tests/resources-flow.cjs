const { chromium } = require("playwright"),
  fs = require("fs"),
  path = require("path"),
  http = require("http"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://localhost").pathname;
  const file = path.join(root, p.endsWith("/") ? p + "index.html" : p);
  fs.readFile(file, (e, d) => {
    res.writeHead(e ? 404 : 200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
          ".svg": "image/svg+xml",
        }[path.extname(file)] || "text/plain",
    });
    res.end(e ? "missing" : d);
  });
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE,
  });
  const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
      viewport: { width: 1440, height: 1000 },
      reducedMotion: process.env.RESOURCE_MOTION || "reduce",
    }),
    page = await context.newPage();
  let role = "admin",
    resources = [],
    uploads = 0,
    reads = 0,
    resourceReads = 0;
  const errors = [],
    owner = "11111111-1111-4111-8111-111111111111",
    member = "22222222-2222-4222-8222-222222222222";
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await context.route("https://*.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      body = req.headers()["content-type"]?.includes("application/json")
        ? req.postDataJSON()
        : null;
    const json = (v, headers = {}) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(v),
        headers: { "Access-Control-Expose-Headers": "Content-Range", ...headers },
      });
    if (url.pathname === "/auth/v1/token")
      return json({
        access_token: "fake",
        refresh_token: "fake-refresh",
        expires_in: 3600,
        user: { id: role === "admin" ? owner : member },
      });
    if (url.pathname === "/auth/v1/logout") return json({});
    if (url.pathname.endsWith("/rpc/panel_access"))
      return json({
        role,
        profile_complete: true,
        profile_enabled: true,
        needs_password: false,
        profile: {
          first_name: role === "admin" ? "Carlos" : "Consultor",
          last_name: "De prueba",
          phone: "000000000",
        },
      });
    if (url.pathname.endsWith("/rpc/get_my_team_profile"))
      return json({
        user_id: role === "admin" ? owner : member,
        position: "Financial Consultant",
        multiplier: 2.5,
        is_root: role === "admin",
      });
    if (url.pathname.endsWith("/rpc/list_my_clients"))
      return json({ rows: [], total: 15, stats: { clients: 12, interested: 3 } });
    if (url.pathname.includes("/premeeting_responses"))
      return json(
        [
          {
            id: owner,
            full_name: role === "admin" ? "Cliente Carlos" : "Cliente Consultor",
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          },
        ],
        { "Content-Range": "0-0/1" },
      );
    if (url.pathname.includes("/contact_requests"))
      return req.method() === "HEAD"
        ? route.fulfill({
            status: 200,
            headers: {
              "Content-Range": "*/0",
              "Access-Control-Expose-Headers": "Content-Range",
            },
          })
        : json([]);
    if (url.pathname.includes("/team_resources")) {
      if (req.method() === "POST") {
        assert.equal(role, "admin");
        resources.push({
          ...body,
          archived: false,
          created_at: new Date().toISOString(),
        });
        return json({});
      }
      if (req.method() === "PATCH") {
        resources.find((r) => "eq." + r.id === url.searchParams.get("id")).archived =
          body.archived;
        return json({});
      }
      if (req.method() === "DELETE") {
        const target = url.searchParams.get("id").slice(3);
        resources = resources.filter((r) => r.id !== target);
        return json([{ id: target }]);
      }
      resourceReads++;
      return json(resources);
    }
    if (url.pathname.startsWith("/storage/v1/object/team-resources/")) {
      assert.equal(role, "admin");
      uploads++;
      return json({});
    }
    if (url.pathname === "/storage/v1/object/team-resources") {
      assert.equal(role, "admin");
      return json({});
    }
    if (url.pathname.startsWith("/storage/v1/object/authenticated/team-resources/")) {
      reads++;
      return route.fulfill({
        status: 200,
        contentType: url.pathname.endsWith(".html") ? "text/html" : "application/pdf",
        body: url.pathname.endsWith(".html")
          ? '<!doctype html><html><body><h1>Presentación de prueba</h1><script>try{parent.document.body.dataset.compromised="true";document.body.dataset.isolated="false"}catch{document.body.dataset.isolated="true"}</script></body></html>'
          : "%PDF-1.4\n%%EOF",
      });
    }
    throw Error("Unexpected " + req.method() + " " + url.pathname);
  });
  const login = async () => {
    await page.goto(base + "/panel/");
    await page.locator('#login-form [name="email"]').fill("test@example.invalid");
    await page.locator('#login-form [name="password"]').fill("password of example");
    await page.locator("#login-button").click();
    await page.locator("#panel-screen").waitFor();
    await page.waitForFunction(
      () => document.getElementById("dashboard-clients").textContent === "12",
    );
  };
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await login();
    assert.match(await page.locator("#dashboard-name").textContent(), /Carlos/);
    assert.equal(await page.locator("#dashboard-forms").textContent(), "1");
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "Dashboard responsive",
        );
      }
    }
    await page.screenshot({
      path: path.join(process.env.TEMP, "workspace-dashboard.png"),
      fullPage: true,
    });
    await page.locator('#panel-navigation [data-view="resources"]').click();
    await page.waitForFunction(() =>
      document.getElementById("resource-personal-link").value.includes("consultor="),
    );
    assert.match(
      await page.locator("#resource-personal-link").inputValue(),
      new RegExp(owner),
    );
    assert.deepEqual(
      await page
        .locator("#panel-navigation [data-view]")
        .evaluateAll((a) => a.map((n) => n.dataset.view)),
      [
        "home",
        "resources",
        "requests",
        "premeeting",
        "clients",
        "team",
        "consultants",
        "statistics",
        "profile",
      ],
    );
    assert.equal(await page.locator(".resource-company").count(), 2);
    assert.equal(
      resourceReads,
      1,
      "El inicio y los recursos comparten la misma consulta",
    );
    assert.equal(await page.locator("#resource-admin").isVisible(), false);
    assert(
      await page
        .locator(".resource-company img")
        .evaluateAll((a) => a.every((i) => i.complete && i.naturalWidth > 0)),
    );
    await page.locator("#resource-copy-link").click();
    assert.match(await page.locator(".copy-feedback").textContent(), /Enlace copiado/);
    assert.match(await page.locator("#resource-copy-link").textContent(), /Copiado/);
    assert.match(
      await page.evaluate(() => navigator.clipboard.readText()),
      new RegExp(owner),
    );
    await page.screenshot({
      path: path.join(process.env.TEMP, "company-gallery.png"),
      fullPage: true,
    });
    await page.locator('.resource-company[data-company="axa"]').hover();
    await page.waitForTimeout(400);
    assert.equal(
      await page
        .locator('.resource-company[data-company="axa"]')
        .evaluate((n) => getComputedStyle(n, "::before").content),
      "none",
    );
    await page.locator('.resource-company[data-company="axa"]').click();
    await page.locator("#resource-company-heading").waitFor();
    assert.match(await page.locator("#resource-company-heading").textContent(), /AXA/);
    assert.equal(await page.locator(".resource-personal").isVisible(), false);
    await page
      .getByRole("button", { name: "← Todas las compañías", exact: true })
      .click();
    await page.locator(".resource-personal").waitFor();
    assert.equal(await page.locator(".resource-personal").isVisible(), true);
    const beforeRefresh = resourceReads;
    await page.locator("#refresh-button").click();
    await page.waitForFunction(() => !document.getElementById("refresh-button").disabled);
    assert.equal(
      resourceReads,
      beforeRefresh + 1,
      "Actualizar consulta de nuevo al servidor",
    );
    await page.evaluate(() => {
      window.testCopy = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
    });
    await page.locator("#resource-copy-link").click();
    assert.match(
      await page.locator(".copy-feedback").textContent(),
      /No se ha podido copiar/,
    );
    await page.evaluate(() => {
      navigator.clipboard.writeText = window.testCopy;
    });
    if (!(await page.locator("#resource-admin").isVisible()))
      await page.locator('.resource-company[data-company="axa"]').click();
    await page.locator("#resource-admin summary").click();
    assert.equal(
      await page.locator('#resource-form [name="company"]').inputValue(),
      "AXA",
    );
    assert.equal(
      await page.locator('#resource-form [name="company"]').getAttribute("readonly"),
      "",
    );
    await page.locator('#resource-form [name="product"]').fill("Producto de ejemplo");
    await page.locator('#resource-form [name="title"]').fill("Guía de ejemplo");
    await page.locator("#resource-kind").selectOption("link");
    await page.locator("#resource-url").fill("https://docs.example.invalid/recurso");
    await page.locator("#resource-save").click();
    await page.getByText("Guía de ejemplo", { exact: true }).waitFor();
    assert.equal(resources.length, 1);
    await page
      .locator(".resource-document")
      .getByRole("button", { name: "Archivar", exact: true })
      .click();
    await page.getByRole("heading", { name: "Archivo · versiones anteriores" }).waitFor();
    await page
      .locator(".resource-document")
      .getByRole("button", { name: "Restaurar", exact: true })
      .click();
    await page.getByRole("heading", { name: "Documentación disponible" }).waitFor();
    await page.locator("#resource-admin summary").click();
    assert.equal(
      await page.locator('#resource-form [name="company"]').inputValue(),
      "AXA",
    );
    await page.locator('#resource-form [name="product"]').fill("Producto de ejemplo");
    await page.locator('#resource-form [name="title"]').fill("PDF de ejemplo");
    await page.locator("#resource-file").setInputFiles({
      name: "ejemplo.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF"),
    });
    await page.locator("#resource-save").click();
    await page.getByText("PDF de ejemplo", { exact: true }).waitFor();
    assert.equal(uploads, 1);
    const popupPromise = page.waitForEvent("popup");
    await page
      .locator(".resource-document")
      .filter({ hasText: "PDF de ejemplo" })
      .locator("h4")
      .click();
    const popup = await popupPromise;
    await popup.waitForURL("blob:**");
    assert.equal(reads, 1);
    await popup.close();
    assert.match(
      await page.locator(".resource-document").first().locator("h4").textContent(),
      /PDF de ejemplo/,
    );
    assert.match(
      await page
        .locator(".resource-document")
        .first()
        .locator(".resource-product")
        .textContent(),
      /Producto de ejemplo/,
    );
    assert(
      await page.locator(".resource-document time").first().getAttribute("datetime"),
    );
    await page.locator("#resource-admin summary").click();
    await page.locator("#resource-form [name=product]").fill("Presentaciones");
    await page.locator("#resource-form [name=title]").fill("HTML de ejemplo");
    await page.locator("#resource-kind").selectOption("html");
    assert.equal(
      await page.locator("#resource-file").getAttribute("accept"),
      "text/html,.html,.htm",
    );
    await page.locator("#resource-file").setInputFiles({
      name: "presentacion.html",
      mimeType: "text/html",
      buffer: Buffer.from("<!doctype html><html><body>Prueba</body></html>"),
    });
    await page.locator("#resource-save").click();
    await page.getByRole("heading", { name: "HTML de ejemplo", exact: true }).waitFor();
    assert.equal(uploads, 2);
    assert.equal(resources.find((r) => r.title === "HTML de ejemplo").kind, "html");
    const htmlPopupPromise = page.waitForEvent("popup");
    await page
      .locator(".resource-document")
      .filter({ hasText: "HTML de ejemplo" })
      .getByRole("button", { name: "Ver presentación ↗", exact: true })
      .click();
    const htmlPopup = await htmlPopupPromise;
    await htmlPopup.locator("iframe").waitFor();
    assert.equal(
      await htmlPopup.locator("iframe").getAttribute("sandbox"),
      "allow-scripts allow-presentation",
    );
    await htmlPopup
      .frameLocator("iframe")
      .getByRole("heading", { name: "Presentación de prueba" })
      .waitFor();
    assert.equal(
      await htmlPopup
        .frameLocator("iframe")
        .locator("body")
        .getAttribute("data-isolated"),
      "true",
    );
    assert.equal(await htmlPopup.locator("body").getAttribute("data-compromised"), null);
    await htmlPopup.close();
    await page.locator("#resource-admin summary").click();
    await page.locator("#resource-form [name=product]").fill("Presentaciones");
    await page.locator("#resource-form [name=title]").fill("Web de ejemplo");
    await page.locator("#resource-kind").selectOption("web");
    await page.locator("#resource-url").fill("https://docs.example.invalid/presentacion");
    await page.locator("#resource-save").click();
    await page.getByRole("heading", { name: "Web de ejemplo", exact: true }).waitFor();
    assert.equal(resources.find((r) => r.title === "Web de ejemplo").kind, "web");
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "Recursos responsive",
      );
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "Tarjetas en móvil y tema claro",
    );
    await page.screenshot({
      path: path.join(process.env.TEMP, "resources-mobile-light.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await page.screenshot({
      path: path.join(process.env.TEMP, "workspace-resources.png"),
      fullPage: true,
    });
    await page.locator("#logout-button").click();
    role = "consultant";
    await login();
    assert.match(await page.locator("#dashboard-name").textContent(), /Consultor/);
    assert.match(
      await page.locator("#dashboard-form-recent").textContent(),
      /Cliente Consultor/,
    );
    assert.doesNotMatch(
      await page.locator("#dashboard-form-recent").textContent(),
      /Cliente Carlos/,
    );
    await page.locator('#panel-navigation [data-view="resources"]').click();
    await page.waitForFunction(() =>
      document.getElementById("resource-personal-link").value.includes("22222222"),
    );
    assert.equal(await page.locator("#resource-admin").isVisible(), false);
    assert.equal(await page.locator("#resource-bulk").isVisible(), false);
    await page.getByRole("button", { name: "AXA", exact: false }).click();
    await page.locator(".resource-document").first().waitFor();
    assert.equal(await page.locator(".resource-document").count(), 4);
    assert.equal(
      await page.getByRole("button", { name: "Archivar", exact: true }).count(),
      0,
    );
    await page.locator("#logout-button").click();
    role = "admin";
    await login();
    await page.locator('#panel-navigation [data-view="resources"]').click();
    await page.getByRole("button", { name: "AXA", exact: false }).click();
    await page.locator(".resource-document").first().waitFor();
    assert.equal(await page.locator("#resource-bulk").isVisible(), false);
    await page.locator("[data-resource-id]").first().check();
    assert.equal(await page.locator("#resource-bulk").isVisible(), true);
    await page.locator("[data-resource-id]").first().uncheck();
    assert.equal(await page.locator("#resource-bulk").isVisible(), false);
    await page.locator("[data-resource-id]").first().check();
    await page.locator("#resource-select-all").check();
    await page.locator("#resource-delete-selected").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".resource-document").length === 0,
    );
    assert.equal(resources.length, 0);
    assert.deepEqual(errors, []);
    console.log(
      "Dashboard y recursos: datos propios, enlaces personales, compañías/productos, enlaces, PDF privado, archivo, permisos y borrado múltiple verificados.",
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
