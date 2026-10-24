const { chromium, webkit, devices } = require("playwright");
const { server, mock, state, login } = require("./profile-flow.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const safari = process.env.MOBILE_BROWSER === "webkit";
  const mobile = safari || process.env.MOBILE_BROWSER === "android";
  const browser = await (safari ? webkit : chromium).launch({
    headless: true,
    ...(!safari && { executablePath: process.env.CHROME_EXECUTABLE }),
  });
  const failures = [];
  try {
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [768, 1024],
      [1024, 768],
      [844, 390],
    ]) {
      const context = await browser.newContext({
        ...(mobile ? devices[safari ? "iPhone 13" : "Pixel 7"] : {}),
        viewport: { width, height },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      });
      await mock(context, state());
      await context.route("**/rpc/get_unit_statistics_range", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            last_day: 31,
            scopes: {
              own: { units: 120, euros: 240 },
              team: { units: 80, euros: 40 },
              global: { units: 200, euros: 440 },
            },
            days: { own: [], team: [], global: [] },
            months: { own: [], team: [], global: [] },
            consultants: [],
            team_sources: [],
          }),
        }),
      );
      await context.route("**/rpc/premeeting_consultant", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ name: "Consultor de prueba", id: "test-user" }),
        }),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const check = async (name) => {
        const overflow = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          return [...document.querySelectorAll("body *")]
            .filter((el) => {
              const r = el.getBoundingClientRect(),
                s = getComputedStyle(el);
              if (
                !r.width ||
                !r.height ||
                s.visibility === "hidden" ||
                s.position === "fixed"
              )
                return false;
              if (el.closest("details:not([open])") && !el.closest("summary"))
                return false;
              if (
                el.closest(
                  ".team-viewport,.stats-chart-scroll,.table-scroll,.contract-native-control",
                )
              )
                return false;
              for (
                let p = el.parentElement;
                p && p !== document.body;
                p = p.parentElement
              ) {
                if (
                  ["auto", "scroll", "hidden", "clip"].includes(
                    getComputedStyle(p).overflowX,
                  )
                )
                  return false;
              }
              return r.right > w + 2 || r.left < -2;
            })
            .slice(0, 8)
            .map((el) => el.tagName + "." + el.className + "#" + el.id);
        });
        if (overflow.length) failures.push({ width, height, name, overflow });
      };
      for (const route of ["", "cuenta/", "previo/"]) {
        await page.goto(base + route);
        await check(route || "public");
        if (!route) {
          assert(
            await page
              .locator(".portrait img")
              .evaluate((img) => img.complete && img.naturalWidth > 0),
          );
          if (await page.locator(".menu-toggle").isVisible()) {
            await page.locator(".menu-toggle").tap();
            await check("public-menu");
            await page.locator(".menu-toggle").tap();
          }
          await page.screenshot({
            path: path.join(process.env.TEMP, `responsive-public-${width}.png`),
            fullPage: true,
            scale: "css",
          });
        }
      }
      await login(page, base);
      for (const view of [
        "home",
        "resources",
        "requests",
        "premeeting",
        "clients",
        "team",
        "consultants",
        "statistics",
        "profile",
      ]) {
        await page.evaluate((view) => window.PanelNavigation.go(view), view);
        await check(view);
        for (const theme of ["dark", "light"]) {
          await page.evaluate(
            (theme) => (document.documentElement.dataset.theme = theme),
            theme,
          );
          await check(view + "-" + theme);
        }
        if (view === "clients") {
          await page.locator(".clients-import-menu > summary").tap();
          await check("import-open");
          await page.locator(".clients-import-menu > summary").tap();
          await page.locator("#clients-demo-toggle").tap();
          for (const mode of ["cards", "compact", "list"]) {
            const toggle = page.locator(`[data-client-view="${mode}"]`);
            await toggle.tap();
            await check("clients-" + mode);
          }
          await page.locator("#clients-list .client-identity").first().tap();
          await check("client-file");
          await page.locator('[data-client-tab="contact"]').tap();
          await check("client-contact");
          assert(
            await page
              .locator("#client-detail-dialog")
              .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
          );
          await page.touchscreen.tap(2, 2);
          assert.equal(await page.locator("#client-detail-dialog").isVisible(), false);
          await page.locator("#clients-list .client-identity").first().tap();
          await page.locator("#client-detail-close").tap();
        }
        if (view === "statistics") {
          assert.equal(
            await page
              .locator(".stats-bars > div")
              .first()
              .evaluate((el) => getComputedStyle(el).minWidth),
            "28px",
          );
          await page.locator(".stats-bars > div").first().tap();
          assert.match(
            await page.locator(".stats-chart-selection").textContent(),
            /Propias.*Equipo/,
          );
          await page.locator(".contract-date-trigger").first().tap();
          assert.equal(
            await page.locator(".contract-calendar:not([hidden]) [data-month]").count(),
            12,
          );
          await check("month-picker");
          await page.keyboard.press("Escape");
        }
        if (view === "profile" || view === "statistics" || view === "home")
          await page.screenshot({
            path: path.join(
              process.env.TEMP,
              `responsive-${process.env.MOBILE_BROWSER || "chromium"}-${view}-${width}.png`,
            ),
            fullPage: true,
            scale: "css",
          });
      }
      await page.locator('#profile-form [name="phone"]').fill("000000002");
      await page.evaluate(() => {
        window.PanelNavigation.go("home");
      });
      await page.locator("#site-confirm-dialog").waitFor();
      await check("unsaved-profile-confirmation");
      await page.locator("[data-confirm-no]").tap();
      assert.equal(await page.locator("#profile-view").isVisible(), true);
      await page.evaluate(() => {
        window.PanelNavigation.go("home");
      });
      await page.locator("#site-confirm-dialog").waitFor();
      await page.locator("[data-confirm-yes]").tap();
      await page.locator("#home-view").waitFor();
      assert.deepEqual(errors, [], "Sin errores de JavaScript durante la navegación");
      if (width <= 850) {
        await page.locator(".panel-menu-toggle").tap();
        await check("menu-open");
        assert(await page.locator("#global-search").isVisible());
        await page.locator("#global-search").fill("cliente");
        assert.equal(
          await page
            .locator("#global-search")
            .evaluate((input) => getComputedStyle(input).fontSize),
          "16px",
        );
      }
      await context.close();
    }
    if (safari) {
      // Sin perfil iPhone, WebKit degrada month a text: conservar los meses.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setContent('<label>Mes<input type="month" value="2024-02"></label>');
      assert.equal(await page.locator("input").evaluate((input) => input.type), "text");
      await page.addScriptTag({ path: path.join(__dirname, "../js/date-picker.js") });
      await page.locator(".contract-date-trigger").click();
      assert.equal(await page.locator("[data-month]").count(), 12);
      await page.locator('[data-month="2024-01"]').click();
      assert.equal(await page.locator("input").inputValue(), "2024-01");
      await context.close();
    }
    console.log(JSON.stringify(failures, null, 2));
    assert.equal(failures.length, 0, "Contenido fuera de la pantalla");
    console.log(
      `${safari ? "WebKit (motor de Safari)" : mobile ? "Chromium con perfil Android" : "Chromium"}: web pública, cuenta, formulario y nueve secciones del panel; cinco tamaños táctiles sin desbordamientos.`,
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
