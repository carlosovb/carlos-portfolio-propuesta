const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { server, mock, state, login } = require("./profile-flow.cjs");

function project(name, holder, monthly) {
  const lines = [
    "AXA PIAS Proyecto Futuro", "Documento preparado para: " + holder,
    "CARTERA DINAMICA +", "Mensual " + monthly + ",00 \\200", "Fecha de firma: 01/03/2026",
  ];
  const stream = "BT /F1 12 Tf 50 750 Td " + lines.map((line) => "(" + line + ") Tj 0 -20 Td").join("\n") + " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += (i + 1) + " 0 obj\n" + object + "\nendobj\n";
  });
  const xref = Buffer.byteLength(pdf);
  pdf += "xref\n0 6\n0000000000 65535 f \n" +
    offsets.map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  return { name, mimeType: "application/pdf", buffer: Buffer.from(pdf) };
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE });
    const width = Number(process.env.PROJECT_TEST_WIDTH || 390);
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await mock(context, state());
    const id = "11111111-1111-4111-8111-111111111111";
    const stored = [];
    await context.route("**/rpc/search_my_clients", (r) => r.fulfill({ json: {
      rows: [{ id, first_name: "Ana", last_name: "Prueba", status: "active", kind: "client", product_count: 0 }],
      total: 1, stats: { clients: 1 },
    } }));
    await context.route("**/rpc/get_client_pias_budget", (r) => r.fulfill({ json: { reserved: 0, remaining: 8000 } }));
    await context.route("**/rest/v1/client_products?*", (r) => {
      if (r.request().method() !== "POST") return r.fulfill({ json: stored });
      const row = r.request().postDataJSON();
      stored.push(row);
      return r.fulfill({ json: [{ id: row.id }] });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await login(page, process.env.PROJECT_TEST_URL || "http://127.0.0.1:" + server.address().port + "/");
    await page.evaluate(() => window.PanelNavigation.go("clients"));
    await page.getByText("Ana Prueba", { exact: true }).first().click();
    const [picker] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Importar productos", exact: true }).click(),
    ]);
    assert.equal(picker.isMultiple(), true);
    await picker.setFiles([
      project("primero.pdf", "Ana Prueba", 50),
      project("segundo.pdf", "Ana Prueba", 100),
      project("pendiente.pdf", "Ana Prueba", 150),
      project("ajeno.pdf", "Otra Persona", 200),
      { name: "ilegible.pdf", mimeType: "application/pdf", buffer: Buffer.from("no es un PDF") },
    ]);
    const queue = page.locator(".product-project-queue");
    const item = (file) => queue.locator("li").filter({ hasText: file });
    await item("ilegible.pdf").getByText("PDF ilegible", { exact: true }).waitFor();
    assert.match(await item("ajeno.pdf").innerText(), /El titular no coincide/);
    assert.equal(await item("ajeno.pdf").getByRole("button", { name: "Revisar" }).count(), 0);
    for (const [file, monthly] of [["primero.pdf", "50"], ["segundo.pdf", "100"]]) {
      await item(file).getByRole("button", { name: "Revisar", exact: true }).click();
      const form = page.locator(".contract-editor");
      const units = form.locator("[name=units]");
      await units.waitFor();
      assert.equal(await form.locator("[name=amount]").inputValue(), monthly);
      assert.equal(await units.evaluate((e) => e.validity.valueMissing), true);
      await units.fill("41");
      await form.locator("[name=signed_multiplier]").selectOption("2");
      await form.locator(".capture-confirm input[required]").check();
      await form.getByRole("button", { name: "Marcar como listo" }).click();
      await item(file).getByText("Listo para guardar", { exact: true }).waitFor();
    }
    assert.equal(stored.length, 0);
    await queue.getByRole("button", { name: "Guardar productos listos (2)", exact: true }).click();
    await queue.waitFor({ state: "hidden" });
    assert.deepEqual(stored.map(({ amount, units }) => [amount, units]), [[50, 41], [100, 41]]);
    await page.getByRole("button", { name: "Retomar revisión de PDF", exact: true }).click();
    assert.match(await item("pendiente.pdf").innerText(), /Por revisar/);
    await item("pendiente.pdf").getByRole("button", { name: "Revisar", exact: true }).click();
    await page.locator(".contract-editor [name=amount]").waitFor();
    assert.equal(await page.locator(".contract-editor [name=amount]").inputValue(), "150");
    assert.equal(stored.length, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(width + " px: selector múltiple, cierre tras guardar y revisión pendiente recuperada; solo dos guardados simulados.");
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
