// PostgreSQL en memoria. No se conecta a Supabase ni contiene datos reales.
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111";
  const member = "22222222-2222-4222-8222-222222222222";
  const unknown = "33333333-3333-4333-8333-333333333333";
  async function asUser(id) {
    await db.exec("reset role; set role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  }
  async function access() {
    return (await db.query("select public.panel_access() as access")).rows[0].access;
  }
  async function denied(sql) {
    await assert.rejects(
      () => db.query(sql),
      (error) => error.code === "42501",
    );
  }
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, email text, invited_at timestamptz, created_at timestamptz default now(), encrypted_password text default '');
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    `);
    const initial = fs
      .readFileSync(path.join(__dirname, "../database/setup.sql"), "utf8")
      .split("-- Activar pg_cron")[0];
    await db.exec(initial);
    await db.query(
      "insert into auth.users (id,email,encrypted_password) values ($1,'owner@example.invalid','test-hash')",
      [owner],
    );
    await db.query("insert into private.panel_owners values ($1)", [owner]);
    const migration = fs.readFileSync(
      path.join(__dirname, "../database/profile-setup.sql"),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(
      fs.readFileSync(path.join(__dirname, "../database/consultants-setup.sql"), "utf8"),
    );
    await db.exec(migration); // La migración es reutilizable sin perder perfiles ni permisos.
    await db.query(
      "insert into auth.users (id,email,invited_at) values ($1,'member@example.invalid',now())",
      [member],
    );
    await db.query(
      "insert into auth.users (id,email) values ($1,'unknown@example.invalid')",
      [unknown],
    );
    await db.exec(`insert into public.contact_requests (id,full_name,phone,email,call_time)
      values ('44444444-4444-4444-8444-444444444444','Cliente ficticio','000000000','test@example.invalid','indiferente')`);

    await db.exec("set role anon;");
    await denied("select * from public.consultant_profiles");
    await denied("select public.panel_access()");

    await asUser(owner);
    assert.equal(
      (await db.query("select public.list_consultants() as team")).rows[0].team.length,
      1,
    );
    await asUser(member);
    await assert.rejects(() => db.query("select public.list_consultants()"));
    await asUser(unknown);
    assert.equal(await access(), null);
    assert.equal(
      (await db.query("select * from public.contact_requests")).rows.length,
      0,
    );

    await asUser(member);
    let details = await access();
    assert.equal(details.role, "consultant");
    assert.equal(details.needs_password, true);
    assert.equal(details.profile_complete, false);
    await db.query("select public.save_my_profile($1,$2,$3)", [
      "Nombre",
      "De prueba",
      "+34 000 000 000",
    ]);
    details = await access();
    assert.equal(details.profile.phone, "+34000000000");
    assert.equal(
      details.profile_complete,
      false,
      "Guardar un perfil no sustituye crear la contraseña",
    );
    await denied("select * from private.panel_owners");
    await denied("select * from public.consultant_profiles");
    await denied("update public.consultant_profiles set first_name='Otro'");
    assert.equal(
      (await db.query("select * from public.contact_requests")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update public.contact_requests set status='scheduled' returning id",
        )
      ).rows.length,
      0,
    );

    await db.exec("reset role;");
    await db.query(
      "update auth.users set encrypted_password='new-test-hash' where id=$1",
      [member],
    );
    await asUser(member);
    details = await access();
    assert.equal(details.needs_password, false);
    assert.equal(details.profile_complete, true);
    assert.equal(
      await (
        await db.query("select public.is_panel_owner() as owner")
      ).rows[0].owner,
      false,
    );

    await asUser(owner);
    assert.equal((await access()).role, "admin");
    assert.equal(
      (await db.query("select * from public.contact_requests")).rows.length,
      1,
    );
    await db.query("select public.save_my_profile($1,$2,$3)", [
      "Administrador",
      "De prueba",
      "000000000",
    ]);
    assert.equal((await access()).profile_complete, true);
    assert.equal((await access()).profile.first_name, "Administrador");
    await asUser(member);
    assert.equal(
      (await access()).profile.first_name,
      "Nombre",
      "No mezcla perfiles de usuarios",
    );

    await db.exec("reset role;");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      member,
    ]);
    await asUser(member);
    assert.equal(await access(), null);
    console.log(
      "SQL correcto: invitaciones, contraseña inicial, perfil propio, aislamiento de clientes, bloqueo de cuentas no autorizadas y revocación de miembros.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
