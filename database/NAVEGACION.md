# Navegación del panel

Las lecturas de listados y perfiles profesionales se reutilizan durante un máximo de 60 segundos en la memoria de la pestaña. El inicio carga los resúmenes comunes; los apartados reutilizan esas mismas respuestas. Las fichas se consultan al abrirlas, sin descargar de golpe todos los clientes o formularios. Las consultas simultáneas idénticas comparten una petición. La caché admite como máximo 100 consultas.

Las escrituras invalidan las lecturas antes y después de la operación. El botón Actualizar vacía la caché y fuerza una consulta nueva. Las verificaciones de acceso y las descargas de archivos no se guardan en esta caché. Al iniciar o cerrar sesión se vacía y se descartan las respuestas que correspondan a una sesión o versión anterior. No se utiliza almacenamiento persistente del navegador.

La transición entre apartados dura 180 ms y respeta prefers-reduced-motion. Las acciones en grupo solo aparecen tras seleccionar al menos una fila. Las tarjetas de documentos abren el recurso al pulsar su contenido; selección, archivo y botones mantienen su acción propia.
