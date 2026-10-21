# Invitaciones desde el panel

## 1. Base de datos
Ejecutar consultants-setup.sql en SQL Editor después de profile-setup.sql.
Solo el propietario puede consultar la lista de consultores.

## 2. Función de envío
En Supabase > Edge Functions > Deploy a new function > Via Editor:
- Nombre exacto: invite-consultant.
- Sustituir index.ts por supabase/functions/invite-consultant/index.ts de este repositorio.
- Desplegar y mantener la verificación JWT activada (Verify JWT).
- SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son variables del entorno de Supabase. No copiarlas al navegador ni al repositorio.
La función valida la sesión con Auth y comprueba is_panel_owner con el token del usuario antes de utilizar permisos administrativos. Solo admite correos @ovb.es y una dirección de activación fija. No permite elegir contraseñas, roles ni destinos desde el navegador. Los errores no devuelven datos internos de Auth.

## 3. Direcciones de autenticación
Authentication > URL Configuration:
- Site URL: https://carlosovb.github.io/carlos-portfolio-propuesta/cuenta/
- Redirect URLs: añadir exactamente la misma dirección.
Mantener los registros públicos desactivados.

## 4. Correo de salida
Authentication > Email > SMTP Settings (o Custom SMTP según el panel):
- Activar Custom SMTP.
- Sender email: una dirección que el proveedor permita usar como remitente.
- Sender name: Carlos Caballero Dávila.
- Host, puerto, usuario y contraseña: los que facilite el proveedor SMTP.
Guardar estos datos solo en Supabase. No usar la contraseña habitual del correo si el proveedor requiere una contraseña de aplicación o credencial SMTP específica.
Para utilizar el correo corporativo, confirmar con su administrador que permite envío SMTP desde Supabase y solicitar los datos correctos. No asumir que basta con conocer el correo y su contraseña. Si no se dispone de SMTP corporativo, elegir otro proveedor con un remitente verificado; el dominio ovb.es no es un dominio que podamos verificar por nuestra cuenta.
Sin Custom SMTP, Supabase limita los destinatarios a miembros del equipo del proyecto. Los límites y costes dependen del proveedor elegido.

## 5. Plantillas
Usar las plantillas Invite user y Reset password indicadas en PROFILE-CONFIGURACION.md, con TokenHash y SiteURL. La pantalla de activación valida el enlace al pulsar el botón y retira sus credenciales de la dirección.

## 6. Prueba real
Desde Consultores, introducir un correo corporativo de prueba bajo tu control y enviar una sola invitación. Verificar recepción (también spam), activación, creación de contraseña, perfil y entrada. Comprobar que el consultor no ve solicitudes de clientes. El listado distingue pendiente, perfil completado y acceso desactivado. El envío confirmado significa que Auth aceptó el envío, no garantiza entrega en la bandeja de entrada.
No hay botón de reenvío ni desactivación en esta fase. Una cuenta ya existente puede impedir una nueva invitación; para recuperar contraseña se utiliza el flujo de recuperación.

## Validación realizada en desarrollo
Pruebas aisladas de la función con Auth y correo simulados; pruebas PostgreSQL de acceso al listado. No se han enviado invitaciones reales ni configurado SMTP automáticamente.
