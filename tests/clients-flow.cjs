// Integración con datos ficticios; no utiliza el informe real ni cuentas de producción.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  http = require("http");
const XLSX = require("../vendor/xlsx-0.20.3.min.js"),
  parser = require("../js/client-import.js");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(
    root,
    url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname,
  );
  fs.readFile(file, (e, data) => {
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
    res.end(e ? "Not found" : data);
  });
});
const uid = "11111111-1111-4111-8111-111111111111";
const headers = [
  "Tipo cliente",
  "Estado",
  "Apellido",
  "Nombre",
  "E- Mail",
  "Móvil/Teléfono",
  "F. de nacimiento",
  "Tipo de via",
  "Calle",
  "Nº",
  "C.P.",
  "Localidad",
  "Dato que debe ignorarse",
];
const a = [
  "Cliente",
  "Activo",
  "García",
  "Ana",
  "ana@example.invalid",
  "000000001",
  "1990-02-03",
  "Calle",
  "Ejemplo",
  "1",
  "35001",
  "Las Palmas",
  "NO CONSERVAR",
];
const data = [
  a,
  [...a.slice(0, 2), " GARCIA ", "ANA", ...a.slice(4)],
  [...a.slice(0, 3), "Bruno", "bruno@example.invalid", ...a.slice(5)],
  [...a.slice(0, 6), "fecha inválida", ...a.slice(7)],
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...data]), "Clientes");
const excel = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE || undefined,
  });
  let delayNextList = 0,
    products = [];
  let trash = [];
  let clients = [],
    writes = 0,
    previewCalls = 0,
    role = "admin",
    preferredView = "list";
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("https://*.supabase.co/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        body = req.headers()["content-type"]?.includes("application/json")
          ? req.postDataJSON()
          : null;
      const json = (value) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(value),
          headers: { "Access-Control-Expose-Headers": "Content-Range" },
        });
      if (url.pathname.endsWith("/rpc/get_client_view_preference"))
        return json(preferredView);
      if (url.pathname.endsWith("/rpc/save_client_view_preference")) {
        preferredView = body.p_view;
        return json(null);
      }
      if (url.pathname === "/auth/v1/token")
        return json({
          access_token: "test-access",
          refresh_token: "test-refresh",
          expires_in: 3600,
          user: { id: uid },
        });
      if (url.pathname === "/auth/v1/logout") return json({});
      if (url.pathname.includes("/client_products")) {
        const clientId = url.searchParams.get("client_id")?.slice(3),
          id = url.searchParams.get("id");
        if (req.method() === "POST") {
          const row = { ...body, created_at: new Date().toISOString() };
          products.push(row);
          return json([row]);
        }
        if (req.method() === "PATCH") {
          const found = products.find(
            (r) => r.client_id === clientId && id === "eq." + r.id,
          );
          Object.assign(found, body);
          return json([found]);
        }
        if (req.method() === "DELETE") {
          const removed = products.filter(
            (r) => r.client_id === clientId && id.includes(r.id),
          );
          products = products.filter((r) => !removed.includes(r));
          return json(removed.map((r) => ({ id: r.id })));
        }
        return json(products.filter((r) => r.client_id === clientId));
      }
      if (url.pathname.includes("/team_resources")) return json([]);

      if (url.pathname.includes("premeeting_responses")) return json([]);
      if (url.pathname.endsWith("/rpc/panel_access"))
        return json({
          role,
          profile_enabled: true,
          profile_complete: true,
          needs_password: false,
          email: "test@example.invalid",
          profile: {
            first_name: "Consultor",
            last_name: "De ejemplo",
            phone: "000000000",
          },
        });
      if (url.pathname.includes("contact_requests"))
        return req.method() === "HEAD"
          ? route.fulfill({
              status: 200,
              headers: {
                "Content-Range": "*/0",
                "Access-Control-Expose-Headers": "Content-Range",
              },
            })
          : json([]);
      if (url.pathname.endsWith("/rpc/get_unit_statistics")) {
        return json({
          month: body.p_month,
          last_day: 29,
          undated_own: 1,
          incomplete_global: 1,
          incomplete_team: 0,
          scopes: {
            own: {
              units: 100,
              own_units: 100,
              own_euros: 250,
              team_units: 0,
              team_euros: 0,
              pending: 0,
            },
            team: {
              units: 100,
              own_units: 0,
              own_euros: 0,
              team_units: 100,
              team_euros: 150,
              pending: 0,
            },
            global: {
              units: 100,
              own_units: 100,
              own_euros: 200,
              team_units: 200,
              team_euros: 200,
              pending: 0,
            },
          },
          days: {
            own: [{ day: 29, units: 100, euros: 250 }],
            global: [{ day: 29, units: 100, euros: 400 }],
          },
          people: [
            {
              user_id: uid,
              name: "Consultor de ejemplo",
              own_units: 100,
              own_euros: 200,
              team_units: 100,
              team_euros: 150,
              pending: 0,
            },
          ],
        });
      }
      if (url.pathname.endsWith("/rpc/get_my_team_profile"))
        return json({
          user_id: uid,
          is_root: true,
          position_code: "team_manager",
          position: "Gestor de Equipo",
          multiplier: 3.5,
          manager_id: null,
        });
      if (url.pathname.endsWith("/rpc/get_career_progress"))
        return json({
          user_id: uid,
          counts: {},
          units_available: true,
          production: { quarter: 25, historical: 100, totalQuarter: 125, incomplete: 0 },
        });
      if (url.pathname.endsWith("/rpc/get_team_directory"))
        return json([
          {
            user_id: uid,
            is_root: true,
            first_name: "Consultor",
            last_name: "De ejemplo",
            position: "Gestor de Equipo",
            position_code: "team_manager",
            multiplier: 3.5,
            manager_id: null,
          },
        ]);
      if (url.pathname.endsWith("/rpc/get_team_client_counts"))
        return json({
          total: clients.length,
          consultants_with_clients: clients.length ? 1 : 0,
          by_consultant: [{ user_id: uid, clients: clients.length, interested: 0 }],
        });
      if (url.pathname.endsWith("/rpc/search_my_clients")) {
        if (delayNextList) {
          const delay = delayNextList;
          delayNextList = 0;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        const q = parser.normalize(body.p_search),
          f = body.p_filters || {};
        const all = clients.map((row) => {
          const contracts = products.filter((p) => p.client_id === row.id);
          return {
            ...row,
            companies: [...new Set(contracts.map((p) => p.company))],
            products: [...new Set(contracts.map((p) => p.product))],
            product_count: contracts.length,
            total_units: contracts.reduce((sum, p) => sum + Number(p.units || 0), 0),
            pending_units: contracts.filter((p) => p.units == null).length,
          };
        });
        const matches = all.filter(
          (row) =>
            parser.normalize(Object.values(row).join(" ")).includes(q) &&
            (!f.company ||
              products.some(
                (p) =>
                  p.client_id === row.id &&
                  p.company === f.company &&
                  (!f.product || p.product === f.product),
              )) &&
            (!f.product ||
              products.some(
                (p) =>
                  p.client_id === row.id &&
                  p.product === f.product &&
                  (!f.company || p.company === f.company),
              )) &&
            (f.min_products == null || row.product_count >= f.min_products) &&
            (f.max_products == null || row.product_count <= f.max_products) &&
            (f.min_units == null || row.total_units >= f.min_units) &&
            (f.max_units == null || row.total_units <= f.max_units),
        );
        return json({
          rows: matches.slice(body.p_page * 25, (body.p_page + 1) * 25),
          total: matches.length,
          stats: {
            clients: clients.length,
            localities: new Set(clients.map((r) => r.locality)).size,
            interested: 0,
          },
          options: {
            companies: [...new Set(products.map((p) => p.company))],
            products: products.map((p) => ({ company: p.company, product: p.product })),
          },
        });
      }
      if (url.pathname.endsWith("/rpc/import_my_clients")) {
        const seen = new Set(clients.map(parser.identity));
        let added = 0,
          duplicates = 0;
        for (const row of body.p_rows) {
          if (seen.has(parser.identity(row))) {
            duplicates++;
            continue;
          }
          seen.add(parser.identity(row));
          added++;
          if (!body.p_preview) {
            writes++;
            clients.push({
              ...row,
              id: "44444444-4444-4444-8444-" + String(writes).padStart(12, "0"),
            });
          }
        }
        if (body.p_preview) previewCalls++;
        return json({
          received: body.p_rows.length,
          added,
          duplicates,
          invalid: 0,
          preview: body.p_preview,
        });
      }
      if (url.pathname.endsWith("/rpc/trash_my_clients")) {
        const removed = clients.filter((row) => body.p_ids.includes(row.id));
        trash.push(
          ...removed.map((row) => ({
            ...row,
            deleted_at: new Date().toISOString(),
            purge_at: new Date(Date.now() + 10 * 86400000).toISOString(),
            recoverable: true,
          })),
        );
        clients = clients.filter((row) => !body.p_ids.includes(row.id));
        return json(removed.length);
      }
      if (url.pathname.endsWith("/rpc/list_deleted_clients"))
        return json({
          admin: role === "admin",
          rows: trash.slice(body.p_page * 25, body.p_page * 25 + 25),
          total: trash.length,
        });
      if (url.pathname.endsWith("/rpc/restore_deleted_client")) {
        clients.push(...trash.filter((row) => row.id === body.p_id));
        trash = trash.filter((row) => row.id !== body.p_id);
        return json(null);
      }
      if (url.pathname.endsWith("/rpc/purge_deleted_client")) {
        assert.equal(role, "admin");
        trash = trash.filter((row) => row.id !== body.p_id);
        return json(null);
      }
      throw Error(
        "Petición no prevista en la prueba: " + req.method() + " " + url.pathname,
      );
    });
    async function login() {
      await page.goto(base + "/panel/");
      await page.locator('#login-form [name="email"]').fill("test@example.invalid");
      await page.locator('#login-form [name="password"]').fill("contraseña de prueba");
      await page.locator("#login-button").click();
      await page.locator("#panel-screen").waitFor();
    }
    await login();
    await page.locator('#panel-navigation [data-view="clients"]').click();
    await page.locator("#clients-empty").waitFor();
    await page.locator("#clients-demo-toggle").click();
    await page.locator("#clients-demo-banner").waitFor();
    assert.equal(await page.locator("#clients-list tr").count(), 3);
    assert.equal(clients.length, 0);
    assert.equal(writes, 0);
    assert.deepEqual(
      await page
        .locator("#clients-list tr")
        .evaluateAll((rows) => rows.map((row) => row.dataset.category)),
      ["client", "client", "interested"],
    );
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1050 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
          "La cartera debe ajustarse a la pantalla",
        );
      }
      if (width === 320 && process.env.CLIENTS_MOBILE_SCREENSHOT)
        await page.screenshot({
          path: process.env.CLIENTS_MOBILE_SCREENSHOT,
          fullPage: true,
        });
    }
    if (process.env.CLIENTS_SCREENSHOT)
      await page.screenshot({ path: process.env.CLIENTS_SCREENSHOT, fullPage: true });
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const open = page.locator("#clients-list .client-action button").first();
      const target = page.locator("#clients-list .client-identity").first();
      await target.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => window.scrollY);
      await target.click();
      assert.ok(
        Math.abs((await page.evaluate(() => window.scrollY)) - before) < 2,
        "Abrir la ficha no debe desplazar la página",
      );
      assert.equal(await page.locator("#client-detail-fields .client-field").count(), 6);
      assert.equal(await page.locator("#client-detail-demo").isVisible(), true);
      assert.equal(
        await page
          .locator("#client-detail-dialog")
          .evaluate((d) => d.scrollWidth <= d.clientWidth),
        true,
      );
      await page.locator('[data-client-tab="contact"]').click();
      assert.equal(await page.locator("#client-detail-fields").isVisible(), true);
      assert.equal(await page.locator("#client-products-section").isVisible(), false);
      await page.locator('[data-client-tab="products"]').click();
      await page.locator("#client-detail-name").click();
      assert.equal(
        await page.locator("#client-detail-dialog").evaluate((d) => d.open),
        true,
        "Pulsar dentro no debe cerrar la ficha",
      );
      await page.mouse.click(2, 2);
      await page.waitForFunction(
        () => !document.querySelector("#client-detail-dialog").open,
      );
      assert.ok(
        Math.abs((await page.evaluate(() => window.scrollY)) - before) < 2,
        "Cerrar la ficha debe conservar la posición",
      );
    }
    const selectClient = page.locator("#clients-list input[type=checkbox]").first();
    await selectClient.check();
    assert.equal(
      await page.locator("#client-detail-dialog").evaluate((d) => d.open),
      false,
      "La selección masiva no abre la ficha",
    );
    await selectClient.uncheck();
    for (const selector of [".client-contact", ".client-locality", ".client-state"]) {
      await page
        .locator("#clients-list " + selector)
        .first()
        .click();
      await page.locator("#client-detail-dialog").waitFor();
      await page.locator("#client-detail-close").click();
    }
    await page.locator("#clients-list .client-action button").first().focus();
    await page.keyboard.press("Enter");
    await page.locator("#client-detail-dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("#clients-demo-toggle").click();
    await page.locator("#clients-empty").waitFor();
    const upload = () =>
      page.locator("#clients-file").setInputFiles({
        name: "informe-ficticio.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: excel,
      });
    await upload();
    await page.locator("#clients-preview").waitFor();
    assert.equal(await page.locator("#clients-preview-new").textContent(), "2");
    assert.equal(await page.locator("#clients-preview-duplicates").textContent(), "1");
    assert.equal(await page.locator("#clients-preview-invalid").textContent(), "1");
    assert.equal(writes, 0, "La vista previa no guarda nada");
    await page.locator("#clients-cancel-import").click();
    assert.equal(clients.length, 0);
    await upload();
    await page.locator("#clients-preview").waitFor();
    await page.locator("#clients-confirm-import").click();
    await page.waitForFunction(
      () => document.querySelector("#clients-count").textContent === "2",
    );
    assert.equal(clients.length, 2);
    assert.equal(Object.keys(clients[0]).length, 13);
    assert.equal(JSON.stringify(clients).includes("NO CONSERVAR"), false);
    await upload();
    await page.locator("#clients-preview").waitFor();
    assert.equal(await page.locator("#clients-preview-new").textContent(), "0");
    assert.equal(await page.locator("#clients-preview-duplicates").textContent(), "3");
    assert.equal(await page.locator("#clients-confirm-import").isDisabled(), true);
    await page.locator("#clients-cancel-import").click();
    assert.equal(writes, 2);
    await page.locator("#clients-list .client-action button").first().click();
    await page.getByRole("button", { name: "+ Añadir producto", exact: true }).click();
    const contract = page.locator(".contract-editor");
    async function choose(name, value) {
      const radio = contract.locator(`input[name="${name}"][value="${value}"]`);
      if (!(await radio.isVisible()))
        await contract
          .locator(`.product-picker-group[data-choice="${name}"] .product-change`)
          .click();
      await radio.check();
    }

    assert.equal(await contract.locator(".product-conditions").isVisible(), false);
    await choose("company", "AXA");
    assert.equal(
      await contract.locator('input[name=product][value="PIAS Proyecto Futuro"]').count(),
      1,
    );
    await choose("product", "PIAS Proyecto Futuro");
    await contract.locator('input[name=portfolio][value="Equilibrada+"]').check();
    await choose("company", "Intesa Sanpaolo Assicurazioni");
    assert.equal(
      await contract.locator('input[name=product][value="PIAS Proyecto Futuro"]').count(),
      0,
    );
    assert.equal(await contract.locator("input[name=product]:checked").count(), 0);
    assert.equal(await contract.locator(".product-conditions").isVisible(), false);
    await choose("product", "__manual__");
    await contract.locator("[name=manual_product]").fill("Producto de ejemplo");
    await choose("company", "AXA");
    assert.equal(await contract.locator("input[name=product]:checked").count(), 0);
    await choose("product", "PIAS Proyecto Futuro");
    assert.equal(
      await contract.locator("input[name=portfolio]:checked").inputValue(),
      "",
    );
    await contract.locator('input[name=portfolio][value="Equilibrada+"]').check();
    for (const theme of ["dark", "light"]) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert(
          await page
            .locator("#client-detail-dialog")
            .evaluate((d) => d.scrollWidth <= d.clientWidth),
          "Selector de productos responsive",
        );
      }
    }
    await contract
      .locator(".product-picker")
      .screenshot({ path: path.join(process.env.TEMP, "product-picker.png") });
    assert.equal(await contract.locator(".product-company-options").isVisible(), false);
    assert.equal(await contract.locator(".product-product-options").isVisible(), false);
    assert(
      (await contract.locator(".product-picker").boundingBox()).height < 420,
      "Selección compacta tras elegir compañía y producto",
    );
    await contract.locator("[name=amount]").fill("50");
    await contract.locator("[name=units]").fill("2.5");
    await contract.locator("[name=signed_on]").fill("2024-02-29");
    await contract.locator("[name=signed_multiplier]").selectOption("2.5");
    await contract.locator(".contract-signature input[type=checkbox]").check();
    await contract.getByRole("button", { name: "Guardar producto", exact: true }).click();
    await page.locator(".contract-card").waitFor();
    assert.equal(products.length, 1);
    assert.equal(products[0].portfolio, "Equilibrada+");
    assert.equal(products[0].product, "PIAS Proyecto Futuro");
    assert.equal(products[0].signed_on, "2024-02-29");
    assert.equal(products[0].signed_multiplier, 2.5);
    await page
      .locator(".contract-card")
      .getByRole("button", { name: "Editar", exact: true })
      .click();
    assert.equal(
      await contract.locator("input[name=product]:checked").inputValue(),
      "PIAS Proyecto Futuro",
    );
    assert.equal(
      await contract.locator("input[name=portfolio]:checked").inputValue(),
      "Equilibrada+",
    );
    await choose("product", "__manual__");
    await contract
      .locator("[name=manual_product]")
      .fill("Producto anterior personalizado");
    await contract.locator('input[name=portfolio][value="__manual__"]').check();
    await contract
      .locator("[name=manual_portfolio]")
      .fill("Cartera anterior personalizada");
    await contract.locator("[name=payment_type]").selectOption("single");
    await contract.locator("[name=amount]").fill("1000");
    await contract.locator("[name=units]").fill("");
    await contract.locator(".contract-signature input[type=checkbox]").check();
    await contract.getByRole("button", { name: "Guardar producto", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector(".contract-card").textContent.includes("Aportación única"),
    );
    assert.equal(products[0].payment_type, "single");
    assert.equal(products[0].units, null);
    assert.equal(products[0].product, "Producto anterior personalizado");
    assert.equal(products[0].portfolio, "Cartera anterior personalizada");
    await page
      .locator(".contract-card")
      .getByRole("button", { name: "Editar", exact: true })
      .click();
    assert.equal(
      await contract.locator("[name=manual_product]").inputValue(),
      "Producto anterior personalizado",
    );
    assert.equal(
      await contract.locator("[name=manual_portfolio]").inputValue(),
      "Cartera anterior personalizada",
    );
    await contract.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(await page.locator(".contract-list").isVisible(), true);
    await page.getByRole("button", { name: "+ Añadir producto", exact: true }).click();
    await contract.waitFor();
    assert.equal(await page.locator(".contract-list").isVisible(), false);
    await choose("company", "Intesa Sanpaolo Assicurazioni");
    await choose("product", "__manual__");
    await contract.locator("[name=manual_product]").fill("Segundo producto");
    await contract.locator("[name=amount]").fill("30");
    await contract.getByRole("button", { name: "Guardar producto", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".contract-card").length === 2,
    );
    assert.equal(
      await page
        .locator("#clients-list tr")
        .first()
        .locator(".client-company-mark")
        .count(),
      2,
    );
    await page.getByRole("button", { name: "+ Añadir producto", exact: true }).click();
    await contract.waitFor();
    assert.equal(await page.locator(".contract-card").count(), 2);
    assert.equal(
      await page.locator(".contract-list").isVisible(),
      false,
      "Los productos existentes quedan ocultos durante el alta",
    );
    assert.equal(await page.locator(".contract-metrics").isVisible(), false);
    await contract.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(await page.locator(".contract-list").isVisible(), true);
    await page.locator("#client-detail-close").click();
    assert.equal(
      await page
        .locator("#clients-list tr")
        .first()
        .locator(".client-company-mark[data-company=axa]")
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator("#clients-list tr")
        .first()
        .locator(".client-company-mark[data-company=intesa]")
        .count(),
      1,
    );
    await page.locator("#clients-list .client-action button").first().click();
    await page.waitForFunction(
      () => document.querySelectorAll(".contract-card").length === 2,
    );

    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page
          .locator("#client-detail-dialog")
          .evaluate((d) => d.scrollWidth <= d.clientWidth),
        "Ficha productos responsive",
      );
    }
    for (const theme of ["dark", "light"]) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert(
          await page
            .locator("#client-detail-dialog")
            .evaluate((d) => d.scrollWidth <= d.clientWidth),
          "Nueva ficha responsive",
        );
        await page.locator("#client-detail-dialog").screenshot({
          path: path.join(process.env.TEMP, `client-file-${theme}-${width}.png`),
        });
      }
    }
    assert.equal(await page.locator(".contract-company").count(), 2);
    assert.equal(
      await page.locator(".contract-company-heading h4").first().textContent(),
      "AXA",
    );
    await page.screenshot({
      path: path.join(process.env.TEMP, "client-products.png"),
      fullPage: true,
    });
    await page.locator(".contract-card input[type=checkbox]").first().check();
    await page.locator(".contract-bulk input[type=checkbox]").check();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Eliminar seleccionados", exact: true })
      .last()
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".contract-card").length === 0,
    );
    assert.equal(products.length, 0);
    assert.equal(
      await page.locator("#clients-list .client-company-mark").count(),
      0,
      "Eliminar productos actualiza las referencias de compañías",
    );
    await page.locator("#client-detail-close").click();
    assert.equal(await page.locator("#client-products-section").textContent(), "");

    await page.locator('#panel-navigation [data-view="statistics"]').click();
    await page.locator(".stats-heading").waitFor();
    await page.locator(".stats-heading input").fill("2024-02");
    await page.locator(".stats-heading input").dispatchEvent("change");
    await page.locator(".stats-heading").waitFor();
    assert.equal(await page.locator(".stats-bars>div").count(), 29);
    await page.getByRole("button", { name: "Equipo completo", exact: true }).click();
    assert.match(await page.locator(".stats-metrics").textContent(), /400/);
    assert.equal(await page.locator(".stats-person").count(), 1);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert(
          await page
            .locator("#statistics-view")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
          "Statistics responsive",
        );
        if (width === 1440)
          await page.screenshot({
            path: path.join(process.env.TEMP, "statistics-" + theme + ".png"),
            fullPage: true,
          });
      }
    }
    await page.locator('#panel-navigation [data-view="clients"]').click();
    assert.equal(await page.locator("#clients-filter-panel").isVisible(), false);
    for (const view of ["cards", "compact", "list"]) {
      await page.locator(`[data-client-view="${view}"]`).click();
      await page.waitForFunction(
        (v) => document.querySelector("#clients-table-wrap").dataset.view === v,
        view,
      );
      await page.waitForFunction(() =>
        document.querySelector("#clients-view-status").textContent.includes("guardada"),
      );
      assert.equal(preferredView, view);
      for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert(
          await page
            .locator("#clients-view")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
          "Vistas de cartera responsive",
        );
        if (width === 1440)
          await page.screenshot({
            path: path.join(process.env.TEMP, `clients-workspace-${view}.png`),
            fullPage: true,
          });
      }
    }
    await page.locator('[data-client-view="cards"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#clients-view-status").textContent.includes("guardada"),
    );
    await login();
    await page.locator('#panel-navigation [data-view="clients"]').click();
    await page.waitForFunction(
      () => document.querySelector("#clients-table-wrap").dataset.view === "cards",
    );
    assert.equal(
      preferredView,
      "cards",
      "La vista se recupera al volver a iniciar sesión",
    );
    await page.locator('[data-client-view="list"]').click();
    await page.locator("#clients-filter-toggle").click();
    assert.equal(await page.locator("#clients-filter-panel").isVisible(), true);
    await page.locator("#clients-filter-panel [name=min_products]").fill("1");
    await page.locator("#clients-filter-panel button[type=submit]").click();
    await page.waitForFunction(
      () => document.querySelectorAll("#clients-list tr").length === 0,
    );
    await page.locator("#clients-filter-clear").click();
    await page.waitForFunction(
      () => document.querySelectorAll("#clients-list tr").length === 2,
    );
    await page.locator("#clients-filter-toggle").click();
    await page.locator("#clients-search").fill("Bruno");
    await page.waitForFunction(
      () =>
        document.querySelector("#clients-list").textContent.includes("Bruno") &&
        document.querySelectorAll("#clients-list tr").length === 1,
    );
    await page.locator("#clients-search").fill("");
    await page.waitForFunction(
      () => document.querySelectorAll("#clients-list tr").length === 2,
    );
    await page.locator('#panel-navigation [data-view="team"]').click();
    await page.locator(".team-node-self").waitFor();
    assert.equal(await page.locator("#team-view .team-node-client-count").count(), 0);
    assert.equal(await page.locator(".team-clients-summary").count(), 0);
    await page.locator(".team-node-self").click();
    assert.equal(await page.locator("#team-member-clients").textContent(), "2");
    assert.equal(await page.locator("#team-member-interested").textContent(), "0");
    await page.waitForFunction(() =>
      document
        .querySelector("#team-member-progress")
        .textContent.includes("125 U registradas"),
    );
    await page.locator("#team-member-close").click();
    assert.equal(
      await page
        .locator("#team-view")
        .textContent()
        .then((text) => text.includes("ana@example.invalid")),
      false,
      "El árbol no recibe datos personales de clientes",
    );
    await page.locator('#panel-navigation [data-view="clients"]').click();
    await page.locator("#clients-list tr").first().waitFor();
    assert.equal(await page.locator("#clients-bulk").isVisible(), false);
    await page.locator("#clients-list input[type=checkbox]").first().check();
    await page.locator("#clients-select-all").check();
    page.once("dialog", (d) => d.accept());
    await page.locator("#clients-delete-selected").click();
    await page.locator("#clients-empty").waitFor();
    assert.equal(clients.length, 0);
    await page.locator("#clients-trash-open").click();
    await page.locator(".trash-client").first().waitFor();
    assert.equal(await page.locator(".trash-client").count(), 2);
    assert.equal(
      await page
        .locator("#clients-trash-dialog")
        .textContent()
        .then((t) => t.includes("10 días")),
      true,
    );
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      for (const width of [320,1440]) {
        await page.setViewportSize({width,height:1000});
        assert.equal(await page.locator('#clients-trash-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Eliminados sin desbordamiento horizontal');
        await page.screenshot({path:require('os').tmpdir()+`/clients-trash-${theme}-${width}.png`});
      }
    }
    await page
      .getByRole("button", { name: "Recuperar cliente", exact: true })
      .first()
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".trash-client").length === 1,
    );
    assert.equal(clients.length, 1);
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Eliminar definitivamente", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".trash-client").length === 0,
    );
    await page.locator("#clients-trash-close").click();
    await page.locator("#clients-list input[type=checkbox]").first().check();
    page.once("dialog", (d) => d.accept());
    await page.locator("#clients-delete-selected").click();
    await page.locator("#clients-empty").waitFor();
    role = "consultant";
    await page.locator("#clients-trash-open").click();
    await page.locator(".trash-client").first().waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Eliminar definitivamente", exact: true })
        .count(),
      0,
    );
    await page.locator("#clients-trash-close").click();
    role = "admin";
    await page.locator("#clients-demo-toggle").click();
    await page.locator("#clients-demo-banner").waitFor();
    await page.evaluate(() => window.PortfolioBackend.invalidateCache());
    delayNextList = 600;
    await upload();
    role = "consultant";
    await page.locator("#logout-button").click();
    await page.locator('#login-form [name="email"]').fill("another@example.invalid");
    await page.locator('#login-form [name="password"]').fill("contraseña de prueba");
    await page.locator("#login-button").click();
    await page.locator("#panel-screen").waitFor();
    await page.locator('#panel-navigation [data-view="clients"]').click();
    await page.locator("#clients-empty").waitFor();
    await page.waitForTimeout(850);
    assert.equal(
      previewCalls,
      3,
      "Un archivo de la sesión anterior no debe procesarse en la cuenta nueva",
    );
    assert.equal(await page.locator("#clients-preview").isVisible(), false);
    assert.equal(
      await page.locator('#panel-navigation [data-view="requests"]').isVisible(),
      false,
    );
    await page.locator("#clients-demo-toggle").click();
    await page.locator("#clients-demo-banner").waitFor();
    await page.locator("#clients-list .client-action button").first().click();
    await page.locator("#client-detail-close").click();
    await page.locator("#logout-button").click();
    assert.equal(await page.locator("#clients-list tr").count(), 0);
    assert.equal(await page.locator("#client-detail-fields").textContent(), "");
    assert.equal(await page.evaluate(() => localStorage.getItem("clients")), null);
    assert.equal(previewCalls, 3);
    assert.deepEqual(errors, []);
    console.log(
      "Cartera: ejemplo separado, importación con vista previa, duplicados, columnas limitadas, búsqueda, resumen sin datos, eliminación, acceso consultor y limpieza al salir comprobados.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
