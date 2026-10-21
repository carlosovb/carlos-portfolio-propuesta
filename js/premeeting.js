(() => {
  const M = window.PremeetingModel,
    get = (id) => document.getElementById(id);
  let data = M.initial(),
    step = 0,
    reached = 0,
    sending = false,
    submitted = false;
  const id = crypto.randomUUID();
  const steps = [
    "Vuestros datos",
    "Objetivos",
    "Ingresos",
    "Gastos",
    "Ahorro y productos",
    "Revisar y enviar",
  ];
  const content = get("premeeting-content");
  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function button(text, fn, cls = "premeeting-secondary") {
    const n = el("button", text, cls);
    n.type = "button";
    n.addEventListener("click", fn);
    return n;
  }
  function field(parent, label, obj, key, options = {}) {
    const wrap = el("label", undefined, "premeeting-field");
    wrap.append(el("span", label));
    const input = el(options.options ? "select" : "input");
    if (options.options)
      options.options.forEach((value) => {
        const o = el("option", value || "Selecciona una opción");
        o.value = value;
        input.append(o);
      });
    else {
      input.type = options.type || "text";
      input.maxLength = options.max || 120;
      if (options.type === "number") {
        input.min = "18";
        input.max = "120";
        input.step = "1";
      }
    }
    input.required = !!options.required;
    input.value = obj[key];
    if (options.autocomplete) input.autocomplete = options.autocomplete;
    input.addEventListener("input", () => (obj[key] = input.value));
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
  function money(parent, label, obj, key, months = false) {
    const wrap = el("label", undefined, "premeeting-field premeeting-money");
    wrap.append(el("span", label));
    const controls = el("div", undefined, "premeeting-money-controls"),
      select = el("select"),
      input = el("input");
    Object.entries(M.statuses).forEach(([key, text]) => {
      const o = el("option", text);
      o.value = key;
      select.append(o);
    });
    select.value = obj[key].status;
    select.setAttribute("aria-label", `${label} · opción`);
    input.type = "number";
    input.inputMode = months ? "numeric" : "decimal";
    input.min = "0";
    input.max = months ? "1200" : "100000000";
    input.step = months ? "1" : "0.01";
    input.placeholder = months ? "Meses aproximados" : "Importe en €";
    input.setAttribute("aria-label", label);
    input.value = obj[key].value ?? "";
    input.disabled = select.value !== "known";
    input.required = !input.disabled;
    select.addEventListener("change", () => {
      obj[key] = { status: select.value, value: null };
      input.value = "";
      input.disabled = select.value !== "known";
      input.required = !input.disabled;
    });
    input.addEventListener(
      "input",
      () => (obj[key].value = input.value === "" ? null : Number(input.value)),
    );
    controls.append(select, input);
    wrap.append(controls);
    parent.append(wrap);
  }
  function group(title) {
    const f = el("fieldset", undefined, "premeeting-person");
    f.append(el("legend", title));
    content.append(f);
    return f;
  }
  const name = (p, i) => p.first_name || `Persona ${i + 1}`;
  function groups(fn, shared = false) {
    data.people.forEach((p, i) => fn(group(name(p, i)), p));
    if (shared && data.mode === "couple")
      fn(group("Compartido · indicar una sola vez"), data.shared);
  }
  function goals(parent, g) {
    const list = el("div");
    g.goals.forEach((goal, index) => {
      const row = el("div", undefined, "premeeting-repeater");
      const grid = el("div", undefined, "premeeting-grid");
      field(grid, "Objetivo", goal, "label", { required: true, max: 120 });
      field(grid, "Prioridad (opcional)", goal, "priority", {
        options: ["", "Alta", "Media", "Baja"],
      });
      row.append(
        grid,
        button("Quitar objetivo", () => {
          g.goals.splice(index, 1);
          render();
        }),
      );
      list.append(row);
    });
    parent.append(list);
    const choices = el("div", undefined, "premeeting-choices");
    M.goals
      .filter((label) => !g.goals.some((g) => g.label === label))
      .forEach((label) =>
        choices.append(
          button(`+ ${label}`, () => {
            if (g.goals.length < 12) {
              g.goals.push({ label, priority: "" });
              render();
            }
          }),
        ),
      );
    parent.append(choices);
    parent.append(
      button("+ Añadir otro objetivo", () => {
        if (g.goals.length < 12) {
          g.goals.push({ label: "", priority: "" });
          render();
        }
      }),
    );
  }
  function expenses(parent, g) {
    parent.append(
      el(
        "p",
        "Incluye aquí solo los gastos de este apartado. La financiación del coche va en préstamos, no en transporte. La hipoteca va en vivienda, no se repite como préstamo.",
      ),
    );
    const expenseGrid = el("div", undefined, "premeeting-grid");
    M.expenses.forEach(([key, label]) => money(expenseGrid, label, g.expenses, key));
    parent.append(expenseGrid);
    money(parent, "Hipoteca · meses pendientes aproximados", g, "mortgage_months", true);
    parent.append(el("h3", "Préstamos y financiación"));
    parent.append(
      el(
        "p",
        "Añade cada préstamo: coche, personal, compras financiadas, tarjetas… Si no tienes, no añadas ninguno.",
      ),
    );
    g.loans.forEach((loan, i) => {
      const row = el("div", undefined, "premeeting-repeater");
      field(row, "Tipo o nombre del préstamo", loan, "label", { required: true });
      money(row, "Cuota mensual", loan, "payment");
      money(row, "Meses aproximados pendientes", loan, "months", true);
      row.append(
        button("Quitar préstamo", () => {
          g.loans.splice(i, 1);
          render();
        }),
      );
      parent.append(row);
    });
    parent.append(
      button("+ Añadir préstamo", () => {
        if (g.loans.length < 20) {
          g.loans.push({ label: "", payment: M.money(), months: M.money() });
          render();
        }
      }),
    );
  }
  function assets(parent, g) {
    const skip = el("label", undefined, "premeeting-consent"),
      check = el("input");
    check.type = "checkbox";
    check.checked = g.assets_skipped;
    check.addEventListener("change", () => {
      g.assets_skipped = check.checked;
      if (check.checked) g.assets = [];
      render();
    });
    skip.append(
      check,
      el(
        "span",
        "Saltar este apartado · prefiero comentarlo en la reunión (se quitarán los productos añadidos aquí)",
      ),
    );
    parent.append(skip);
    if (g.assets_skipped) return;
    g.assets.forEach((a, i) => {
      const row = el("div", undefined, "premeeting-repeater");
      field(row, "Qué producto tienes", a, "product", {
        options: M.products,
        required: true,
      });
      field(row, "Nombre o aclaración (opcional)", a, "label");
      money(row, "Cantidad depositada o valor actual aproximado", a, "amount");
      row.append(
        button("Quitar producto", () => {
          g.assets.splice(i, 1);
          render();
        }),
      );
      parent.append(row);
    });
    parent.append(
      button("+ Añadir cuenta o producto", () => {
        if (g.assets.length < 20) {
          g.assets.push({ product: "Cuenta bancaria", label: "", amount: M.money() });
          render();
        }
      }),
    );
  }
  function render() {
    content.replaceChildren();
    get("premeeting-error").hidden = true;
    const progress = get("premeeting-progress");
    progress.replaceChildren();
    steps.forEach((label, i) => {
      const b = button("", () => go(i));
      b.append(el("strong", String(i + 1).padStart(2, "0")), el("span", label));
      b.disabled = i > reached;
      if (i === step) b.setAttribute("aria-current", "step");
      progress.append(b);
    });
    const title = el("h2", steps[step]);
    title.tabIndex = -1;
    content.append(title);
    if (step === 0) {
      const choices = el("div", undefined, "premeeting-choices");
      [
        ["individual", "Individual"],
        ["couple", "En pareja"],
      ].forEach(([value, label]) => {
        const wrap = el("label"),
          radio = el("input");
        radio.type = "radio";
        radio.name = "mode";
        radio.value = value;
        radio.checked = data.mode === value;
        radio.addEventListener("change", () => {
          if (
            value === "individual" &&
            data.people.length === 2 &&
            !confirm(
              "Se quitarán los datos de la segunda persona y los compartidos. ¿Continuar?",
            )
          ) {
            render();
            return;
          }
          data.mode = value;
          data.people =
            value === "couple" ? [data.people[0], M.person()] : [data.people[0]];
          if (value === "individual") data.shared = M.initial().shared;
          render();
        });
        wrap.append(radio, el("span", label));
        choices.append(wrap);
      });
      content.append(choices);
      groups((parent, p) => {
        const grid = el("div", undefined, "premeeting-grid");
        field(grid, "Nombre *", p, "first_name", { required: true, max: 80 });
        field(grid, "Apellidos *", p, "last_name", { required: true });
        field(grid, "Edad *", p, "age", { required: true, type: "number" });
        field(grid, "Ocupación *", p, "occupation", { required: true });
        field(grid, "Situación laboral *", p, "employment", {
          required: true,
          options: [
            "",
            "Por cuenta ajena",
            "Autónomo/a",
            "Empresario/a",
            "En búsqueda de empleo",
            "Estudiante",
            "Jubilado/a o pensionista",
            "Otra situación",
          ],
        });
        parent.append(grid);
      });
      const contact = group("Contacto principal"),
        grid = el("div", undefined, "premeeting-grid");
      field(grid, "Correo electrónico *", data.contact, "email", {
        required: true,
        type: "email",
        max: 254,
        autocomplete: "email",
      });
      const phone = field(grid, "Teléfono *", data.contact, "phone", {
        required: true,
        type: "tel",
        max: 30,
        autocomplete: "tel",
      });
      const checkPhone = () =>
        phone.setCustomValidity(
          phone.value && !/^\+?[0-9]{7,20}$/.test(phone.value.replace(/[ ()-]/g, ""))
            ? "Indica un teléfono válido con al menos 7 cifras."
            : "",
        );
      phone.addEventListener("input", checkPhone);
      checkPhone();
      contact.append(grid);
      content.append(
        el(
          "p",
          "Los datos personales y ambas formas de contacto son obligatorios. Formulario para mayores de 18 años.",
        ),
      );
    } else if (step === 1) {
      content.append(
        el(
          "p",
          "Elige solo los objetivos que te interesen. La prioridad es opcional: alta, media o baja. Los importes y plazos los concretaremos en la reunión.",
        ),
      );
      groups(goals, true);
    } else if (step === 2) {
      content.append(
        el(
          "p",
          "Importes netos: lo que recibes después de impuestos. Si no tienes un ingreso, elige indicar la cantidad y escribe 0. Las pagas extra se indican como total anual, sin repetirlas en el sueldo mensual.",
        ),
      );
      groups((parent, p) => {
        const grid = el("div", undefined, "premeeting-grid");
        M.income.forEach(([key, label]) => money(grid, label, p.income, key));
        parent.append(grid);
      });
    } else if (step === 3) {
      content.append(
        el(
          "p",
          data.mode === "couple"
            ? "Primero los gastos personales de cada uno y después los compartidos, sin duplicarlos. Usa medias mensuales para los pagos anuales."
            : "Usa importes mensuales aproximados. Para un gasto que no tienes, indica 0. Para pagos anuales, divide entre 12.",
        ),
      );
      groups(expenses, true);
    } else if (step === 4) {
      content.append(
        el(
          "p",
          "Este apartado es opcional: puedes saltarlo. Solo necesitamos saber qué producto tienes y cuánto hay aproximadamente. No indiques IBAN, contraseñas ni números de contrato. El dinero compartido se añade una sola vez.",
        ),
      );
      groups(assets, true);
    } else {
      const summary = el("div");
      content.append(summary);
      window.PremeetingSummary.render(data, summary, go);
      const label = el("label", undefined, "premeeting-consent"),
        check = el("input");
      check.type = "checkbox";
      check.checked = data.consent;
      check.required = true;
      check.addEventListener("change", () => (data.consent = check.checked));
      label.append(
        check,
        el(
          "span",
          "He leído la información de privacidad y autorizo a Carlos a tratar estas respuestas para preparar nuestra reunión. Si lo rellenamos en pareja, ambas personas conocemos y aceptamos este envío. Las respuestas se eliminarán a los 30 días.",
        ),
      );
      content.append(label);
    }
    get("premeeting-back").hidden = step === 0;
    get("premeeting-next").textContent =
      step === 5 ? "Enviar mis respuestas ↗" : "Continuar →";
    get("premeeting-position").textContent = `${step + 1} de ${steps.length}`;
  }
  function validate() {
    const fields = [...content.querySelectorAll("input,select")];
    const invalid = fields.find((input) => !input.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return false;
    }
    return true;
  }
  function go(next) {
    if (sending || submitted) return;
    if (next > step && !validate()) return;
    step = next;
    reached = Math.max(reached, step);
    render();
    content.querySelector("h2").focus({ preventScroll: true });
    get("premeeting-progress").scrollIntoView({ block: "start", behavior: "instant" });
  }
  get("premeeting-back").addEventListener("click", () => go(step - 1));
  get("premeeting-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending || submitted || !validate()) return;
    if (step < 5) {
      go(step + 1);
      return;
    }
    const invalid = M.invalidStep(data);
    if (invalid !== null) {
      go(invalid);
      get("premeeting-error").textContent =
        "Revisa los campos de este apartado antes de enviar. Puedes quitar las filas que no quieras completar.";
      get("premeeting-error").hidden = false;
      return;
    }
    sending = true;
    get("premeeting-next").disabled = true;
    get("premeeting-next").textContent = "Enviando…";
    try {
      const config = window.PORTFOLIO_BACKEND;
      const response = await fetch(`${config.url}/rest/v1/rpc/submit_premeeting`, {
        method: "POST",
        headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ p_id: id, p_payload: data }),
        signal: AbortSignal.timeout(25000),
        cache: "no-store",
      });
      if (!response.ok || (await response.json()) !== true) throw Error("send");
      submitted = true;
      data = null;
      content.replaceChildren();
      get("premeeting-workspace").hidden = true;
      get("premeeting-intro").hidden = true;
      get("premeeting-success").hidden = false;
      get("premeeting-success").focus();
    } catch {
      get("premeeting-error").textContent =
        "No se ha podido enviar. Tus respuestas siguen aquí. Comprueba la conexión y vuelve a intentarlo; un reintento no duplica el envío.";
      get("premeeting-error").hidden = false;
    } finally {
      sending = false;
      get("premeeting-next").disabled = false;
      get("premeeting-next").textContent = "Enviar mis respuestas ↗";
    }
  });
  addEventListener("beforeunload", (event) => {
    if (!submitted && (reached > 0 || data.people[0].first_name)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  render();
})();
