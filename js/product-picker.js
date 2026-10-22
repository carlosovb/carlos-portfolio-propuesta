// Selección visual; guarda los mismos textos que el editor anterior.
(() => {
  const catalog = window.PortfolioCompanies;
  const custom = "__manual__";
  function node(tag, text, cls) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  }
  function group(title, step) {
    const fieldset = node("fieldset", undefined, "product-picker-group");
    const legend = node("legend");
    legend.append(
      node("span", step, "product-picker-step"),
      document.createTextNode(title),
    );
    fieldset.append(legend);
    return fieldset;
  }
  function choice(host, name, value, title, description, checked, onChange, company) {
    const label = node("label", undefined, "product-choice");
    const radio = node("input");
    radio.type = "radio";
    radio.name = name;
    radio.value = value;
    radio.checked = checked;
    radio.required = true;
    const copy = node("span", undefined, "product-choice-copy");
    if (company) {
      const img = node("img");
      img.src = "../assets/companies/" + company.logo;
      img.alt = "";
      img.dataset.company = company.id;
      copy.append(img);
    }
    copy.append(node("strong", title));
    if (description) copy.append(node("small", description));
    const tick = node("span", "✓", "product-choice-tick");
    tick.setAttribute("aria-hidden", "true");
    copy.append(tick);
    label.append(radio, copy);
    host.append(label);
    radio.addEventListener("change", () => {
      if (radio.checked) onChange(value);
    });
    return radio;
  }
  function manualInput(host, text, name, max) {
    const label = node("label", text, "product-manual-field"),
      input = node("input");
    input.name = name;
    input.maxLength = max;
    input.addEventListener("input", () =>
      input.setCustomValidity(input.value.trim() ? "" : "Escribe un nombre."),
    );
    label.append(input);
    host.append(label);
    return { label, input };
  }
  function compactSelection(group, options, key) {
    group.dataset.choice = key;
    const summary = node("div", undefined, "product-selected");
    const text = node("strong");
    const change = node("button", "Cambiar", "product-change");
    change.type = "button";
    change.setAttribute(
      "aria-label",
      "Cambiar " + (key === "company" ? "compañía" : "producto"),
    );
    change.addEventListener("click", () => {
      summary.hidden = true;
      options.hidden = false;
      change.setAttribute("aria-expanded", "true");
      (options.querySelector("input:checked") || options.querySelector("input"))?.focus({
        preventScroll: true,
      });
    });
    summary.append(text, change);
    group.insertBefore(summary, options);
    return (value) => {
      const collapse = !!value && value !== custom;
      const moveFocus = collapse && options.contains(document.activeElement);
      text.textContent = value || "";
      summary.hidden = !collapse;
      options.hidden = collapse;
      change.setAttribute("aria-expanded", String(!collapse));
      if (moveFocus) change.focus({ preventScroll: true });
    };
  }
  function mount(form, original, conditions) {
    const root = node("div", undefined, "product-picker");
    const companies = group("Elige la compañía", "01");
    const companyOptions = node("div", undefined, "product-company-options");
    companies.append(companyOptions);
    const collapseCompany = compactSelection(companies, companyOptions, "company");
    const companyManual = manualInput(
      companies,
      "Nombre de la compañía",
      "manual_company",
      120,
    );
    const products = group("Elige el producto", "02");
    const portfolios = group("Cartera de fondos", "03");
    const status = node("p", undefined, "product-picker-status");
    status.setAttribute("role", "status");
    root.append(companies, status, products, portfolios);
    form.append(root);
    let company = catalog.find(original.company),
      product = null;
    const knownCompany = company?.name || (original.company ? custom : "");
    companyManual.input.value = company ? "" : original.company || "";
    companyManual.label.hidden = knownCompany !== custom;
    companyManual.input.disabled = knownCompany !== custom;
    companyManual.input.required = knownCompany === custom;

    function renderPortfolios(saved = "") {
      portfolios.replaceChildren();
      const legend = node("legend");
      legend.append(
        node("span", "03", "product-picker-step"),
        document.createTextNode("Cartera de fondos"),
      );
      portfolios.append(legend);
      const options = node("div", undefined, "product-portfolio-options");
      portfolios.append(options);
      const names = product?.portfolios || [];
      const isManual = !!saved && !names.includes(saved);
      const manual = manualInput(
        portfolios,
        "Nombre de la cartera",
        "manual_portfolio",
        160,
      );
      manual.input.value = isManual ? saved : "";
      const reference = node("div", undefined, "axa-selected-reference");
      portfolios.append(reference);
      function toggle(value) {
        reference.replaceChildren();
        if (company?.id === "axa") {
          const info = window.AxaPortfolios?.details(value);
          if (info) reference.append(info);
        }
        manual.label.hidden = value !== custom;
        manual.input.disabled = value !== custom;
        manual.input.required = value === custom;
      }
      names.forEach((name) => {
        const radio = choice(
          options,
          "portfolio",
          name,
          name,
          "",
          saved === name,
          toggle,
        );
        if (company?.id === "axa") window.AxaPortfolios?.decorate(radio, name);
      });
      if (names.length) {
        manual.label.hidden = true;
        manual.input.disabled = true;
        manual.input.required = false;
        if (saved && !names.includes(saved))
          portfolios.append(
            node(
              "p",
              "Selecciona una cartera del catálogo para actualizar este contrato.",
              "product-picker-help",
            ),
          );
        toggle(names.includes(saved) ? saved : "");
      } else {
        manual.label.firstChild.textContent = "Cartera de fondos";
        manual.label.hidden = false;
        manual.input.disabled = false;
        manual.input.required = true;
        manual.input.value = saved;
      }
      portfolios.hidden = false;
    }
    function renderProducts(selectedCompany, savedProduct = "", savedPortfolio = "") {
      collapseCompany(selectedCompany);
      company = catalog.find(selectedCompany);
      companyManual.label.hidden = selectedCompany !== custom;
      companyManual.input.disabled = selectedCompany !== custom;
      companyManual.input.required = selectedCompany === custom;
      products.replaceChildren();
      const legend = node("legend");
      legend.append(
        node("span", "02", "product-picker-step"),
        document.createTextNode("Elige el producto"),
      );
      products.append(legend);
      const available = company?.products || [];
      const options = node("div", undefined, "product-product-options");
      products.append(options);
      const collapseProduct = compactSelection(products, options, "product");
      if (!available.length)
        products.append(
          node(
            "p",
            "Todavía no hay productos en el catálogo de esta compañía. Puedes registrar el nombre manualmente.",
            "product-picker-help",
          ),
        );
      const manual = manualInput(products, "Nombre del producto", "manual_product", 160);
      const known = available.find((p) => p.name === savedProduct);
      const isManual = !!savedProduct && !known;
      manual.input.value = isManual ? savedProduct : "";
      function select(value, portfolio = "") {
        collapseProduct(value);
        product = available.find((p) => p.name === value) || null;
        manual.label.hidden = value !== custom;
        manual.input.disabled = value !== custom;
        manual.input.required = value === custom;
        conditions.hidden = !value;
        if (value) renderPortfolios(portfolio);
        else portfolios.hidden = true;
      }
      available.forEach((p) =>
        choice(
          options,
          "product",
          p.name,
          p.name,
          p.type,
          known?.name === p.name,
          (value) => select(value),
        ),
      );
      choice(
        options,
        "product",
        custom,
        "Otro producto",
        "Introducir el nombre manualmente",
        isManual,
        (value) => select(value),
      );
      select(known?.name || (isManual ? custom : ""), savedPortfolio);
      products.hidden = !selectedCompany;
      status.textContent = selectedCompany
        ? (company?.name || "Otra compañía") +
          " · " +
          available.length +
          (available.length === 1 ? " producto en catálogo" : " productos en catálogo")
        : "Selecciona una compañía para ver sus productos.";
    }
    catalog.list.forEach((c) =>
      choice(
        companyOptions,
        "company",
        c.name,
        c.name,
        "",
        knownCompany === c.name,
        (value) => renderProducts(value),
        c,
      ),
    );
    choice(
      companyOptions,
      "company",
      custom,
      "Otra compañía",
      "Introducir el nombre",
      knownCompany === custom,
      (value) => renderProducts(value),
    );
    renderProducts(knownCompany, original.product, original.portfolio);
    return {
      read(values) {
        return {
          company:
            values.company === custom
              ? String(values.manual_company || "").trim()
              : values.company || "",
          product:
            values.product === custom
              ? String(values.manual_product || "").trim()
              : values.product || "",
          portfolio: (values.portfolio || values.manual_portfolio || "").trim(),
        };
      },
    };
  }
  window.ProductPicker = { mount };
})();
