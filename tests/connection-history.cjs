// PostgreSQL aislado: sin cuentas reales ni cambios en producción.
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  const a = "11111111-1111-4111-8111-111111111111",
    b = "22222222-2222-4222-8222-222222222222",
    blocked = "33333333-3333-4333-8333-333333333333";
  const s1 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    s2 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
    s3 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
    sb = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
  const as = async (id) => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const overview = async () =>
    (await db.query("select public.get_panel_connection_activity() data")).rows[0].data;
  const update = async (session, connected = true) =>
    (
      await db.query("select public.update_panel_connection_presence($1,$2) data", [
        session,
        connected,
      ])
    ).rows[0].data;
  const who = (r, id) => r.people.find((p) => p.user_id === id);
  const migration = fs.readFileSync("database/panel-connection-history.sql", "utf8");
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema private;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table private.panel_owners(user_id uuid primary key);
  create table private.panel_members(user_id uuid primary key,enabled boolean);
  create table public.consultant_profiles(user_id uuid primary key,first_name text,last_name text,office_code text);
  create table public.team_roles(code text primary key,label text);
  create table private.team_assignments(user_id uuid primary key,position_code text);
  create function public.team_view_allowed() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.panel_owners where user_id=auth.uid()) or exists(select 1 from private.panel_members where user_id=auth.uid() and enabled)$$;
  insert into auth.users values('${a}'),('${b}'),('${blocked}');
  insert into private.panel_owners values('${a}');
  insert into private.panel_members values('${b}',true),('${blocked}',false);
  insert into public.consultant_profiles values('${a}','Ana','Prueba','LPA1'),('${b}','Bruno','Prueba','LPA1'),('${blocked}','No','Autorizado','LPA1');
  insert into public.team_roles values('financial_trainee','Financial Trainee');
  insert into private.team_assignments values('${a}','financial_trainee'),('${b}','financial_trainee');`);
    await db.exec(fs.readFileSync("database/panel-presence.sql", "utf8"));
    await db.exec(migration);
    await db.exec(migration);
    await as(a);
    let r = await overview();
    assert.equal(r.people.length, 2);
    assert.equal(r.events.length, 0);
    assert.equal(who(r, a).last_connected_at, null);
    r = await update(s1);
    assert(who(r, a).online);
    assert.equal(r.events.length, 1);
    const first = who(r, a).last_connected_at;
    r = await update(s1);
    assert.equal(r.events.length, 1);
    assert.equal(who(r, a).last_connected_at, first);
    r = await update(s2);
    assert.equal(r.events.length, 1, "Varias pestañas comparten una conexión");
    r = await update(s1, false);
    assert(who(r, a).online);
    assert.equal(r.events.length, 1);
    r = await update(s2, false);
    assert.equal(who(r, a).online, false);
    assert.equal(r.events.length, 2);
    assert.equal(r.events[0].kind, "disconnected");
    assert.equal(r.events[0].inferred, false);
    r = await update(s2, false);
    assert.equal(r.events.length, 2, "Cerrar de nuevo no duplica movimientos");
    r = await update(s2, true);
    assert.equal(
      who(r, a).online,
      false,
      "Un heartbeat tardío no reabre una sesión cerrada",
    );
    r = await update(s3);
    assert(who(r, a).online);
    assert.equal(r.events.length, 3);
    await as(b);
    r = await overview();
    assert.equal(who(r, b).last_connected_at, null);
    r = await update(sb);
    assert(who(r, b).online);
    const bConnected = who(r, b).last_connected_at;
    await db.exec("reset role");
    await db.query(
      "update private.panel_presence set last_seen=clock_timestamp()-interval '2 minutes' where user_id=$1 and disconnected_at is null",
      [a],
    );
    await db.query(
      "update private.panel_connection_visits set connected_at=clock_timestamp()-interval '3 minutes',last_seen_at=clock_timestamp()-interval '2 minutes' where user_id=$1 and disconnected_at is null",
      [a],
    );
    await as(b);
    r = await overview();
    assert.equal(who(r, a).online, false);
    const timeout = r.events.find(
      (e) => e.user_id === a && e.kind === "disconnected" && e.inferred,
    );
    assert(timeout);
    assert(
      Date.parse(timeout.occurred_at) < Date.now() - 20000,
      "Se conserva el vencimiento estimado, no la hora de consulta",
    );
    await as(a);
    r = await update(s3);
    assert(who(r, a).online, "Al volver de una suspensión se inicia una nueva conexión");
    assert(who(r, b).online);
    await as(b);
    r = await update(sb, false);
    assert.equal(who(r, b).online, false);
    assert.equal(
      who(r, b).last_connected_at,
      bConnected,
      "La última conexión permanece al desconectarse",
    );
    await as(a);
    r = await update(sb, true);
    assert.equal(
      who(r, b).online,
      false,
      "Reutilizar un identificador no modifica sesiones ajenas",
    );
    await update(sb, false);
    await as(b);
    const before = JSON.stringify(r.events);
    await db.exec("reset role");
    await db.exec(migration);
    await as(b);
    assert.equal(
      JSON.stringify((await overview()).events),
      before,
      "Migración reutilizable sin borrar historial",
    );
    await assert.rejects(
      () => db.query("select * from private.panel_connection_visits"),
      (e) => e.code === "42501",
    );
    await assert.rejects(
      () => db.query("select private.expire_panel_connections()"),
      (e) => e.code === "42501",
    );
    await as(blocked);
    await assert.rejects(overview, (e) => e.code === "42501");
    await assert.rejects(
      () => update(s1),
      (e) => e.code === "42501",
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(overview, (e) => e.code === "42501");
    await assert.rejects(
      () => update(s1),
      (e) => e.code === "42501",
    );
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      b,
    ]);
    await as(a);
    r = await overview();
    assert(!r.people.some((p) => p.user_id === b));
    assert(
      !r.events.some((e) => e.user_id === b),
      "Un miembro revocado no se expone en el historial",
    );
    await update(s3, false);
    for (let i = 0; i < 16; i++) {
      const id = "cccccccc-cccc-4ccc-8ccc-" + String(i + 1).padStart(12, "0");
      await update(id, true);
      await update(id, false);
    }
    r = await overview();
    assert.equal(r.events.length, 30, "La lectura de actividad está acotada");
    assert(
      r.events.every(
        (e, i) =>
          !i || Date.parse(r.events[i - 1].occurred_at) >= Date.parse(e.occurred_at),
      ),
    );
    assert(
      !JSON.stringify(r).includes(s1),
      "La API no expone identificadores de pestañas",
    );
    console.log(
      "Conexiones: pestañas múltiples, cierre explícito, reconexión, expiración estimada, historial durable y permisos verificados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
