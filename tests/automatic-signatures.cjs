// Pruebas aisladas: ninguna cuenta real ni foto se modifica.
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const fs = require("fs");
const assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111",
    member = "22222222-2222-4222-8222-222222222222",
    other = "33333333-3333-4333-8333-333333333333";
  const as = async (id) => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  try {
    await db.exec(
      "create role anon; create role authenticated; create schema auth; create schema storage; create table auth.users(id uuid primary key,email text,invited_at timestamptz,encrypted_password text default '',created_at timestamptz default now()); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;",
    );
    await db.exec(
      fs.readFileSync("database/setup.sql", "utf8").split("-- Activar pg_cron")[0],
    );
    await db.exec(fs.readFileSync("database/profile-setup.sql", "utf8"));
    await db.query(
      "insert into auth.users(id,email) values($1,'owner@example.invalid')",
      [owner],
    );
    await db.query("insert into private.panel_owners values($1)", [owner]);
    const sql = fs.readFileSync("database/team-setup.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(fs.readFileSync("database/career-roles.sql", "utf8"));
    const levels = require("../js/career-data.js");
    const roles = (await db.query("select code,label,multiplier from public.team_roles"))
      .rows;
    assert.equal(roles.length, 9);
    for (const level of levels) {
      const row = roles.find((r) => r.code === level.code);
      assert.equal(Number(row.multiplier), level.factor);
      assert.equal(row.label, level.name);
    }
    for (const [id, name] of [
      [member, "member"],
      [other, "other"],
    ]) {
      await db.query("insert into auth.users(id,email,invited_at) values($1,$2,now())", [
        id,
        name + "@example.invalid",
      ]);
      await db.query("update auth.users set encrypted_password='test-hash' where id=$1", [
        id,
      ]);
    }
    for (const id of [owner, member, other]) {
      await as(id);
      await db.query("select public.save_my_profile('Nombre','Prueba','000000000')");
    }

    await db.exec("reset role");
    await db.exec(fs.readFileSync("database/career-progress-permissions.sql", "utf8"));
    const sibling = "44444444-4444-4444-8444-444444444444";
    await db.query(
      "insert into auth.users(id,email,invited_at,encrypted_password) values($1,'sibling@example.invalid',now(),'test')",
      [sibling],
    );
    await db.query(
      "update auth.users set encrypted_password='updated-test' where id=$1",
      [sibling],
    );
    await as(sibling);
    await db.query("select public.save_my_profile('Otra','Rama','000000000')");
    await as(owner);
    await db.query("select public.save_team_assignment($1,'financial_consultant',$2)", [
      member,
      owner,
    ]);
    await db.query("select public.save_team_assignment($1,'team_manager',$2)", [
      other,
      member,
    ]);
    await db.query("select public.save_team_assignment($1,'financial_consultant',$2)", [
      sibling,
      owner,
    ]);

    await db.exec("reset role");
    await db.exec(fs.readFileSync("database/clients-setup.sql", "utf8"));
    await db.exec(fs.readFileSync("database/client-products-setup.sql", "utf8"));
    await db.exec(fs.readFileSync("database/unit-statistics.sql", "utf8"));
    await db.exec(fs.readFileSync("database/unit-statistics.sql", "utf8"));
    await as(owner);
    await db.query("select public.save_team_assignment($1,'team_manager',null)", [owner]);
    await db.query("select public.save_team_assignment($1,'financial_trainee',$2)", [
      other,
      member,
    ]);
    await as(other);
    await db.query("select public.import_my_clients($1::jsonb,false)", [
      JSON.stringify([
        { first_name: "Test", last_name: "Client", client_type: "Cliente" },
      ]),
    ]);
    const client = (await db.query("select id from public.portfolio_clients")).rows[0].id;
    const rates = JSON.stringify({ [owner]: 3.5, [member]: 2.5 });
    await db.exec("reset role");
    await db.exec(fs.readFileSync("database/automatic-signature-rates.sql", "utf8"));
    await as(other);
    const add = async () =>
      (
        await db.query(
          "insert into public.client_products(client_id,company,product,payment_type,amount,units,signed_on,signed_multiplier,signature_rates) values($1,'AXA','Automatic','monthly',50,100,'2024-02-29',2,$2) returning id,signature_rates",
          [client, JSON.stringify({ [owner]: 6 })],
        )
      ).rows[0];
    const product = await add();
    assert.deepEqual(
      product.signature_rates,
      { [owner]: 3.5, [member]: 2.5 },
      "Server ignores supplied rates and snapshots the whole chain",
    );
    await db.exec("reset role");
    await db.exec(fs.readFileSync("database/statistics-range.sql", "utf8"));
    const fixtures = [];
    for (const [id, own, team, count] of [
      [other, 200, 0, 1],
      [member, 0, 50, 2],
      [owner, 0, 150, 4],
    ]) {
      await as(id);
      const value = (
        await db.query(
          "select public.get_unit_statistics_range('2024-02-01','2024-02-01') data",
        )
      ).rows[0].data;
      assert.equal(value.scopes.own?.own_euros || 0, own);
      assert.equal(value.scopes.team?.team_euros || 0, team);
      assert.equal(value.people.length, count);
      const self = value.people.find((p) => p.user_id === id);
      assert.equal(self.own_euros, own);
      assert.equal(self.team_euros, team);
      assert.equal(value.months.own?.[0]?.own_euros || 0, own);
      assert.equal(value.months.team?.[0]?.team_euros || 0, team);
      assert.equal(value.scopes.global.units, 100);
      assert.equal(value.scopes.global.own_euros + value.scopes.global.team_euros, 400);
      assert.equal(value.team_sources.length, team ? 1 : 0);
      if (team) {
        assert.equal(value.team_sources[0].user_id, other);
        assert.equal(value.team_sources[0].units, 100);
        assert.equal(value.team_sources[0].euros, team);
      }
      fixtures.push({ id, own, team, value });
    }
    const { chromium } = require("playwright");
    const browser = await chromium.launch({
      executablePath: process.env.CHROME_EXECUTABLE,
      headless: true,
    });
    try {
      const page = await browser.newPage();
      for (const fixture of fixtures) {
        await page.setContent('<div id="statistics-view"></div>');
        await page.addStyleTag({ path: "css/base.css" });
        await page.addStyleTag({ path: "css/statistics.css" });
        await page.evaluate(
          (value) => (window.PortfolioBackend = { getUnitStatistics: async () => value }),
          fixture.value,
        );
        await page.addScriptTag({ path: "js/date-picker.js" });
        await page.addScriptTag({ path: "js/statistics.js" });
        await page.evaluate(() => window.StatisticsPanel.load());
        await page.locator("input[name=from]").fill("2024-02");
        await page.locator("input[name=to]").fill("2024-02");
        await page.getByRole("button", { name: "Ver periodo", exact: true }).click();
        await page.locator(".stats-metrics").waitFor();
        await page.getByRole("button", { name: "Propias", exact: true }).click();
        const euros = async () =>
          Number(
            (await page.locator(".stats-metric[data-kind=money] strong").textContent())
              .replace(/[^0-9,]/g, "")
              .replace(",", "."),
          );
        assert.equal(await euros(), fixture.own);
        await page.getByRole("button", { name: "Equipo inferior", exact: true }).click();
        assert.equal(await euros(), fixture.team);
        await page.locator(".stats-split .stats-commission-open").click();
        await page.locator(".stats-commission-dialog").waitFor();
        assert.equal(
          await page.locator(".stats-commission-row").count(),
          fixture.team ? 1 : 0,
        );
        if (fixture.team) {
          assert.match(
            await page.locator(".stats-commission-row").textContent(),
            /100 U/,
          );
          assert.match(
            await page.locator(".stats-commission-total").textContent(),
            new RegExp(String(fixture.team)),
          );
        }
        for (const width of [320, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          assert(
            await page
              .locator(".stats-commission-dialog")
              .evaluate((el) => el.scrollWidth <= el.clientWidth),
            "Modal fits viewport",
          );
          if (fixture.team === 150)
            await page.screenshot({
              path: require("path").join(
                process.env.TEMP,
                "commission-breakdown-" + width + ".png",
              ),
            });
        }
        const centered = await page
          .locator(".stats-commission-close")
          .evaluate((button) => {
            const b = button.getBoundingClientRect(),
              icon = button.querySelector("svg").getBoundingClientRect();
            return (
              Math.abs(b.x + b.width / 2 - icon.x - icon.width / 2) < 1 &&
              Math.abs(b.y + b.height / 2 - icon.y - icon.height / 2) < 1
            );
          });
        assert(centered, "Close icon is centered");
        await page.getByRole("button", { name: "Cerrar desglose", exact: true }).click();
        await page.locator(".stats-commission-dialog").waitFor({ state: "detached" });

        await page.locator(".stats-chart [data-metric=euros]").click();
        const feb = page.locator(".stats-bars>div").nth(28);
        assert.match(
          await feb.getAttribute("title"),
          new RegExp("Equipo: " + fixture.team),
        );
        assert.equal(
          await page.locator(".stats-person").count(),
          fixture.value.people.length,
        );
        await page.getByRole("button", { name: "Equipo completo", exact: true }).click();
        assert.equal(await euros(), 400);
        console.log(
          "Cuenta verificada: propias " +
            fixture.own +
            " EUR / equipo " +
            fixture.team +
            " EUR; global 400 EUR y 100 UD.",
        );
      }
    } finally {
      await browser.close();
    }
    await as(owner);
    await db.query("select public.save_team_assignment($1,'financial_consultant',null)", [
      owner,
    ]);
    await as(other);
    const updated = (
      await db.query(
        "update public.client_products set amount=60,signature_rates='{}' where id=$1 returning signature_rates",
        [product.id],
      )
    ).rows[0];
    assert.deepEqual(
      updated.signature_rates,
      product.signature_rates,
      "Saved history survives promotions and attempted changes",
    );
    const stats = (await db.query("select public.get_unit_statistics('2024-02-01') data"))
      .rows[0].data;
    assert.equal(stats.scopes.global.own_euros, 200);
    assert.equal(stats.scopes.global.team_euros, 200);
    await as(member);
    assert.equal(
      (await db.query("select public.get_unit_statistics('2024-02-01') data")).rows[0]
        .data.scopes.team.team_euros,
      50,
    );
    console.log(
      "Automatic signatures: server-owned rates, full hierarchy, historical snapshots and differential commissions verified.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
