// Datos ficticios, OCR real y API simulada: ninguna escritura en la base real.
const assert = require("node:assert/strict");
const { chromium, webkit } = require("playwright");
const { server, mock, state, login } = require("./profile-flow.cjs");
require("./capture-fixture.cjs")(server);
const parser = require("../js/product-capture-parser.js");
for (const [abbr, name] of [
  ["Con", "Conservadora+"],
  ["Mod", "Moderada+"],
  ["Equ", "Equilibrada+"],
  ["Din", "Dinámica+"],
  ["Res", "Responsable+"],
  ["Glo", "Global+"],
]) {
  assert.equal(parser.portfolio("PIASPFPerf" + abbr + " +, 4").name, name);
}
assert.equal(parser.portfolio("PIASPFPerfDesconocida +, 4"), null);
assert.equal(parser.portfolio("PIASPFPerfDin +, 4").confirmed, true);
assert.equal(parser.portfolio("PIASPFPerfMod +, 3").confirmed, false);
assert.equal(parser.number("40,8000"), 40.8);
assert.equal(parser.number("1.200,50"), 1200.5);
assert.equal(parser.number("0,00"), 0);
assert.equal(parser.samePerson("Prueba, Ana", "Ana Prueba"), true);
assert.equal(parser.samePerson("Prueba, Ana", "Otra Persona"), false);
// Si falta la etiqueta del neto, el importe bruto no absorbe la cifra vecina.
const word = (text, x0, y0, x1, y1) => ({ text, bbox: { x0, y0, x1, y1 } });
const missingNetLabel = parser.parse({
  text: "PIASPFPerfDin +, 4",
  words: [
    word("Compañía", 3, 100, 100, 118),
    word("Producto", 1200, 100, 1300, 118),
    word("Prima/Aportación bruta", 3, 200, 178, 218),
    word("Fracc.", 2410, 200, 2456, 218),
    word("50,00", 1142, 231, 1192, 249),
    word("0,00", 2357, 231, 2398, 249),
    word("Mensual", 2410, 231, 2485, 249),
  ],
});
assert.equal(missingNetLabel.draft.amount, 50);
assert.equal(missingNetLabel.draft.payment_type, "monthly");
const id = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const client = {
  id,
  first_name: "Ana",
  last_name: "Prueba",
  category: "client",
  client_type: "Cliente",
  is_active: true,
  companies: [],
  product_count: 0,
  total_units: 0,
  locality: "Las Palmas",
};
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const safari = process.env.MOBILE_BROWSER === "webkit";
  const browser = await (safari ? webkit : chromium).launch({
    headless: true,
    ...(!safari && { executablePath: process.env.CHROME_EXECUTABLE }),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 1000 },
      reducedMotion: "reduce",
    });
    await mock(context, state());
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "*",
    };
    const json = (route, value) =>
      route.fulfill({
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(value),
      });
    await context.route("**/rpc/search_my_clients", (r) =>
      json(r, {
        rows: [client],
        total: 1,
        stats: { clients: 1, interested: 0, localities: 1 },
        options: { companies: [], products: [] },
      }),
    );
    await context.route("**/rpc/get_client_pias_budget", (r) =>
      json(r, { reserved: 0, remaining: 8000 }),
    );
    await context.route("**/rpc/get_my_clients_without_products", (r) =>
      json(r, [client]),
    );
    let writes = [];
    await context.route("**/client_products?**", (r) => {
      if (r.request().method() === "POST") {
        writes.push(r.request().postDataJSON());
        return json(r, [r.request().postDataJSON()]);
      }
      return json(r, []);
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page, process.env.PRODUCT_CAPTURE_URL || `http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => window.PanelNavigation.go("clients"));
    await page.locator("#clients-list .client-identity").first().click();
    await page.getByRole("button", { name: "Importar captura", exact: true }).click();
    const image = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1800;
      c.height = 680;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#123650";
      ctx.font = "22px Arial";
      const draw = (x, y, label, value, right = false) => {
        ctx.fillText(label, x, y);
        ctx.fillText(value, right ? x + 470 : x, y + 38);
      };
      ctx.fillText("Contrato: Prueba, Ana", 20, 35);
      draw(20, 90, "Unidades", "40,8000", true);
      draw(620, 90, "Unidades brutas myOVB", "40,8000", true);
      draw(1220, 90, "Unidades netas myOVB", "40,8000", true);
      draw(20, 190, "Estado", "Activo");
      draw(620, 190, "Estado del proceso", "Comisión contabilizada");
      draw(20, 290, "Compañía", "AXA Seguros");
      draw(620, 290, "Producto", "PIASPFPerfDin +, 4");
      draw(20, 390, "Prima/Aportación bruta", "50,00", true);
      draw(620, 390, "Prima/Aportación neta", "0,00", true);
      draw(1220, 390, "Fracc.", "Mensual");
      draw(20, 490, "F. Efecto", "10.06.2026");
      draw(620, 490, "Duración del pago", "52");
      draw(20, 590, "Tomador", "Prueba, Ana");
      draw(620, 590, "N° Póliza", "12345678");
      return c.toDataURL("image/png").split(",")[1];
    });
    const png = process.env.CAPTURE_REFERENCE
      ? require("fs").readFileSync(process.env.CAPTURE_REFERENCE)
      : Buffer.from(image, "base64");
    await page.locator(".capture-body input[type=file]").setInputFiles({
      name: "contrato-ficticio.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page
      .getByRole("button", { name: "Revisar en el formulario" })
      .waitFor({ timeout: 90000 });
    const extracted = await page.locator(".capture-summary").innerText();
    assert.match(extracted, /Dinámica\+/);
    assert.match(extracted, /41 U/);
    assert.match(extracted, /40\.8 U/);
    assert.match(extracted, /50 €/);
    assert.match(extracted, /Mensual/);
    assert.equal(writes.length, 0, "La captura no guarda nada");
    if (!process.env.CAPTURE_REFERENCE)
      await page.locator(".capture-preview").screenshot({
        path: require("path").join(
          process.env.TEMP,
          "capture-preview-" + (safari ? "webkit" : "chromium") + ".png",
        ),
      });
    await page.locator(".capture-preview .capture-confirm input").check();
    await page.getByRole("button", { name: "Revisar en el formulario" }).click();
    const form = page.locator(".contract-editor");
    await form.locator("[name=amount]").waitFor();
    assert.equal(await form.locator("[name=amount]").inputValue(), "50");
    assert.equal(await form.locator("[name=units]").inputValue(), "41");
    assert.equal(await form.locator("[name=signed_on]").inputValue(), "");
    assert.equal(await form.locator("[name=signed_multiplier]").inputValue(), "");
    assert.equal(
      await form.locator("input[name=portfolio]:checked").inputValue(),
      "Dinámica+",
    );
    assert.equal(writes.length, 0, "Revisar no guarda el producto");
    for (const width of [1366, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        "Sin desbordamiento " + width,
      );
      if (!process.env.CAPTURE_REFERENCE)
        await page.screenshot({
          path: require("path").join(
            process.env.TEMP,
            "capture-review-" + (safari ? "webkit-" : "") + width + ".png",
          ),
        });
    }
    await form.locator("[name=signed_on]").fill("2026-06-10");
    await form.locator("[name=signed_multiplier]").selectOption("2");
    await form.locator("label.capture-confirm input").check();
    await form.getByRole("button", { name: "Guardar producto", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".contract-editor"));
    assert.equal(writes.length, 1, "Solo se guarda tras confirmar");
    const saved = Array.isArray(writes[0]) ? writes[0][0] : writes[0];
    assert.equal(saved.units, 41);
    assert.equal(saved.portfolio, "Dinámica+");
    assert.equal(saved.signed_multiplier, 2);
    // La misma opción está disponible al recorrer clientes sin productos.
    await page.locator("#client-detail-close").click();
    const guideButton = page.getByRole("button", {
      name: /Configurar clientes sin productos/,
    });
    await guideButton.click();
    await page.locator("#client-import-guide").waitFor();
    await page.locator(".capture-import > button").click();
    await page.locator(".capture-body input[type=file]").setInputFiles({
      name: "contrato-ficticio.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByRole("button", { name: "Cancelar lectura", exact: true }).click();
    assert.match(
      await page.locator(".capture-body [role=status]").innerText(),
      /cancelada/,
    );
    assert.equal(writes.length, 1, "Cancelar la lectura no guarda");
    await page.getByRole("button", { name: "Continuar más tarde", exact: true }).click();
    const lab = await context.newPage();
    const external = [];
    lab.on("request", (r) => {
      if (
        !r.url().startsWith(`http://127.0.0.1:${server.address().port}/`) &&
        !r.url().startsWith("blob:") &&
        !r.url().startsWith("data:")
      )
        external.push(r.url());
    });
    await lab.goto(`http://127.0.0.1:${server.address().port}/pruebas-capturas/`);
    await lab.getByRole("button", { name: "Importar captura", exact: true }).click();
    await lab.locator(".capture-body input[type=file]").waitFor();
    await lab.locator(".capture-body input[type=file]").setInputFiles({
      name: "contrato-ficticio.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
    await lab
      .getByRole("button", { name: "Revisar en el formulario" })
      .waitFor({ timeout: 90000 });
    assert.deepEqual(external, [], "La lectura no hace peticiones a servicios externos");
    await lab.close();
    assert.deepEqual(errors, []);
    console.log(
      "OCR real: cartera, aportación, redondeo 40,8→41, revisión, firma histórica pendiente, guardado explícito y móvil verificados.",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  server.close();
});
