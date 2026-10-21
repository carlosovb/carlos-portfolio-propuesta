# Herramientas, biblioteca e inicio privado

Aplicar `resources-html.sql` después de `resources-setup.sql`. Aplicar `resources-setup.sql` después de los scripts de perfiles, equipo y formulario previo. La migración es idempotente y conserva las fechas de caducidad existentes.

## Formulario personal

- Cada consultor con el perfil completado obtiene su enlace en Herramientas y recursos: `previo/?consultor=<identificador>`.
- Al abrir el enlace, el servidor devuelve únicamente el nombre profesional, identificador y condición de responsable principal. No devuelve correo, teléfono, clientes ni respuestas. Un consultor desactivado deja de admitir nuevos envíos.
- Los enlaces anteriores sin identificador siguen correspondiendo al responsable principal.
- `submit_premeeting` valida el destinatario y asigna `owner_id` en el servidor. Las respuestas anteriores se asignan al responsable principal. Un envío no puede introducir fechas, propietario alternativo ni resumen calculado.
- La RLS de lectura y borrado exige simultáneamente propietario de la respuesta, cuenta autorizada, perfil completo y respuesta vigente. El administrador tampoco puede leer las respuestas de otros consultores.
- Se mantiene la eliminación automática a los 30 días. La cartera y las solicitudes públicas de primera reunión conservan su funcionamiento anterior.

## Biblioteca privada

- Organización: compañía → listado directo de documentos y enlaces, con el producto identificado en cada tarjeta. Sin buscador. La fecha de subida se muestra sin hora.
- Todos los consultores autorizados y con perfil completo pueden leer la documentación. Solo el administrador puede subir, archivar, restaurar o eliminar recursos.
- Los PDF y HTML autónomos, de hasta 10 MB, se guardan en el bucket privado `team-resources`. No se publican en GitHub ni tienen una URL pública. Se abren en una pestaña del navegador a partir de una descarga autenticada y una URL temporal de memoria; al cerrar la sesión se revocan las URLs creadas por el panel.
- Los enlaces externos deben utilizar HTTPS. Se abren en otra pestaña sin acceso a la ventana de origen.
- La publicación es inmediata para el equipo. Los archivados aparecen debajo de los documentos disponibles. La selección permite eliminar varios recursos de la compañía mostrada.
- El administrador borra primero el archivo y después su registro. Ante un fallo parcial, el registro permanece para que pueda revisarse y reintentarse la operación.
- La descarga de un PDF ya realizada por una persona autorizada no puede retirarse de su dispositivo desde este panel.

## Dashboard

El inicio privado muestra la cartera y los interesados propios, formularios propios, recursos activos, puesto y multiplicador, accesos directos y actividad reciente. Las solicitudes de primera reunión aparecen únicamente al administrador. Todos los consultores entran en este inicio después de completar su perfil; la web pública conserva su diseño.

Los datos se descartan de la pantalla al salir del apartado o cerrar la sesión. Las peticiones pendientes se comprueban antes de representar resultados para evitar que una respuesta antigua se muestre tras cambiar de cuenta.

## Pruebas

`resources-permissions.cjs` verifica aislamiento entre consultores, acceso del administrador solo a sus respuestas, conservación de respuestas anteriores, revocación de usuarios y permisos de recursos y archivos. `resources-flow.cjs` comprueba el dashboard, el enlace personal, las carpetas, publicación de enlaces y PDF, archivo/restauración, apertura en otra pestaña y borrado múltiple. Solo utilizan datos ficticios.

## Presentaciones HTML y web

Se pueden publicar un enlace HTTPS marcado como presentación web o un archivo HTML autónomo. El archivo debe incorporar sus imágenes, CSS y scripts, o usar recursos externos con URL absoluta: no se suben carpetas ni archivos ZIP. Los HTML se descargan con autenticación y se muestran en otra pestaña dentro de un iframe sandbox con scripts y presentación permitidos, sin same-origin, ventanas emergentes ni navegación de la ventana superior. El código HTML no se introduce en el DOM del panel. La prueba de navegador verifica que un script de ejemplo no puede acceder al documento del visor. El bucket sigue siendo privado y solo el administrador publica o elimina.
