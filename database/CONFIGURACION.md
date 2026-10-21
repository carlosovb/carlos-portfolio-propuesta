# Activación del panel privado

El panel y la base de datos son piezas distintas. GitHub Pages publica la interfaz; las solicitudes se guardan en Supabase. No se crean archivos con datos de clientes en GitHub.

## Estado actual

La integración está preparada y la configuración está vacía. No se envían datos a Supabase hasta completar la configuración. El acceso no se simula: si no hay servicio conectado, el formulario de contacto y el inicio de sesión permanecen desactivados.

## 1. Crear el proyecto

Crear un proyecto de Supabase en el plan gratuito y seleccionar una región de la Unión Europea. El plan gratuito puede pausar proyectos por inactividad: no garantiza disponibilidad continua ni la ejecución del borrado mientras el proyecto esté pausado. No activar cobros ni contratar otro plan sin decidirlo previamente.

## 2. Preparar los permisos

Ejecutar `setup.sql` en el SQL Editor del proyecto. Crea la tabla, permisos y programación de borrado. Si la parte de Cron falla, activar `pg_cron` en Supabase y ejecutar la parte final. Verificar en Cron que `portfolio-expired-requests` está activo y que sus ejecuciones finalizan correctamente.

La tabla no admite consultas públicas ni inserciones directas. El formulario solo puede ejecutar una función de registro con campos limitados. No puede elegir el estado, las fechas ni leer solicitudes anteriores. La función limita a tres solicitudes por teléfono por hora; no sustituye una protección antibots completa.

## 3. Crear la cuenta de Carlos

En Authentication > Users, crear el usuario administrador con correo y contraseña. Desactivar los registros públicos en la configuración de Authentication. Crear la cuenta no envía solicitudes de clientes por correo.

Copiar el UUID del usuario y utilizarlo en `owner.example.sql`. Solo los UUID registrados en `private.panel_owners` podrán consultar solicitudes, cambiar estados y borrarlas. Otros usuarios autenticados, incluidos los futuros miembros de RED, no tienen estos permisos.

La contraseña se introduce en Supabase o en el formulario de acceso. Nunca se escribe en el repositorio ni se comparte por el chat.

## 4. Conectar el sitio

Completar `js/backend-config.js` con la URL HTTPS del proyecto y la clave **publishable** (`sb_publishable_…`). Estas dos piezas están diseñadas para ser públicas. El acceso a los datos lo restringen los permisos del servidor, no ocultar esa clave.

No usar una clave `secret`, `service_role`, una contraseña de base de datos o una contraseña de usuario en ese archivo. La integración rechaza esas claves.

## 5. Verificación con el servicio real

Antes de habilitar el formulario para clientes:

- Una petición sin sesión no puede leer, actualizar ni eliminar solicitudes.
- Un usuario autenticado fuera de la lista de propietarios tampoco puede hacerlo.
- Un usuario sin autorización no puede añadir propietarios ni cambiar fechas o estados al enviar una solicitud.
- Carlos puede entrar, buscar por nombre, cambiar estados y borrar.
- Una solicitud de prueba no contiene datos reales y aparece una sola vez aunque se reintente con el mismo ID.
- Un registro de prueba ya caducado no aparece mediante la API y el trabajo de Cron lo elimina.

Las pruebas de interfaz con respuestas simuladas no sustituyen estas comprobaciones en el proyecto real.

## Conservación y cifrado

Las solicitudes vencen a los 60 días; los permisos dejan de mostrarlas al vencer y Cron elimina las vencidas cada minuto cuando el proyecto está activo. No se anuncia el borrado como una garantía hasta verificar Cron y resolver la posible pausa del plan gratuito. Las copias de seguridad del proveedor tienen sus propias condiciones de conservación.

Supabase documenta cifrado AES-256 en almacenamiento y TLS en tránsito. No es cifrado de extremo a extremo: el proveedor opera la base de datos. No se suben los datos al repositorio, ni cifrados ni sin cifrar.

La sesión del panel vive en memoria y se cierra tras 15 minutos de inactividad o al recargar. El acceso desde el portfolio usa un traspaso de sesión de un solo uso en `sessionStorage`, válido durante 30 segundos: el panel lo elimina al leerlo y vuelve a verificar el usuario y sus permisos con el servidor. No contiene contraseñas ni solicitudes. No se guardan sesiones en `localStorage`; solo se conserva ahí la preferencia visual de tema.

## Pendiente de esta fase

Panel de RED, formulario financiero previo, edición del portfolio y copiado del enlace previo se implementarán después. Esta fase cubre las solicitudes de primera reunión. Revisar la información de privacidad definitiva antes de difundir el formulario a clientes.
