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
    await db.exec(fs.readFileSync("database/client-import-product-guide.sql", "utf8"));
    await as(member);
    const batch = [
      a,
      { ...a, last_name: " GARCIA ", first_name: "ANA" },
      { ...a, first_name: "Bruno", email: "bruno@example.invalid" },
      { first_name: "", last_name: "" },
    ];
    let result = await rpc(batch);
    assert.deepEqual(result, {
      received: 4,
      added: 2,
      duplicates: 1,
      invalid: 1,
      preview: true,
    });
    assert.equal(
      (await db.query("select count(*)::int total from public.portfolio_clients")).rows[0]
        .total,
      0,
    );
    result = await rpc(batch, false);
    assert.equal(result.added, 2);
    assert.equal(result.new_clients.length, 2);
    assert(
      result.new_clients.every(
        (row) => row.id && !("owner_id" in row) && !("identity_name" in row),
      ),
    );

    assert.equal(result.invalid, 1);
    result = await rpc(batch, false);
    assert.equal(result.added, 0);
    assert.deepEqual(result.new_clients, []);
    assert.equal(result.duplicates, 3);
    await rpc([{ ...a, email: "replacement@example.invalid", owner_id: other }], false);
    assert.equal(
      (
        await db.query(
          "select email from public.portfolio_clients where first_name='Ana'",
        )
      ).rows[0].email,
      a.email,
      "Los repetidos no se actualizan",
    );
    assert.equal(
      (await db.query("select distinct owner_id from public.portfolio_clients")).rows[0]
        .owner_id,
      member,
    );
    await assert.rejects(() =>
      db.query(
        "insert into public.portfolio_clients(owner_id,first_name,last_name) values($1,'Ataque','Prueba')",
        [other],
      ),
    );
    await rpc([{ ...a, birth_date: "not-a-date" }], false).then((r) =>
      assert.equal(r.invalid, 1),
    );
    await rpc([{ ...a, last_name: "Propietario falso", owner_id: other }], false);
    assert.equal(
      (
        await db.query(
          "select owner_id from public.portfolio_clients where last_name='Propietario falso'",
        )
      ).rows[0].owner_id,
      member,
    );
    await assert.rejects(() =>
      db.query("update public.portfolio_clients set owner_id=$1", [other]),
    );
    assert.equal(
      (
        await db.query(
          "delete from public.portfolio_clients where last_name='Propietario falso' returning id",
        )
      ).rows.length,
      1,
    );
    const list = (await db.query("select public.list_my_clients('garcia',0) result"))
      .rows[0].result;
    assert.equal(list.total, 2, "La búsqueda debe ignorar las tildes");
    assert.equal(
      (await db.query("select public.list_my_clients('Ana',0) result")).rows[0].result
        .total,
      1,
    );
    const leads = Array.from({ length: 26 }, (_, i) => ({
      ...a,
      client_type: "Interesado",
      last_name: "AAA",
      first_name: "Interesado " + i,
    }));
    await rpc(leads, false);
    const firstPage = (await db.query("select public.list_my_clients('',0) result"))
      .rows[0].result;
    const secondPage = (await db.query("select public.list_my_clients('',1) result"))
      .rows[0].result;
    assert.equal(firstPage.stats.clients, 2);
    assert.equal(firstPage.stats.interested, 26);
    assert.equal(firstPage.rows[0].category, "client");
    assert.equal(firstPage.rows[1].category, "client");
    assert.equal(
      secondPage.rows.every((row) => row.category === "interested"),
      true,
      "La prioridad se aplica antes de paginar",
    );
    await db.query("delete from public.portfolio_clients where client_type='Interesado'");
    const id = (
      await db.query("select id from public.portfolio_clients where first_name='Ana'")
    ).rows[0].id;
    await as(other);
    assert.equal(
      (await db.query("select count(*)::int total from public.portfolio_clients")).rows[0]
        .total,
      0,
    );
    assert.equal(
      (
        await db.query("delete from public.portfolio_clients where id=$1 returning id", [
          id,
        ])
      ).rows.length,
      0,
    );
    await rpc(
      [
        {
          ...a,
          client_type: "Interesado",
          first_name: "Cliente de otro consultor",
          email: "other@example.invalid",
        },
      ],
      false,
    );
    const counts = (await db.query("select public.get_team_client_counts() result"))
      .rows[0].result;
    assert.equal(counts.total, 2);
    assert.equal(counts.interested, 1);
    assert.equal(counts.by_consultant.find((row) => row.user_id === member).clients, 2);
    assert.equal(JSON.stringify(counts).includes("example.invalid"), false);
    assert.deepEqual(Object.keys(counts.by_consultant[0]).sort(), [
      "clients",
      "interested",
      "user_id",
    ]);
    await as(owner);
    assert.equal(
      (await db.query("select count(*)::int total from public.portfolio_clients")).rows[0]
        .total,
      0,
      "El administrador no lee carteras ajenas",
    );
    await as(member);
    const interested = await rpc(
      [{ first_name: "Interesado", last_name: "Prueba", client_type: "Interesado" }],
      false,
    );
    assert.equal(interested.added, 1);
    assert.deepEqual(
      interested.new_clients,
      [],
      "Interested contacts are excluded from product setup",
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(() => db.query("select * from public.portfolio_clients"));
    await assert.rejects(() => db.query("select public.get_team_client_counts()"));
    await assert.rejects(() => rpc([a], false));
    await as(member);
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      member,
    ]);
    await as(member);
    assert.equal(
      (await db.query("select count(*)::int total from public.portfolio_clients")).rows[0]
        .total,
      0,
    );
    await assert.rejects(() => rpc([a], false));
    await assert.rejects(() => db.query("select public.get_team_client_counts()"));
    console.log(
      "Clientes: vista previa sin escritura, duplicados, validación, propietario fijo, aislamiento, eliminación y agregados privados comprobados.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
