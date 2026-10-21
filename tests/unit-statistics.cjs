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
    const product = (
      await db.query(
        "insert into public.client_products(client_id,company,product,payment_type,amount,units,signed_on,signed_multiplier,signature_rates) values($1,'AXA','Test','monthly',50,100,'2024-02-29',2,$2) returning id",
        [client, rates],
      )
    ).rows[0].id;
    const stats = async (month = "2024-02-01") =>
      (await db.query("select public.get_unit_statistics($1) data", [month])).rows[0]
        .data;
    let value = await stats();
    assert.equal(value.last_day, 29);
    assert.equal(value.scopes.own.own_euros, 200);
    assert.equal(value.scopes.global.own_euros, 200);
    assert.equal(value.scopes.global.team_euros, 200);
    assert.equal(value.scopes.global.units, 100);
    assert.equal(value.people.length, 1, "No superior or lateral per-person statistics");
    await as(member);
    value = await stats();
    assert.equal(value.scopes.team.team_euros, 50);
    await as(owner);
    value = await stats();
    assert.equal(value.scopes.team.team_euros, 150);
    const person = value.people.find((p) => p.user_id === other);
    assert.equal(person.own_euros, 200);
    assert.equal(value.people.find((p) => p.user_id === member).team_euros, 50);
    assert.equal(
      (await db.query("select public.get_career_progress($1) data", [other])).rows[0].data
        .production.historical,
      100,
    );
    assert.equal(
      (await db.query("select public.get_career_progress($1) data", [owner])).rows[0].data
        .production.totalQuarter,
      0,
    );
    assert.equal((await stats("2025-02-01")).last_day, 28);
    assert.equal((await stats("2024-04-01")).last_day, 30);
    assert.equal((await stats("2024-01-01")).last_day, 31);
    await assert.rejects(() => stats("2099-01-01"));
    await db.query("select public.save_team_assignment($1,'financial_consultant',$2)", [
      other,
      member,
    ]);
    await as(other);
    await db.query("update public.client_products set product='Corrected' where id=$1", [
      product,
    ]);
    value = await stats();
    assert.equal(
      value.scopes.global.own_euros,
      200,
      "Promotion must not rewrite historic commissions",
    );
    await assert.rejects(() =>
      db.query("update public.client_products set signature_rates=$1 where id=$2", [
        JSON.stringify({ [sibling]: 6 }),
        product,
      ]),
    );
    await assert.rejects(() =>
      db.query("update public.client_products set signed_multiplier=100 where id=$1", [
        product,
      ]),
    );
    await db.query(
      "update public.client_products set signed_multiplier=2.5 where id=$1",
      [product],
    );
    value = await stats();
    assert.equal(value.scopes.own.own_euros, 250);
    await db.query(
      "update public.client_products set signed_multiplier=null where id=$1",
      [product],
    );
    value = await stats();
    assert.equal(value.scopes.own.pending, 1);
    assert.equal(value.scopes.global.pending, 3);
    assert.equal(value.scopes.global.own_euros, 0);
    const quarter = (
      await db.query(
        "select date_trunc('quarter',now() at time zone 'Atlantic/Canary')::date::text d",
      )
    ).rows[0].d;
    const older = (await db.query("select ($1::date-1)::text d", [quarter])).rows[0].d;
    const addAt = async (date, units) =>
      (
        await db.query(
          "insert into public.client_products(client_id,company,product,payment_type,amount,units,signed_on,signed_multiplier,signature_rates) values($1,'AXA','Quarter test','single',1,$2,$3,2.5,$4) returning id",
          [client, units, date, JSON.stringify({ [owner]: 3.5, [member]: 2 })],
        )
      ).rows[0].id;
    const current = await addAt(quarter, 20),
      previous = await addAt(older, 30);
    await assert.rejects(() => addAt("2099-01-01", 10));
    await as(owner);
    const measured = (
      await db.query("select public.get_career_progress($1) data", [other])
    ).rows[0].data.production;
    assert.equal(measured.quarter, 20, "Only natural current quarter");
    assert.equal(measured.historical, 150);
    assert.equal(
      (await db.query("select public.get_career_progress($1) data", [owner])).rows[0].data
        .production.totalQuarter,
      20,
    );
    await as(other);
    await db.query("delete from public.client_products where id=any($1::uuid[])", [
      [current, previous],
    ]);
    await db.query("update public.client_products set signed_on=null where id=$1", [
      product,
    ]);
    value = await stats();
    assert.equal(value.undated_own, 1);
    assert.deepEqual(value.scopes, {});
    await assert.rejects(() =>
      db.query("select public.get_career_progress($1)", [owner]),
    );
    await as(owner);
    assert.equal(
      (await db.query("select count(*) n from public.client_products")).rows[0].n,
      0,
      "Aggregates must not expose contracts",
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(() => stats());
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      other,
    ]);
    await as(other);
    await assert.rejects(() => stats());
    console.log(
      "Statistics: own 200/250, differential 50/150, global 400, unique units, snapshot, leap month, pending and privacy verified.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
