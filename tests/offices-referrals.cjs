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
    await as(other);
    const office = async () =>
      (await db.query("select public.get_my_office() data")).rows[0].data;
    assert.equal((await office()).office_code, "LPA1");
    await assert.rejects(() =>
      db.query("select public.create_consultant_office('LPA2')"),
    );
    await as(owner);
    await db.query("select public.create_consultant_office('LPA2')");
    await as(other);
    await db.query("select public.save_my_office('lpa2')");
    assert.equal((await office()).office_code, "LPA2");
    await assert.rejects(() => db.query("select public.save_my_office('unknown')"));
    await db.query(
      "select public.save_my_profile('Nombre','Prueba','000000000','2020-01-01')",
    );
    await assert.rejects(() =>
      db.query(
        "select public.save_my_profile('Nombre','Prueba','000000000','2021-01-01')",
      ),
    );
    await assert.rejects(() =>
      db.query("select public.admin_set_consultant_since($1,'2021-01-01')", [other]),
    );
    await as(owner);
    assert.equal(
      (
        await db.query("select public.admin_set_consultant_since($1,'2021-01-01') data", [
          other,
        ])
      ).rows[0].data,
      true,
    );
    await as(other);
    assert.equal(
      (await db.query("select public.panel_access() data")).rows[0].data.profile
        .consultant_since,
      "2021-01-01",
    );
    await db.exec("reset role");
    await db.exec(fs.readFileSync("database/team-directory-office-since.sql", "utf8"));
    await as(member);
    const colleague = (
      await db.query("select public.get_team_directory() data")
    ).rows[0].data.find((p) => p.user_id === other);
    assert.equal(colleague.office_code, "LPA2");
    assert.equal(colleague.consultant_since, "2021-01-01");
    await assert.rejects(() =>
      db.query("select public.admin_set_consultant_since($1,'2022-01-01')", [other]),
    );
    await as(other);
    const online = (
      await db.query(
        "select public.update_panel_presence('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true) data",
      )
    ).rows[0].data;
    assert.equal(online.find((p) => p.user_id === other).office_code, "LPA2");
    assert.equal(
      online.find((p) => p.user_id === other).position_code,
      "financial_trainee",
    );
    const newbie = "55555555-5555-4555-8555-555555555555";
    await db.exec("reset role");
    await db.query(
      "insert into auth.users(id,email,invited_at) values($1,'new@example.invalid',now())",
      [newbie],
    );
    await as(newbie);
    await assert.rejects(() =>
      db.query("select public.save_my_profile('Nueva','Cuenta','000000000')"),
    );
    await assert.rejects(() =>
      db.query(
        "select public.save_my_profile('Nueva','Cuenta','000000000','2099-01-01')",
      ),
    );
    await db.query(
      "select public.save_my_profile('Nueva','Cuenta','000000000','2020-01-01')",
    );
    assert.equal((await office()).office_code, "LPA1");
    await db.exec("reset role;create role service_role");
    await db.exec(fs.readFileSync("database/consultant-referrals.sql", "utf8"));
    await db.exec(fs.readFileSync("database/consultant-referrals.sql", "utf8"));
    await as(member);
    assert.equal(
      (await db.query("select public.prepare_consultant_invitation('child@ovb.es') data"))
        .rows[0].data,
      true,
    );
    await as(other);
    assert.equal(
      (await db.query("select public.prepare_consultant_invitation('child@ovb.es') data"))
        .rows[0].data,
      false,
    );
    const child = "66666666-6666-4666-8666-666666666666";
    await db.exec("reset role");
    await db.query(
      "insert into auth.users(id,email,invited_at) values($1,'child@ovb.es',now())",
      [child],
    );
    assert.equal(
      (
        await db.query("select public.record_consultant_invitation($1,$2) data", [
          child,
          member,
        ])
      ).rows[0].data,
      true,
    );
    await as(other);
    await assert.rejects(() =>
      db.query("select public.record_consultant_invitation($1,$2)", [child, other]),
    );
    assert.equal(
      (await db.query("select public.list_consultants() data")).rows[0].data.length,
      0,
    );
    assert.equal(
      (await db.query("select public.cancel_pending_invitation($1) data", [child]))
        .rows[0].data,
      false,
    );
    await as(member);
    assert.equal(
      (await db.query("select public.list_consultants() data")).rows[0].data[0].user_id,
      child,
    );
    await db.exec("reset role");
    await db.query(
      "update auth.users set encrypted_password='new-password' where id=$1",
      [child],
    );
    await as(child);
    await db.query(
      "select public.save_my_profile('Nuevo','Consultor','000000000','2020-01-01')",
    );
    assert.equal(
      (await db.query("select public.get_my_team_profile() data")).rows[0].data
        .manager_id,
      member,
    );
    await as(member);
    assert.equal(
      (await db.query("select public.cancel_pending_invitation($1) data", [child]))
        .rows[0].data,
      false,
    );
    assert.equal(
      (await db.query("select public.prepare_consultant_invitation('child@ovb.es') data"))
        .rows[0].data,
      false,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query("select public.record_consultant_invitation($1,$2) data", [
          child,
          other,
        ])
      ).rows[0].data,
      false,
    );
    await db.exec("reset role");
    await db.exec(fs.readFileSync("database/profile-save-all.sql", "utf8"));
    await as(other);
    const saved = (
      await db.query(
        "select public.save_profile_details('Perfil','Unificado','000000001','2021-01-01','LPA1',null) data",
      )
    ).rows[0].data;
    assert.equal(saved.profile.first_name, "Perfil");
    assert.equal(saved.profile.office_code, "LPA1");
    await assert.rejects(() =>
      db.query(
        "select public.save_profile_details('No guardar','Unificado','000000001','2021-01-01','UNKNOWN',null)",
      ),
    );
    assert.equal(
      (await db.query("select public.panel_access() data")).rows[0].data.profile
        .first_name,
      "Perfil",
    );
    await assert.rejects(() =>
      db.query(
        "select public.save_profile_details('No guardar','Unificado','000000001','2021-01-01','LPA2','national_director')",
      ),
    );
    await assert.rejects(() =>
      db.query(
        "select public.save_profile_details('No guardar','Unificado','000000001','2022-01-01','LPA2',null)",
      ),
    );
    await as(owner);
    await db.query(
      "select public.save_profile_details('Admin','Prueba','000000001',null,'LPA2','team_manager')",
    );
    assert.equal(
      (await db.query("select public.get_my_team_profile() data")).rows[0].data
        .position_code,
      "team_manager",
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(() => office());
    console.log(
      "Oficina y antigüedad: LPA1, catálogo solo admin, perfil propio, fecha obligatoria y corrección exclusiva admin verificados.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
