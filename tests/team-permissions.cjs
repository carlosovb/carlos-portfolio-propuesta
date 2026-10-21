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
    await db.exec("reset role; set role anon");
    await assert.rejects(() => db.query("select public.get_team_directory()"));
    await as(member);
    const initial = (await db.query("select public.get_my_team_profile() as data"))
      .rows[0].data;
    assert.equal(
      initial.manager_id,
      owner,
      "Las incorporaciones directas dependen del administrador",
    );
    const directory = (await db.query("select public.get_team_directory() as data"))
      .rows[0].data;
    assert.equal(directory.length, 3);
    assert.equal("phone" in directory[0], false);
    assert.equal("email" in directory[0], false);
    await assert.rejects(() =>
      db.query("select public.save_team_assignment($1,'team_manager',null)", [member]),
    );
    await assert.rejects(() => db.query("select * from private.team_assignments"));
    await as(owner);
    for (const level of levels) {
      await db.query("select public.save_team_assignment($1,$2,$3)", [
        member,
        level.code,
        owner,
      ]);
      await as(member);
      const mine = (await db.query("select public.get_my_team_profile() as data")).rows[0]
        .data;
      assert.equal(mine.position_code, level.code);
      assert.equal(Number(mine.multiplier), level.factor);
      await assert.rejects(() =>
        db.query("select public.save_team_assignment($1,'national_director',$2)", [
          member,
          owner,
        ]),
      );
      await as(owner);
    }
    await db.query("select public.save_team_assignment($1,'team_manager',null)", [owner]);
    await db.query("select public.save_team_assignment($1,'financial_consultant',$2)", [
      member,
      owner,
    ]);
    await db.query("select public.save_team_assignment($1,'financial_trainee',$2)", [
      other,
      member,
    ]);
    await assert.rejects(() =>
      db.query("select public.save_team_assignment($1,'team_manager',$2)", [
        owner,
        other,
      ]),
    );
    await assert.rejects(() =>
      db.query("select public.save_team_assignment($1,'financial_trainee',$1)", [member]),
    );
    await db.query("select public.save_team_assignment($1,'team_manager',$1)", [owner]);
    const root = (await db.query("select public.get_my_team_profile() as data")).rows[0]
      .data;
    assert.equal(root.is_root, true);
    assert.equal(root.manager_id, null);
    assert.equal(root.multiplier, 3.5);
    await as(member);
    const mine = (await db.query("select public.get_my_team_profile() as data")).rows[0]
      .data;
    assert.equal(mine.multiplier, 2.5);
    assert.equal(mine.manager_id, owner);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('consultant-avatars',$1)",
      [member + "/portrait.webp"],
    );
    await assert.rejects(() =>
      db.query(
        "insert into storage.objects(bucket_id,name) values('consultant-avatars',$1)",
        [other + "/portrait.webp"],
      ),
    );
    await db.exec("reset role");
    await db.query(
      "insert into storage.objects(bucket_id,name) values('consultant-avatars',$1)",
      [other + "/portrait.webp"],
    );
    await as(member);
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='consultant-avatars'",
        )
      ).rows.length,
      2,
    );
    assert.equal(
      (
        await db.query("delete from storage.objects where name=$1 returning id", [
          other + "/portrait.webp",
        ])
      ).rows.length,
      0,
    );
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      other,
    ]);
    await as(other);
    await assert.rejects(() => db.query("select public.get_team_directory()"));
    assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
    await as(member);
    assert.equal(
      (await db.query("select public.get_team_directory() as data")).rows[0].data.length,
      2,
    );
    assert.equal((await db.query("select * from storage.objects")).rows.length, 1);
    console.log(
      "Equipo: roles, multiplicadores, jerarquía, ciclos, perfiles, fotos privadas y revocación comprobados.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
