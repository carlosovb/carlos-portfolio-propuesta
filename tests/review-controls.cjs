const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { server, mock, state, login } = require("./profile-flow.cjs");

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE });
    const context = await browser.newContext();
    await mock(context, state());
    await context.route("**/rpc/get_client_pias_budget", (route) =>
      route.fulfill({ json: { reserved: 0, remaining: 8000 } }));
    const clientId = "11111111-1111-4111-8111-111111111111";
    await context.route("**/rpc/get_client_view_preference", (route) => route.fulfill({ json: "cards" }));
    await context.route("**/rpc/search_my_clients", (route) => route.fulfill({ json: {
      rows: [{
        id: clientId, first_name: "Ana", last_name: "Prueba", client_type: "Interesado",
        status: "Activo", locality: "Santa María de Guía", companies: [], products: [], product_count: 0,
      }],
      total: 1, stats: { clients: 0, interested: 1 },
    } }));
    const products = [];
    await context.route("**/rest/v1/client_products?*", (route) => {
      if (route.request().method() === "POST") {
        const row = route.request().postDataJSON();
        products.push(row);
        return route.fulfill({ json: [{ id: row.id }] });
      }
      return route.fulfill({ json: products });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await login(page, "http://127.0.0.1:" + server.address().port + "/");
    await page.evaluate(() => window.PanelNavigation.go("clients"));
    const row = page.locator("#clients-list tr[data-category=interested]");
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await row.hover();
      const checkbox = row.locator(".client-select-cell input");
      await checkbox.check();
      assert.equal(await checkbox.isChecked(), true);
      assert.equal(await page.locator("#client-detail-dialog").evaluate((e) => e.open), false);
      const circle = await checkbox.boundingBox();
      const card = await row.boundingBox();
      assert.equal(circle.width, circle.height);
      assert(Math.abs(circle.y + circle.height / 2 - card.y - card.height / 2) <= 1);
      await checkbox.uncheck();
    }
    await row.locator(".client-identity").click();
    await page.getByRole("button", { name: "+ Añadir producto", exact: true }).click();
    const form = page.locator(".contract-editor");
    await form.locator('input[name=company][value="AXA"]').check();
    await form.locator('input[name=product][value="Vida Protect"]').check();
    await form.locator("[name=amount]").fill("129.46");
    await form.locator("[name=units]").fill("120");
    await form.locator("[name=life_death]").fill("50000");
    await form.locator("[name=life_effective_on]").fill("2026-12-01");
    await form.locator("[name=signed_on]").fill("2026-11-06");
    await form.locator("[name=signed_multiplier]").selectOption("2");
    await form.getByText(/Cuota neta por recibo: 10,79/).waitFor();
    await form.getByText(/12 cuotas de 10 U.*1 ene 2027/).waitFor();
    await form.getByRole("button", { name: "Guardar producto", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".contract-editor"));
    assert.equal(products[0].portfolio, "");
    assert.equal(products[0].life_annual_net_premium, 129.46);
    assert.equal(products[0].amount, 10.79);
    await page.locator(".contract-summary").click();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    assert.equal(await form.locator("[name=amount]").inputValue(), "129.46");
    await form.getByRole("button", { name: "Abrir calendario: Fecha de firma", exact: true }).click();
    await form.getByRole("button", { name: "Cancelar", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "+ Añadir producto", exact: true }).click();
    assert.equal(await form.locator(".contract-calendar:visible").count(), 0);
    await form.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: "+ Añadir producto", exact: true }).click();
    await form.locator('input[name=company][value="AXA"]').check();
    await form.locator('input[name=product][value="PIAS Proyecto Futuro"]').check();
    await form.locator('input[name=portfolio][value="Dinámica+"]').check();
    await form.locator("[name=amount]").fill("50");
    await form.locator("[name=units]").fill("41");
    let confirmed = false;
    await context.route("**/rest/v1/client_products?*", (route) => {
      if (route.request().method() === "POST") {
        const row = route.request().postDataJSON();
        products.push(row);
        confirmed = true;
        return route.fulfill({ json: [{ id: row.id }] });
      }
      return confirmed ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: products });
    });
    await form.getByRole("button", { name: "Guardar producto", exact: true }).click();
    await page.getByText("El producto está guardado. Vuelve a abrir la ficha para actualizar el listado.", { exact: true }).waitFor();
    assert.equal(await form.count(), 0);
    assert.equal(products.length, 2);
    console.log("Selector sin interferencias, prima anual exacta al reeditar y calendario cerrado al cancelar comprobados.");
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
