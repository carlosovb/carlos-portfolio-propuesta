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
    const product = (
      await db.query(
        "insert into public.client_products(client_id,company,product,payment_type,amount,units,signed_on,signed_multiplier,signature_rates) values($1,'AXA','Prueba','monthly',50,100,'2024-02-29',2,$2) returning id",
        [client, JSON.stringify({ [owner]: 3.5, [member]: 2.5 })],
      )
    ).rows[0].id;
    const stats = async () =>
      (await db.query("select public.get_unit_statistics('2024-02-01') data")).rows[0]
        .data;
    const initialScopes = (await stats()).scopes;
    await db.query("select public.set_client_active($1,false)", [client]);
    assert.equal(
      (
        await db.query("select is_active from public.portfolio_clients where id=$1", [
          client,
        ])
      ).rows[0].is_active,
      false,
    );
    assert.ok(
      (
        await db.query("select archived_at from public.client_products where id=$1", [
          product,
        ])
      ).rows[0].archived_at,
    );
    assert.deepEqual(
      (await stats()).scopes,
      initialScopes,
      "Baja preserves units and euros",
    );
    await assert.rejects(() =>
      db.query("select public.set_client_product_archived($1,false)", [product]),
    );
    const filtered = (
      await db.query("select public.search_my_clients('',0,$1) data", [
        JSON.stringify({ activity: "inactive", product_scope: "history" }),
      ])
    ).rows[0].data;
    assert.equal(filtered.total, 1);
    await db.query("select public.set_client_active($1,true)", [client]);
    assert.ok(
      (
        await db.query("select archived_at from public.client_products where id=$1", [
          product,
        ])
      ).rows[0].archived_at,
      "Reactivation does not revive contracts",
    );
    await db.query("select public.set_client_product_archived($1,false)", [product]);
    assert.equal(
      (
        await db.query("select archived_at from public.client_products where id=$1", [
          product,
        ])
      ).rows[0].archived_at,
      null,
    );
    await as(member);
    await assert.rejects(() =>
      db.query("select public.set_client_active($1,false)", [client]),
    );
    await assert.rejects(() =>
      db.query("select public.set_client_product_archived($1,true)", [product]),
    );
    await as(member);
    assert.equal((await stats()).scopes.team.team_euros, 50);
    await as(other);
    await db.query(
      "update public.client_products set signed_multiplier=2.5 where id=$1",
      [product],
    );
    await as(member);
    assert.equal((await stats()).scopes.team.team_euros, 0, "Equal factor earns zero");
    await as(other);
    await db.query(
      "update public.client_products set signed_multiplier=3.5 where id=$1",
      [product],
    );
    await as(member);
    assert.equal(
      (await stats()).scopes.team.team_euros,
      0,
      "Lower factor earns zero, never negative",
    );
    await as(other);
    await db.query("update public.client_products set signed_multiplier=2 where id=$1", [
      product,
    ]);
    const before = await stats();
    await assert.rejects(() =>
      db.query("delete from public.portfolio_clients where id=$1", [client]),
    );
    await as(member);
    assert.equal(
      (await db.query("select public.trash_my_clients($1) n", [[client]])).rows[0].n,
      0,
    );
    await as(other);
    assert.equal(
      (await db.query("select public.trash_my_clients($1) n", [[client]])).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select count(*) n from public.portfolio_clients")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*) n from public.client_products")).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query("delete from public.client_products where id=$1 returning id", [
          product,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(() =>
      db
        .query("update public.client_products set units=0 where id=$1 returning id", [
          product,
        ])
        .then((r) => {
          assert.equal(r.rows.length, 1);
        }),
    );
    assert.deepEqual(
      (await stats()).scopes,
      before.scopes,
      "Quarantine preserves production",
    );
    await assert.rejects(() =>
      db.query("select public.set_client_active($1,true)", [client]),
    );
    await assert.rejects(() =>
      db.query("select public.set_client_product_archived($1,true)", [product]),
    );
    let trash = (await db.query("select public.list_deleted_clients() data")).rows[0]
      .data;
    assert.equal(trash.rows.length, 1);
    assert.equal(trash.admin, false);
    assert.equal(trash.rows[0].recoverable, true);
    assert.equal(
      new Date(trash.rows[0].purge_at) - new Date(trash.rows[0].deleted_at),
      10 * 86400000,
    );
    await assert.rejects(() =>
      db.query("select public.purge_deleted_client($1)", [client]),
    );
    await as(member);
    assert.equal(
      (await db.query("select public.list_deleted_clients() data")).rows[0].data.rows
        .length,
      0,
    );
    await assert.rejects(() =>
      db.query("select public.restore_deleted_client($1)", [client]),
    );
    await as(other);
    await db.query("select public.restore_deleted_client($1)", [client]);
    assert.equal(
      (await db.query("select count(*) n from public.client_products")).rows[0].n,
      1,
    );
    assert.deepEqual(
      (await stats()).scopes,
      before.scopes,
      "Recovery restores records without duplicating units",
    );
    await db.query("select public.trash_my_clients($1)", [[client]]);
    await as(owner);
    assert.equal(
      (await db.query("select public.list_deleted_clients() data")).rows[0].data.admin,
      true,
    );
    await db.query("select public.purge_deleted_client($1)", [client]);
    await as(other);
    assert.deepEqual(
      (await stats()).scopes,
      before.scopes,
      "Permanent client deletion preserves historic units and euros",
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*) n from private.deleted_product_production"))
        .rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select count(*) n from public.client_products")).rows[0].n,
      0,
    );
    // A second product deletion must also preserve accounting, independently of client deletion.
    await as(other);
    await db.query("select public.import_my_clients($1::jsonb,false)", [
      JSON.stringify([
        { first_name: "Otro", last_name: "Ejemplo", client_type: "Cliente" },
      ]),
    ]);
    const second = (await db.query("select id from public.portfolio_clients")).rows[0].id;
    const insert = async (id) =>
      db.query(
        "insert into public.client_products(id,client_id,company,product,payment_type,amount,units,signed_on,signed_multiplier,signature_rates) values($1,$2,'AXA','Prueba','single',1,10,'2024-02-29',2,$3)",
        [id, second, JSON.stringify({ [owner]: 3.5, [member]: 2.5 })],
      );
    await assert.rejects(() => insert(product));
    const secondProduct = "99999999-9999-4999-8999-999999999999";
    await insert(secondProduct);
    const secondBefore = (await stats()).scopes;
    await db.query("delete from public.client_products where id=$1", [secondProduct]);
    assert.deepEqual(
      (await stats()).scopes,
      secondBefore,
      "Deleting a product keeps historic production",
    );
    await db.query("select public.trash_my_clients($1)", [[second]]);
    await db.exec("reset role");
    await db.query(
      "update public.portfolio_clients set deleted_at=now()-interval '10 days' where id=$1",
      [second],
    );
    await as(other);
    assert.equal(
      (await db.query("select public.list_deleted_clients() data")).rows[0].data.rows[0]
        .recoverable,
      false,
    );
    await assert.rejects(() =>
      db.query("select public.restore_deleted_client($1)", [second]),
    );
    await db.exec(
      "reset role;delete from public.portfolio_clients where deleted_at<=now()-interval '10 days'",
    );
    await as(other);
    assert.equal(
      (await db.query("select public.list_deleted_clients() data")).rows[0].data.total,
      0,
    );
    assert.deepEqual((await stats()).scopes, secondBefore);
    await db.exec("reset role;set role anon");
    await assert.rejects(() => db.query("select public.list_deleted_clients()"));
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      other,
    ]);
    await as(other);
    await assert.rejects(() => db.query("select public.list_deleted_clients()"));
    await assert.rejects(() =>
      db.query("select * from private.deleted_product_production"),
    );
    console.log(
      "Eliminados: 10 días, recuperación, privacidad, borrado solo admin, caducidad, producción permanente y diferencial nunca negativo comprobados.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
