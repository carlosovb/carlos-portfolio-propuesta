# Productos contratados

La ficha de cada cliente permite añadir, editar y eliminar sus productos contratados. Campos: compañía, producto, cartera de fondos (opcional), tipo de aportación mensual o única, importe en euros y unidades generadas (opcionales, introducidas manualmente). Los importes mensuales y únicos se resumen por separado.

La migración `client-products-setup.sql` crea la tabla con RLS y cuatro políticas. Cada consultor solo accede a los productos de sus propios clientes, también para el administrador. Las cuentas anónimas, sin perfil completo o desactivadas no pueden acceder. El cliente y la fecha de creación no se pueden cambiar desde el navegador. Al eliminar un cliente se eliminan sus productos en cascada.

No contiene datos reales ni credenciales privadas. La migración ya está aplicada al proyecto de producción. Las pruebas `client-products-permissions.cjs` y `clients-flow.cjs` verifican permisos, validación, edición y borrado con datos ficticios.

## Referencias en el listado de clientes

Aplicar `client-company-references.sql` después de `client-products-setup.sql`.
La consulta paginada devuelve las compañías distintas de cada cliente, respetando
los permisos existentes. No devuelve productos ni datos de otros consultores.
La interfaz actualiza las referencias al guardar o eliminar un contrato.

## Cartera con búsqueda, filtros y vistas

Aplicar `client-workspace.sql` después de las tablas de clientes, productos y perfiles.
`search_my_clients` filtra toda la cartera antes de paginar (25 registros), conservando
RLS y la prioridad de clientes sobre interesados. La combinación compañía/producto
se exige sobre un mismo contrato. Las unidades son la suma de las registradas en
los productos; los valores desconocidos se señalan aparte, sin inventar producción.

Los filtros y la búsqueda se mantienen solo en memoria. La vista list/cards/compact
se guarda por auth.uid() en una tabla privada mediante funciones autorizadas. No se
almacenan clientes en localStorage. Al salir se borran opciones de filtros y filas.
Pruebas: `tests/client-workspace.cjs`, `tests/clients-flow.cjs`.
Referencia de organización visual: catálogo oficial Figma, plantilla CRM Dashboard
Customers List: https://www.figma.com/templates/dashboard-designs/.
