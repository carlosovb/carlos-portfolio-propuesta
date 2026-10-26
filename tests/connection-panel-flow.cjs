// Interfaz real con servicios simulados; también admite recursos de la URL publicada.
const { chromium, webkit, devices } = require("playwright");
const { server, mock, state, login } = require("./profile-flow.cjs");
const assert = require("node:assert/strict"),
  path = require("node:path");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const safari = process.env.MOBILE_BROWSER === "webkit";
  const browser = await (safari ? webkit : chromium).launch({
    headless: true,
    ...(!safari && { executablePath: process.env.CHROME_EXECUTABLE }),
  });
  const base =
    process.env.CONNECTION_PANEL_URL || "http://127.0.0.1:" + server.address().port + "/";
  const a = "11111111-1111-4111-8111-111111111111",
    b = "22222222-2222-4222-8222-222222222222";
  const prefix =
    (process.env.CONNECTION_PANEL_URL ? "connections-live" : "connections-panel") +
    (safari ? "-webkit" : "");
  try {
    const context = await browser.newContext({
      ...(safari ? devices["iPhone 13"] : {}),
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const s = state();
    s.profile = { first_name: "Ana", last_name: "Prueba", phone: "000000000" };
    s.teamUserId = a;
    s.team = [
      {
        user_id: a,
        first_name: "Ana",
        last_name: "Prueba",
        position_code: "team_manager",
        position: "Gestor de Equipo",
        office_code: "LPA1",
        is_root: true,
        multiplier: 3.5,
        manager_id: null,
      },
      {
        user_id: b,
        first_name: "Bruno",
        last_name: "Prueba",
        position_code: "financial_trainee",
        position: "Financial Trainee",
        office_code: "LPA1",
        manager_id: a,
        multiplier: 2,
      },
    ];
    await mock(context, s);
    const timestamp = new Date().toISOString();
    const response = {
      people: s.team.map((p, i) => ({
        ...p,
        name: p.first_name + " " + p.last_name,
        online: i === 0,
        last_connected_at: timestamp,
        last_seen_at: timestamp,
        last_disconnected_at: i ? timestamp : null,
      })),
      events: [
        {
          id: "b-out",
          user_id: b,
          name: "Bruno Prueba",
          kind: "disconnected",
          occurred_at: timestamp,
          inferred: true,
        },
        {
          id: "a-in",
          user_id: a,
          name: "Ana Prueba",
          kind: "connected",
          occurred_at: timestamp,
          inferred: false,
        },
      ],
    };
    await context.route("**/rpc/update_panel_connection_presence", (r) =>
      r.fulfill({
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
        body: JSON.stringify(response),
      }),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page, base);
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await page.locator(".dashboard-presence .presence-ready").waitFor();
    await page.locator(".dashboard-presence summary").click();
    await page.locator('.dashboard-presence [data-presence-tab="activity"]').click();
    assert.match(
      await page.locator(".dashboard-presence .presence-body").textContent(),
      /Bruno Prueba/,
    );
    await page.screenshot({ path: path.join(process.env.TEMP, prefix + "-home.png") });
    await page.mouse.click(5, 5);
    await page.evaluate(() => window.PanelNavigation.go("team"));
    await page.locator(".team-node-self").waitFor();
    await page.locator(".team-presence summary").click();
    await page.locator('.team-presence [data-presence-tab="last"]').click();
    assert.match(
      await page.locator(".team-presence .presence-body").textContent(),
      /Última conexión:/,
    );
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert(
        await page
          .locator(".team-presence .presence-list")
          .evaluate(
            (el) =>
              el.getBoundingClientRect().right <= innerWidth + 1 &&
              el.scrollWidth <= el.clientWidth + 1,
          ),
        "Conexiones visibles en Equipo a " + width,
      );
      await page.screenshot({
        path: path.join(process.env.TEMP, prefix + "-team-" + width + ".png"),
      });
    }
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".team-node").filter({ hasText: "Bruno Prueba" }).click();
    assert.match(
      await page.locator("#team-member-connection").textContent(),
      /Última conexión:/,
    );
    assert.match(
      await page.locator("#team-member-connection").textContent(),
      /Sin conexión/,
    );
    await page.screenshot({
      path: path.join(process.env.TEMP, prefix + "-consultant.png"),
    });
    await page.locator("#team-member-close").click();
    await page.locator("#logout-button").click();
    await page.waitForFunction(() => document.querySelector("#panel-screen").hidden);
    assert(
      !(await page.locator("[data-panel-presence]").first().textContent()).includes(
        "Bruno Prueba",
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      (safari ? "WebKit" : "Chromium") +
        ": conexiones y movimientos en Inicio, última conexión en Equipo y ficha, móvil y limpieza al salir verificados.",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
