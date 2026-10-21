# Formulario previo a la reunión

La página `previo/` no se enlaza desde la portada y no requiere una cuenta. Cada consultor puede copiar su enlace personal desde «Herramientas y recursos». El enlace incluye su identificador y muestra su nombre. Tener el enlace permite rellenar el formulario; no permite consultar respuestas.

## Recorrido

1. Modalidad individual o pareja, datos personales de cada persona y contacto principal (correo y teléfono obligatorios).
2. Objetivos personales y compartidos, ejemplos y objetivos propios. Prioridad opcional: alta, media o baja. Sin cantidades ni plazos del objetivo.
3. Ingresos por persona: neto mensual, media mensual de variables, otros ingresos y total anual opcional de pagas extra.
4. Gastos personales y compartidos. Hipoteca dentro de vivienda, cuota y meses pendientes. Otros préstamos separados, con cuota y meses pendientes. Suscripciones y transporte tienen sus propias categorías.
5. Cuentas y productos: tipo, aclaración opcional e importe aproximado. Se puede saltar por persona o para el dinero compartido; al saltarlo se descartan los productos de ese apartado.
6. Resumen editable, estimación mensual y autorización del envío.

Las cantidades aceptan importe conocido (incluido 0), «No lo sé» o «Prefiero comentarlo en la reunión». Los ingresos y gastos desconocidos no se cuentan como datos confirmados: el cálculo se presenta como incompleto. El ahorro acumulado no se considera ingreso. Las pagas extra se dividen entre 12; los gastos comunes y las cuotas solo se suman una vez. El desglose individual muestra el disponible antes de gastos comunes, sin atribuir arbitrariamente un reparto.

## Privacidad y permisos

- Las respuestas solo se mantienen en memoria durante la visita. No hay borrador persistente ni envío de correos.
- La tabla `public.premeeting_responses` tiene RLS. El visitante no puede leerla ni insertar directamente en ella. Cada consultor solo puede leer o borrar las respuestas de su enlace.
- La política vigente exige `owner_id = auth.uid()`, cuenta autorizada y perfil completo, y permite lectura y eliminación únicamente mientras no estén caducadas. Ni el administrador puede consultar respuestas ajenas.
- La función pública `submit_premeeting` es el único punto de inserción. Usa `SECURITY DEFINER` deliberadamente, con esquema de búsqueda vacío, validadores internos, estructura y tamaño limitados, fechas fijadas por el servidor y límites de frecuencia. No acepta propietario, fechas ni un resumen calculado por el visitante.
- Los resúmenes se calculan de nuevo en el panel a partir de las respuestas, usando el mismo modelo de cálculo. Los textos se representan mediante `textContent`.
- El identificador aleatorio del envío permite reintentos sin duplicar registros. La respuesta nunca contiene los datos guardados.
- La tabla no se exporta a GitHub. No se guardan archivos bancarios, IBAN, claves ni números de contrato.

## Instalación y conservación

La configuración actual se completa con `resources-setup.sql`, que conserva los envíos anteriores y los asigna al responsable principal. Ver `RECURSOS.md`.

`premeeting-setup.sql` requiere la configuración anterior del panel y `pg_cron` ya activo. Es idempotente. Crea una tarea independiente `portfolio-expired-premeeting` que elimina cada minuto las respuestas con `expires_at <= now()`. La caducidad se fija en el servidor a los 30 días exactos del envío; el borrado físico se produce en la siguiente ejecución del programador. Las respuestas caducadas dejan de ser visibles inmediatamente por RLS. No modifica los 60 días de las solicitudes de primera reunión ni la cartera de clientes.

El texto de privacidad informa de esta conservación y facilita el contacto para pedir eliminación anticipada. No se presenta como una garantía de eliminación de copias externas que alguien haya realizado.

## Comprobación

- `tests/premeeting-permissions.cjs`: validación con Postgres aislado, datos nulos y formatos incorrectos, permisos, reintentos, límite de envíos, conservación, borrado y cálculos individuales y conjuntos.
- `tests/premeeting-flow.cjs`: formulario en pareja, pasos, edición desde el resumen, préstamos, salto de productos, reintento, envío, limpieza de pantalla, consulta privada, cierre exterior y eliminación en masa. Comprobación de anchuras de 320, 768 y 1440 píxeles y temas claro/oscuro.

Las pruebas utilizan exclusivamente personas y contactos ficticios.
