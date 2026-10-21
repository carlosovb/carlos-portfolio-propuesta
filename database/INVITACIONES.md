# Invitaciones por enlace desde el panel

Esta versión genera el enlace sin enviar correo desde Supabase. Carlos lo copia y lo envía desde su correo habitual. No requiere configurar SMTP para las invitaciones.

## 1. Base de datos
Ejecutar consultants-setup.sql después de profile-setup.sql, si no se ha hecho todavía.

## 2. Función protegida
En Supabase > Edge Functions > Deploy a new function > Via Editor:
- Nombre exacto: invite-consultant (si existe, editarla).
- Sustituir todo index.ts por supabase/functions/invite-consultant/index.ts del repositorio y desplegar.
- Mantener Verify JWT activado.
- Las variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY se proporcionan dentro de Supabase. Nunca copiarlas a GitHub ni al navegador.

La función valida la identidad con Auth y comprueba is_panel_owner con la sesión del administrador. Solo después solicita /auth/v1/admin/generate_link con type invite. No llama al endpoint de envío de correo. Solo devuelve un enlace de activación fijo con TokenHash, nunca el objeto de usuario, OTP, credenciales administrativas o tokens de sesión.
Solo acepta correos @ovb.es. Los registros públicos permanecen desactivados.

## 3. Direcciones
Authentication > URL Configuration:
Site URL y Redirect URLs deben incluir exactamente:
https://carlosovb.github.io/carlos-portfolio-propuesta/cuenta/

## 4. Uso
Consultores > introducir correo > Generar enlace de invitación > Copiar enlace.
Enviarlo únicamente al destinatario indicado. No abrirlo como administrador para probar: permite activar esa cuenta. Es de un solo uso y su caducidad depende de la configuración Auth del proyecto. Si falla la copia automática puede copiarse del campo de texto.
El enlace no se guarda en la base de datos del panel ni en almacenamiento del navegador. Se retira al cambiar de apartado o cerrar sesión; la copia en el portapapeles y el correo enviado quedan bajo el control del usuario.
Una cuenta ya activada puede impedir generar otra invitación. Esta pantalla no genera accesos para cuentas existentes ni enlaces de recuperación.

## 5. Comprobación real pendiente
Generar una invitación para un correo de prueba bajo control de Carlos. Enviarla y abrirla como destinatario. Comprobar validación, perfil, contraseña y entrada sin solicitudes de clientes. Un enlace usado o caducado no debe permitir activar nuevamente.
Las pruebas automatizadas usan Auth simulado: no crean cuentas reales ni mandan mensajes.

## Recuperación de contraseña
El flujo de recuperación por correo existente sigue necesitando SMTP para destinatarios ajenos al equipo del proyecto. Generar invitaciones manuales no activa ese envío. Se configurará o adaptará por separado.

## Eliminar invitaciones pendientes
Volver a ejecutar consultants-setup.sql y actualizar la función invite-consultant en Supabase. El botón aparece únicamente si el consultor no ha completado a la vez su perfil y su contraseña, aunque ya haya abierto y validado el enlace. Pide confirmación con el correo del destinatario. El servidor comprueba de nuevo el estado, bloquea primero el acceso y elimina la cuenta pendiente con Auth. Si la eliminación falla tras el bloqueo, la cuenta queda desactivada y puede reintentarse. No elimina cuentas del administrador ni cuentas que ya hayan completado su perfil y creado su contraseña. No se ha eliminado ninguna cuenta real durante las pruebas.
