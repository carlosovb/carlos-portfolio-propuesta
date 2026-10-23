const assert = require("node:assert/strict"),
  P = require("../js/career-progress.js");
const root = { user_id: "root", position_code: "team_manager", manager_id: null };
const people = [
  root,
  { user_id: "a", manager_id: "root", position_code: "financial_consultant" },
  { user_id: "b", manager_id: "a", position_code: "team_manager" },
  { user_id: "c", manager_id: "root", position_code: "team_manager" },
  { user_id: "d", manager_id: "b", position_code: "financial_consultant" },
  { user_id: "outside", manager_id: null, position_code: "team_manager" },
];
const [goal] = P.calculate(root, people);
assert.equal(goal.level.code, "zone_coordinator");
assert.deepEqual(
  goal.base.team.map((t) => [t.role, t.observed, t.missing]),
  [
    ["GE", 2, 1],
    ["FC", 2, 4],
  ],
);
assert.deepEqual(
  goal.extra.team.map((t) => t.missing),
  [0, 2],
);
assert.equal(goal.base.units[0].required, 9000);
assert.equal(goal.extra.units[0].required, 11250);
for (const rule of [goal.base, goal.extra])
  for (const units of rule.units) {
    assert.equal(units.recorded, null);
    assert.equal(units.missing, null);
  }
assert.deepEqual(
  P.calculate(people[1], people).map((g) => g.level.code),
  ["financial_consultant_senior_i", "team_manager"],
);
assert.equal(
  P.calculate({ ...root, position_code: "national_director" }, people).length,
  0,
);
assert.equal(P.calculate({ ...root, position_code: null }, people).length, 0);
assert.equal(
  P.branch("root", [
    ...people,
    { user_id: "root", manager_id: "d", position_code: "team_manager" },
  ]).length,
  4,
  "No incluye al propio consultor ni repite ciclos",
);
const many = [
  ...people,
  ...Array.from({ length: 10 }, (_, i) => ({
    user_id: "extra" + i,
    manager_id: "a",
    position_code: "team_manager",
  })),
];
assert.equal(
  P.calculate(root, many)[0].base.team[0].missing,
  0,
  "Las cantidades sobrantes no producen faltantes negativos",
);
console.log(
  "Carrera: rama completa, alternativas, exclusión del propio consultor, ciclos, exceso de colaboradores y unidades pendientes comprobados.",
);

const actual = P.calculate(
  { user_id: "x", position_code: "financial_trainee" },
  [],
  {},
  { historical: 250, quarter: 50, totalQuarter: 75, incomplete: 1 },
)[0].base.units[0];
assert.equal(actual.recorded, 250);
assert.equal(actual.missing, 750);
assert.equal(actual.incomplete, true);

const fc={user_id:'leader',position_code:'financial_consultant'};
const branch=[fc,{user_id:'ft1',manager_id:'leader',position_code:'financial_trainee'},{user_id:'ft2',manager_id:'ft1',position_code:'financial_trainee'},{user_id:'fc1',manager_id:'leader',position_code:'financial_consultant'},{user_id:'external',manager_id:null,position_code:'financial_trainee'}];
const managerGoal=P.calculate(fc,branch).find(goal=>goal.level.code==='team_manager');
assert.deepEqual(managerGoal.base.team.map(row=>[row.role,row.count,row.observed,row.missing]),[['FT',3,2,1]],'GE requires three FT from the whole branch; FC and outsiders do not count');
assert.equal(managerGoal.base.units[0].required,4000);
const complete=P.calculate(fc,[...branch,{user_id:'ft3',manager_id:'fc1',position_code:'financial_trainee'}]).find(goal=>goal.level.code==='team_manager');
assert.equal(complete.base.team[0].missing,0);
const authorized=P.calculate(fc,[],{financial_trainee:1,financial_consultant:99}).find(goal=>goal.level.code==='team_manager');
assert.equal(authorized.base.team[0].observed,1);assert.equal(authorized.base.team[0].missing,2);
console.log('Gestor de Equipo: tres FT, descendientes indirectos y recuentos autorizados comprobados.');
