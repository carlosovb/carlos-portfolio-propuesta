// Ajuste local: no se sube ninguna imagen hasta confirmar el encuadre.
(() => {
  const get = (id) => document.getElementById(id),
    dialog = get("photo-crop-dialog"),
    canvas = get("photo-crop-canvas");
  const context = canvas.getContext("2d");
  let bitmap = null,
    resolvePending = null,
    generation = 0,
    zoom = 1,
    rotation = 0,
    x = 0,
    y = 0,
    drag = null;
  function finish(blob = null) {
    generation++;
    dialog.close();
    if (bitmap) bitmap.close();
    bitmap = null;
    drag = null;
    if (resolvePending) {
      const resolve = resolvePending;
      resolvePending = null;
      resolve(blob);
    }
    context.clearRect(0, 0, 512, 512);
  }
  function draw() {
    if (!bitmap) return;
    const rotated = rotation % 180 !== 0;
    const w = rotated ? bitmap.height : bitmap.width,
      h = rotated ? bitmap.width : bitmap.height;
    const scale = Math.max(512 / w, 512 / h) * zoom;
    x = Math.max(-(w * scale - 512) / 2, Math.min((w * scale - 512) / 2, x));
    y = Math.max(-(h * scale - 512) / 2, Math.min((h * scale - 512) / 2, y));
    context.clearRect(0, 0, 512, 512);
    context.save();
    context.translate(256 + x, 256 + y);
    context.rotate((rotation * Math.PI) / 180);
    context.scale(scale, scale);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    context.restore();
  }
  async function open(file) {
    finish();
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    )
      throw new Error("Selecciona un JPG, PNG o WebP de hasta 5 MB.");
    const current = generation;
    const image = await createImageBitmap(file);
    if (current !== generation) {
      image.close();
      return null;
    }
    bitmap = image;
    zoom = 1;
    rotation = 0;
    x = 0;
    y = 0;
    get("photo-crop-zoom").value = "1";
    get("photo-crop-save").disabled = false;
    get("photo-crop-notice").hidden = true;
    dialog.showModal();
    draw();
    return new Promise((resolve) => {
      resolvePending = resolve;
    });
  }
  canvas.tabIndex = 0;
  canvas.addEventListener("keydown", (event) => {
    const moves = {
      ArrowLeft: [-12, 0],
      ArrowRight: [12, 0],
      ArrowUp: [0, -12],
      ArrowDown: [0, 12],
    };
    if (moves[event.key]) {
      event.preventDefault();
      x += moves[event.key][0];
      y += moves[event.key][1];
      draw();
    }
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (!bitmap) return;
    drag = { x: event.clientX, y: event.clientY, offsetX: x, offsetY: y };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const ratio = 512 / canvas.getBoundingClientRect().width;
    x = drag.offsetX + (event.clientX - drag.x) * ratio;
    y = drag.offsetY + (event.clientY - drag.y) * ratio;
    draw();
  });
  canvas.addEventListener("pointerup", () => (drag = null));
  canvas.addEventListener("pointercancel", () => (drag = null));
  get("photo-crop-zoom").addEventListener("input", (event) => {
    zoom = Number(event.target.value);
    draw();
  });
  get("photo-crop-rotate").addEventListener("click", () => {
    rotation = (rotation + 90) % 360;
    x = 0;
    y = 0;
    draw();
  });
  get("photo-crop-reset").addEventListener("click", () => {
    zoom = 1;
    rotation = 0;
    x = 0;
    y = 0;
    get("photo-crop-zoom").value = "1";
    draw();
  });
  ["photo-crop-close", "photo-crop-cancel"].forEach((id) =>
    get(id).addEventListener("click", () => finish()),
  );
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  get("photo-crop-save").addEventListener("click", async () => {
    if (!bitmap) return;
    const current = generation;
    get("photo-crop-save").disabled = true;
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.9),
    );
    if (current !== generation) return;
    if (blob?.type === "image/webp") finish(blob);
    else {
      get("photo-crop-notice").textContent =
        "No se ha podido preparar la foto. Inténtalo de nuevo.";
      get("photo-crop-notice").hidden = false;
      get("photo-crop-save").disabled = false;
    }
  });
  window.PhotoCrop = Object.freeze({ open, cancel: () => finish() });
})();
