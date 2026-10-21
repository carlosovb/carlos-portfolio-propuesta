# Perfil, invitaciones y contraseñas

## Cambios de esta fase

Cada cuenta tiene nombre, apellidos y teléfono privados, además de su correo de acceso (no editable desde el perfil) y su rol. «Mi perfil» permite editar sus propios datos y cambiar la contraseña verificando la actual. No permite cambiar el correo ni elevar permisos.

Las cuentas invitadas completan los datos y crean su contraseña en `/cuenta/`. Solo se autorizan automáticamente usuarios que Supabase marque como invitados administrativamente. Los registros públicos siguen desactivados. El administrador ya creado conserva su contraseña y completará solo sus datos de perfil.

## 1. Ejecutar la ampliación SQL

Ejecutar `profile-setup.sql` en el SQL Editor del proyecto. No vuelve a crear las solicitudes ni cambia sus políticas. Añade las tablas de perfiles y miembros y las funciones para consultar/modificar el propio perfil. Los miembros no reciben permisos sobre `contact_requests`.

Sin esta ampliación, el acceso anterior del administrador sigue funcionando y «Mi perfil» indica que falta la configuración. No se simula el guardado de datos.

## 2. Configurar las direcciones de Auth

En Authentication > URL Configuration:

- Site URL: `https://carlosovb.github.io/carlos-portfolio-propuesta/cuenta/`
- Redirect URLs: añadir exactamente `https://carlosovb.github.io/carlos-portfolio-propuesta/cuenta/`.

No habilitar registros públicos.

## 3. Preparar el correo de autenticación

Supabase restringe el envío sin SMTP propio a los correos del equipo del proyecto. Para invitar a compañeros fuera de ese equipo se necesita configurar Custom SMTP. Este requisito es independiente del almacenamiento de solicitudes: los datos de clientes siguen sin enviarse por correo.

No colocar credenciales SMTP en GitHub ni en JavaScript. Se configuran únicamente en Supabase. No se ha contratado ni configurado ningún proveedor de correo adicional ni se han enviado invitaciones reales en esta implementación.

## 4. Plantillas

En Authentication > Email Templates > Invite user, utilizar un enlace como este:

```html
<h2>Activa tu acceso de consultor</h2>
<p>Completa tus datos y crea tu contraseña personal.</p>
<a href="{{ .SiteURL }}#token_hash={{ .TokenHash }}&amp;type=invite">Preparar mi cuenta</a>
```

En Reset password:

```html
<h2>Recupera tu acceso</h2>
<a href="{{ .SiteURL }}#token_hash={{ .TokenHash }}&amp;type=recovery">Crear una nueva contraseña</a>
```

Los enlaces se leen en memoria y se retiran de la dirección inmediatamente. El usuario pulsa «Validar mi acceso» para comprobarlos con Supabase. Un enlace falso, caducado o ya consumido no autoriza el acceso. También se admite el formato por fragmento de las plantillas predeterminadas de Supabase si redirigen a `/cuenta/`.

## 5. Dar de alta un consultor

En Authentication > Users > Add user > Invite user, introducir el correo corporativo. Utilizar **Invite user**, no crear una cuenta con contraseña provisional. Esto lo realiza Carlos desde Supabase por ahora; la gestión de invitaciones desde el propio panel requerirá una función administrativa en el servidor.

El consultor abre el enlace, valida la invitación, rellena sus datos y crea su contraseña. El cambio de contraseña se registra desde un trigger del servidor, no desde un campo de perfil editable. Su panel solo muestra Inicio y Mi perfil; los recursos de RED siguen pendientes de implementación.

## Verificación real después de aplicar el SQL

1. Carlos conserva el acceso y puede completar su perfil.
2. Una invitación de prueba abre la activación y el enlace deja de aparecer en la dirección.
3. El consultor ve únicamente su perfil y no puede listar ni modificar solicitudes de clientes por la API.
4. El consultor no puede consultar perfiles de otros ni asignarse rol de administrador.
5. Una contraseña actual incorrecta no permite cambiarla.
6. Las contraseñas nuevas deben coincidir y tener al menos 12 caracteres.
7. Al cambiar la contraseña se cierra la sesión y se comprueba el acceso con la nueva.
8. La recuperación envía un enlace únicamente cuando la solicita el usuario; la respuesta no confirma si una dirección está registrada.

Las pruebas de interfaz y autenticación simuladas no sustituyen estas comprobaciones en el proyecto real y su configuración de correo.
