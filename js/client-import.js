/* El archivo se interpreta localmente. Solo se conservan las columnas hasta Localidad. */
(function (root) {
  const fields = [
    ["client_type", "Tipo de cliente"],
    ["status", "Estado"],
    ["last_name", "Apellidos"],
    ["first_name", "Nombre"],
    ["email", "Correo"],
    ["phone", "Teléfono"],
    ["birth_date", "Fecha de nacimiento"],
    ["street_type", "Tipo de vía"],
    ["street", "Calle"],
    ["street_number", "Número"],
    ["postal_code", "C.P."],
    ["locality", "Localidad"],
  ];
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const identity = (row) =>
    normalize(row.last_name) +
    ":" +
    normalize(row.first_name) +
    "|" +
    (row.birth_date || "");
  const limits = [120, 120, 160, 120, 254, 80, 10, 80, 240, 40, 20, 160];
  function birthDate(value, XLSX) {
    if (value == null || value === "") return "";
    let y, m, d;
    if (typeof value === "number") {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (!parsed) throw Error("Fecha de nacimiento no válida");
      ({ y, m, d } = parsed);
    } else {
      const text = String(value).trim();
      const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
      const local = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
      if (iso) [, y, m, d] = iso.map(Number);
      else if (local) {
        d = +local[1];
        m = +local[2];
        y = +local[3];
        if (y < 100) y += y <= 30 ? 2000 : 1900;
      } else throw Error("Fecha de nacimiento no válida");
    }
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== m - 1 ||
      date.getUTCDate() !== d ||
      y < 1900 ||
      date > new Date()
    )
      throw Error("Fecha de nacimiento no válida");
    return [y, String(m).padStart(2, "0"), String(d).padStart(2, "0")].join("-");
  }
  function parseWorkbook(workbook, XLSX) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet || !sheet["!ref"])
      throw Error("El archivo no contiene una hoja de clientes.");
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    let header = -1;
    for (let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
      const last = sheet[XLSX.utils.encode_cell({ r, c: 11 })];
      if (normalize(last?.v) === "localidad") {
        header = r;
        break;
      }
    }
    if (header < 0)
      throw Error(
        "No encuentro las 12 columnas del informe hasta Localidad. Usa el informe de clientes original.",
      );
    const expected = [
      ["tipocliente", "tipodecliente"],
      ["estado"],
      ["apellido", "apellidos"],
      ["nombre"],
      ["email", "correo", "correoelectronico"],
      ["moviltelefono", "telefonofijo", "telefono", "moviltelfono"],
      ["fdenacimiento", "fechadenacimiento"],
      ["tipodevia", "tipovia"],
      ["calle"],
      ["n", "no", "numero"],
      ["cp", "codigopostal"],
      ["localidad"],
    ];
    for (let c = 0; c < 12; c++) {
      let label = normalize(sheet[XLSX.utils.encode_cell({ r: header, c })]?.v);
      // Algunos informes corporativos exportan tildes como caracteres de sustitución.
      if (c === 5 && label.startsWith("m") && label.includes("viltel"))
        label = "moviltelefono";
      if (!expected[c].includes(label))
        throw Error("La columna " + (c + 1) + " no coincide con «" + fields[c][1] + "».");
    }
    const rows = [],
      issues = [];
    let received = 0;
    for (let r = header + 1; r <= Math.min(range.e.r, header + 5001); r++) {
      const cells = fields.map((_, c) => sheet[XLSX.utils.encode_cell({ r, c })]);
      if (cells.every((c) => c?.v == null || String(c.v).trim() === "")) continue;
      if (++received > 5000)
        throw Error(
          "El informe supera los 5.000 clientes. Divide el archivo antes de importarlo.",
        );
      const row = {};
      let error = "";
      fields.forEach(([key], c) => {
        const cell = cells[c];
        if (cell?.f)
          error = "Contiene fórmulas; utiliza el informe exportado con sus valores.";
        try {
          row[key] =
            key === "birth_date"
              ? birthDate(cell?.v, XLSX)
              : String(
                  cell?.v == null
                    ? ""
                    : typeof cell.v === "number"
                      ? XLSX.utils.format_cell(cell)
                      : cell.v,
                ).trim();
          if (key === "postal_code" && /^\d{1,4}$/.test(row[key]))
            row[key] = row[key].padStart(5, "0");
          if (row[key].length > limits[c])
            error = "Uno de los campos supera la longitud permitida.";
        } catch (e) {
          error = e.message;
        }
      });
      if ((normalize(row.first_name) + normalize(row.last_name)).length < 2)
        error = "Falta el nombre o los apellidos.";
      if (error) issues.push({ row: r + 1, message: error });
      else rows.push(row);
    }
    if (range.e.r > header + 5001)
      throw Error(
        "El informe supera las 5.000 filas. Divide el archivo antes de importarlo.",
      );
    if (!received) throw Error("El informe no contiene clientes.");
    return { rows, issues, received };
  }
  async function read(file) {
    if (!file || !/\.xlsx$/i.test(file.name))
      throw Error("Selecciona un informe Excel .xlsx.");
    if (file.size > 5 * 1024 * 1024) throw Error("El archivo supera los 5 MB.");
    const data = await file.arrayBuffer();
    const signature = new Uint8Array(data, 0, Math.min(4, data.byteLength));
    if (signature[0] !== 80 || signature[1] !== 75)
      throw Error("El archivo no es un Excel .xlsx válido.");
    if (!root.XLSX)
      throw Error("No se ha podido cargar el lector de Excel. Actualiza la página.");
    try {
      return parseWorkbook(
        root.XLSX.read(data, {
          type: "array",
          cellFormula: true,
          cellHTML: false,
          bookVBA: false,
          sheetRows: 5032,
          sheets: 0,
        }),
        root.XLSX,
      );
    } catch (error) {
      if (/archivo|informe|columna|clientes|filas|encuentro|hoja/i.test(error.message))
        throw error;
      throw Error(
        "No se ha podido leer este Excel. Comprueba que no esté protegido con contraseña.",
      );
    }
  }
  const api = { fields, normalize, identity, birthDate, parseWorkbook, read };
  root.ClientImport = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
