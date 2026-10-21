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
    const progress = async (id) =>
      (await db.query("select public.get_career_progress($1) data", [id])).rows[0].data;
    const root = await progress(owner);
    assert.equal(root.counts.financial_consultant, 2);
    assert.equal(root.counts.team_manager, 1);
    assert.equal(root.units_available, false);
    assert.equal(
      (await progress(other)).user_id,
      other,
      "El responsable superior de la rama puede consultar descendientes indirectos",
    );
    await as(member);
    assert.equal((await progress(member)).counts.team_manager, 1);
    await progress(other);
    await assert.rejects(() => progress(owner));
    await assert.rejects(() => progress(sibling));
    assert.equal(
      (await db.query("select public.get_team_directory() data")).rows[0].data.length,
      4,
      "El directorio profesional completo sigue visible",
    );
    await as(other);
    await progress(other);
    await assert.rejects(() => progress(member));
    await assert.rejects(() => progress(owner));
    await assert.rejects(() => progress(sibling));
    await as(sibling);
    await assert.rejects(() => progress(member));
    await assert.rejects(() => progress(other));
    await db.exec("reset role;set role anon");
    await assert.rejects(() => progress(owner));
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      member,
    ]);
    await as(member);
    await assert.rejects(() => progress(member));
    await assert.rejects(() => progress(other));
    console.log(
      "Privacidad de carrera: propio y descendientes permitidos; superiores, ramas ajenas, anónimos y cuentas desactivadas bloqueados. Directorio completo conservado.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
