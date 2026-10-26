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
      window.currentPresence = [
        {
          user_id: "one",
          name: "Consultor de prueba",
          position_code: "financial_consultant_senior_ii",
          office_code: "LPA1",
        },
      ];
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
    assert.equal(
      await page.locator(".consultant-presence[data-state=online]").count(),
      1,
    );
    assert.equal(await page.locator(".presence-ready").count(), 2);
    await page.locator(".presence-summary summary").first().click();
    assert.equal(
      await page.locator(".presence-name").first().textContent(),
      "Consultor de prueba",
    );
    assert.equal(await page.locator(".presence-role").first().textContent(), "FC II");
    assert.equal(
      await page.locator(".presence-person small").first().textContent(),
      "LPA1",
    );
    await page.locator(".presence-list span").first().click();
    assert.equal(
      await page.locator(".presence-summary[open]").count(),
      1,
      "Clicking inside keeps the list open",
    );
    await page.locator("#badge").click();
    assert.equal(
      await page.locator(".presence-summary[open]").count(),
      0,
      "Outside click closes the list",
    );
    await page.locator(".presence-summary summary").first().click();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".presence-summary[open]").count(),
      0,
      "Escape closes the list",
    );
    assert(
      await page
        .locator(".presence-summary summary")
        .first()
        .evaluate((el) => el === document.activeElement),
    );
    await page.evaluate(async () => {
      window.currentPresence = [];
      await window.PanelPresence.refresh();
    });
    assert.equal(
      await page.locator(".consultant-presence[data-state=offline]").count(),
      1,
    );
    await page.evaluate(async () => {
      window.currentPresence = [
        {
          user_id: "one",
          name: "Consultor de prueba",
          position_code: "financial_consultant_senior_ii",
          office_code: "LPA1",
        },
      ];
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
    await page.evaluate(async () => {
      const now = new Date().toISOString();
      window.currentPresence = {
        people: [
          {
            user_id: "one",
            name: "Consultor de prueba",
            position_code: "financial_consultant_senior_ii",
            office_code: "LPA1",
            online: true,
            last_connected_at: now,
            last_seen_at: now,
          },
          {
            user_id: "two",
            name: "Consultora desconectada",
            position_code: "team_manager",
            office_code: "LPA1",
            online: false,
            last_connected_at: now,
            last_disconnected_at: now,
          },
        ],
        events: [
          {
            id: "two-out",
            user_id: "two",
            name: "Consultora desconectada",
            kind: "disconnected",
            occurred_at: now,
            inferred: true,
          },
          {
            id: "one-in",
            user_id: "one",
            name: "Consultor de prueba",
            kind: "connected",
            occurred_at: now,
            inferred: false,
          },
        ],
      };
      window.PortfolioBackend.updateConnectionPresence = async (id, connected) => {
        window.calls.push(connected);
        return window.currentPresence;
      };
      window.PanelPresence.start();
      await window.PanelPresence.refresh();
      document.querySelector("#badge").append(window.PanelPresence.details("two"));
    });
    await page.locator(".presence-summary summary").first().click();
    await page.locator('[data-presence-tab="last"]').first().click();
    assert.match(
      await page.locator(".presence-body").first().textContent(),
      /Consultora desconectada/,
    );
    assert.match(
      await page.locator(".presence-detail").textContent(),
      /Última conexión:/,
    );
    await page.locator('[data-presence-tab="activity"]').first().click();
    assert.equal(await page.locator(".presence-event").count(), 2);
    assert.match(
      await page.locator(".presence-event").first().textContent(),
      /Hora estimada/,
    );
    await page.evaluate(() => window.PanelPresence.refresh());
    assert.equal(
      await page
        .locator('[data-presence-tab="activity"]')
        .first()
        .getAttribute("aria-pressed"),
      "true",
      "La actualización conserva el apartado abierto",
    );
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert(
        await page
          .locator(".presence-list")
          .first()
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        "Historial sin desbordamiento",
      );
      await page.screenshot({
        path: require("node:path").join(
          process.env.TEMP,
          "connections-" + width + ".png",
        ),
      });
    }
    await page.evaluate(() => window.PanelPresence.stop());
    assert(
      !(await page.locator("[data-panel-presence]").first().textContent()).includes(
        "Consultora desconectada",
      ),
      "Al salir se limpian también los movimientos y el último aviso",
    );
    await page.evaluate(async () => {
      window.PortfolioBackend.updateConnectionPresence = (id, connected) =>
        connected
          ? new Promise((resolve) => (window.finishPresence = resolve))
          : Promise.resolve(window.currentPresence);
      window.PanelPresence.start();
      const stopping = window.PanelPresence.stop();
      window.finishPresence(window.currentPresence);
      await stopping;
    });
    assert(
      !(await page.locator("[data-panel-presence]").first().textContent()).includes(
        "Consultor de prueba",
      ),
      "Una respuesta tardía no repone datos tras cerrar sesión",
    );
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
