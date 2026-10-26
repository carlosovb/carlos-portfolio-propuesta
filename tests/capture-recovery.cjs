// Fallos de carga simulados: comprobar mensaje correcto y reintento con la misma imagen.
const { chromium } = require("playwright");
const { server } = require("./profile-flow.cjs");
require("./capture-fixture.cjs")(server);
const assert = require("node:assert/strict");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let blocked = true;
    await page.route("**/spa.traineddata.gz", (r) =>
      blocked ? r.fulfill({ status: 503, body: "Unavailable" }) : r.continue(),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/pruebas-capturas/`);
    await page.getByRole("button", { name: "Importar captura", exact: true }).click();
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 900;
      c.height = 150;
      const x = c.getContext("2d");
      x.fillStyle = "white";
      x.fillRect(0, 0, 900, 150);
      x.fillStyle = "black";
      x.font = "30px Arial";
      x.fillText("Producto: PIASPFPerfDin +, 4", 20, 60);
      return c.toDataURL().split(",")[1];
    });
    await page
      .locator(".capture-body input[type=file]")
      .setInputFiles({
        name: "prueba.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
    await page.waitForFunction(
      () =>
        document
          .querySelector(".capture-body [role=status]")
          .textContent.includes("[C02]"),
      {},
      { timeout: 60000 },
    );
    assert.equal(await page.locator(".capture-summary").count(), 0);
    blocked = false;
    await page.getByRole("button", { name: "Volver a intentar", exact: true }).click();
    await page.locator(".capture-summary").waitFor({ timeout: 60000 });
    assert.match(await page.locator(".capture-summary").innerText(), /Dinámica\+/);
    assert.deepEqual(errors, []);
    console.log(
      "Fallo del lector identificado como C02; reintento con la misma captura correcto.",
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
