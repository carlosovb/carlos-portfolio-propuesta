// Catálogo visual y normalización de nombres. No contiene información de clientes.
(() => {
  const globalEquity = "Global Equity DB - Clase E";
  const planBaskets = [
    "Perfil Conservador ESG", "Perfil Moderado ESG", "Perfil Dinámico ESG",
    globalEquity, "Renta Variable Multitemática", "Renta Fija Global",
  ];
  function intesaBaskets(levels) {
    return ["", " ESG"].flatMap((suffix) =>
      ["Perfil", "Capital Activo"].flatMap((family) =>
        levels.map((level) => family + " " + level + suffix),
      ),
    ).concat(globalEquity);
  }
  const companies = [
    {
      id: "axa",
      name: "AXA",
      logo: "axa-official.svg",
      resourceLogo: "axa.png",
      products: [
        {
          id: "pias-proyecto-futuro",
          name: "PIAS Proyecto Futuro",
          type: "Seguro de ahorro · PIAS",
          portfolios: [
            "Conservadora+",
            "Moderada+",
            "Equilibrada+",
            "Dinámica+",
            "Responsable+",
            "Global+",
          ],
        },
      ],
    },
    {
      id: "intesa",
      name: "Intesa Sanpaolo Assicurazioni",
      logo: "intesa-sanpaolo-assicurazioni.png",
      products: [
        { name: "TOP Plan", type: "Ahorro periódico", portfolios: planBaskets },
        { name: "TOP Premium", type: "Prima única", portfolios: intesaBaskets(["Base", "Standard", "Plus"]) },
        { name: "TOP PIAS", type: "Seguro de ahorro · PIAS", portfolios: planBaskets },
        { name: "TOP10", type: "Ahorro periódico", portfolios: intesaBaskets(["Conservador", "Moderado", "Dinámico"]) },
      ],
    },
  ];
  const norm = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  function find(value) {
    const key = norm(value);
    return key === "axa"
      ? companies[0]
      : key.startsWith("intesasanpaolo")
        ? companies[1]
        : null;
  }
  window.PortfolioCompanies = {
    list: companies,
    find,
    matchPortfolio: (names, value) => names.find((name) => norm(name) === norm(value)),
    label: (value) => find(value)?.name || String(value || "").trim(),
  };
})();
