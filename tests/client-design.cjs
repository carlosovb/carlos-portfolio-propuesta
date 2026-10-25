// Comparación del diseño elegido y regresión de la ficha lateral con datos ficticios.
const { chromium, webkit, devices } = require("playwright");
const { server, mock, state, login } = require("./profile-flow.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.TEMP;
const company = "Intesa Sanpaolo Assicurazioni";
const clients = [
  ["Ana", "García", ["AXA", company], 420, 2],
  ["Daniel", "Suárez", ["AXA"], 150, 1],
  ["Lucía", "Martín", [company], 320, 1],
  ["Marta", "Pérez", ["AXA"], 180, 1],
  ["Pablo", "León", [], 0, 0],
  ["Elena", "Díaz", [], 0, 0],
].map((r, i) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`,
  first_name: r[0],
  last_name: r[1],
  companies: r[2],
  total_units: r[3],
  product_count: r[4],
  client_type: i < 4 ? "Cliente" : "Interesado",
  category: i < 4 ? "client" : "interested",
  is_active: true,
  phone: "600 000 101",
  email: r[0].toLowerCase() + "@example.invalid",
  locality: "Las Palmas",
  postal_code: "35001",
}));
const contracts = [
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
    company: "AXA",
    product: "PIAS Proyecto Futuro",
    portfolio: "Global+",
    payment_type: "monthly",
    amount: 100,
    units: 280,
    signed_on: "2026-10-24",
    signed_multiplier: 2,
    created_at: "2026-10-24T10:00:00Z",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
    company,
    product: "Producto contratado",
    portfolio: "Cartera de ejemplo",
    payment_type: "monthly",
    amount: 50,
    units: 140,
    signed_on: "2026-10-24",
    signed_multiplier: 2,
    created_at: "2026-10-24T10:00:00Z",
  },
];
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const safari = process.env.MOBILE_BROWSER === "webkit";
  const browser = await (safari ? webkit : chromium).launch({
    headless: true,
    ...(!safari && { executablePath: process.env.CHROME_EXECUTABLE }),
  });
  const base = `http://127.0.0.1:${server.address().port}/`;
  const prefix = safari ? "client-design-webkit" : "client-design";
  try {
    const context = await browser.newContext({
      ...(safari ? devices["iPhone 13"] : {}),
      viewport: { width: 1487, height: 1058 },
      reducedMotion: "reduce",
      hasTouch: true,
    });
    const data = state();
    data.profile = { first_name: "Carlos", last_name: "Caballero", phone: "000000000" };
    data.insights = {
      events: [
        {
          id: "activity-example",
          kind: "product.updated",
          title: "Producto actualizado",
          target_id: clients[0].id,
          happened_at: "2026-10-24T10:00:00Z",
        },
      ],
      notices: [],
    };
    await mock(context, data);
    await context.route("**/rpc/get_client_view_preference", (r) =>
      r.fulfill({ contentType: "application/json", body: '"cards"' }),
    );
    await context.route("**/rpc/search_my_clients", (r) =>
      r.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          rows: clients,
          total: clients.length,
          stats: { clients: 4, interested: 2, localities: 1 },
          options: {
            companies: ["AXA", company],
            products: [{ company: "AXA", product: "PIAS Proyecto Futuro" }],
          },
        }),
      }),
    );
    await context.route("**/client_products?**", (r) =>
      r.fulfill({
        contentType: "application/json",
        body: JSON.stringify(r.request().url().includes(clients[0].id) ? contracts : []),
      }),
    );
    await context.route("**/rpc/get_client_pias_budget", (r) =>
      r.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ reserved: 1200, remaining: 6800 }),
      }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page, base);
    await page.evaluate(() => window.PanelNavigation.go("clients"));
    await page.locator("#clients-list tr").first().waitFor();
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await page.locator("#clients-list .client-identity").first().click();
    await page.locator(".contract-company").first().waitFor();
    await page.locator(".contract-card > button").first().click();
    await page.locator(".contract-editor [name=amount]").waitFor();
    await page.locator("#clients-list .client-identity").first().click();
    assert.equal(
      await page.locator(".contract-editor [name=amount]").inputValue(),
      "100",
    );
    await page.locator("#clients-list .client-identity").nth(1).click();
    await page.locator("#site-confirm-dialog").waitFor();
    await page.locator("[data-confirm-no]").click();
    assert.match(await page.locator("#client-detail-name").textContent(), /Ana/);
    await page.locator("#clients-list .client-identity").nth(1).click();
    await page.locator("#site-confirm-dialog").waitFor();
    await page.locator("[data-confirm-yes]").click();
    await page.waitForFunction(() =>
      document.querySelector("#client-detail-name").textContent.includes("Daniel"),
    );
    await page.locator("#clients-list .client-identity").first().click();
    await page.locator(".contract-company").first().waitFor();
    assert(
      await page
        .locator("#client-detail-dialog")
        .evaluate((d) => d.open && !d.matches(":modal")),
      "Ficha lateral en ordenador",
    );
    assert.equal(
      await page.locator("#client-detail-slot #client-detail-dialog").count(),
      1,
    );
    assert.equal(await page.locator('#clients-list tr[data-current="true"]').count(), 1);
    assert.match(await page.locator(".contract-metrics").textContent(), /420 U/);
    const cardBounds = await page
      .locator('#clients-list tr[data-category="client"]')
      .first()
      .boundingBox();
    const interestedBounds = await page
      .locator('#clients-list tr[data-category="interested"]')
      .first()
      .boundingBox();
    assert(
      cardBounds.height >= 240 && cardBounds.height <= 285,
      "Tarjeta con la densidad de la referencia",
    );
    assert(interestedBounds.height < 95, "Interesados en filas compactas");
    const metricsBounds = await page.locator(".contract-metrics").boundingBox();
    const productHeadingBounds = await page
      .locator(".client-products-heading")
      .boundingBox();
    assert(
      metricsBounds.y < productHeadingBounds.y,
      "Cifras antes del listado de productos",
    );
    assert(
      await page.locator(".client-close-label").isVisible(),
      "Cierre textual de la ficha lateral",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(dir, prefix + "-desktop.png") });
    await page.locator("#clients-list .client-identity").nth(1).click();
    assert.match(await page.locator("#client-detail-name").textContent(), /Daniel/);
    await page.locator("#clients-list .client-identity").first().click();
    await page.locator(".contract-company").first().waitFor();
    await page.locator('[data-client-tab="contact"]').click();
    assert(await page.locator("#client-detail-fields").isVisible());
    await page.locator('[data-client-tab="products"]').click();
    for (const width of [1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => {
        const dialog = document.querySelector("#client-detail-dialog");
        return dialog.open && dialog.matches(":modal");
      });
      assert(
        await page
          .locator("#client-detail-dialog")
          .evaluate((d) => d.open && d.matches(":modal")),
        "Ficha modal en móvil/tableta",
      );
      assert(
        await page
          .locator("#client-detail-dialog")
          .evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
        "Ficha sin desbordamientos",
      );
      await page.screenshot({ path: path.join(dir, `${prefix}-file-${width}.png`) });
    }
    await page.setViewportSize({ width: 1487, height: 1058 });
    await page.waitForFunction(() => {
      const dialog = document.querySelector("#client-detail-dialog");
      return dialog.open && !dialog.matches(":modal");
    });
    assert(
      await page
        .locator("#client-detail-dialog")
        .evaluate((d) => d.open && !d.matches(":modal")),
    );
    await page.locator("#client-detail-close").click();
    await page.locator("#client-detail-dialog").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.querySelector("#client-detail-name").textContent === "",
    );
    assert.equal(await page.locator("#client-detail-contact").textContent(), "");
    for (const width of [1487, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ["dark", "light"]) {
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `Sin desbordamiento en ${width}px, tema ${theme}: ${await page.evaluate(() =>
            [...document.querySelectorAll("body *")]
              .filter(
                (e) =>
                  e.getBoundingClientRect().right > innerWidth + 1 &&
                  e.getBoundingClientRect().width > 0,
              )
              .slice(0, 8)
              .map((e) => e.tagName + "." + e.className)
              .join(", "),
          )}`,
        );
        await page.screenshot({
          path: path.join(dir, `${prefix}-directory-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    assert.deepEqual(errors, []);
    const ref =
      process.env.CLIENT_DESIGN_REFERENCE ||
      path.join(
        require("node:os").homedir(),
        ".codex/generated_images/01a15a58-2596-7332-aa93-286a0314d77e/exec-d28a144d-7322-48c7-a4c6-a2bd2e8fcee2.png",
      );
    if (!safari && fs.existsSync(ref)) {
      const board = await context.newPage();
      await board.setViewportSize({ width: 2974, height: 1058 });
      await board.setContent(
        `<body style="margin:0;display:flex"><img width="1487" height="1058" src="data:image/png;base64,${fs.readFileSync(ref).toString("base64")}"><img width="1487" height="1058" src="data:image/png;base64,${fs.readFileSync(path.join(dir, prefix + "-desktop.png")).toString("base64")}"></body>`,
      );
      await board.screenshot({ path: path.join(dir, "client-design-comparison.png") });
      await board.setViewportSize({ width: 1400, height: 650 });
      await board.setContent(
        `<body style="margin:0;display:flex">${[ref, path.join(dir, prefix + "-desktop.png")].map((file) => `<div style="position:relative;width:700px;height:650px;overflow:hidden"><img style="position:absolute;left:-225px;top:-160px;width:1487px;height:1058px;max-width:none" src="data:image/png;base64,${fs.readFileSync(file).toString("base64")}"></div>`).join("")}</body>`,
      );
      await board.screenshot({ path: path.join(dir, "client-design-focus.png") });
      await board.setViewportSize({ width: 1240, height: 800 });
      await board.setContent(
        `<body style="margin:0;display:flex">${[ref, path.join(dir, prefix + "-desktop.png")].map((file, i) => `<div style="position:relative;width:620px;height:800px;overflow:hidden"><img style="position:absolute;left:-${i ? 868 : 860}px;top:-160px;width:1487px;height:1058px;max-width:none" src="data:image/png;base64,${fs.readFileSync(file).toString("base64")}"></div>`).join("")}</body>`,
      );
      await board.screenshot({ path: path.join(dir, "client-design-detail-focus.png") });
    }
    console.log(
      `${safari ? "WebKit" : "Chromium"}: ficha lateral/modal, cambio de cliente, productos, contacto, limpieza, cinco anchuras y ambos temas verificados.`,
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
