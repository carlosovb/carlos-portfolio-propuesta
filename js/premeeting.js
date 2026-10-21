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
  const C = window.PremeetingControls;
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
    wrap.append(options.options ? C.selectControl(input, label) : input);
    parent.append(wrap);
    return input;
  }
  function money(parent, label, obj, key, months = false) {
    const wrap = el("div", undefined, "premeeting-field premeeting-money");
    const heading = el("div", undefined, "premeeting-money-heading");
    heading.append(
      C.icon(months ? "clock" : key === "mortgage" || key === "rent" ? "home" : "wallet"),
      el("span", label),
    );
    wrap.append(heading);
    const input = el("input");
    input.type = "number";
    input.inputMode = months ? "numeric" : "decimal";
    input.min = "0";
    input.max = months ? "1200" : "100000000";
    input.step = months ? "1" : "0.01";
    input.placeholder = "0";
    input.setAttribute("aria-label", label);
    input.value = obj[key].value ?? "";
    const entry = el("div", undefined, "premeeting-amount-entry");
    entry.append(input, el("span", months ? "meses" : "€"));
    const options = el("div", undefined, "premeeting-money-options");
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", `${label} · opción`);
    const hint = el("p", undefined, "premeeting-money-hint");
    const buttons = [];
    function refresh() {
      const known = obj[key].status === "known";
      input.disabled = !known;
      input.required = known;
      entry.hidden = !known;
      hint.hidden = known;
      hint.textContent =
        obj[key].status === "meeting"
          ? "Lo veremos juntos en la reunión."
          : "No pasa nada si no tienes esta cifra a mano.";
      wrap.dataset.status = obj[key].status;
      buttons.forEach(([value, btn]) =>
        btn.setAttribute("aria-pressed", String(value === obj[key].status)),
      );
    }
    [
      ["known", months ? "Indicar meses" : "Indicar importe"],
      ["unknown", "No lo sé"],
      ["meeting", "En la reunión"],
    ].forEach(([value, text]) => {
      const btn = button(
        text,
        () => {
          if (obj[key].status !== value) {
            obj[key] = { status: value, value: null };
            input.value = "";
          }
          refresh();
          if (value === "known") input.focus({ preventScroll: true });
        },
        "premeeting-option",
      );
      btn.title = M.statuses[value];
      buttons.push([value, btn]);
      options.append(btn);
    });
    input.addEventListener(
      "input",
      () => (obj[key].value = input.value === "" ? null : Number(input.value)),
    );
    wrap.append(options, entry, hint);
    refresh();
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
  const goalLooks = [
    ["shield", "mint", "Un respaldo para lo inesperado"],
    ["savings", "copper", "Dar el primer paso, a tu ritmo"],
    ["chart", "blue", "Saber dónde está tu dinero"],
    ["sun", "lavender", "Pensar en tu yo del futuro"],
    ["home", "copper", "Un espacio para tu próxima etapa"],
    ["debt", "blue", "Ganar tranquilidad mes a mes"],
    ["heart", "rose", "Cuidar de quienes más importan"],
    ["children", "mint", "Acompañar su futuro desde hoy"],
  ];
  function priorities(parent, goal) {
    const priorities = el("div", undefined, "premeeting-priorities");
    priorities.setAttribute("role", "group");
    priorities.setAttribute(
      "aria-label",
      `Prioridad de ${goal.label || "tu objetivo"} (opcional)`,
    );
    const title = el("span", "Tu prioridad", "premeeting-priority-label");
    priorities.append(title);
    ["Alta", "Media", "Baja"].forEach((priority) => {
      const btn = button(
        priority,
        () => {
          goal.priority = goal.priority === priority ? "" : priority;
          update();
        },
        "premeeting-priority",
      );
      btn.dataset.priority = priority;
      function update() {
        [...priorities.querySelectorAll("button")].forEach((b) =>
          b.setAttribute("aria-pressed", String(b.textContent === goal.priority)),
        );
      }
      priorities.append(btn);
      update();
    });
    parent.append(priorities);
  }
  function goals(parent, g) {
    const groupIndex = [...content.querySelectorAll(".premeeting-person")].indexOf(
      parent,
    );
    const header = el("div", undefined, "premeeting-goals-heading");
    header.append(
      el("p", "¿Qué te gustaría conseguir?"),
      el("span", `${g.goals.length} seleccionados`, "premeeting-selected-count"),
    );
    parent.append(header);
    const grid = el("div", undefined, "premeeting-goal-grid");
    M.goals.forEach((label, i) => {
      const goal = g.goals.find((x) => x.label === label),
        [icon, tone, description] = goalLooks[i];
      const card = el("article", undefined, "premeeting-goal-card");
      card.dataset.tone = tone;
      card.dataset.selected = String(!!goal);
      const pick = button(
        "",
        () => {
          if (goal) g.goals.splice(g.goals.indexOf(goal), 1);
          else if (g.goals.length < 12) g.goals.push({ label, priority: "" });
          render();
          [...content.querySelectorAll(".premeeting-person")][groupIndex]
            ?.querySelectorAll(".premeeting-goal-pick")
            [i]?.focus({ preventScroll: true });
        },
        "premeeting-goal-pick",
      );
      pick.setAttribute("aria-label", label);
      pick.setAttribute("aria-pressed", String(!!goal));
      pick.disabled = !goal && g.goals.length >= 12;
      const badge = el("span", undefined, "premeeting-goal-icon");
      badge.append(C.icon(icon));
      const copy = el("span", undefined, "premeeting-goal-copy");
      copy.append(el("strong", label), el("small", description));
      const state = el("span", undefined, "premeeting-goal-check");
      state.append(C.icon(goal ? "check" : "plus"));
      pick.append(badge, copy, state);
      card.append(pick);
      if (goal) priorities(card, goal);
      grid.append(card);
    });
    parent.append(grid);
    g.goals
      .filter((goal) => !M.goals.includes(goal.label))
      .forEach((goal) => {
        const card = el("article", undefined, "premeeting-custom-goal");
        const heading = el("div", undefined, "premeeting-row-heading");
        heading.append(C.icon("plus"), el("h4", "Tu propio objetivo"));
        card.append(heading);
        field(card, "¿Qué quieres conseguir?", goal, "label", {
          required: true,
          max: 120,
        });
        priorities(card, goal);
        card.append(
          button(
            "Quitar objetivo",
            () => {
              g.goals.splice(g.goals.indexOf(goal), 1);
              render();
            },
            "premeeting-remove",
          ),
        );
        parent.append(card);
      });
    const add = button(
      "+ Añadir otro objetivo",
      () => {
        if (g.goals.length < 12) {
          g.goals.push({ label: "", priority: "" });
          render();
          const inputs = content.querySelectorAll(".premeeting-custom-goal input");
          inputs[inputs.length - 1]?.focus({ preventScroll: true });
        }
      },
      "premeeting-add",
    );
    add.disabled = g.goals.length >= 12;
    parent.append(add);
    parent.append(
      el(
        "p",
        "No necesitas elegirlos todos. Puedes cambiar una prioridad o desmarcarla pulsando de nuevo.",
        "premeeting-helper",
      ),
    );
  }
  function expenses(parent, g) {
    parent.append(
      el(
        "p",
        "Incluye aquí solo los gastos de este apartado. La financiación del coche va en préstamos, no en transporte. La hipoteca va en vivienda, no se repite como préstamo.",
      ),
    );
    const sections = [
      ["Vivienda y hogar", ["rent", "mortgage", "utilities", "food"]],
      ["Tu día a día", ["transport", "insurance", "subscriptions", "leisure"]],
      ["Familia y otros gastos", ["education", "other"]],
    ];
    sections.forEach(([title, keys]) => {
      parent.append(el("h3", title));
      const expenseGrid = el("div", undefined, "premeeting-grid");
      M.expenses
        .filter(([key]) => keys.includes(key))
        .forEach(([key, label]) => money(expenseGrid, label, g.expenses, key));
      parent.append(expenseGrid);
    });
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
      const heading = el("div", undefined, "premeeting-row-heading");
      heading.append(C.icon("debt"), el("h4", `Préstamo ${i + 1}`));
      row.append(heading);
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
      const heading = el("div", undefined, "premeeting-row-heading");
      heading.append(C.icon("savings"), el("h4", `Cuenta o producto ${i + 1}`));
      row.append(heading);
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
    C.close();
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
    document.body.dataset.step = String(step);
    const sectionLabel = el(
      "p",
      `TU PUNTO DE PARTIDA / ${String(step + 1).padStart(2, "0")}`,
      "premeeting-section-label",
    );
    content.append(sectionLabel);
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
      const custom = invalid.closest(".premeeting-select");
      if (custom) {
        custom.querySelector('[role="combobox"]').focus();
        get("premeeting-error").textContent =
          "Selecciona una opción en el campo indicado para continuar.";
        get("premeeting-error").hidden = false;
        return false;
      }
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
