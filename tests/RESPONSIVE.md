# Revisión de móviles y tabletas

La capa final `css/devices.css` se carga en las cuatro entradas públicas y
privadas. Mantiene el escritorio y reúne ajustes para tacto, lectura de
formularios, ventanas de poca altura y orientación horizontal. No oculta el
desbordamiento del documento: las áreas que lo necesitan (árbol y gráficos)
conservan su desplazamiento local.

`node tests/responsive-audit.cjs` utiliza únicamente datos ficticios. Comprueba
320×568, 390×844, 768×1024, 1024×768 y 844×390 en Chromium, incluyendo portada,
cuenta, formulario previo, nueve secciones del panel, ambos temas, menú abierto,
importación, tres vistas de clientes, ficha, calendario y consulta de barras.
Comprueba también errores de JavaScript y la carga de la fotografía optimizada.
Reutiliza los servicios simulados de `profile-flow.cjs`.

El conjunto completo de pruebas cubre además registro válido, formulario de
pareja hasta su resumen, productos/APEX, recursos, notificaciones, administración
del equipo, progreso y permisos. Estas pruebas de navegador no sustituyen una
comprobación física en Safari/iOS o Android.

También se han ejecutado las pruebas con `MOBILE_BROWSER=webkit` (WebKit 26.5,
perfil iPhone 13) y `MOBILE_BROWSER=android` (Chromium, perfil Pixel 7). La
auditoría utiliza pulsaciones táctiles y verifica cierre exterior de fichas,
calendario mensual y confirmación de cambios sin guardar. Los recorridos de
perfil y formulario previo permiten seleccionar WebKit con la misma
variable. El navegador WebKit se instala fuera del repositorio con Playwright;
`PLAYWRIGHT_BROWSERS_PATH` indica esa carpeta.

Regresión encontrada: en WebKit sin soporte nativo de `month`, `.type` devuelve
`text`. El calendario debe consultar el atributo HTML solicitado para conservar
el selector de meses. La auditoría comprueba de forma aislada este modo de
compatibilidad, la selección de enero de 2024 y la presencia de los 12 meses.

Un ensayo adicional de `clients-flow.cjs` en WebKit completó las operaciones y
el calendario, pero falló al comprobar errores por una respuesta CORS de logout
interceptada. No se cuenta como un recorrido completo aprobado en WebKit; ese
flujo mantiene su ejecución habitual en Chromium. El recorrido de perfil con
cierre de sesión sí pasó en WebKit. La consulta OPTIONS sin credenciales al
servicio publicado confirmó que permite el origen y los encabezados necesarios.

La portada usa WebP de 480/800 píxeles, con dimensiones reservadas, `srcset` y
prioridad alta; el retrato de Equipo usa la versión de 480. El original PNG se
conserva como fuente. No se modifica la versión funcional v0.6 ni la base de datos.
