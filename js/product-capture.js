// OCR local: imágenes y texto permanecen en memoria; no se suben ni persisten.
(() => {
  const base = new URL("../assets/vendor/ocr/", document.currentScript.src);
  function diagnostic(detail) {
    if (["localhost", "127.0.0.1"].includes(location.hostname))
      window.dispatchEvent(new CustomEvent("capture-diagnostic", { detail }));
  }
  let library;
  function load() {
    if (window.Tesseract) return Promise.resolve();
    if (!library)
      library = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = new URL("tesseract.min.js?v=ocr2", base);
        script.onload = () => {
          if (typeof window.Tesseract?.createWorker === "function") resolve();
          else {
            library = null;
            script.remove();
            reject(new Error("library"));
          }
        };
        script.onerror = () => {
          library = null;
          script.remove();
          reject(new Error("No se pudo cargar el lector"));
        };
        document.head.append(script);
      });
    return library;
  }
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, action) => {
    const b = el("button", text, "panel-secondary");
    b.type = "button";
    b.onclick = action;
    return b;
  };
  function createEngine(options) {
    let rejectFailure,
      timeout,
      finished = false;
    const failure = new Promise((_, reject) => {
      rejectFailure = reject;
      timeout = setTimeout(() => reject(new Error("engine-timeout")), 20000);
    });
    const initialization = window.Tesseract.createWorker("spa", 1, {
      ...options,
      errorHandler: (error) => rejectFailure(new Error(String(error))),
    });
    initialization.then(
      (instance) => {
        if (finished) instance.terminate().catch(() => {});
      },
      () => {},
    );
    return Promise.race([initialization, failure]).finally(() => {
      finished = true;
      clearTimeout(timeout);
    });
  }
  function mount(form, { client, existing, onDraft, current }) {
    const root = el("section", null, "capture-import");
    const trigger = button("Importar desde captura", () => {
      body.hidden = !body.hidden;
      trigger.setAttribute("aria-expanded", String(!body.hidden));
      if (!body.hidden) file.focus();
    });
    trigger.setAttribute("aria-expanded", "false");
    const body = el("div", null, "capture-body");
    body.hidden = true;
    const label = el("label", "Sube una captura o pégala aquí con Ctrl + V");
    const file = el("input");
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp";
    label.append(file);
    const status = el(
      "p",
      "También puedes arrastrar la imagen. Se lee en tu dispositivo; nada se guarda automáticamente.",
    );
    status.setAttribute("role", "status");
    const progress = el("progress");
    progress.max = 1;
    progress.hidden = true;
    progress.setAttribute("aria-label", "Lectura de la captura");
    const preview = el("div", null, "capture-preview");
    const cancel = button("Cancelar lectura", () => {
      stop();
      status.textContent = "Lectura cancelada. Puedes elegir otra imagen.";
    });
    cancel.hidden = true;
    const retry = button("Volver a intentar", () => {
      if (lastImage) accept(lastImage);
    });
    retry.hidden = true;
    body.append(label, status, progress, cancel, retry, preview);
    root.append(trigger, body);
    form.append(root);
    let generation = 0,
      worker = null,
      url = null,
      dead = false,
      lastImage = null;
    function release() {
      if (url) URL.revokeObjectURL(url);
      url = null;
    }
    function stop() {
      generation++;
      const active = worker;
      worker = null;
      if (active) active.terminate().catch(() => {});
      progress.hidden = cancel.hidden = true;
      file.disabled = false;
    }
    async function accept(image) {
      stop();
      release();
      preview.replaceChildren();
      retry.hidden = true;
      if (
        !image ||
        !/^image\/(png|jpeg|webp)$/.test(image.type) ||
        image.size > 10 * 1024 * 1024
      ) {
        status.textContent = "Selecciona una imagen PNG, JPG o WebP de hasta 10 MB.";
        return;
      }
      const ticket = generation;
      lastImage = image;
      const valid = () => !dead && ticket === generation && root.isConnected && current();
      file.disabled = true;
      progress.hidden = cancel.hidden = false;
      progress.value = 0;
      status.textContent =
        "Preparando la lectura… La primera vez puede tardar unos segundos.";
      let stage = "image";
      try {
        url = URL.createObjectURL(image);
        const img = new Image();
        img.src = url;
        await img.decode();
        if (!valid()) return;
        if (img.naturalWidth * img.naturalHeight > 24000000) throw new Error("large");
        const picture = el("img");
        picture.src = url;
        picture.alt = "Captura seleccionada para revisar";
        preview.append(picture);
        // Ampliar texto pequeño sin superar un lienzo razonable en móvil.
        const scale = Math.min(
          2,
          3600 / img.naturalWidth,
          Math.sqrt(24000000 / (img.naturalWidth * img.naturalHeight)),
        );
        const canvas = el("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        stage = "library";
        await load();
        if (!valid()) return;
        stage = "engine";
        const options = {
          workerPath: new URL("worker.min.js?v=ocr2", base).href,
          // Un worker del mismo origen evita el bloqueo de workers blob
          // que ocurre en algunos navegadores integrados.
          workerBlobURL: false,
          langPath: base.href.replace(/\/$/, ""),
          cacheMethod: "none",
          logger: (m) => {
            if (valid()) {
              progress.value = m.progress || 0;
              status.textContent =
                m.status === "recognizing text"
                  ? "Leyendo la captura… " + Math.round((m.progress || 0) * 100) + " %"
                  : "Preparando lector local…";
            }
          },
        };
        let created;
        try {
          created = await createEngine({
            ...options,
            corePath: base.href,
          });
        } catch (initialError) {
          if (!valid()) return;
          status.textContent = "Probando el lector en modo compatible…";
          // Solo como alternativa: núcleo LSTM sin SIMD para navegadores
          // que anuncian SIMD pero no pueden iniciar ese núcleo.
          created = await createEngine({
            ...options,
            corePath: new URL("tesseract-core-lstm.wasm.js", base).href,
          });
        }
        if (!valid()) {
          await created.terminate();
          return;
        }
        worker = created;
        stage = "reading";
        await created.setParameters({
          tessedit_pageseg_mode: "11",
          preserve_interword_spaces: "1",
        });
        const result = await created.recognize(canvas);
        if (!valid()) return;
        const parsed = window.ProductCaptureParser.parse(result.data);
        stage = "review";
        review(parsed, preview, valid, result.data.confidence);
        diagnostic({
              status: "ready",
              stage: "review",
            });
        status.textContent = "Revisa lo reconocido antes de pasarlo al formulario.";
      } catch (error) {
        if (valid()) {
          console.warn("Fallo del lector local de capturas", stage, error);
          diagnostic({ status: "error", stage, error: String(error?.message || error) });
          preview.replaceChildren();
          retry.hidden = false;
          status.textContent =
            error?.message === "large"
              ? "La imagen es demasiado grande. Recorta solo la ficha del producto."
              : stage === "image"
                ? "El navegador no pudo abrir la imagen. Guárdala como PNG o JPG y vuelve a seleccionarla. [C01]"
                : ["library", "engine"].includes(stage)
                  ? "No se pudo iniciar el lector en este navegador. Vuelve a intentarlo o prueba a abrir la web en Chrome o Edge. La captura no es el problema. [C02]"
                  : "La lectura se ha interrumpido. Pulsa Volver a intentar; si continúa, indícanos el código " +
                    (stage === "review" ? "C04" : "C03") +
                    ".";
        }
      } finally {
        if (ticket === generation) {
          const active = worker;
          worker = null;
          active?.terminate().catch(() => {});
          progress.hidden = cancel.hidden = true;
          file.disabled = false;
          file.value = "";
        }
      }
    }
    function review(result, preview, valid, confidence) {
      const { draft, source } = result;
      const grid = el("dl", null, "capture-summary");
      const data = [
        ["Cliente detectado", source.holder],
        ["Compañía", draft.company],
        ["Producto", draft.product],
        ["Código de origen", source.code],
        ["Cartera propuesta", draft.portfolio],
        ["Aportación", draft.amount == null ? "" : draft.amount + " €"],
        [
          "Periodicidad",
          draft.payment_type === "monthly"
            ? "Mensual"
            : draft.payment_type === "single"
              ? "Única"
              : "",
        ],
        [
          "Unidades a guardar",
          draft.units == null
            ? ""
            : draft.units +
              " U · Lectura original: " +
              source.units +
              " U · Redondeo hacia arriba",
        ],
        ["Fecha de efecto (no es la firma)", source.effective],
        ["Póliza (referencia de lectura)", source.policy],
      ];
      for (const [name, value] of data) {
        const pair = el("div");
        pair.append(el("dt", name), el("dd", value || "Pendiente de completar"));
        grid.append(pair);
      }
      preview.append(grid);
      const name = [client.first_name, client.last_name].filter(Boolean).join(" ");
      const notes = [];
      if (!window.ProductCaptureParser.samePerson(source.holder, name))
        notes.push(
          "El nombre no coincide exactamente o no se ha podido leer. Comprueba que la captura corresponde a " +
            name +
            ".",
        );
      if (!source.portfolioConfirmed && draft.portfolio)
        notes.push(
          "Cartera propuesta por la abreviatura: confirma que «" +
            source.abbreviation +
            "» corresponde a " +
            draft.portfolio +
            ".",
        );
      if (!draft.portfolio)
        notes.push("No se reconoce la cartera. Deberás seleccionar una.");
      if (source.state && !/^activo$/i.test(source.state.trim()))
        notes.push(
          "Estado detectado: " +
            source.state +
            ". Confirma si procede añadirlo como producto vigente.",
        );
      if (confidence < 70)
        notes.push(
          "La lectura tiene poca nitidez. Revisa especialmente los importes y las unidades.",
        );
      if (
        existing.some(
          (p) =>
            !p.is_apex &&
            p.company === draft.company &&
            p.portfolio === draft.portfolio &&
            Number(p.amount) === draft.amount,
        )
      )
        notes.push(
          "Ya existe un producto parecido en esta ficha. Comprueba que no lo estás duplicando antes de continuar.",
        );
      notes.push(
        "La fecha de firma y el multiplicador histórico quedan pendientes. La póliza y la fecha de efecto se muestran solo como referencia; todavía no se guardan en el contrato.",
      );
      for (const note of notes) preview.append(el("p", note, "capture-note"));
      const checkLabel = el("label", null, "capture-confirm");
      const check = el("input");
      check.type = "checkbox";
      checkLabel.append(
        check,
        document.createTextNode(
          "He comprobado el cliente, la cartera y los posibles duplicados.",
        ),
      );
      const apply = button("Revisar en el formulario →", async () => {
        if (!valid() || !check.checked) return;
        const manual = [...new FormData(form)].some(
          ([key, value]) =>
            ["amount", "units", "company", "product"].includes(key) && String(value),
        );
        if (
          manual &&
          !(await window.SiteConfirm.ask(
            "¿Sustituir el borrador actual por los datos de la captura?",
            { title: "Revisar captura", accept: "Usar captura" },
          ))
        )
          return;
        if (valid()) onDraft({ ...draft, _capture: true });
      });
      apply.disabled = true;
      check.onchange = () => {
        apply.disabled = !check.checked;
      };
      preview.append(checkLabel, apply);
    }
    const paste = (event) => {
      if (body.hidden) return;
      const image = [...(event.clipboardData?.items || [])].find((i) =>
        i.type.startsWith("image/"),
      );
      if (image) {
        event.preventDefault();
        accept(image.getAsFile());
      }
    };
    file.onchange = (event) => {
      diagnostic({ status: "selected", stage: "picker", trusted: event.isTrusted });
      accept(file.files[0]);
    };
    root.ondragover = (e) => {
      if (!body.hidden) e.preventDefault();
    };
    root.ondrop = (e) => {
      if (!body.hidden) {
        e.preventDefault();
        accept(e.dataTransfer.files[0]);
      }
    };
    form.addEventListener("paste", paste);
    return () => {
      dead = true;
      lastImage = null;
      stop();
      release();
      form.removeEventListener("paste", paste);
      root.remove();
    };
  }
  window.ProductCapture = { mount };
})();
