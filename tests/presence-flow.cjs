const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_EXECUTABLE,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="panel-screen"><div data-panel-presence></div><div data-panel-presence></div><div id="badge"></div></div>',
    );
    await page.addStyleTag({ path: "css/base.css" });
    await page.addStyleTag({ path: "css/presence.css" });
    await page.evaluate(() => {
      window.crypto.randomUUID = () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      window.currentPresence = [{ user_id: "one", name: "Consultor de prueba" }];
      window.calls = [];
      window.PortfolioBackend = {
        updatePresence: async (id, connected) => {
          window.calls.push(connected);
          return window.currentPresence;
        },
      };
    });
    await page.addScriptTag({ path: "js/presence.js" });
    await page.evaluate(async () => {
      window.PanelPresence.start();
      await window.PanelPresence.refresh();
      document.querySelector("#badge").append(window.PanelPresence.badge("one"));
    });
    assert.equal(await page.locator("[data-state=online]").count(), 1);
    assert.equal(await page.locator(".presence-ready").count(), 2);
    await page.locator(".presence-summary summary").first().click();
    assert.equal(
      await page.locator(".presence-list").first().textContent(),
      "Consultor de prueba",
    );
    await page.evaluate(async () => {
      window.currentPresence = [];
      await window.PanelPresence.refresh();
    });
    assert.equal(await page.locator("[data-state=offline]").count(), 1);
    await page.evaluate(async () => {
      window.currentPresence = [{ user_id: "one", name: "Consultor de prueba" }];
      await window.PanelPresence.refresh();
    });
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert(
        await page
          .locator(".presence-summary")
          .first()
          .evaluate((el) => el.scrollWidth <= innerWidth),
      );
    }
    await page.evaluate(() => window.PanelPresence.stop());
    assert(
      !(await page
        .locator("[data-panel-presence]")
        .first()
        .textContent()
        .then((s) => s.includes("Consultor de prueba"))),
    );
    assert.equal(await page.evaluate(() => window.calls.at(-1)), false);
    console.log(
      "Presencia: indicadores, lista, actualizaciones, varias vistas y limpieza al cerrar sesión verificados.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
