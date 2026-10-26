// Catálogo visual y normalización de nombres. No contiene información de clientes.
(() => {
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
    label: (value) => find(value)?.name || String(value || "").trim(),
  };
})();
