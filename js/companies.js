// Catálogo visual y normalización de nombres. No contiene información de clientes.
(() => {
  const globalEquity = "Global Equity DB - Clase E";
  const intesaApex = { minimum: 300, wait: "dos meses" };
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
        { name: "TOP Plan", type: "Ahorro periódico", portfolios: planBaskets, apex: intesaApex },
        { name: "TOP Premium", type: "Prima única", portfolios: intesaBaskets(["Base", "Standard", "Plus"]), apex: { ...intesaApex, wait: "30 días", transferAll: true } },
        { name: "TOP PIAS", type: "Seguro de ahorro · PIAS", portfolios: planBaskets, apex: { ...intesaApex, annual: 8000 } },
        { name: "TOP10", type: "Ahorro periódico", portfolios: intesaBaskets(["Conservador", "Moderado", "Dinámico"]), apex: intesaApex },
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
    isTop10: (company, product) => find(company)?.id === "intesa" && norm(product) === "top10",
    apex: (company, product) => {
      const brand = find(company);
      const entry = brand?.products.find((item) => norm(item.name) === norm(product));
      return brand?.id === "axa" && entry?.name === product ? { minimum: 600, annual: 8000 } : entry?.apex;
    },
    matchPortfolio: (names, value) => names.find((name) => norm(name) === norm(value)),
    label: (value) => find(value)?.name || String(value || "").trim(),
  };
})();
