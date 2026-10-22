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
    const product = await add();
    const references = async () =>
      (await db.query("select public.list_my_clients() data")).rows[0].data;
    assert.deepEqual((await references()).rows[0].companies, ["AXA"]);
    await add();
    await db.query(
      "insert into public.client_products(client_id,company,product,payment_type,amount) values($1,'Intesa Sanpaolo Assicurazioni','Test','monthly',20)",
      [client],
    );
    assert.deepEqual(
      (await references()).rows[0].companies,
      ["AXA", "Intesa Sanpaolo Assicurazioni"],
      "Compañías sin duplicados",
    );

    await db.query(
      "update public.client_products set portfolio='Cartera conservadora',payment_type='single',amount=1000,units=null where id=$1",
      [product],
    );
    assert.equal(
      (
        await db.query(
          "select portfolio,amount,units from public.client_products where id=$1",
          [product],
        )
      ).rows[0].units,
      null,
    );
    await assert.rejects(() => db.query("update public.client_products set amount=-1"));
    await assert.rejects(() =>
      db.query("update public.client_products set amount=1.001"),
    );
    await assert.rejects(() =>
      db.query("update public.client_products set units=1.00001"),
    );
    await assert.rejects(() =>
      db.query("update public.client_products set created_at=now()"),
    );
    await assert.rejects(() =>
      db.query("update public.client_products set client_id=$1", [client]),
    );
    for (const id of [other, owner]) {
      await as(id);
      assert.deepEqual(
        (await references()).rows,
        [],
        "Ni el administrador puede consultar compañías de clientes ajenos",
      );
      assert.equal(
        (await db.query("select * from public.client_products")).rows.length,
        0,
      );
      await assert.rejects(() => add());
      assert.equal(
        (
          await db.query("delete from public.client_products where id=$1 returning id", [
            product,
          ])
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "update public.client_products set amount=1 where id=$1 returning id",
            [product],
          )
        ).rows.length,
        0,
      );
    }
    await db.exec("reset role;set role anon");
    await assert.rejects(() => db.query("select * from public.client_products"));
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      member,
    ]);
    await as(member);
    assert.equal((await db.query("select * from public.client_products")).rows.length, 0);
    await assert.rejects(() => add());
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=true where user_id=$1", [
      member,
    ]);
    await as(member);
    await db.query("delete from public.portfolio_clients where id=$1", [client]);
    assert.equal((await db.query("select * from public.client_products")).rows.length, 0);
    console.log(
      "Productos: CRUD propio, aislamiento entre consultores y administrador, límites, permisos de columnas, usuario desactivado y borrado en cascada comprobados.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
