// Analiza texto y coordenadas de OCR. No guarda datos ni calcula comisiones.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProductCaptureParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const compact = (s) => norm(s).replace(/[^a-z0-9]/g, "");
  const portfolios = [
    ["conservadora", "Conservadora+"],
    ["moderada", "Moderada+"],
    ["equilibrada", "Equilibrada+"],
    ["dinamica", "Dinámica+"],
    ["responsable", "Responsable+"],
    ["global", "Global+"],
  ];
  function portfolio(code) {
    const match = norm(code).match(/pias\s*pf\s*perf\s*([a-z\s]+?)\s*\+/i);
    if (!match) return null;
    const key = compact(match[1]);
    const found = portfolios.filter(([name]) => key.length >= 3 && name.startsWith(key));
    if (found.length !== 1) return null;
    return {
      name: found[0][1],
      abbreviation: match[1].trim(),
      confirmed: key === "din" || key === found[0][0],
    };
  }
  function number(text) {
    const s = String(text || "").replace(/\s|€/g, "");
    if (!/^\d[\d.,]*$/.test(s)) return null;
    const value = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  function samePerson(a, b) {
    const tokens = (s) =>
      norm(s)
        .match(/[a-z]+/g)
        ?.sort()
        .join(" ") || "";
    return !!tokens(a) && tokens(a) === tokens(b);
  }
  function fragments(words) {
    const valid = words.filter(
      (w) => w.text?.trim() && w.bbox && Number.isFinite(w.bbox.x0),
    );
    if (!valid.length) return [];
    const heights = valid.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
    const height = heights[Math.floor(heights.length / 2)] || 12;
    const lines = [];
    valid
      .sort((a, b) => a.bbox.y0 - b.bbox.y0)
      .forEach((word) => {
        const y = (word.bbox.y0 + word.bbox.y1) / 2;
        let line = lines.find((l) => Math.abs(l.y - y) < height * 0.65);
        if (!line) lines.push((line = { y, words: [] }));
        line.words.push(word);
      });
    return lines
      .sort((a, b) => a.y - b.y)
      .flatMap((line) => {
        const parts = [];
        line.words
          .sort((a, b) => a.bbox.x0 - b.bbox.x0)
          .forEach((word) => {
            let part = parts.at(-1);
            if (!part || word.bbox.x0 - part.x1 > height * 3) {
              parts.push(
                (part = {
                  text: "",
                  x0: word.bbox.x0,
                  x1: word.bbox.x1,
                  y0: word.bbox.y0,
                  y1: word.bbox.y1,
                  height,
                }),
              );
            }
            part.text += (part.text ? " " : "") + word.text;
            part.x1 = Math.max(part.x1, word.bbox.x1);
            part.y0 = Math.min(part.y0, word.bbox.y0);
            part.y1 = Math.max(part.y1, word.bbox.y1);
          });
        return parts;
      });
  }
  function parse(data) {
    const parts = fragments(data.words || []);
    // Las columnas del bloque de producto se repiten en distintas filas.
    // Si OCR omite una etiqueta (p. ej. «Prima/Aportación neta»), conservar
    // ese límite con las etiquetas de otras filas evita unir bruto y neto.
    const columnStarts = parts
      .filter((p) =>
        /^(compania|producto|tipodeproducto|primaaportacionbruta|primaaportacionneta|fracc|tomador|asegurado|fefecto|duraciondelpago|duraciondelcontrato|fvencimiento|moduloasesoramiento)$/.test(
          compact(p.text),
        ),
      )
      .map((p) => p.x0);
    function read(pattern) {
      const label = parts.find((p) => pattern.test(compact(p.text)));
      if (!label) return "";
      const next = parts
        .filter((p) => p.x0 > label.x1 && Math.abs(p.y0 - label.y0) < label.height)
        .sort((a, b) => a.x0 - b.x0)[0];
      const right =
        Math.min(
          next?.x0 ?? Infinity,
          ...columnStarts.filter((x) => x > label.x1 + label.height * 2),
        ) -
        label.height * 0.2;
      // Los valores alineados a la derecha rozan el inicio de la siguiente
      // columna. Leer por palabras evita unir «0,00 Mensual» entre columnas.
      const values = (data.words || [])
        .filter((w) => w.text?.trim() && w.bbox)
        .map((w) => ({ text: w.text, ...w.bbox }));
      const candidates = values.filter(
        (p) =>
          p.y0 >= label.y1 - 1 &&
          p.y0 - label.y1 < label.height * 3 &&
          p.x0 >= label.x0 - label.height * 0.3 &&
          p.x1 <= right,
      );
      if (!candidates.length) return "";
      const y = Math.min(...candidates.map((p) => p.y0));
      return candidates
        .filter((p) => Math.abs(p.y0 - y) < label.height * 0.65)
        .sort((a, b) => a.x0 - b.x0)
        .map((p) => p.text)
        .join(" ");
    }
    const text = data.text || parts.map((p) => p.text).join("\n");
    const code =
      text.match(/PIAS\s*PF\s*Perf\s*[A-Za-zÀ-ÿ\s]+?\s*\+\s*[,;]?\s*\d?/i)?.[0]?.trim() ||
      "";
    const selected = portfolio(code);
    const company = read(/^compania$/);
    const identity = identify(company + "\n" + text, code || read(/^producto$/));
    const basket = read(/^(?:cesta|cestadeinversion|cartera|carteradeinversion|fondovinculado)$/) || basketName(text);
    const signature = signatureDate(read(/^(?:fechadefirma|fechafirma|ffirma)$/)) ||
      documentSignature(text);
    const amount = number(read(/^primaaportacionbruta$/));
    const units = number(read(/^unidades$/));
    const frequency = read(/^fracc(?:ionamiento)?$/);
    const payment_type = /mensual/i.test(frequency)
      ? "monthly"
      : /unica/i.test(norm(frequency))
        ? "single"
        : "";
    return {
      draft: {
        ...identity,
        portfolio: identity.company === "AXA" ? selected?.name || "" : identity.company ? basket : "",
        payment_type,
        amount,
        units: units == null ? null : Math.ceil(units),
        signed_on: signature,
        signed_multiplier: "",
      },
      source: {
        units,
        code,
        holder:
          read(/^tomador$/) || text.match(/Contrato:\s*([^\n]+)/i)?.[1]?.trim() || "",
        policy: read(/^npoliza$/),
        signature,
        state: read(/^estado$/),
        abbreviation: selected?.abbreviation || "",
        portfolioConfirmed: !!selected?.confirmed || !!basket,
      },
    };
  }
  function signatureDate(text) {
    const value = norm(text);
    const numeric = value.match(/\b(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}))\b/);
    let year, month, day;
    if (numeric) {
      [year, month, day] = numeric[1] ? numeric.slice(1, 4) : [numeric[6], numeric[5], numeric[4]];
    } else {
      const written = value.match(/\b(\d{1,2}) de ([a-z]+) de (\d{4})\b/);
      if (!written) return "";
      const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
      [, day, month, year] = written;
      month = String(months.indexOf(month) + 1);
    }
    const iso = [year, month.padStart(2, "0"), day.padStart(2, "0")].join("-");
    const parsed = new Date(iso + "T00:00:00Z");
    return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === iso ? iso : "";
  }

  function documentSignature(text) {
    const signatures = [...norm(text).matchAll(/\b(?:fecha (?:de )?firma|f\.\s*(?:de )?firma|firmado el)\s*:?\s*([^\n]+)/g)]
      .map((match) => signatureDate(match[1])).filter(Boolean);
    return new Set(signatures).size === 1 ? signatures[0] : "";
  }

  function basketName(text) {
    const match = text.match(/^[ \t]*(?:Cesta(?: de inversi[oó]n| elegida| seleccionada)?|Cartera(?: de inversi[oó]n)?|Fondo vinculado)[ \t]*(?:[:–-]\s*|\r?\n[ \t]*)([^\r\n]+)/im);
    const value = match?.[1].trim() || "";
    return value.length <= 160 ? value : "";
  }

  function identify(text, productField = "") {
    const normalized = norm(text);
    const productText = norm(productField || text);
    const topProducts = [
      [/\btop[\s-]*plan\b/, "TOP Plan"],
      [/\btop[\s-]*premium\b/, "TOP Premium"],
      [/\btop[\s-]*pias\b/, "TOP PIAS"],
      [/\btop[\s-]*10\b/, "TOP10"],
    ];
    const matches = topProducts.filter(([pattern]) => pattern.test(productText));
    const axaProduct = /\bpias\s+proyecto\s+futuro\b|\bpias\s*pf\s*perf/.test(productText);
    const axa = /\baxa\b/.test(normalized) || axaProduct;
    const intesa = /\bintesa\b/.test(normalized) || matches.length > 0;
    if (axa && intesa) return { company: "", product: "" };
    if (axa) return { company: "AXA", product: axaProduct ? "PIAS Proyecto Futuro" : "" };
    if (intesa) return {
      company: "Intesa Sanpaolo Assicurazioni",
      product: matches.length === 1 ? matches[0][1] : "",
    };
    return { company: "", product: "" };
  }

  function projectRows(items) {
    const rows = [];
    for (const item of items) {
      if (!item.str?.trim() || !item.transform) continue;
      const [, , , , x, y] = item.transform;
      let row = rows.find((candidate) => Math.abs(candidate.y - y) < 2.4);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push({ x, width: item.width, text: item.str });
    }
    return rows.sort((a, b) => b.y - a.y).map((row) => {
      let text = "";
      let right = 0;
      for (const item of row.items.sort((a, b) => a.x - b.x)) {
        if (text && item.x - right > 1.25 && !text.endsWith(" ")) text += " ";
        text += item.text;
        right = item.x + item.width;
      }
      return { y: row.y, text: text.trim().replace(/\s+/g, " ") };
    });
  }

  function intesaCover(items) {
    const rows = projectRows(items);
    const find = (pattern) => rows.map((row) => row.text.match(pattern)).find(Boolean);
    const holder = find(/^Nombre y Apellidos del Tomador\s*:\s*(\p{L}[\p{L}\p{M} ,.'’\-]+)$/iu)?.[1]?.trim() || "";
    const frequency = find(/^Forma de pago prima peri[oó]dica\s*:?\s*(MENSUAL|TRIMESTRAL|ANUAL)\b/i)?.[1]?.toLowerCase();
    const money = (value) => number(/^\d{1,3}(?:\.\d{3})+$/.test(value || "") ? value.replace(/\./g, "") : value);
    const annual = money(find(/^Prima peri[oó]dica anual total\s*:?\s*([\d.,]+)\s*(?:euros?\b|€)/i)?.[1]);
    const single = money(find(/^Prima (?:[uú]nica(?: inicial)?|inicial [uú]nica)\s*:?\s*([\d.,]+)\s*(?:euros?\b|€)/i)?.[1]);
    const allocation = rows.findIndex((row) => /^Asignaci[oó]n de la prima\b/i.test(row.text));
    const funds = [];
    if (allocation >= 0) {
      const percentageOnly = /^[\d.,]+\s*%$/;
      const labelOnly = /^\p{L}[^%]+$/u;
      for (let i = allocation + 1; i < rows.length; i++) {
        const row = rows[i];
        const next = rows[i + 1];
        let value = row.text;
        // En algunas portadas el porcentaje tiene una línea base distinta a la del fondo.
        if (next && row.y - next.y <= 6) {
          if (percentageOnly.test(value) && labelOnly.test(next.text)) {
            value = next.text + " " + value;
            i++;
          } else if (labelOnly.test(value) && percentageOnly.test(next.text)) {
            value += " " + next.text;
            i++;
          }
        }
        if (/^total\b/i.test(value)) break;
        const match = value.match(/^(\p{L}.*?)\s+([\d.,]+)\s*%$/u);
        if (!match) break;
        const weight = number(match[2]);
        if (weight === null || weight > 100) break;
        if (weight > 0) funds.push({ name: match[1], weight });
      }
    }
    const total = funds.reduce((sum, fund) => sum + fund.weight, 0);
    const basket = Math.abs(total - 100) < 0.001
      ? funds.map(({ name, weight }) => funds.length === 1 ? name : name + " " + weight + " %").join(" + ")
      : "";
    return {
      holder,
      basket,
      monthly: frequency === "mensual" && annual > 0 ? Math.round(annual * 100 / 12) / 100 : null,
      top10: annual > 0 && frequency === "trimestral" ? { type: "quarterly", amount: Math.round(annual * 25) / 100 }
        : annual > 0 && frequency === "anual" ? { type: "annual", amount: annual } : null,
      single: single > 0 ? single : null,
    };
  }

  function parseProject(text, coverItems = []) {
    text = String(text || "").replace(/[^\S\r\n]+/g, " ").trim();
    if (!text) throw Error("project-format");
    const normalized = norm(text);
    const productField = text.match(/^[ \t]*(?:Producto|Denominaci[oó]n del producto)[ \t]*(?::\s*|\r?\n[ \t]*)([^\r\n]+)/im)?.[1];
    const identity = identify(text, productField);
    const cover = identity.company === "Intesa Sanpaolo Assicurazioni" ? intesaCover(coverItems) : {};
    const holder = cover.holder || text.match(/^\s*(?:Documento preparado para|Tomador(?: del seguro)?|Nombre del cliente|Cliente)\s*:\s*([^\n]+)/im)?.[1]?.trim() || "";
    const selected = normalized.match(/cartera\s+(conservadora|moderada|equilibrada|dinamica|responsable|global)\s*\+/)?.[1];
    const basket = cover.basket || basketName(text);
    const monthly = cover.monthly ?? number(text.match(/\bMensual\s+([\d.,]+)\s*€/i)?.[1] ||
      normalized.match(/(?:aportacion|prima) mensual\s*:\s*([\d.,]+)/)?.[1]);
    const single = cover.single ?? number(normalized.match(/(?:aportacion|prima) unica(?: inicial)?\s*:\s*([\d.,]+)/)?.[1]);
    const top10 = identity.product === "TOP10" ? cover.top10 : null;
    const paymentType = top10?.type || (monthly !== null && single === null ? "monthly"
      : single !== null && monthly === null ? "single" : "");
    const signature = documentSignature(text);
    const chosenPortfolio = identity.company === "AXA"
      ? portfolios.find(([key]) => key === selected)?.[1] || ""
      : identity.company && basket && basket.length <= 640 ? basket : "";
    return {
      draft: {
        ...identity,
        portfolio: chosenPortfolio,
        payment_type: paymentType,
        amount: top10?.amount ?? (paymentType === "monthly" ? monthly : paymentType === "single" ? single : null),
        units: null, signed_on: signature, signed_multiplier: "",
      },
      source: {
        project: true, holder, code: "Proyecto PDF", signature,
        total: text.match(/TOTAL INVERTIDO\s+([\d.,]+)\s*€/i)?.[1] || "",
        units: null, policy: "", state: "",
        portfolioConfirmed: !!chosenPortfolio,
      },
    };
  }
  return { parse, parseProject, portfolio, number, samePerson, fragments };
});
