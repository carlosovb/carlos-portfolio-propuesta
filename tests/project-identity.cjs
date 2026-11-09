// Proyectos y comprobación de identidad: PDF en memoria, sin guardar productos.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { server, mock, state } = require("./profile-flow.cjs");

const parser = require("../js/product-capture-parser.js");
for (const product of ["TOP Plan", "TOP Premium", "TOP PIAS", "TOP10"]) {
  const text = [
    "Intesa Sanpaolo Assicurazioni",
    "Producto: " + product,
    "Cesta de inversión: Perfil Moderado ESG",
    "Fecha de efecto: 15/04/2026",
    "Fecha de firma: 03/04/2026",
  ].join("\n");
  const { draft } = parser.parseProject(text);
  assert.equal(draft.company, "Intesa Sanpaolo Assicurazioni");
  assert.equal(draft.product, product);
  assert.equal(draft.portfolio, "Perfil Moderado ESG");
  assert.equal(draft.signed_on, "2026-04-03");
}
const incomplete = parser.parseProject("Intesa Sanpaolo Assicurazioni\nFecha de efecto: 15/04/2026");
assert.equal(incomplete.draft.product, "");
assert.equal(incomplete.draft.portfolio, "");
assert.equal(incomplete.draft.signed_on, "");
assert.equal(parser.parseProject("Intesa TOP Plan y TOP10").draft.product, "");

function fixture(withName = true) {
  const lines = [
    "AXA PIAS Proyecto Futuro",
    ...(withName ? ["Documento preparado para: Ana Prueba"] : []),
    "CARTERA DINAMICA +", "Mensual 50,00 \\200 43 anos", "TOTAL INVERTIDO 600,00 \\200",
  ];
  const stream = "BT /F1 12 Tf 50 750 Td " + lines.map((s, i) =>
    (i ? "0 -20 Td " : "") + "(" + s + ") Tj").join("\n") + " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "\nendstream",
  ];
  let pdf = "%PDF-1.4\n", offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += (i + 1) + " 0 obj\n" + object + "\nendobj\n"; });
  const xref = Buffer.byteLength(pdf);
  pdf += "xref\n0 6\n0000000000 65535 f \n" + offsets.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  pdf += "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  return Buffer.from(pdf);
}
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE });
  try {
    const context = await browser.newContext();
    await mock(context, state());
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:" + server.address().port + "/panel/");
    const holder = process.env.PROJECT_HOLDER || "Ana Prueba";
    const document = process.env.PROJECT_REFERENCE ? fs.readFileSync(process.env.PROJECT_REFERENCE) : fixture();
    for (const [name, matches, buffer] of [[holder, true, document], ["Otro Cliente", false, document], [holder, false, fixture(false)]]) {
      await page.evaluate((name) => {
        window.projectCleanup?.();
        document.getElementById("project-test-form")?.remove();
        const form = document.createElement("form");
        form.id = "project-test-form";
        document.body.append(form);
        window.projectCleanup = window.ProductCapture.mount(form, {
          client: { first_name: name, last_name: "" }, existing: [], current: () => true,
          onDraft: (draft) => { window.projectDraft = draft; },
        });
      }, name);
      await page.locator(".capture-import > button").click();
      await page.locator(".capture-body input[type=file]").setInputFiles({ name: "proyecto.pdf", mimeType: "application/pdf", buffer });
      await page.locator(".capture-summary").waitFor();
      assert.equal(await page.locator(".capture-identity-warning").count(), matches ? 0 : 1);
      const apply = page.getByRole("button", { name: "Revisar en el formulario" });
      await page.locator(".capture-confirm input").check();
      if (!matches) {
        assert.equal(await apply.isDisabled(), true);
        await page.locator(".capture-identity-warning input").check();
      }
      await apply.click();
      const draft = await page.evaluate(() => window.projectDraft);
      assert.equal(draft.portfolio, "Dinámica+");
      assert.equal(draft.amount, 50);
      assert.equal(draft.units, null);
      assert.equal(draft.signed_on, buffer === document && process.env.PROJECT_REFERENCE ? "2026-03-03" : "");
    }
    if (process.env.INTESA_PROJECT_REFERENCE) {
      const intesa = fs.readFileSync(process.env.INTESA_PROJECT_REFERENCE);
      for (const name of [process.env.INTESA_PROJECT_HOLDER, "Otro Cliente"]) {
        await page.evaluate((name) => {
          window.projectCleanup?.();
          const form = document.getElementById("project-test-form");
          form.replaceChildren();
          window.projectCleanup = window.ProductCapture.mount(form, {
            client: { first_name: name, last_name: "" }, existing: [], current: () => true,
            onDraft: (draft) => { window.projectDraft = draft; },
          });
        }, name);
        await page.locator(".capture-import > button").click();
        await page.locator(".capture-body input[type=file]").setInputFiles({
          name: "oferta-intesa.pdf", mimeType: "application/pdf", buffer: intesa,
        });
        await page.locator(".capture-summary").waitFor();
        const warning = page.locator(".capture-identity-warning");
        const needsConfirmation = await warning.count() > 0;
        await page.locator(".capture-confirm input").check();
        const apply = page.getByRole("button", { name: "Revisar en el formulario" });
        if (needsConfirmation) {
          assert.equal(await apply.isDisabled(), true);
          await warning.locator("input").check();
        }
        await apply.click();
        const draft = await page.evaluate(() => window.projectDraft);
        assert.equal(draft.company, "Intesa Sanpaolo Assicurazioni");
        assert.equal(draft.product, "TOP Plan");
        if (name === "Otro Cliente") assert(needsConfirmation, "El PDF ajeno requiere confirmación específica");
        else console.log("Intesa real:", {
          titularVerificado: !needsConfirmation, fechaFirma: !!draft.signed_on,
          cesta: !!draft.portfolio, importe: draft.amount != null,
        });
      }
    }
    console.log("PDF: coincidencia, discrepancia y nombre ausente comprobados; confirmación específica obligatoria.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
