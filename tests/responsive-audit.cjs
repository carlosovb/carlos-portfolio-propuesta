const { chromium } = require("playwright");
const { server, mock, state, login } = require("./profile-flow.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE,
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
            await page.locator(".menu-toggle").click();
            await check("public-menu");
            await page.locator(".menu-toggle").click();
          }
          await page.screenshot({
            path: path.join(process.env.TEMP, `responsive-public-${width}.png`),
            fullPage: true,
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
          await page.locator(".clients-import-menu > summary").click();
          await check("import-open");
          await page.locator(".clients-import-menu > summary").click();
          await page.locator("#clients-demo-toggle").click();
          for (const mode of ["cards", "compact", "list"]) {
            const toggle = page.locator(`[data-client-view="${mode}"]`);
            if (await toggle.count()) await toggle.click();
            await check("clients-" + mode);
          }
          await page.locator("#clients-list .client-identity").first().click();
          await check("client-file");
          await page.locator('[data-client-tab="contact"]').click();
          await check("client-contact");
          await page.locator("#client-detail-close").click();
        }
        if (view === "statistics") {
          assert.equal(
            await page
              .locator(".stats-bars > div")
              .first()
              .evaluate((el) => getComputedStyle(el).minWidth),
            "28px",
          );
          await page.locator(".stats-bars > div").first().click();
          assert.match(
            await page.locator(".stats-chart-selection").textContent(),
            /Propias.*Equipo/,
          );
          await page.locator(".contract-date-trigger").first().click();
          await check("month-picker");
          await page.keyboard.press("Escape");
        }
        if (view === "profile" || view === "statistics" || view === "home")
          await page.screenshot({
            path: path.join(process.env.TEMP, `responsive-${view}-${width}.png`),
            fullPage: true,
          });
      }
      assert.deepEqual(errors, [], "Sin errores de JavaScript durante la navegación");
      if (width <= 850) {
        await page.locator(".panel-menu-toggle").click();
        await check("menu-open");
        assert(await page.locator("#global-search").isVisible());
      }
      await context.close();
    }
    console.log(JSON.stringify(failures, null, 2));
    assert.equal(failures.length, 0, "Contenido fuera de la pantalla");
    console.log(
      "Web pública, cuenta, formulario y nueve secciones del panel: cinco tamaños táctiles sin desbordamientos.",
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
