# Producción y comisiones por firma

Aplicar `unit-statistics.sql` después de los archivos de clientes, productos,
equipo, puestos y permisos de carrera. La migración es aditiva y repetible:
no cambia los productos anteriores ni les asigna fechas o multiplicadores.

## Registro

En Clientes → Ver ficha → Productos contratados se registra:

- Unidades generadas por el producto.
- Fecha real de firma (sin fechas futuras).
- Multiplicador del firmante en esa fecha.
- Multiplicadores de los responsables de esa firma, con confirmación explícita.

La aportación mensual o única del cliente no es la comisión del consultor.
Una firma produce unidades una sola vez. No se repite cada mes.

Al registrar la firma, el servidor valida la estructura actual del consultor.
Después conserva esa estructura y los multiplicadores registrados, aunque haya
ascensos o cambios de responsable. No hay un historial anterior de responsables:
si se necesitan firmas de otra estructura histórica, debe revisarse esa estructura
antes de introducirlas. Los multiplicadores desconocidos se dejan pendientes.

Las fechas o unidades que falten se señalan como productos pendientes y no se
imputan a ningún mes. Un multiplicador desconocido permite contar las unidades
fechadas, pero su comisión queda pendiente. Los totales de euros son parciales
si hay comisiones pendientes. Borrar un cliente o producto también elimina sus
unidades y comisiones: las estadísticas reflejan los contratos conservados.

## Cálculo confirmado

- Propias: unidades × multiplicador del firmante.
- Equipo inferior: unidades × máximo(multiplicador del beneficiario −
  multiplicador del firmante, 0), en cada nivel que figure en la firma.
- Equipo completo: unidades globales sin duplicar las firmas; euros sumando
  todas las comisiones propias y de equipo. Las unidades vinculadas a los
  beneficiarios de equipo pueden repetirse entre niveles y se etiquetan aparte.
- Cada comisión se redondea a céntimos antes de sumar.

Ejemplo: 100 U, firmante ×2, responsable ×2,5 y superior ×3,5:
200 € propios + 50 € de equipo + 150 € de equipo = 400 € globales; 100 U firmadas.
Esta es la regla solicitada; no se aplica el diferencial entre niveles adyacentes.

## Periodos y acceso

Meses naturales, incluido febrero bisiesto; referencia horaria Atlantic/Canary.
La carrera usa producción propia histórica, propia del trimestre natural o total
del trimestre según el requisito. Las unidades de equipo corresponden a la
estructura guardada en cada firma, sin recalcular meses pasados tras un traslado.

El detalle por persona se limita al usuario y sus descendientes actuales.
Los superiores y ramas ajenas aparecen solo en los agregados de la organización.
Los productos y los datos de clientes continúan siendo privados por consultor.
`get_career_progress` conserva la autorización propia y por descendientes.
El cálculo interno de comisiones no tiene permiso de ejecución para clientes.

## Verificación

`tests/unit-statistics.cjs` prueba importes, meses, trimestres, instantáneas,
datos incompletos, permisos y revocación sobre una base aislada.
`tests/clients-flow.cjs` prueba captura de firma, pantalla de estadísticas,
desglose, navegación y adaptación en ambos temas a 320, 768 y 1440 px.
Las pruebas no utilizan clientes reales ni envían correos.
