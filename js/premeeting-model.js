// Modelo compartido: formulario del cliente y lectura privada en el panel.
(function (root, factory) {
  const model = factory();
  if (typeof module === "object" && module.exports) module.exports = model;
  else root.PremeetingModel = model;
})(typeof window === "undefined" ? globalThis : window, function () {
  const income = [
    ["salary", "Ingreso neto mensual habitual"],
    ["variable", "Ingresos variables · media mensual"],
    ["other", "Otros ingresos mensuales · alquileres, pensiones…"],
    ["extras", "Pagas extra · total anual (opcional)"],
  ];
  const expenses = [
    ["rent", "Alquiler de vivienda"],
    ["mortgage", "Cuota mensual de hipoteca"],
    ["utilities", "Suministros · luz, agua, internet y teléfono"],
    ["food", "Alimentación y compras del hogar"],
    ["transport", "Coche y transporte · combustible, mantenimiento…"],
    ["insurance", "Seguros · media mensual"],
    ["subscriptions", "Suscripciones · Netflix, gimnasio, aplicaciones…"],
    ["leisure", "Ocio, compras y cuidado personal"],
    ["education", "Hijos, educación y personas a cargo"],
    ["other", "Otros gastos mensuales"],
  ];
  const goals = [
    "Crear un colchón de emergencia",
    "Empezar a ahorrar",
    "Entender mis inversiones",
    "Preparar mi jubilación",
    "Comprar una vivienda",
    "Reducir mis deudas",
    "Proteger a mi familia",
    "Ahorrar para los hijos",
  ];
  const products = [
    "Cuenta bancaria",
    "Cuenta de ahorro o remunerada",
    "Depósito a plazo",
    "Fondo de inversión",
    "ETF o fondo indexado",
    "Acciones",
    "Plan de pensiones",
    "Seguro de ahorro · PIAS, SIALP, unit linked…",
    "Renta fija · letras, bonos…",
    "Criptomonedas",
    "Otro",
    "No sé qué producto tengo",
  ];
  const statuses = {
    known: "Indico la cantidad",
    unknown: "No lo sé",
    meeting: "Prefiero comentarlo en la reunión",
  };
  const money = () => ({ status: "unknown", value: null });
  const group = (fields) => Object.fromEntries(fields.map(([key]) => [key, money()]));
  const person = () => ({
    first_name: "",
    last_name: "",
    age: "",
    occupation: "",
    employment: "",
    goals: [],
    income: group(income),
    expenses: group(expenses),
    mortgage_months: money(),
    loans: [],
    assets: [],
    assets_skipped: false,
  });
  const initial = () => ({
    version: 1,
    mode: "individual",
    contact: { email: "", phone: "" },
    people: [person()],
    shared: {
      goals: [],
      expenses: group(expenses),
      mortgage_months: money(),
      loans: [],
      assets: [],
      assets_skipped: false,
    },
    consent: false,
  });
  const amount = (m) =>
    m?.status === "known" &&
    typeof m.value === "number" &&
    Number.isFinite(m.value) &&
    m.value >= 0
      ? m.value
      : null;
  function calculate(data) {
    let incomplete = false;
    const read = (m) => {
      const value = amount(m);
      if (value === null) incomplete = true;
      return value ?? 0;
    };
    const costs = (g) =>
      expenses.reduce((sum, [key]) => sum + read(g.expenses[key]), 0) +
      g.loans.reduce((sum, loan) => sum + read(loan.payment), 0);
    const people = data.people.map((p) => {
      const earnings = income.reduce(
        (sum, [key]) => sum + read(p.income[key]) / (key === "extras" ? 12 : 1),
        0,
      );
      const spending = costs(p);
      return {
        name: `${p.first_name} ${p.last_name}`.trim(),
        income: earnings,
        expenses: spending,
        available: earnings - spending,
      };
    });
    const shared = data.mode === "couple" ? costs(data.shared) : 0;
    const totalIncome = people.reduce((s, p) => s + p.income, 0);
    const totalExpenses = people.reduce((s, p) => s + p.expenses, 0) + shared;
    return {
      people,
      shared,
      income: totalIncome,
      expenses: totalExpenses,
      available: totalIncome - totalExpenses,
      incomplete,
    };
  }
  function invalidStep(data) {
    if (
      data.people.some(
        (p) =>
          [p.first_name, p.last_name, p.occupation, p.employment].some(
            (v) => !v.trim(),
          ) ||
          !/^\d{2,3}$/.test(p.age) ||
          Number(p.age) < 18 ||
          Number(p.age) > 120,
      ) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact.email) ||
      !/^\+?[0-9]{7,20}$/.test(data.contact.phone.replace(/[ ()-]/g, ""))
    )
      return 0;
    const groups = [...data.people, ...(data.mode === "couple" ? [data.shared] : [])];
    if (groups.some((g) => g.goals.some((goal) => !goal.label.trim()))) return 1;
    const valid = (m, months = false) =>
      m.status !== "known" ||
      (amount(m) !== null &&
        m.value <= (months ? 1200 : 100000000) &&
        (months
          ? Number.isInteger(m.value)
          : Math.abs(m.value * 100 - Math.round(m.value * 100)) < 0.00001));
    if (data.people.some((p) => income.some(([key]) => !valid(p.income[key])))) return 2;
    if (
      groups.some(
        (g) =>
          expenses.some(([key]) => !valid(g.expenses[key])) ||
          !valid(g.mortgage_months, true) ||
          g.loans.some(
            (l) => !l.label.trim() || !valid(l.payment) || !valid(l.months, true),
          ),
      )
    )
      return 3;
    if (
      groups.some(
        (g) => !g.assets_skipped && g.assets.some((a) => !a.product || !valid(a.amount)),
      )
    )
      return 4;
    return null;
  }
  return {
    income,
    expenses,
    goals,
    products,
    statuses,
    money,
    person,
    initial,
    amount,
    calculate,
    invalidStep,
  };
});
