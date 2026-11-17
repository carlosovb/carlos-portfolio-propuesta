const assert = require("node:assert/strict");
const fs = require("node:fs");

module.exports = async (db, { owner, as }) => {
  await db.exec("reset role");
  const events = fs.readFileSync("database/panel-intelligence.sql", "utf8")
    .split("create or replace function private.track_client_event()")[0] + "commit;";
  await db.exec(events);
  await db.exec(fs.readFileSync("database/automatic-signature-rates.sql", "utf8"));
  const historyQuery = "select * from private.signature_commissions() order by product_id,beneficiary,signed_on";
  const historyBefore = (await db.query(historyQuery)).rows;
  await db.exec(fs.readFileSync("database/life-installment-promotions.sql", "utf8"));
  assert.deepEqual((await db.query(historyQuery)).rows, historyBefore);
  await db.query("update private.team_assignments set position_code='team_manager' where user_id=$1", [owner]);
  const today = (await db.query("select (now() at time zone 'Atlantic/Canary')::date::text d")).rows[0].d;
  const monthAgo = (await db.query("select ($1::date-interval '1 month')::date::text d", [today])).rows[0].d;
  const effectDue = today.slice(0, 8) + "01";
  const effectBefore = (await db.query("select ($1::date-interval '1 month')::date::text d", [effectDue])).rows[0].d;

  async function consultant(suffix, previousUnits = 990) {
    await db.exec("reset role");
    const user = (await db.query(
      "insert into auth.users(id,email,invited_at,encrypted_password) values(gen_random_uuid(),$1,now(),'first') returning id",
      ["life-" + suffix + "@example.invalid"],
    )).rows[0].id;
    await db.query("update auth.users set encrypted_password='confirmed' where id=$1", [user]);
    await as(user);
    await db.query("select public.save_my_profile('Prueba','Vida','000000000')");
    await db.exec("reset role");
    await db.query("update private.team_assignments set position_code='financial_trainee',manager_id=$2 where user_id=$1", [user, owner]);
    await as(user);
    await db.query("select public.import_my_clients($1::jsonb,false)", [
      JSON.stringify([{ first_name: "Cliente", last_name: suffix, client_type: "Cliente" }]),
    ]);
    const client = (await db.query("select id from public.portfolio_clients where owner_id=$1", [user])).rows[0].id;
    await db.query(
      "insert into public.client_products(client_id,company,product,portfolio,payment_type,amount,units,signed_on,signed_multiplier) values($1,'AXA','Prueba histórica','','monthly',50,$2,$3,2)",
      [client, previousUnits, monthAgo],
    );
    return { user, client };
  }

  for (const [payment, frequency] of [["monthly", 12], ["quarterly", 4], ["semiannual", 2], ["annual", 1]]) {
    const { user, client } = await consultant(payment);
    const product = (await db.query(
      "insert into public.client_products(client_id,company,product,portfolio,payment_type,amount,units,signed_on,signed_multiplier,life_coverages,life_effective_on) values($1,'AXA','Vida Protect','',$2,20,$3,$4,2,'{\"death\":50000}',$5) returning id",
      [client, payment, 30 * frequency, monthAgo, today],
    )).rows[0].id;
    assert.equal((await db.query("select public.get_my_team_profile() p")).rows[0].p.multiplier, 2);
    await db.query("update public.client_products set life_effective_on=$2 where id=$1", [product, effectBefore]);
    assert.equal((await db.query("select public.get_my_team_profile() p")).rows[0].p.multiplier, 2.5);
    await db.exec("reset role");
    const commissions = (await db.query(
      "select beneficiary,units::float8 units,euros::float8 euros,is_own from private.signature_commissions() where product_id=$1",
      [product],
    )).rows;
    assert.equal(commissions.filter((row) => row.is_own).length, 1);
    assert.equal(commissions.find((row) => row.is_own).units, 30);
    assert.equal(commissions.find((row) => row.is_own).euros, 70);
    assert.equal(commissions.find((row) => row.beneficiary === owner).euros, 35);
    const splits = (await db.query(
      "select segments from private.life_installment_splits where product_id=$1 order by recognized_on", [product],
    )).rows;
    assert.equal(splits.length, frequency);
    assert.deepEqual(splits[0].segments, [{ units: 10, multiplier: 2 }, { units: 20, multiplier: 2.5 }]);
    assert(splits.slice(1).every((row) => row.segments.length === 1 && row.segments[0].multiplier === 2.5));
    assert.equal((await db.query("select private.process_due_life_promotions($1) n", [user])).rows[0].n, 0);
    assert.equal(Number((await db.query("select count(*) n from private.career_trophies where user_id=$1", [user])).rows[0].n), 1);
    assert.equal(Number((await db.query("select count(*) n from private.panel_notifications where recipient_id=$1", [user])).rows[0].n), 1);
    await as(user);
    await assert.rejects(() => db.query("select private.process_due_life_promotions($1)", [user]));
    await assert.rejects(() => db.query("update public.client_products set units=units+1 where id=$1", [product]), /consolidada/);
    await db.query("delete from public.client_products where id=$1", [product]);
    await db.exec("reset role");
    const preserved = (await db.query(
      "select euros::float8 euros from private.signature_commissions() where product_id=$1 and is_own", [product],
    )).rows;
    assert.equal(preserved[0].euros, 70);
  }
  const { user, client } = await consultant("scheduled");
  const product = (await db.query(
    "insert into public.client_products(client_id,company,product,portfolio,payment_type,amount,units,signed_on,signed_multiplier,life_coverages,life_effective_on) values($1,'AXA','Vida Protect','','monthly',20,360,$2,2,'{\"death\":50000}',$3) returning id",
    [client, monthAgo, today],
  )).rows[0].id;
  await db.exec("reset role");
  await db.exec("alter table public.client_products disable trigger promote_on_life_installment");
  await db.query("update public.client_products set life_effective_on=$2 where id=$1", [product, effectBefore]);
  await db.exec("alter table public.client_products enable trigger promote_on_life_installment");
  assert.equal((await db.query("select private.process_due_life_promotions($1) n", [user])).rows[0].n, 1);
  assert.equal((await db.query("select private.process_due_life_promotions($1) n", [user])).rows[0].n, 0);
  const inactive = await consultant("inactive");
  const inactiveProduct = (await db.query(
    "insert into public.client_products(client_id,company,product,portfolio,payment_type,amount,units,signed_on,signed_multiplier,life_coverages,life_effective_on) values($1,'AXA','Vida Protect','','monthly',20,360,$2,2,'{\"death\":50000}',$3) returning id",
    [inactive.client, monthAgo, today],
  )).rows[0].id;
  await db.exec("reset role");
  await db.exec("alter table public.client_products disable trigger promote_on_life_installment");
  await db.query("update public.client_products set life_effective_on=$2 where id=$1", [inactiveProduct, effectBefore]);
  await db.exec("alter table public.client_products enable trigger promote_on_life_installment");
  await db.query("update private.panel_members set enabled=false where user_id=$1", [inactive.user]);
  assert.equal((await db.query("select private.process_due_life_promotions($1) n", [inactive.user])).rows[0].n, 0);
  await db.query("update private.panel_members set enabled=true where user_id=$1", [inactive.user]);
  assert.equal((await db.query("select private.process_due_life_promotions($1) n", [inactive.user])).rows[0].n, 1);
  const historical = await consultant("historical", 970);
  await db.query(
    "insert into public.client_products(client_id,company,product,portfolio,payment_type,amount,units,signed_on,signed_multiplier,life_coverages,life_effective_on) values($1,'AXA','Vida Protect','','monthly',20,120,$2,2,'{\"death\":50000}',($3::date-interval '4 months')::date)",
    [historical.client, monthAgo, effectDue],
  );
  await db.exec("reset role");
  const historicalRows = (await db.query(
    "select s.units::float8 units,s.euros::float8 euros from private.signature_commissions() s join public.client_products p on p.id=s.product_id where p.client_id=$1 and p.product='Vida Protect' and s.is_own order by s.signed_on",
    [historical.client],
  )).rows;
  // La firma de producción histórica es posterior a las primeras cuotas.
  assert(historicalRows.slice(0, 2).every((row) => row.euros === 20));
  assert.equal((await db.query("select position_code from private.team_assignments where user_id=$1", [historical.user])).rows[0].position_code, "financial_consultant");
  console.log("Vida Protect: cuatro periodicidades, primer cobro, ascenso único, trofeo, aviso, tramos y comisión de equipo comprobados.");
};
