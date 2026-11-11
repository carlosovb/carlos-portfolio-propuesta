(() => {
  const product = "Vida Protect";
  const covers = [
    ["death", "Fallecimiento por cualquier causa", "cualq causa"],
    ["death_accident", "Fallecimiento por accidente", "fallec. accid"],
    ["death_traffic", "Fallecimiento por accidente de circulación", "fallec. accid circulacion"],
    ["disability", "Incapacidad permanente absoluta por cualquier causa", "incapac cualquier causa"],
    ["disability_accident", "Incapacidad permanente absoluta por accidente", "por accid"],
    ["disability_traffic", "Incapacidad permanente absoluta por accidente de circulación", "x accid. circ"],
    ["occupational_disability", "Incapacidad permanente total para la profesión habitual", "incap perm. prof habit"],
    ["critical_illness", "Enfermedades graves", "enfermedades graves"],
  ];
  const norm = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const isProduct = (company, name) => norm(company) === "axa" && norm(name) === "vida protect";
  const money = (value) => {
    const text = String(value ?? "").replace(/[€\s]/g, "");
    if (!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(text)) return null;
    const amount = Number(text.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  };
  function date(day, month, year) {
    if (!day || !month || !/^\d{4}$/.test(year)) return "";
    const value = year + "-" + month.padStart(2, "0") + "-" + day.padStart(2, "0");
    const parsed = new Date(value + "T00:00:00Z");
    return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value ? value : "";
  }
  function request(fields, signature) {
    const lookup = (items) => new Map(items.filter((field) => !field.hidden && field.fieldType === "Tx")
      .map((field) => [norm(field.fieldName), String(field.fieldValue ?? "").trim()]));
    const first = lookup(fields), last = lookup(signature);
    const holder = ["nombre o razon social", "primer apellido", "segundo apellido"]
      .map((key) => first.get(key)).filter(Boolean).join(" ");
    const marked = fields.find((field) => !field.hidden && norm(field.fieldName) === "persona fisica" &&
      field.buttonValue && field.buttonValue === field.fieldValue);
    const index = Number(marked?.buttonValue?.match(/[1-4]$/)?.[0]) - 1;
    const monthName = norm(last.get("fecha mes"));
    const months = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split(" ");
    const month = /^\d{1,2}$/.test(monthName) ? monthName : String(months.indexOf(monthName) + 1);
    const effect = first.get("fecha_efecto")?.match(/^(\d{2})[/. -]?(\d{2})[/. -]?(\d{4})$/);
    const coverages = Object.fromEntries(covers.map(([key, , field]) => [key, money(first.get("capital asegurado / " + field))])
      .filter(([, amount]) => amount !== null));
    return {
      draft: {
        company: "AXA", product, portfolio: "", amount: null, units: null, signed_multiplier: "",
        payment_type: ["annual", "semiannual", "quarterly", "monthly"][index] || "",
        signed_on: date(last.get("fecha dia"), month, last.get("fecha ano") || ""),
        life_coverages: coverages,
        life_effective_on: effect ? date(effect[1], effect[2], effect[3]) : "",
      },
      source: { holder, lifeDocument: "request" },
    };
  }
  function offer(cover, table, premium) {
    const label = cover.find((item) => norm(item.str) === "tomador");
    const holder = label && cover.find((item) => {
      const [x, y] = item.transform.slice(-2);
      const [left, top] = label.transform.slice(-2);
      return Math.abs(x - left) < 12 && top - y > 8 && top - y < 42 &&
        /^[\p{L}\p{M} ,.'’-]+$/u.test(item.str.trim());
    })?.str.trim();
    const protections = {};
    for (const [key, name] of covers) {
      const line = table.find((item) => norm(item.str).startsWith(norm(name)) &&
        !/ accidente| circulacion/.test(norm(item.str).slice(norm(name).length)));
      if (!line) continue;
      const [x, y] = line.transform.slice(-2);
      const [capital, net] = table.filter((item) => item.transform[4] > x && Math.abs(item.transform[5] - y) < 2 && /€/.test(item.str))
        .sort((a, b) => a.transform[4] - b.transform[4]).map((item) => money(item.str));
      if (capital) protections[key] = { capital, net };
    }
    const annual = premium.find((item) => norm(item.str) === "anual");
    const [net, total] = annual ? premium.filter((item) => /€/.test(item.str) &&
      Math.abs(item.transform[4] - annual.transform[4]) < 55 && annual.transform[5] > item.transform[5] &&
      annual.transform[5] - item.transform[5] < 65)
      .sort((a, b) => b.transform[5] - a.transform[5]).map((item) => money(item.str)) : [];
    return { draft: { company: "AXA", product }, source: { holder, lifeDocument: "offer", protections, net, total } };
  }
  window.LifeProtect = { covers, isProduct, request, offer };
})();
