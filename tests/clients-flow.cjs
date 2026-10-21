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
  let delayNextList = 0;
  let clients = [],
    writes = 0,
    previewCalls = 0,
    role = "admin";
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
      if (url.pathname === "/auth/v1/token")
        return json({
          access_token: "test-access",
          refresh_token: "test-refresh",
          expires_in: 3600,
          user: { id: uid },
        });
      if (url.pathname === "/auth/v1/logout") return json({});
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
      if (url.pathname.endsWith("/rpc/get_my_team_profile"))
        return json({
          user_id: uid,
          is_root: true,
          position_code: "team_manager",
          position: "Gestor de Equipo",
          multiplier: 3.5,
          manager_id: null,
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
      if (url.pathname.endsWith("/rpc/list_my_clients")) {
        if (delayNextList) {
          const delay = delayNextList;
          delayNextList = 0;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        const q = parser.normalize(body.p_search);
        const matches = clients
          .filter((row) => parser.normalize(Object.values(row).join(" ")).includes(q))
          .sort(
            (a, b) =>
              (parser.normalize(a.client_type) === "cliente" ? 0 : 1) -
              (parser.normalize(b.client_type) === "cliente" ? 0 : 1),
          );
        return json({
          rows: matches.slice(body.p_page * 25, (body.p_page + 1) * 25),
          total: matches.length,
          stats: {
            clients: clients.length,
            localities: new Set(clients.map((row) => row.locality)).size,
            interested: 0,
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
      if (url.pathname.includes("/portfolio_clients") && req.method() === "DELETE") {
        const selected = url.searchParams.get("id");
        const removed = clients.filter((row) => selected.includes(row.id));
        clients = clients.filter((row) => !selected.includes(row.id));
        return json(removed.map((row) => ({ id: row.id })));
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
      await open.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => window.scrollY);
      await open.click();
      assert.ok(
        Math.abs((await page.evaluate(() => window.scrollY)) - before) < 2,
        "Abrir la ficha no debe desplazar la página",
      );
      assert.equal(await page.locator("#client-detail-fields .client-field").count(), 12);
      assert.equal(await page.locator("#client-detail-demo").isVisible(), true);
      assert.equal(
        await page
          .locator("#client-detail-dialog")
          .evaluate((d) => d.scrollWidth <= d.clientWidth),
        true,
      );
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
    await page.locator("#clients-select-all").check();
    page.once("dialog", (d) => d.accept());
    await page.locator("#clients-delete-selected").click();
    await page.locator("#clients-empty").waitFor();
    assert.equal(clients.length, 0);
    await page.locator("#clients-demo-toggle").click();
    await page.locator("#clients-demo-banner").waitFor();
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
