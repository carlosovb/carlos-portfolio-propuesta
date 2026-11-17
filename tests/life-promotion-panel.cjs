const assert = require("node:assert/strict");
const { chromium, firefox, webkit } = require("playwright");
const { server, mock, state, login } = require("./profile-flow.cjs");

(async () => {
  const external = process.env.PROMOTION_TEST_URL;
  if (!external) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const engine = process.env.PROMOTION_TEST_BROWSER;
    browser = await (engine === "webkit" ? webkit : engine === "firefox" ? firefox : chromium).launch(
      engine ? {} : { executablePath: process.env.CHROME_EXECUTABLE },
    );
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const data = state();
      const userId = "22222222-2222-4222-8222-222222222222";
      data.team = [{
        user_id: userId, first_name: "Prueba", last_name: "Promoción", is_root: true, manager_id: null,
        position_code: "financial_trainee", position: "Financial Trainee", multiplier: 2,
      }];
      data.insights = { events: [], notices: [], results: { clients: [], consultants: [], forms: [], resources: [] } };
      await mock(context, data);
      await context.route("**/rpc/list_career_trophies", (route) => route.fulfill({ json:
        data.team[0].position_code === "financial_consultant" ? [{
          position_code: "financial_consultant", position: "Financial Consultant", name: "Prueba Promoción",
          awarded_at: "2026-11-17T10:00:00Z",
        }] : [],
      }));
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await login(page, external || "http://127.0.0.1:" + server.address().port + "/");
      await page.locator("#login-loading").waitFor({ state: "hidden" });
      await page.evaluate(() => window.PanelNavigation.go("profile"));
      await page.locator("#my-team-position").waitFor();
      await page.waitForFunction(() => document.getElementById("my-team-position").value === "financial_trainee");
      await page.locator("#refresh-button:not([disabled])").waitFor();
      const name = page.locator('#profile-form [name="first_name"]');
      await name.fill("Cambio pendiente");
      data.team[0].position_code = "financial_consultant";
      data.team[0].position = "Financial Consultant";
      data.team[0].multiplier = 2.5;
      data.insights.notices = [{
        id: "promotion-test", read_at: null, title: "¡Enhorabuena por tu ascenso!",
        detail: "Has ascendido a Financial Consultant. Has alcanzado 1.000 U con las cuotas ya vencidas.",
        target_type: "career_promotion", target_id: "33333333-3333-4333-8333-333333333333",
        happened_at: "2026-11-17T10:00:00Z",
      }];
      await page.evaluate(() => window.PanelInsights.refreshNotifications());
      await page.locator("#career-promotion-dialog").waitFor();
      await page.waitForFunction(() => document.getElementById("my-team-position").value === "financial_consultant");
      assert.match(await page.locator("#my-team-multiplier").inputValue(), /2[.,]5/);
      assert.equal(await name.inputValue(), "Cambio pendiente");
      await page.locator("#career-promotion-dialog").getByRole("button", { name: "Continuar", exact: true }).click();
      const initialName = data.profile?.first_name || "Carlos";
      await name.fill(initialName);
      await page.evaluate(() => window.PanelNavigation.go("team"));
      const node = page.locator(".team-node").first();
      await node.waitFor();
      await node.click();
      await page.locator("#team-member-position").getByText("Financial Consultant", { exact: true }).waitFor();
      assert.match(await page.locator("#team-member-multiplier").innerText(), /2[.,]5/);
      await page.getByText("Vitrina de logros", { exact: true }).waitFor();
      console.log(width + " px: felicitación, perfil FC ×2,5, datos sin guardar preservados y ficha de Equipo actualizada.");
      await context.close();
    }
  } finally {
    await browser?.close();
    if (!external) server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
