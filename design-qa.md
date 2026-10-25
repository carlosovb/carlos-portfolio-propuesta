# Clientes — fidelidad a la propuesta 2

final result: passed

## Alcance y referencia

Referencia visual: `C:/Users/ccaba/.codex/generated_images/01a15a58-2596-7332-aa93-286a0314d77e/exec-d28a144d-7322-48c7-a4c6-a2bd2e8fcee2.png` (1487 × 1058).
Página comprobada: https://carlosovb.github.io/carlos-portfolio-propuesta/panel/

La comparación corresponde a Tarjetas, tema oscuro, Ana García abierta en la ficha lateral, dos compañías y dos interesados. Los datos de la captura son ficticios. Las respuestas de autenticación/datos se simulan exclusivamente en el navegador de pruebas; HTML, CSS, JavaScript, fuentes e imágenes de la comprobación publicada proceden de GitHub Pages, sin sustituciones locales.

## Hallazgos de la comprobación publicada inicial

1. P1: la preferencia guardada podía abrir Lista o Compacta. La auditoría anterior forzaba Tarjetas y ocultaba esa diferencia. Se verificó que existe una preferencia Compacta en producción. Se cambia únicamente el valor predeterminado para cuentas sin elección, y se ofrece «Ver tarjetas» cuando hay otra vista guardada. Se conservan las preferencias existentes: la revisión automática rechazó su sobrescritura global.
2. P1: la ficha pasaba a modal por debajo de 1280 px, también en portátiles. Se ajustan el diseño y su comportamiento al mismo límite de 1100 px; por debajo se mantiene el modal móvil.
3. P2: las tarjetas acumulaban reglas antiguas de tabla, columnas implícitas y alturas fijas excesivas. Se sustituye la hoja de ajustes por una capa coherente, reiniciando columnas/filas. La altura depende del contenido y los interesados tienen una única fila.
4. P2: cada producto ocupaba varias líneas y los controles competían con sus cifras. Ahora producto, cartera/aportación y unidades forman una fila compacta; Editar queda en el desplegable. Las compañías se pueden plegar y muestran un control accesible con aria-expanded.
5. P2: faltaban consistencia tipográfica, iconos y jerarquía de cifras. Se incorpora Inter autohospedada con licencia SIL, iconos Tabler originales, sufijos de cifras y logotipos reales sobre fondos de compañía. Se separan fecha y título de la actividad real.
6. P2 detectado durante regresión: el texto invisible del botón accesible de tarjeta podía ampliar el ancho en móvil. Se limita su caja y el contorno de selección, manteniendo el clic de toda la tarjeta y el teclado.

## Evidencia visual

Directorio de capturas: `C:/Users/ccaba/AppData/Local/Temp/`.

Antes, recursos publicados:
- `client-published-before-saved-list.png`: preferencia Lista simulada, publicada antes de la corrección.
- `client-published-before-file.png`: Tarjetas y ficha publicadas antes de la corrección.

Después, código local y misma densidad:
- `client-design-desktop.png`: 1487 × 1058, CSS 1487 × 1058, DPR 1.
- `client-design-comparison.png`: referencia + implementación, 2974 × 1058, sin escalado.
- `client-design-focus.png`: tarjetas, 1400 × 650; recortes a la misma escala.
- `client-design-detail-focus.png`: ficha, 1240 × 800; recortes a la misma escala.
- `client-design-laptop-1366.png`, `client-design-laptop-1200.png`, `client-design-laptop-1100.png`: ficha lateral en portátil.
- `client-design-file-390.png`, `client-design-file-320.png`: ficha móvil.
- `client-design-directory-{dark|light}-{width}.png`: directorio en cinco anchuras y ambos temas.
- Prefijo `client-design-webkit-`: comprobación equivalente con WebKit y perfil iPhone.

Comprobación posterior a publicación: el mismo test admite `CLIENT_DESIGN_URL=https://carlosovb.github.io/carlos-portfolio-propuesta/` y genera los equivalentes con prefijo `client-live-`, incluida la comparación completa y los dos recortes. Su resultado se registra al completar el despliegue.

Se inspeccionaron juntas referencia e implementación y ambos recortes antes de aceptar la corrección. Las capturas móviles se revisaron para evitar cortes de importes, texto o controles. No se atribuyen estas comprobaciones a dispositivos físicos.

## Superficies de fidelidad

- Tipografía: Inter variable local, pesos, jerarquía y medidas estables entre equipos; sin depender de fuentes instaladas.
- Distribución: dos columnas de tarjetas y ficha lateral, tarjetas de altura variable, interesados aparte y ficha compacta. Versión modal en móvil/tableta.
- Colores: azul oscuro, cobre, verde para clientes y violeta para interesados. Se conserva la petición previa de evitar resplandores, sin copiar el brillo del concepto.
- Recursos: logos originales de AXA/Intesa e iconos SVG Tabler; sin marcas inventadas ni texto rasterizado.
- Contenido: datos reales cuando se use la cuenta real; en pruebas son explícitamente ficticios. «Unidades firmadas» corrige la etiqueta equivocada de la imagen («Aportaciones únicas» bajo 420 U). Los recuentos, la oficina y el puesto no se inventan para copiar la captura.

## Verificación funcional

Aprobadas las pruebas de diseño en Chromium y WebKit, el flujo de clientes y la prueba SQL de filtros/preferencias/permisos. Se comprueban importación, deduplicación, productos, APEX, baja/reactivación, historial, selección, vistas guardadas, cierre, cambio de ficha sin perder una edición y limpieza al salir. La auditoría adaptable del panel y las páginas públicas pasa en ambos motores. Se verifican la fuente cargada, ausencia de errores JavaScript y recursos gráficos sin errores HTTP.

La migración de valor predeterminado no actualiza filas de preferencias ni cambia permisos o información de clientes. La prueba SQL confirma que una elección Compacta permanece intacta después de la migración y que cada cuenta mantiene su propia elección.

No quedan P0/P1/P2 abiertos en la vista Tarjetas. Diferencias aceptadas: datos y recuentos ficticios, rol real del usuario en el menú, controles adicionales disponibles al desplegar y ausencia del resplandor previamente rechazado por el usuario. La preferencia personal solo se cambia con una selección expresa del titular.
