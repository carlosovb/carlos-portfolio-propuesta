# Conexiones y última conexión del panel

Migración: `panel-connection-history.sql`, después de `panel-presence.sql` y `profile-office-since.sql`. Aplicada mediante Supabase MCP con nombre `panel_connection_history`.

## Comportamiento

- Un registro durable representa una conexión del consultor, agrupando sus pestañas y dispositivos activos.
- Los avisos de actividad llegan cada 25 segundos, reutilizando el servicio de presencia sin invalidar la caché de clientes ni otros listados.
- Cerrar una pestaña no desconecta al consultor si otra sigue activa. El cierre de la última ventana se envía con `keepalive`. Si no llega, se registra la desconexión estimada al vencer los 90 segundos sin actividad.
- Las peticiones retrasadas de una pestaña que ya notificó su cierre se ignoran. Tras una suspensión sin cierre explícito, volver a enviar actividad inicia una conexión nueva cuando corresponde.
- `get_panel_connection_activity()` devuelve personas autorizadas y los últimos 30 movimientos, sin identificadores de pestañas, correos, IP ni datos de clientes. Las fechas se presentan en Atlantic/Canary.
- La última conexión permanece cuando el consultor sale. No se inventa actividad anterior: el historial comienza con la activación de esta función.

## Acceso y concurrencia

La tabla de visitas y la de presencia están en `private`, con RLS y sin permisos directos para `anon` o `authenticated`. El acceso mediante funciones `SECURITY DEFINER` es intencionado: cada función pública valida `auth.uid()` y `team_view_allowed()`, utiliza `search_path=''` y solo puede modificar la sesión del solicitante. La lectura conserva el mismo alcance del directorio del equipo; las cuentas deshabilitadas y sus movimientos no aparecen.

Un bloqueo de transacción por consultor evita duplicar conexiones simultáneas. El barrido de expiraciones usa `FOR UPDATE SKIP LOCKED` para no bloquear las actualizaciones de otros usuarios. La lectura de movimientos está limitada y dispone de índices por persona y fecha. Se conserva el contrato del servicio anterior para pestañas pendientes de recargar.

El asesor de Supabase señala las funciones autorizadas `SECURITY DEFINER` y la ausencia de políticas en tablas privadas. Se ha revisado: se deniega todo acceso directo y las pruebas comprueban anonimato, cuentas revocadas y separación de sesiones. No se han añadido permisos de tabla para silenciar esos avisos.

## Verificación

`tests/connection-history.cjs` comprueba en PostgreSQL aislado: varios dispositivos, no duplicar eventos en cada actualización, última pestaña, cierre repetido, peticiones tardías, expiración estimada, reconexión, historial conservado, lectura limitada a 30, permisos y cuentas deshabilitadas.

`tests/presence-flow.cjs` cubre las tres vistas del indicador, fechas, movimientos, estado en la ficha, cierre exterior/Escape, cuatro anchuras y limpieza tras cerrar sesión, incluidas respuestas pendientes.

`tests/connection-panel-flow.cjs` recorre Inicio y Equipo, consulta la ficha y revisa el indicador hasta 320 px. Admite `CONNECTION_PANEL_URL` para verificar archivos publicados usando únicamente servicios simulados. Las capturas `connections-panel-*` y `connections-live-*` contienen datos ficticios.

La verificación de producción confirmó la tabla y las funciones, RLS activo y ausencia de lectura directa para roles de navegador. Se observaron registros creados por actividad auténtica del panel; no se insertaron visitas de prueba en producción.
