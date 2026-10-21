# Clientes

Cada consultor dispone de su propia cartera privada. Incluso el administrador solo consulta los datos personales de su cartera. En Equipo se comparten únicamente cantidades por consultor y total del directorio activo.

## Importación

- El informe .xlsx se interpreta en el navegador mediante la copia local de SheetJS.
- Se conservan las 12 columnas del informe desde Tipo cliente hasta Localidad. El resto se descarta antes de enviar datos.
- El archivo original no se sube ni se conserva. Los registros se muestran en una vista previa; se guardan solo al confirmar.
- Se comprueban apellidos y nombre normalizados, y fecha de nacimiento. Con fechas diferentes se conservan personas distintas. Si falta una fecha, una coincidencia de nombre se trata conservadoramente como repetida.
- Los repetidos se omiten sin actualizar sus datos. La comprobación se repite en la transacción final y se serializa por consultor para evitar duplicados por importaciones simultáneas.
- Las filas con datos incorrectos quedan fuera y se indica su número para corregir el archivo. Límites: 5 MB y 5.000 registros por archivo.
- Los ejemplos son ficticios y funcionan en memoria. No se mezclan con la cartera ni se incorporan a los recuentos del equipo.

## Almacenamiento y permisos

`database/clients-setup.sql` crea la tabla con RLS. Lectura y eliminación requieren propietario coincidente con auth.uid() y acceso al panel completo y vigente. La tabla no permite INSERT ni UPDATE directos desde el navegador; la importación exige usuario autorizado y fija el propietario en el servidor, ignorando cualquier propietario enviado.

Los recuentos del equipo se calculan mediante una función con privilegios que comprueba el acceso antes de agregar; nunca devuelve nombres, fechas, correos, teléfonos, direcciones ni filas de clientes. Los demás endpoints trabajan con la cartera propia.

No se aplica a esta cartera el borrado a los 60 días de las solicitudes de primera reunión. Los clientes permanecen hasta que su consultor los elimina o se elimina su cuenta.

## Comprobaciones

`tests/clients-permissions.cjs`: base aislada, permisos por consultor, validación, duplicados, propietario fijado en servidor, anonimato de los agregados y bloqueo de accesos desactivados.

`tests/clients-flow.cjs`: datos ficticios, ejemplo separado, vista previa, importación repetida, exclusión de columnas adicionales, búsqueda, fichas, selección múltiple, eliminación y limpieza al cerrar sesión, en móvil y escritorio.

Los tipos originales Cliente e Interesado se distinguen mediante etiquetas y colores. Los clientes se ordenan primero desde la base de datos, antes de paginar; los tipos no reconocidos quedan al final sin reclasificarse. El resumen de cartera distingue ambas categorías. En Equipo, los recuentos aparecen solo dentro de la ficha del consultor.
