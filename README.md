# Carlos Caballero Dávila · Portfolio y panel

Web en español adaptable a móvil, tableta y ordenador, con modos claro y oscuro.

## Estado actual

El portfolio incluye el formulario de primera reunión y el panel de solicitudes en `/panel/`. La URL y la clave pública del proyecto Supabase están configuradas. Se ha comprobado que el acceso sin sesión no permite consultar ni modificar solicitudes. La prueba de acceso del propietario debe realizarla Carlos desde su cuenta.

No se envían solicitudes por correo. El formulario y el inicio de sesión se desactivan si la configuración falta. El panel no simula un acceso privado con contraseñas o datos en archivos públicos.

La cabecera del portfolio ofrece «Acceso consultor»: despliega el inicio de sesión bajo el menú y después lleva al panel. El traspaso usa `sessionStorage` una sola vez, caduca en 30 segundos y se elimina al entrar. El servidor vuelve a verificar la identidad y el permiso de administrador. Las contraseñas nunca se guardan en ese traspaso.

## Estructura

- `index.html`: portfolio y formulario.
- `panel/index.html`: acceso y panel privado.
- `css/base.css`, `css/styles.css`, `css/responsive.css`: apariencia del portfolio.
- `css/contact.css`, `css/panel.css`: formularios y panel.
- `js/theme-init.js`, `js/theme.js`: preferencia visual.
- `js/interactions.js`: menús y animaciones del portfolio.
- `js/backend-config.js`: URL y clave pública del servicio; no contiene contraseñas ni claves privadas.
- `js/backend.js`: autenticación, registro y operaciones autorizadas.
- `js/contact.js`, `js/panel.js`: comportamiento de las interfaces.
- `cuenta/index.html`, `js/account-link-init.js`, `js/account.js`: activación y recuperación.
- `database/`: estructura, permisos e instrucciones de activación, sin datos privados.
- `assets/`: fotografía.

## Activación y privacidad

Seguir [database/CONFIGURACION.md](database/CONFIGURACION.md). Ninguna contraseña ni clave privada debe subirse a GitHub. El repositorio contiene la aplicación, no las solicitudes. La base de datos almacena los datos por separado con permisos de acceso por propietario.

La lista de solicitudes permite buscar por nombre, consultar la ficha, cambiar el estado y eliminar registros. El servidor prepara caducidad a los 60 días. Su aplicación real depende de configurar, verificar y mantener activo el servicio; no debe afirmarse que está funcionando antes de hacerlo.

La interfaz y el cliente se pueden probar con respuestas simuladas. La autorización y la caducidad deben verificarse además en el proyecto real antes de recibir datos de clientes.

## Vista previa local

Con Node.js instalado, ejecutar `node server.cjs` y abrir `http://127.0.0.1:4173`. El panel está en `http://127.0.0.1:4173/panel/`.

## Organización del código

HTML por secciones, CSS con comentarios y JavaScript por función. Sangría de dos espacios. Los estilos del portfolio se cargan en orden: base, estilos, adaptación y contacto. El panel utiliza una hoja independiente después de los estilos compartidos.

El panel de RED, el formulario financiero previo y la edición del portfolio siguen pendientes.

## Perfiles y primer acceso

La pestaña Mi perfil permite guardar nombre, apellidos y teléfono y cambiar la contraseña comprobando la actual. El correo de acceso y los permisos no son editables. La activación por invitación incluye esos tres datos y la creación de contraseña.

Aplicar `database/profile-setup.sql` y seguir `database/PROFILE-CONFIGURACION.md`. Esta ampliación se activa en el servidor; no basta con publicar el código. Hasta ejecutarla, el administrador conserva su acceso anterior y el perfil indica que falta configuración.

Los consultores invitados no reciben permisos para consultar las solicitudes. La gestión y envío de invitaciones se realizan desde Supabase por ahora. Para enviar a compañeros se debe configurar un SMTP propio; no se ha configurado ni contratado uno automáticamente.

## Pruebas

Con las dependencias de desarrollo y Chromium de Playwright instalados, ejecutar `npm test`. Se puede indicar `CHROME_EXECUTABLE` para usar un navegador local. Las pruebas usan datos ficticios y respuestas simuladas; no envían correos ni cambian contraseñas reales. La verificación de servidor se prepara en `database/profile-verify.sql`.
