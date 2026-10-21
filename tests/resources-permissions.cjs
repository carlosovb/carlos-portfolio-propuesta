// Datos ficticios: aislamiento por consultor y permisos de biblioteca/almacenamiento.
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const fs = require("fs"),
  assert = require("node:assert/strict"),
  M = require("../js/premeeting-model.js");
(async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111",
    member = "22222222-2222-4222-8222-222222222222",
    other = "33333333-3333-4333-8333-333333333333";
  const as = async (id, role = "authenticated") => {
    await db.exec("reset role;set role " + role);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const payload = () => {
    const d = M.initial();
    Object.assign(d.people[0], {
      first_name: "Prueba",
      last_name: "Ficticia",
      age: "30",
      occupation: "Profesional",
      employment: "Otra situación",
    });
    d.contact = { email: "prueba@example.invalid", phone: "000000000" };
    d.consent = true;
    return JSON.stringify(d);
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
      await db.query("select public.save_my_profile('Consultor','Ficticio','000000000')");
    }
    await db.exec("reset role");
    await db.exec(
      fs
        .readFileSync("database/premeeting-setup.sql", "utf8")
        .split("-- Supabase: la tarea")[0],
    );
    const old = crypto.randomUUID();
    await as("", "anon");
    await db.query("select public.submit_premeeting($1,$2::jsonb)", [old, payload()]);
    await db.exec("reset role");
    const migration = fs.readFileSync("database/resources-setup.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const htmlMigration = fs.readFileSync("database/resources-html.sql", "utf8");
    await db.exec(htmlMigration);
    await db.exec(htmlMigration);
    await as(owner);
    const htmlId = crypto.randomUUID(),
      webId = crypto.randomUUID();
    await db.query(
      "insert into public.team_resources(id,company,product,title,kind,storage_path) values($1,'AXA','Presentaciones','HTML de prueba','html',$2)",
      [htmlId, htmlId + ".html"],
    );
    await db.query(
      "insert into public.team_resources(id,company,product,title,kind,url) values($1,'AXA','Presentaciones','Web de prueba','web','https://example.invalid/presentacion')",
      [webId],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('team-resources',$1)",
      [htmlId + ".html"],
    );
    await assert.rejects(
      db.query(
        "insert into public.team_resources(id,company,product,title,kind,storage_path) values(gen_random_uuid(),'A','B','C','html','incorrecto.html')",
      ),
    );
    await assert.rejects(
      db.query(
        "insert into public.team_resources(id,company,product,title,kind,url) values(gen_random_uuid(),'A','B','C','web','javascript:alert(1)')",
      ),
    );
    await as(member);
    assert.equal((await db.query("select * from public.team_resources")).rows.length, 2);
    assert.equal(
      (await db.query("select * from storage.objects where name=$1", [htmlId + ".html"]))
        .rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name) values('team-resources','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.html')",
      ),
    );
    await as(owner);
    await db.query("delete from public.team_resources where id in ($1,$2)", [
      htmlId,
      webId,
    ]);
    await db.query("delete from storage.objects where name=$1", [htmlId + ".html"]);
    await as("", "anon");
    const lookup = (await db.query("select public.premeeting_consultant($1) x", [member]))
      .rows[0].x;
    assert.deepEqual(Object.keys(lookup).sort(), ["id", "is_root", "name"]);
    assert.equal(lookup.id, member);
    assert.equal(
      (
        await db.query("select public.premeeting_consultant($1) x", [
          "00000000-0000-4000-8000-000000000099",
        ])
      ).rows[0].x,
      null,
    );
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (let i = 0; i < 2; i++)
      await db.query("select public.submit_premeeting($1,$2::jsonb,$3)", [
        ids[i],
        payload(),
        [owner, member][i],
      ]);
    await assert.rejects(db.query("select * from public.premeeting_responses"));
    await assert.rejects(db.query("select * from public.team_resources"));
    await as(member);
    assert.deepEqual(
      (await db.query("select id from public.premeeting_responses")).rows.map(
        (r) => r.id,
      ),
      [ids[1]],
    );
    assert.equal(
      (
        await db.query(
          "delete from public.premeeting_responses where id=$1 returning id",
          [ids[0]],
        )
      ).rows.length,
      0,
    );
    await as(owner);
    assert.equal(
      (await db.query("select count(*)::int n from public.premeeting_responses")).rows[0]
        .n,
      2,
      "El administrador no puede consultar las respuestas del consultor",
    );
    const rid = "44444444-4444-4444-8444-444444444444";
    await db.query(
      "insert into public.team_resources(id,company,product,title,kind,storage_path) values($1,'Compañía ejemplo','Producto ejemplo','PDF ficticio','file',$2)",
      [rid, rid + ".pdf"],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('team-resources',$1)",
      [rid + ".pdf"],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('team-resources','55555555-5555-4555-8555-555555555555.pdf')",
    );
    await as(member);
    assert.equal(
      (await db.query("select count(*)::int n from public.team_resources")).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from storage.objects where bucket_id='team-resources'",
        )
      ).rows[0].n,
      1,
      "No leer objetos huérfanos",
    );
    await assert.rejects(
      db.query(
        "insert into public.team_resources(id,company,product,title,kind,url) values(gen_random_uuid(),'A','B','C','link','https://example.invalid')",
      ),
    );
    assert.equal(
      (await db.query("delete from public.team_resources returning id")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where bucket_id='team-resources' returning id",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name) values('team-resources','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')",
      ),
    );
    await db.exec("reset role");
    await db.query("update private.panel_members set enabled=false where user_id=$1", [
      member,
    ]);
    await as(member);
    assert.equal(
      (await db.query("select * from public.premeeting_responses")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from public.team_resources")).rows.length, 0);
    assert.equal(
      (await db.query("select * from storage.objects where bucket_id='team-resources'"))
        .rows.length,
      0,
    );
    await as("", "anon");
    assert.equal(
      (await db.query("select public.premeeting_consultant($1) x", [member])).rows[0].x,
      null,
    );
    await assert.rejects(
      db.query("select public.submit_premeeting($1,$2::jsonb,$3)", [
        crypto.randomUUID(),
        payload(),
        member,
      ]),
    );
    await as(owner);
    await assert.rejects(
      db.query(
        "insert into public.team_resources(id,company,product,title,kind,url) values(gen_random_uuid(),'A','B','C','link','javascript:alert(1)')",
      ),
    );
    await assert.rejects(
      db.query(
        "insert into public.team_resources(id,company,product,title,kind) values(gen_random_uuid(),'A','B','C','link')",
      ),
    );
    await db.query("update public.team_resources set archived=true where id=$1", [rid]);
    assert.equal(
      (await db.query("select archived from public.team_resources where id=$1", [rid]))
        .rows[0].archived,
      true,
    );
    await db.query("delete from public.team_resources where id=$1", [rid]);
    assert.equal(
      (await db.query("select count(*)::int n from public.team_resources")).rows[0].n,
      0,
    );
    console.log(
      "Recursos: respuestas propias, migración histórica, revocación, PDF privados y gestión exclusiva del administrador verificados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
