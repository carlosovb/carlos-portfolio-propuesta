# Publicación y vuelta atrás: importación mediante capturas

Versión de respaldo: `respaldo-pre-capturas-20261026`, commit `1998bbd7d6dd9119d73e3a7800aa18065638b6a8`. La etiqueta está guardada en GitHub.

La activación se identifica con la etiqueta `activacion-capturas-20261026`. Para retirar únicamente esta función, sin reescribir el historial:

```powershell
git switch main
git pull --ff-only origin main
git revert --no-edit activacion-capturas-20261026
git push origin main
```

Comprobar después que GitHub Pages ha publicado el cambio. No ejecutar estas instrucciones salvo solicitud de vuelta atrás.

Esta publicación no contiene migraciones ni modifica productos existentes. Revertir el código no elimina los productos que se hayan guardado mediante captura. Su registro utiliza el editor y los permisos actuales; el usuario revisa los datos y confirma antes de guardar.

No se publican el laboratorio `pruebas-capturas/`, los endpoints de diagnóstico, los registros locales, las capturas del usuario ni DESARROLLO-LOCAL.md. Las pruebas utilizan una página aislada generada por tests/capture-fixture.cjs, con datos ficticios.

Validación prevista antes de publicar: flujo de capturas y recuperación tras fallo, flujos de clientes y productos, diseño adaptable, y permisos y cálculos de firmas que ya existen. Verificar después en la web pública los recursos de OCR y el flujo mediante API simulada, sin crear productos reales.
