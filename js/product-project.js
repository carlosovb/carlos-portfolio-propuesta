(() => {
  const base = new URL("../assets/vendor/pdfjs/", document.currentScript.src);

  async function read(file, current) {
    if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024)
      throw Error("Selecciona un PDF de hasta 10 MB.");
    const pdfjs = await import(new URL("pdf.mjs", base).href);
    const data = new Uint8Array(await file.arrayBuffer());
    if (!current()) return;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.mjs", base).href;
    const task = pdfjs.getDocument({ data, isEvalSupported: false });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 200) throw Error("El PDF supera las 200 páginas.");
      const text = [];
      let cover = [], fields = [], lifeCover = [];
      for (const number of new Set([1, 2, 3, pdf.numPages].filter((n) => n <= pdf.numPages))) {
        if (!current()) return;
        const page = await pdf.getPage(number);
        const { items } = await page.getTextContent();
        if (number === 3) lifeCover = items;
        if (number === 1) {
          cover = items;
          fields = await page.getAnnotations({ intent: "display" });
        }
        text.push(items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join(""));
      }
      if (/vida\s+protect/i.test(text.join("\n"))) {
        if (/cuestionario\s*[-–]\s*solicitud/i.test(text[0])) {
          const signature = await (await pdf.getPage(pdf.numPages)).getAnnotations({ intent: "display" });
          return window.LifeProtect.request(fields, signature);
        }
        if (pdf.numPages >= 5 && /proyecto\s+de\s+vida\s+protect/i.test(text.join("\n"))) {
          const table = await (await pdf.getPage(4)).getTextContent();
          const premium = await (await pdf.getPage(5)).getTextContent();
          return window.LifeProtect.offer(lifeCover, table.items, premium.items);
        }
      }
      return window.ProductCaptureParser.parseProject(text.join("\n"), cover, fields);
    } finally {
      await task.destroy().catch(() => {});
    }
  }

  window.ProductProject = { read };
})();
