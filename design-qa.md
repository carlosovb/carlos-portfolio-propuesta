# Clientes: propuesta 2 — revisión visual

final result: passed

## Referencia y alcance

Referencia seleccionada: `C:/Users/ccaba/.codex/generated_images/01a15a58-2596-7332-aa93-286a0314d77e/exec-d28a144d-7322-48c7-a4c6-a2bd2e8fcee2.png`.
Se aplica al panel existente, manteniendo permisos, datos, importación, filtros, tres vistas guardadas, productos, historial y eliminados. No se modifica el cálculo financiero ni el esquema de datos.

## Evidencia comparada

Capturas locales en `C:/Users/ccaba/AppData/Local/Temp/`:

- `client-design-desktop.png`: implementación a 1487 × 1058, DPR 1.
- `client-design-comparison.png`: referencia e implementación juntas, misma escala y tamaño, 2974 × 1058.
- `client-design-focus.png`: comparación enfocada del listado, 1400 × 650.
- `client-design-detail-focus.png`: comparación enfocada de la ficha, 1240 × 800.
- `client-design-file-320.png` y `client-design-file-390.png`: ficha móvil.
- `client-design-directory-dark-320.png` y equivalentes light/390/768/1024/1487: listado adaptable.
- Prefijo `client-design-webkit-`: comprobación equivalente en WebKit con perfil iPhone.

Se inspeccionaron la comparación completa y ambas comparaciones enfocadas. Se revisaron listado y ficha en móvil, tableta y escritorio, en ambos temas. WebKit y Android se comprobaron mediante navegador de pruebas y emulación; no son pruebas en dispositivos físicos.

## Superficies de fidelidad

- Tipografía: se conserva la familia existente del sitio, con títulos claros, jerarquía y tamaños legibles.
- Espaciado: dos columnas de tarjetas y ficha lateral en escritorio; ficha modal y distribución adaptable por debajo de 1280 px.
- Color: azul oscuro plano, cobre para selección y cifras, interesados diferenciados en violeta, compañías con referencias de color. Sin resplandor.
- Imágenes e iconos: logotipos reales existentes y SVG oficiales Tabler con licencia MIT; sin imágenes generadas para representar marcas.
- Contenido: se preservan las acciones reales y se corrige la etiqueta conceptual de 420 U a «Unidades firmadas», manteniendo los euros como importes monetarios.

## Historial de revisión y correcciones

1. Primera comparación: se ajustaron densidad, proporciones de tarjetas, posición de compañías y ficha lateral.
2. Se corrigió el desbordamiento del importador a 768 px y se compactó la entrada de productos.
3. Se mantuvieron los datos accesibles en Lista y Compacta y se separó la selección múltiple del cliente abierto.
4. Se añadió confirmación al cambiar de cliente con una edición en curso y limpieza del correo al cerrar la ficha.
5. Se verificó el cambio entre ficha lateral y modal al redimensionar, incluido WebKit.
6. Comparación final completa y enfocada: aprobada. Las acciones adicionales respecto al concepto (baja, edición, historial de productos, selección e importación guiada) se conservan por requisito funcional.

No quedan incidencias P0, P1 o P2 abiertas. Las diferencias de fuente, datos ficticios y densidad adicional son adaptaciones explícitas al producto existente.

## Validación funcional

Suite funcional y de privacidad existente aprobada; tras corregir el desbordamiento se repitió la auditoría adaptable. `clients-flow.cjs`, `client-design.cjs` y `responsive-audit.cjs` aprobados. Diseño y adaptabilidad comprobados también en WebKit. Las pruebas utilizan clientes ficticios y verifican ausencia de desbordamiento, cambio de ficha, edición, cierre y limpieza de datos.
