# Vuelta atrás de la v0.7.0

La etiqueta local `respaldo-pre-v0.7.0-local` apunta a `0b38d85ebeb1beedb3e41c1f5451847623de1f7b`, la v0.6.2 publicada. La etiqueta se creó sin modificar el remoto.

## Antes de publicar

1. Verificar que el commit de referencia sigue siendo el de producción. Si ha cambiado, actualizar la referencia y repetir la comparación.
2. Guardar una copia recuperable de la base y comprobar que se puede restaurar en un proyecto aislado.
3. Probar las migraciones sobre una copia del esquema de producción. Aplicar `career-auto-promotion.sql`, `career-requests.sql` y `resources-edit-links.sql` en ese orden. Las dos primeras requieren las funciones existentes de producción por firmas, estadísticas y notificaciones.
4. Publicar el código en un commit de lanzamiento identificable. Excluir los laboratorios y los archivos de diagnóstico locales.

## Reversión después de publicar

1. Si es necesario detener la función de promociones mientras se vuelve a la versión anterior, ejecutar `database/rollback-v0.7.0.sql` tras confirmar que están aplicadas las tres migraciones del lanzamiento. La pausa bloquea nuevos ascensos automáticos y deshabilita las solicitudes, resoluciones y edición de enlaces. Las firmas nuevas siguen guardándose.
2. Revertir el commit de lanzamiento con `git revert` y publicar el commit resultante. Si se ha publicado en varios commits, revertir los del lanzamiento en orden inverso. Conservar el historial de la rama.
3. Comprobar acceso, consulta de clientes y estadísticas en el sitio restaurado. Revisar una firma con tramos anterior a la pausa y comprobar que mantiene las unidades y los euros.

El cálculo de comisiones de la v0.7.0 se conserva en la base tras la pausa. Restaurar el cálculo antiguo o borrar las tablas de tramos, ascensos y trofeos quitaría información de operaciones ya confirmadas. Los cambios de puesto ya confirmados se mantienen. La copia de seguridad completa se reserva para una recuperación excepcional que tenga en cuenta las operaciones posteriores a la copia.

Para reactivar, probar de nuevo las tres migraciones antes de aplicarlas y publicar el código corregido. Conciliar primero las firmas registradas durante la pausa. El procedimiento no ejecuta un ascenso retrospectivo por sí solo.
