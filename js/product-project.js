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
      let cover = [], fields = [];
      for (const number of new Set([1, 2, 3, pdf.numPages].filter((n) => n <= pdf.numPages))) {
        if (!current()) return;
        const page = await pdf.getPage(number);
        const { items } = await page.getTextContent();
        if (number === 1) {
          cover = items;
          fields = await page.getAnnotations({ intent: "display" });
        }
        text.push(items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join(""));
      }
      return window.ProductCaptureParser.parseProject(text.join("\n"), cover, fields);
    } finally {
      await task.destroy().catch(() => {});
    }
  }

  window.ProductProject = { read };
})();
