// Selección visual; guarda los mismos textos que el editor anterior.
(() => {
  const catalog = window.PortfolioCompanies;
  const custom = "__manual__";
  const mix = "__mix__";
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
      "Cambiar " + { company: "compañía", product: "producto", portfolio: "cesta" }[key],
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
      product = null, readMix = () => "";
    const knownCompany = company?.name || (original.company ? custom : "");
    companyManual.input.value = company ? "" : original.company || "";
    companyManual.label.hidden = knownCompany !== custom;
    companyManual.input.disabled = knownCompany !== custom;
    companyManual.input.required = knownCompany === custom;

    function renderPortfolios(saved = "") {
      portfolios.replaceChildren();
      readMix = () => "";
      const legend = node("legend");
      legend.append(
        node("span", "03", "product-picker-step"),
        document.createTextNode("Cartera de fondos"),
      );
      portfolios.append(legend);
      const options = node("div", undefined, "product-portfolio-options");
      portfolios.append(options);
      const names = product?.portfolios || [];
      if (company?.id === "intesa" && names.length) {
        renderIntesaPortfolios(options, names, saved);
        portfolios.hidden = false;
        return;
      }
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
    function renderIntesaPortfolios(options, names, saved) {
      saved = String(saved || "");
      const single = catalog.matchPortfolio(names, saved);
      const previous = saved.split(/\s+\+\s+/).map((part) => {
        const match = part.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*%$/);
        return match && [catalog.matchPortfolio(names, match[1]), Number(match[2].replace(",", "."))];
      });
      const previousMix = previous.length > 1 && previous.every((part) => part?.[0])
        ? new Map(previous) : new Map();
      const registered = saved && !single && !previousMix.size ? saved : "";
      const group = node("div", undefined, "intesa-basket-allocation");
      const header = node("div", undefined, "intesa-basket-header");
      const summary = node("strong", "", "intesa-basket-total");
      summary.setAttribute("aria-live", "polite");
      header.append(node("span", "Aportación distribuida"), summary);
      const progress = node("progress", undefined, "intesa-basket-progress");
      progress.max = 100;
      progress.setAttribute("aria-label", "Porcentaje de la aportación distribuido");
      const list = node("div", undefined, "intesa-basket-list");
      const add = node("button", "+ Añadir cesta", "panel-secondary intesa-basket-add");
      add.type = "button";
      group.append(header, progress, list, add);
      portfolios.append(group);
      const rows = [];
      function addBasket(name = "", value = "", focus = false) {
        const row = node("div", undefined, "intesa-basket-row");
        const basket = node("select");
        basket.setAttribute("aria-label", "Cesta");
        basket.append(new Option("Elige una cesta", ""));
        for (const option of names) basket.append(new Option(option, option));
        basket.value = name;
        const weight = node("input");
        weight.type = "number";
        weight.min = "0.01";
        weight.max = "100";
        weight.step = "0.01";
        weight.value = value;
        const percentage = node("span", undefined, "intesa-basket-weight");
        const unit = node("span", "%");
        unit.setAttribute("aria-hidden", "true");
        percentage.append(weight, unit);
        const remove = node("button", "×", "intesa-basket-remove");
        remove.type = "button";
        const entry = { basket, weight, remove };
        row.append(basket, percentage, remove);
        list.append(row);
        rows.push(entry);
        remove.addEventListener("click", () => {
          const index = rows.indexOf(entry);
          rows.splice(index, 1);
          row.remove();
          update();
          (rows[index]?.basket || rows[index - 1]?.basket || add).focus();
        });
        if (focus) {
          update();
          basket.focus();
        }
      }
      const update = () => {
        group.hidden = !mixRadio.checked;
        const namesInUse = new Set(rows.map(({ basket }) => basket.value).filter(Boolean));
        let cents = 0, valid = rows.length >= 2 && namesInUse.size === rows.length;
        for (const { basket, weight, remove } of rows) {
          basket.disabled = weight.disabled = group.hidden;
          basket.required = weight.required = !group.hidden;
          weight.setAttribute("aria-label", basket.value ? "Porcentaje de " + basket.value : "Porcentaje de la cesta");
          remove.setAttribute("aria-label", basket.value ? "Quitar " + basket.value : "Quitar cesta");
          for (const option of basket.options) {
            option.disabled = option.value !== basket.value && namesInUse.has(option.value);
          }
          cents += Math.round(Number(weight.value) * 100);
          if (!weight.value || !weight.validity.valid) valid = false;
        }
        add.disabled = rows.length >= names.length || namesInUse.size !== rows.length;
        summary.textContent = (cents / 100).toLocaleString("es-ES") + " % / 100 %";
        progress.value = Math.min(cents / 100, 100);
        summary.dataset.complete = String(valid && cents === 10000);
        mixRadio.setCustomValidity(!group.hidden && (!valid || cents !== 10000)
          ? "Selecciona al menos dos cestas y reparte exactamente el 100 %." : "");
      };
      const select = (value) => {
        update();
        collapse(value === mix ? "Reparto entre cestas" : value);
      };
      const collapse = compactSelection(portfolios, options, "portfolio");
      for (const name of names) choice(options, "portfolio", name, name, "100 %", name === single, select);
      if (registered) choice(options, "portfolio", registered, registered, "Cesta registrada", true, select);
      const mixRadio = choice(options, "portfolio", mix, "Repartir entre cestas", "Asigna un porcentaje a cada una", !!previousMix.size, select);
      mixRadio.addEventListener("invalid", (event) => {
        if (group.hidden) return;
        event.preventDefault();
        (rows.at(-1)?.weight || add).focus();
      });
      for (const [name, weight] of previousMix) addBasket(name, weight);
      add.addEventListener("click", () => {
        const first = rows[0]?.weight;
        const remaining = rows.length === 1 && first.value && first.validity.valid
          ? (10000 - Math.round(Number(first.value) * 100)) / 100
          : "";
        addBasket("", remaining, true);
      });
      group.addEventListener("input", update);
      group.addEventListener("change", update);
      readMix = () => rows.filter(({ basket, weight }) => basket.value && weight.value)
        .map(({ basket, weight }) => basket.value + " " + Number(weight.value) + " %").join(" + ");
      select(previousMix.size ? mix : single || registered || "");
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
      let suggestedPortfolio = savedProduct ? "" : savedPortfolio;
      function select(value, portfolio = suggestedPortfolio) {
        collapseProduct(value);
        product = available.find((p) => p.name === value) || null;
        manual.label.hidden = value !== custom;
        manual.input.disabled = value !== custom;
        manual.input.required = value === custom;
        conditions.hidden = !value;
        if (value) {
          renderPortfolios(portfolio);
          suggestedPortfolio = "";
        } else portfolios.hidden = true;
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
          portfolio: (values.portfolio === mix ? readMix() : values.portfolio || values.manual_portfolio || "").trim(),
        };
      },
    };
  }
  window.ProductPicker = { mount };
})();
