# Panel v0.6

Aplicar `panel-intelligence.sql` después de las migraciones existentes de clientes, bajas, APEX, oficinas, recursos e invitaciones.

## Historial y actividad

Los triggers registran altas y cambios de clientes, productos/APEX, bajas, recuperación, notas, formularios recibidos, nuevos recursos y finalización de invitaciones. Se reconstruyen solo altas de clientes y productos con su fecha real de creación. No se inventan cambios anteriores ni se envían notificaciones retroactivas.

Los eventos y las notificaciones viven en tablas privadas con RLS y sin permisos directos. Las funciones autorizan cada operación con la identidad de sesión y el acceso vigente al panel. Ni el administrador puede consultar el historial de clientes de otro consultor mediante estas funciones. Las notas se eliminan al borrar definitivamente al cliente; la actividad financiera permanece sin nombres ni datos de contacto, igual que la producción histórica. Los formularios conservan su caducidad: los eventos no guardan respuestas ni nombres de sus remitentes.

## Notificaciones

Los formularios avisan exclusivamente a su destinatario; las invitaciones completadas exclusivamente a quien invitó. Los recursos compartidos avisan a los consultores habilitados (el autor de la subida no recibe un aviso de su propia acción). Los pendientes aparecen al entrar; cerrar el cuadro no los marca como leídos. La campana permite consultar y marcar leídos, con estado persistente por cuenta. Se comprueban cada 45 segundos mientras la pestaña esté visible, sin descargar los conjuntos de clientes o documentos completos.

Los avisos de documentos archivados, respuestas caducadas y perfiles desactivados dejan de mostrarse. No se envían emails ni avisos del sistema operativo.

## Buscador

Solo aparece en el menú lateral; Ctrl/Cmd+K lo enfoca. Los resultados se muestran a la derecha por Clientes e interesados, Consultores, Herramientas y recursos y Formularios. Se consultan a partir de dos caracteres, con 300 ms de espera y hasta 12 coincidencias por apartado. No muestra clientes ni formularios de otras cuentas. Los datos del directorio y los recursos compartidos mantienen sus permisos existentes.

Los documentos privados se descargan con sesión. HTML se visualiza en un iframe aislado sin acceso al origen del panel; los enlaces se abren únicamente mediante HTTPS.

## Pruebas

`tests/panel-intelligence.cjs`: triggers, backfill idempotente, notas sin duplicados, aislamiento, revocación, lectura persistente y caducidad. `tests/profile-flow.cjs`: flujo visual integrado, avisos al entrar, buscador lateral, destinos, notas como texto seguro, cierre y limpieza de sesión.
