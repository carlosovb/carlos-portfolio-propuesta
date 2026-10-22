// Pruebas aisladas de cartera, deduplicación y permisos. Sin cuentas ni clientes reales.
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const fs = require("fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111",
    member = "22222222-2222-4222-8222-222222222222",
    other = "33333333-3333-4333-8333-333333333333";
  const as = async (id) => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const rpc = async (rows, preview = true) =>
    (
      await db.query("select public.import_my_clients($1::jsonb,$2) result", [
        JSON.stringify(rows),
        preview,
      ])
    ).rows[0].result;
  const a = {
    first_name: "Ana",
    last_name: "García",
    birth_date: "1990-02-03",
    email: "ana@example.invalid",
    phone: "000000001",
    client_type: "Cliente",
    status: "Activo",
    street_type: "Calle",
    street: "Ejemplo",
    street_number: "1",
    postal_code: "35001",
    locality: "Las Palmas",
  };
  try {
    await db.exec(
      "create role anon;create role authenticated;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,invited_at timestamptz,encrypted_password text default '',created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;",
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
    await db.exec(fs.readFileSync("database/team-setup.sql", "utf8"));
    for (const id of [member, other]) {
      await db.query("insert into auth.users(id,email,invited_at) values($1,$2,now())", [
        id,
        id + "@example.invalid",
      ]);
      await db.query("update auth.users set encrypted_password='test' where id=$1", [id]);
    }
    for (const id of [owner, member, other]) {
      await as(id);
      await db.query("select public.save_my_profile('Consultor','Prueba','000000000')");
    }
    await db.exec("reset role");
    const sql = fs.readFileSync("database/clients-setup.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(fs.readFileSync("database/client-products-setup.sql", "utf8"));
    await db.exec(fs.readFileSync("database/client-products-setup.sql", "utf8"));
    await db.exec(fs.readFileSync("database/client-company-references.sql", "utf8"));
    await db.exec(fs.readFileSync("database/client-company-references.sql", "utf8"));
    await as(member);
    await rpc([a], false);
    const client = (await db.query("select id from public.portfolio_clients")).rows[0].id;
    const add = async (target = client) =>
      (
        await db.query(
          "insert into public.client_products(client_id,company,product,portfolio,payment_type,amount,units) values($1,'AXA','Producto de prueba','Cartera equilibrada','monthly',50,2.5) returning id",
          [target],
        )
      ).rows[0].id;

    await db.exec("reset role");
    await db.exec(fs.readFileSync("database/client-workspace.sql", "utf8"));
    await db.exec(fs.readFileSync("database/client-workspace.sql", "utf8"));
    await as(member);
    const search = async (filters = {}, page = 0, query = "") =>
      (
        await db.query("select public.search_my_clients($1,$2,$3::jsonb) data", [
          query,
          page,
          JSON.stringify(filters),
        ])
      ).rows[0].data;
    assert.equal(
      (await db.query("select public.get_client_view_preference() v")).rows[0].v,
      "list",
    );
    await db.query("select public.save_client_view_preference('cards')");
    assert.equal(
      (await db.query("select public.get_client_view_preference() v")).rows[0].v,
      "cards",
    );
    await assert.rejects(() =>
      db.query("select public.save_client_view_preference('invalid')"),
    );
    await add();
    await db.query(
      "insert into public.client_products(client_id,company,product,payment_type,amount) values($1,'Intesa Sanpaolo Assicurazioni','Only Intesa','single',100)",
      [client],
    );
    let r = await search();
    assert.equal(r.rows[0].product_count, 2);
    assert.equal(r.rows[0].total_units, 2.5);
    assert.equal(r.rows[0].pending_units, 1);
    assert.equal(
      (await search({ company: "AXA", product: "Only Intesa" })).total,
      0,
      "Filters refer to same contracted product",
    );
    assert.equal(
      (await search({ company: "Intesa Sanpaolo Assicurazioni", product: "Only Intesa" }))
        .total,
      1,
    );
    assert.equal(
      (await search({ min_units: 2, max_units: 3, min_products: 2 })).total,
      1,
    );
    assert.equal((await search({ max_units: 2 })).total, 0);
    assert.equal((await search({ max_products: 1 })).total, 0);
    assert.equal((await search({}, 0, "Intesa")).total, 1);
    await assert.rejects(() => search({ min_units: 5, max_units: 2 }));
    await assert.rejects(() => search({ min_units: -1 }));
    await assert.rejects(() => search({ sort: "unknown" }));
    await rpc(
      Array.from({ length: 30 }, (_, i) => ({
        ...a,
        first_name: "Persona" + i,
        last_name: "ZZ Cliente" + i,
      })),
      false,
    );
    const last = (
      await db.query(
        "select id from public.portfolio_clients where first_name='Persona29'",
      )
    ).rows[0].id;
    await db.query(
      "insert into public.client_products(client_id,company,product,payment_type,amount,units) values($1,'AXA','Last only','monthly',50,300)",
      [last],
    );
    r = await search({ product: "Last only", min_units: 100 });
    assert.equal(r.total, 1);
    assert.equal(r.rows[0].id, last, "Filtering happens before pagination");
    assert.equal((await search({}, 1)).rows.length, 6);
    assert.equal((await search({ sort: "units" })).rows[0].id, last);
    for (const user of [other, owner]) {
      await as(user);
      r = await search();
      assert.equal(r.total, 0);
      assert.deepEqual(r.options.companies, []);
      assert.deepEqual(r.options.products, []);
      assert.equal(
        (await db.query("select public.get_client_view_preference() v")).rows[0].v,
        "list",
        "Views isolated by account",
      );
    }
    await as(member);
    assert.equal(
      (await db.query("select public.get_client_view_preference() v")).rows[0].v,
      "cards",
    );
    await assert.rejects(() => db.query("select * from private.client_view_preferences"));
    await db.exec("reset role;set role anon");
    await assert.rejects(() => search());
    await assert.rejects(() => db.query("select public.get_client_view_preference()"));
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      member,
    ]);
    await as(member);
    await assert.rejects(() => search());
    await assert.rejects(() =>
      db.query("select public.save_client_view_preference('compact')"),
    );
    console.log(
      "Client workspace: filters before pagination, company/product correlation, unit ranges, private options, persistent per-account views and revocation verified.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
