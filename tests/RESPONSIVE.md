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

La portada usa WebP de 480/800 píxeles, con dimensiones reservadas, `srcset` y
prioridad alta; el retrato de Equipo usa la versión de 480. El original PNG se
conserva como fuente. No se modifica la versión funcional v0.6 ni la base de datos.
