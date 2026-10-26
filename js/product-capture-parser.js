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
    const axa = /axa/i.test(company) || !!code;
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
        company: axa ? "AXA" : "",
        product: axa && code ? "PIAS Proyecto Futuro" : "",
        portfolio: selected?.name || "",
        payment_type,
        amount,
        units: units == null ? null : Math.ceil(units),
        signed_on: "",
        signed_multiplier: "",
      },
      source: {
        units,
        code,
        holder:
          read(/^tomador$/) || text.match(/Contrato:\s*([^\n]+)/i)?.[1]?.trim() || "",
        policy: read(/^npoliza$/),
        effective: read(/^fefecto$/),
        state: read(/^estado$/),
        abbreviation: selected?.abbreviation || "",
        portfolioConfirmed: !!selected?.confirmed,
      },
    };
  }
  return { parse, portfolio, number, samePerson, fragments };
});
