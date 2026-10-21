// Validación real de Postgres y RLS, sin datos ni cuentas reales.
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const fs = require("fs"),
  assert = require("node:assert/strict"),
  M = require("../js/premeeting-model.js");
const owner = "11111111-1111-4111-8111-111111111111",
  member = "22222222-2222-4222-8222-222222222222";
const fixture = () => {
  const d = M.initial();
  Object.assign(d.people[0], {
    first_name: "Ana",
    last_name: "Prueba",
    age: "30",
    occupation: "Profesional",
    employment: "Por cuenta ajena",
  });
  d.contact = { email: "prueba@example.invalid", phone: "000000000" };
  d.consent = true;
  return d;
};
(async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
    );
    await db.exec(
      fs.readFileSync("database/setup.sql", "utf8").split("-- Activar pg_cron")[0],
    );
    await db.query("insert into auth.users values($1),($2)", [owner, member]);
    await db.query("insert into private.panel_owners values($1)", [owner]);
    const sql = fs
      .readFileSync("database/premeeting-setup.sql", "utf8")
      .split("-- Supabase: la tarea")[0];
    await db.exec(sql);
    await db.exec(sql);
    const as = async (role, id = "") => {
      await db.exec("reset role;set role " + role);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    };
    const submit = (d, id = crypto.randomUUID()) =>
      db.query("select public.submit_premeeting($1,$2::jsonb) ok", [
        id,
        JSON.stringify(d),
      ]);
    await as("anon");
    const id = crypto.randomUUID();
    assert.equal((await submit(fixture(), id)).rows[0].ok, true);
    assert.equal((await submit(fixture(), id)).rows[0].ok, true);
    await assert.rejects(db.query("select * from public.premeeting_responses"));
    for (const mutate of [
      (d) => (d.consent = false),
      (d) => (d.consent = null),
      (d) => (d.version = null),
      (d) => (d.mode = null),
      (d) => (d.people = []),
      (d) => d.people.push(M.person()),
      (d) => (d.people[0].first_name = null),
      (d) => (d.people[0].age = null),
      (d) => (d.people[0].age = "17"),
      (d) => (d.people[0].income.salary = { status: null, value: null }),
      (d) => (d.people[0].income.salary = { status: "known", value: null }),
      (d) => (d.people[0].income.salary = { status: "known", value: -1 }),
      (d) => (d.people[0].expenses = null),
      (d) => (d.people[0].mortgage_months = { status: "known", value: 1.5 }),
      (d) => (d.people[0].goals = [{ label: "Casa", priority: null }]),
      (d) => (d.people[0].assets = [{ product: null, label: "", amount: M.money() }]),
      (d) => (d.contact.phone = null),
      (d) => (d.contact.email = "bad"),
      (d) => (d.owner_id = owner),
      (d) => (d.shared = null),
    ]) {
      const d = fixture();
      mutate(d);
      await assert.rejects(
        submit(d),
        "Debe rechazar datos inválidos: " + JSON.stringify(d),
      );
    }
    const couple = fixture();
    couple.mode = "couple";
    couple.people.push({ ...structuredClone(couple.people[0]), first_name: "Luis" });
    couple.people[0].assets_skipped = true;
    couple.people[0].assets = [
      {
        product: "Cuenta bancaria",
        label: "No conservar",
        amount: { status: "known", value: 10 },
      },
    ];
    await submit(couple);
    await as("authenticated", member);
    assert.equal(
      (await db.query("select * from public.premeeting_responses")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("delete from public.premeeting_responses returning id")).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query("update public.premeeting_responses set expires_at=now()"),
    );
    await assert.rejects(
      db.query(
        "insert into public.premeeting_responses(id,full_name,email,phone,payload) values(gen_random_uuid(),'a','a','a','{}')",
      ),
    );
    await as("authenticated", owner);
    let rows = (
      await db.query("select * from public.premeeting_responses order by created_at")
    ).rows;
    assert.equal(rows.length, 2);
    assert.equal(
      (new Date(rows[0].expires_at) - new Date(rows[0].created_at)) / 86400000,
      30,
    );
    assert.equal(rows[1].payload.people[0].assets.length, 0);
    await db.exec("reset role");
    await db.query(
      "update public.premeeting_responses set expires_at=now()-interval '1 minute' where id=$1",
      [id],
    );
    await as("authenticated", owner);
    assert.equal(
      (await db.query("select * from public.premeeting_responses")).rows.length,
      1,
    );
    await db.exec(
      "reset role;delete from public.premeeting_responses where expires_at<=now()",
    );
    assert.equal(
      (await db.query("select count(*)::int n from public.premeeting_responses")).rows[0]
        .n,
      1,
    );
    await as("anon");
    await submit(fixture());
    await submit(fixture());
    await assert.rejects(submit(fixture()));
    await as("authenticated", owner);
    assert.equal(
      (await db.query("delete from public.premeeting_responses returning id")).rows
        .length,
      3,
    );
    const d = couple;
    for (const p of d.people) {
      for (const [k] of M.income) p.income[k] = { status: "known", value: 0 };
      for (const [k] of M.expenses) p.expenses[k] = { status: "known", value: 0 };
    }
    for (const [k] of M.expenses) d.shared.expenses[k] = { status: "known", value: 0 };
    d.people[0].income.salary.value = 2000;
    d.people[0].income.extras.value = 2400;
    d.people[1].income.salary.value = 1500;
    d.people[0].expenses.transport.value = 100;
    d.people[0].loans = [
      { label: "Coche", payment: { status: "known", value: 200 }, months: M.money() },
    ];
    d.shared.expenses.mortgage.value = 700;
    let result = M.calculate(d);
    assert.equal(result.income, 3700);
    assert.equal(result.expenses, 1000);
    assert.equal(result.available, 2700);
    assert.equal(result.shared, 700);
    assert.equal(result.people[0].available, 1900);
    assert.equal(result.incomplete, false);
    d.people[1].income.variable = M.money();
    assert.equal(M.calculate(d).incomplete, true);
    console.log(
      "Formulario previo: validación, reintentos, permisos, privacidad, 30 días, borrado y cálculos correctos.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
