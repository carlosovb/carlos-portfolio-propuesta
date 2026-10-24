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
    await db.exec(fs.readFileSync("database/panel-presence.sql", "utf8"));
    await db.exec(fs.readFileSync("database/profile-office-since.sql", "utf8"));
    await db.exec(fs.readFileSync("database/profile-office-since.sql", "utf8"));

    await db.exec("reset role");
    await db.exec(`alter table public.portfolio_clients add column deleted_at timestamptz, add column is_active boolean not null default true,add column inactive_at timestamptz;
    alter table public.client_products add column archived_at timestamptz,add column is_apex boolean not null default false;
    create table public.premeeting_responses(id uuid primary key,owner_id uuid,full_name text,email text,phone text,payload jsonb,created_at timestamptz default now(),expires_at timestamptz default now()+interval '30 days');
    create table public.team_resources(id uuid primary key,company text,product text,title text,kind text,url text,storage_path text,archived boolean default false,created_at timestamptz default now());
    create table private.consultant_invitations(email text primary key,inviter_id uuid,user_id uuid unique);`);
    await db.exec(fs.readFileSync("database/panel-intelligence.sql", "utf8"));
    await db.exec(fs.readFileSync("database/panel-intelligence.sql", "utf8"));
    await as(other);
    let history = (
      await db.query("select public.get_panel_activity($1,0) data", [client])
    ).rows[0].data;
    assert.equal(history.total, 1, "idempotent backfill");
    const req = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.query("select public.add_client_note($1,$2,$3)", [
      client,
      "Nota privada <script>no ejecutar</script>",
      req,
    ]);
    await db.query("select public.add_client_note($1,$2,$3)", [
      client,
      "Nota privada <script>no ejecutar</script>",
      req,
    ]);
    history = (await db.query("select public.get_panel_activity($1,0) data", [client]))
      .rows[0].data;
    assert.equal(history.total, 2);
    assert.equal(history.rows[0].kind, "note.added");
    const search = async (q) =>
      (await db.query("select public.search_panel($1) data", [q])).rows[0].data;
    assert.equal((await search("Test")).clients.length, 1);
    assert.equal((await search("%")).clients, undefined, "short literal not wildcard");
    await db.exec("reset role");
    const product = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.query(
      "insert into public.client_products(id,client_id,company,product,portfolio,payment_type,amount,units) values($1,$2,'AXA','PIAS','Global','monthly',50,41)",
      [product, client],
    );
    await as(other);
    assert.equal((await search("axa")).clients.length, 1);
    history = (await db.query("select public.get_panel_activity($1,0) data", [client]))
      .rows[0].data;
    assert(history.rows.some((r) => r.kind === "product.created"));
    await as(member);
    assert.equal((await search("Test")).clients.length, 0);
    assert.equal((await search("AXA")).clients.length, 0);
    await assert.rejects(() =>
      db.query("select public.get_panel_activity($1,0)", [client]),
    );
    await assert.rejects(() =>
      db.query("select public.add_client_note($1,$2,$3)", [client, "Forbidden", req]),
    );
    assert.equal(
      (await db.query("select public.get_my_client($1) data", [client])).rows[0].data,
      null,
    );
    await as(owner);
    await assert.rejects(() =>
      db.query("select public.get_panel_activity($1,0)", [client]),
    );
    await db.exec("reset role");
    const form = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.query(
      "insert into public.premeeting_responses(id,owner_id,full_name,email,phone) values($1,$2,'Respuesta privada','privado@example.invalid','123456789')",
      [form, other],
    );
    await as(other);
    let alerts = (await db.query("select public.get_panel_notifications() data")).rows[0]
      .data;
    assert.equal(alerts.unread, 1);
    assert.equal((await search("privada")).forms.length, 1);
    const alert = alerts.rows[0].id;
    await as(member);
    assert.equal(
      (await db.query("select public.get_panel_notifications() data")).rows[0].data
        .unread,
      0,
    );
    assert.equal(
      (await db.query("select public.read_panel_notification($1) data", [alert])).rows[0]
        .data,
      false,
    );
    assert.equal((await search("privada")).forms.length, 0);
    assert.equal(
      (await db.query("select public.get_panel_target('form',$1) data", [form])).rows[0]
        .data,
      null,
    );
    await as(other);
    await db.query("select public.read_panel_notification($1)", [alert]);
    assert.equal(
      (await db.query("select public.get_panel_notifications() data")).rows[0].data
        .unread,
      0,
    );
    await db.exec("reset role");
    const resource = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await db.query(
      "insert into public.team_resources(id,company,product,title,kind,url) values($1,'AXA','PIAS','Presentación nueva','link','https://example.invalid')",
      [resource],
    );
    await as(member);
    assert.equal(
      (await db.query("select public.get_panel_notifications() data")).rows[0].data
        .unread,
      1,
    );
    assert.equal((await search("presentacion")).resources.length, 1);
    await db.exec("reset role");
    await db.query("update public.team_resources set archived=true where id=$1", [
      resource,
    ]);
    await as(member);
    assert.equal(
      (await db.query("select public.get_panel_notifications() data")).rows[0].data
        .unread,
      0,
    );
    assert.equal((await search("presentacion")).resources.length, 0);
    assert.equal(
      (await db.query("select public.get_panel_target('resource',$1) data", [resource]))
        .rows[0].data,
      null,
    );
    await db.exec("reset role");
    await db.query(
      "update public.premeeting_responses set expires_at=now()-interval '1 day' where id=$1",
      [form],
    );
    await as(other);
    assert.equal((await search("privada")).forms.length, 0);
    assert.equal(
      (await db.query("select public.get_panel_target('form',$1) data", [form])).rows[0]
        .data,
      null,
    );
    await db.exec("reset role");
    await db.query("update public.portfolio_clients set deleted_at=now() where id=$1", [
      client,
    ]);
    await as(other);
    assert.equal((await search("Test")).clients.length, 0);
    assert.equal(
      (await db.query("select public.get_my_client($1) data", [client])).rows[0].data,
      null,
    );
    await assert.rejects(() =>
      db.query("select public.add_client_note($1,$2,$3)", [client, "Deleted", req]),
    );
    await db.exec("reset role");
    await db.query(
      "update public.portfolio_clients set deleted_at=null,is_active=false where id=$1",
      [client],
    );
    await as(other);
    history = (await db.query("select public.get_panel_activity($1,0) data", [client]))
      .rows[0].data;
    assert(history.rows.some((r) => r.kind === "client.trash"));
    await assert.rejects(() => db.query("select * from private.panel_events"));
    await assert.rejects(() => db.query("select * from private.panel_notifications"));
    await db.exec("reset role");
    await db.query("delete from public.portfolio_clients where id=$1", [client]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from private.panel_events where client_id=$1 and kind='note.added'",
          [client],
        )
      ).rows[0].n,
      0,
    );
    await as(other);
    assert(
      (await db.query("select public.get_panel_activity() data")).rows[0].data.rows.some(
        (r) => r.kind === "product.created",
      ),
    );
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      other,
    ]);
    await as(other);
    await assert.rejects(() => search("Nombre"));
    await assert.rejects(() => db.query("select public.get_panel_notifications()"));

    await db.exec("reset role");
    const joined = "66666666-6666-4666-8666-666666666666";
    await db.query(
      "insert into auth.users(id,email,invited_at) values($1,'joined@ovb.es',now())",
      [joined],
    );
    await db.query(
      "insert into private.consultant_invitations(email,inviter_id,user_id) values('joined@ovb.es',$1,$2)",
      [member, joined],
    );
    await as(joined);
    await db.query(
      "select public.save_my_profile('Nueva','Incorporación','000000000','2020-01-01')",
    );
    await db.exec("reset role");
    await db.query(
      "update auth.users set encrypted_password='child-password' where id=$1",
      [joined],
    );
    await db.query(
      "update private.panel_members set password_set_at=now() where user_id=$1",
      [joined],
    );
    await as(member);
    const joinedAlerts = (
      await db.query("select public.get_panel_notifications() data")
    ).rows[0].data.rows.filter((r) => r.target_id === joined);
    assert.equal(joinedAlerts.length, 1, "invitation completion once, only to inviter");
    await as(owner);
    assert.equal(
      (
        await db.query("select public.get_panel_notifications() data")
      ).rows[0].data.rows.filter((r) => r.target_id === joined).length,
      0,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(() => search("Nombre"));
    await assert.rejects(() => db.query("select public.get_panel_activity()"));
    console.log(
      "v0.6: historial, notas idempotentes, actividad, avisos persistentes, búsqueda privada, caducidad y revocación verificados.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
