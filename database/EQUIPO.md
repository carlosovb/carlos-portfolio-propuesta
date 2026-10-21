# Equipo: árbol, puestos y fotos

El apartado Equipo está disponible para el administrador y los consultores con perfil completado. Los consultores entran directamente en el árbol al iniciar sesión; el administrador conserva su pantalla de actividad inicial. El árbol se centra en la tarjeta del usuario y ofrece desplazamiento, zoom y Volver a mi puesto.

## Puestos
- Financial Trainee: ×2.
- Financial Consultant: ×2,5.
- Gestor de Equipo: ×3,5.

Un usuario sin puesto asignado muestra Pendiente de asignar. No se deduce ni asigna un puesto por su cuenta. El tipo de acceso (administrador/consultor) es independiente del puesto profesional.

## Uso
El administrador abre Equipo, pulsa una tarjeta y selecciona puesto y responsable. El servidor impide que una persona dependa de sí misma o que se formen cadenas circulares. Los consultores ven esos datos en su ficha y en una lista de solo lectura dentro de Mi perfil.

Solo aparecen en el árbol los perfiles completados con acceso activo, además del administrador cuando tiene perfil. Las invitaciones pendientes siguen en Consultores. Los datos de teléfono y correo no se incluyen en el directorio del equipo.

Cada persona puede subir o quitar su propia foto en Mi perfil. Antes de guardar se abre un editor para arrastrar la foto, ajustar el zoom y girarla. También puede reajustarse la foto actual. El encuadre se convierte a WebP de 512 píxeles; se aceptan JPG, PNG o WebP de hasta 5 MB. Si no hay foto, se muestran las iniciales. Las fotos se consultan con la sesión y no se publican en GitHub.

## Instalación reproducible
team-setup.sql se aplica después de profile-setup.sql. Crea los puestos, las asignaciones y el almacenamiento privado de fotos con sus controles de acceso. La función invite-consultant debe incluir la limpieza de la foto al eliminar una invitación incompleta.

## Validación
Pruebas de permisos en Postgres local y pruebas de interfaz con perfiles ficticios: centrado propio, tamaños móviles y de escritorio, selección de puesto exclusiva del administrador, fichas, carga y retirada de foto. No se incluyen datos de usuarios reales en estas pruebas.

El administrador puede guardar su propio puesto desde Mi perfil; el multiplicador se calcula a partir del puesto. Su ficha es la raíz del árbol y muestra Responsable principal. Las incorporaciones sin otro responsable asignado dependen del administrador. El árbol ocupa el espacio completo del panel con controles flotantes.
