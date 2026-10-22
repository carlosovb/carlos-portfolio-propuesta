# Productos contratados

La ficha de cada cliente permite añadir, editar y eliminar sus productos contratados. Campos: compañía, producto, cartera de fondos (opcional), tipo de aportación mensual o única, importe en euros y unidades generadas (opcionales, introducidas manualmente). Los importes mensuales y únicos se resumen por separado.

La migración `client-products-setup.sql` crea la tabla con RLS y cuatro políticas. Cada consultor solo accede a los productos de sus propios clientes, también para el administrador. Las cuentas anónimas, sin perfil completo o desactivadas no pueden acceder. El cliente y la fecha de creación no se pueden cambiar desde el navegador. Al eliminar un cliente se eliminan sus productos en cascada.

No contiene datos reales ni credenciales privadas. La migración ya está aplicada al proyecto de producción. Las pruebas `client-products-permissions.cjs` y `clients-flow.cjs` verifican permisos, validación, edición y borrado con datos ficticios.

## Referencias en el listado de clientes

Aplicar `client-company-references.sql` después de `client-products-setup.sql`.
La consulta paginada devuelve las compañías distintas de cada cliente, respetando
los permisos existentes. No devuelve productos ni datos de otros consultores.
La interfaz actualiza las referencias al guardar o eliminar un contrato.
