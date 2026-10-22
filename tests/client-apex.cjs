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

    await db.exec("reset role");
    await db.exec(
      fs
        .readFileSync("database/client-trash.sql", "utf8")
        .split("-- Limpieza al vencer")[0],
    );
    await db.exec(
      fs
        .readFileSync("database/client-trash.sql", "utf8")
        .split("-- Limpieza al vencer")[0],
    );
    await as(other);
    await db.exec("reset role");
    await db.exec(fs.readFileSync("database/client-workspace.sql", "utf8"));
    await db.exec(fs.readFileSync("database/client-lifecycle.sql", "utf8"));
    await as(other);

    await db.exec("reset role");
    await db.exec(fs.readFileSync("database/client-apex.sql", "utf8"));
    await db.exec(fs.readFileSync("database/client-apex.sql", "utf8"));
    await as(other);
    const rates = JSON.stringify({ [owner]: 3.5, [member]: 2.5 });
    const add = async ({
      parent = null,
      amount = 100,
      units = 50,
      date = "2024-02-29",
      factor = 2,
      portfolio = "Equilibrada+",
      apex = false,
      payment = "monthly",
      target = client,
    } = {}) =>
      (
        await db.query(
          "insert into public.client_products(client_id,company,product,portfolio,payment_type,amount,units,signed_on,signed_multiplier,signature_rates,is_apex,parent_product_id) values($1,'AXA','PIAS Proyecto Futuro',$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
          [target, portfolio, payment, amount, units, date, factor, rates, apex, parent],
        )
      ).rows[0].id;
    await assert.rejects(() => add({ portfolio: "" }));
    await assert.rejects(() => add({ portfolio: "Otra cartera" }));
    await assert.rejects(() => add({ amount: 667 }));
    await assert.rejects(() => add({ payment: "single", date: null }));
    const parent = await add();
    const budget = async (year = 2024) =>
      (await db.query("select public.get_client_pias_budget($1,$2) data", [client, year]))
        .rows[0].data;
    assert.equal((await budget()).remaining, 6800);
    await assert.rejects(() =>
      add({ apex: true, parent, amount: 599, payment: "single", date: "2024-03-01" }),
    );
    await assert.rejects(() =>
      add({
        apex: true,
        parent,
        amount: 600,
        units: null,
        payment: "single",
        date: "2024-03-01",
      }),
    );
    await assert.rejects(() =>
      add({
        apex: true,
        parent,
        amount: 600,
        factor: null,
        payment: "single",
        date: "2024-03-01",
      }),
    );
    await assert.rejects(() =>
      add({ apex: true, parent, amount: 600, payment: "single", date: "2024-01-01" }),
    );
    const extra = await add({
      apex: true,
      parent,
      amount: 600,
      units: 10,
      factor: 2.5,
      payment: "single",
      date: "2024-03-01",
    });
    assert.equal((await budget()).reserved, 1800);
    await assert.rejects(() =>
      db.query("update public.client_products set company='Otra' where id=$1", [parent]),
    );
    const statistics = async (month = "2024-03-01") =>
      (await db.query("select public.get_unit_statistics($1) data", [month])).rows[0]
        .data;
    assert.equal((await statistics()).scopes.own.own_units, 10);
    assert.equal((await statistics()).scopes.own.own_euros, 25);
    assert.equal((await statistics()).scopes.global.own_euros, 25);
    assert.equal((await statistics()).scopes.global.team_euros, 10);
    const search = (await db.query("select public.search_my_clients('',0,'{}') data"))
      .rows[0].data;
    assert.equal(
      search.rows[0].product_count,
      1,
      "APEX is a contribution, not another product",
    );
    assert.equal(search.rows[0].total_units, 60);
    await add({
      apex: true,
      parent,
      amount: 6200,
      units: 20,
      payment: "single",
      date: "2024-03-10",
    });
    assert.equal((await budget()).remaining, 0);
    await assert.rejects(() =>
      add({ apex: true, parent, amount: 600, payment: "single", date: "2024-03-11" }),
    );
    await assert.rejects(() =>
      db.query("update public.client_products set amount=101 where id=$1", [parent]),
    );
    await db.query("delete from public.client_products where id=$1", [extra]);
    assert.equal(
      (await budget()).remaining,
      0,
      "Deleting an APEX must not erase its yearly payment",
    );
    await add({
      apex: true,
      parent,
      amount: 600,
      units: 10,
      payment: "single",
      date: "2025-03-01",
    });
    assert.equal((await budget(2025)).reserved, 1800, "Year boundaries are independent");
    await as(owner);
    await assert.rejects(() => budget());
    await as(member);
    await assert.rejects(() => budget());
    await assert.rejects(() =>
      add({ apex: true, parent, amount: 600, payment: "single", date: "2025-03-01" }),
    );
    await as(other);
    await db.query("select public.set_client_active($1,false)", [client]);
    await assert.rejects(() =>
      add({ apex: true, parent, amount: 600, payment: "single", date: "2025-03-01" }),
    );
    await db.query("select public.set_client_active($1,true)", [client]);
    await db.query("select public.set_client_product_archived($1,false)", [parent]);
    const before = (await statistics()).scopes;
    await db.query("delete from public.client_products where id=$1", [parent]);
    assert.deepEqual(
      (await statistics()).scopes,
      before,
      "Parent deletion preserves every APEX commission",
    );
    assert.equal(
      (await budget()).remaining,
      0,
      "Parent deletion preserves annual payment history",
    );
    assert.equal(
      (await db.query("select count(*) n from public.client_products")).rows[0].n,
      0,
      "Parent and APEX cascade together",
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(() => budget());
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*) n from private.deleted_pias_payments")).rows[0].n,
      4,
    );
    console.log(
      "APEX: cartera obligatoria, 666 al mes, mínimo 600, límite anual 8000, firmas independientes, aislamiento e historial permanente comprobados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
