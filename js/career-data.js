// Transcripción del plan facilitado por Carlos. No calcula promociones ni completa datos ausentes.
((root) => {
  const levels = [
    {
      code: "financial_trainee",
      short: "FT",
      name: "Financial Trainee",
      factor: 2,
      path: "Inicio",
      base: { start: true },
    },
    {
      code: "financial_consultant",
      short: "FC",
      name: "Financial Consultant",
      factor: 2.5,
      path: "Inicio",
      base: { historical: 1000 },
    },
    {
      code: "financial_consultant_senior_i",
      short: "FCS I",
      name: "Financial Consultant Senior I",
      factor: 3.5,
      path: "Especialización",
      base: { quarter: 1000, historical: 6000 },
    },
    {
      code: "financial_consultant_senior_ii",
      short: "FCS II",
      name: "Financial Consultant Senior II",
      factor: 4.5,
      path: "Especialización",
      base: { quarter: 2000, historical: 25000 },
    },
    {
      code: "team_manager",
      short: "GE",
      name: "Gestor de Equipo",
      factor: 3.5,
      path: "Dirección de equipo",
      base: { historical: 4000, team: [{ count: 3, role: "FT" }] },
    },
    {
      code: "zone_coordinator",
      short: "CZ",
      name: "Coordinador de Zona",
      factor: 4.5,
      path: "Dirección de equipo",
      base: {
        totalQuarter: 9000,
        historical: 6000,
        team: [
          { count: 3, role: "GE" },
          { count: 6, role: "FC" },
        ],
      },
      extra: {
        totalQuarter: 11250,
        historical: 6000,
        team: [
          { count: 2, role: "GE" },
          { count: 4, role: "FC" },
        ],
      },
    },
    {
      code: "agency_director",
      short: "DA",
      name: "Director de Agencia",
      factor: 5,
      path: "Dirección de equipo",
      base: {
        totalQuarter: 25000,
        historical: 9000,
        team: [
          { count: 6, role: "GE" },
          { count: 12, role: "FC" },
        ],
      },
      extra: {
        totalQuarter: 31250,
        historical: 9000,
        team: [
          { count: 5, role: "GE" },
          { count: 9, role: "FC" },
        ],
      },
    },
    {
      code: "regional_director",
      short: "DR",
      name: "Director Regional",
      factor: 5.5,
      path: "Dirección de equipo",
      base: { totalQuarter: 60000, team: [{ count: 4, role: "CZ" }] },
      extra: { totalQuarter: 75000, team: [{ count: 3, role: "CZ" }] },
    },
    {
      code: "national_director",
      short: "DN",
      name: "Director Nacional",
      factor: 6,
      path: "Dirección de equipo",
      base: {
        totalQuarter: 120000,
        team: [
          { count: 4, role: "DA" },
          { count: 6, role: "CZ" },
        ],
      },
      extra: {
        totalQuarter: 150000,
        team: [
          { count: 3, role: "DA" },
          { count: 5, role: "CZ" },
        ],
      },
    },
  ];
  if (typeof module === "object" && module.exports) module.exports = levels;
  else root.CareerLevels = levels;
})(typeof window === "object" ? window : globalThis);
