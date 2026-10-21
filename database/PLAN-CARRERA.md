# Plan de carrera

Transcrito de la imagen facilitada por Carlos. El catálogo compartido `js/career-data.js` contiene nueve puestos, sus multiplicadores y requisitos 100 % / 125 %. Se mantienen como alternativas los grupos de colaboradores separados por «o» en el documento, y se exige simultáneamente la producción indicada. Las unidades trimestrales se distinguen de la producción propia histórica. No se deducen requisitos del 125 % para puestos donde la imagen no los detalla. Director Nacional Senior se excluye por indicación expresa de Carlos.

`career-roles.sql` incorpora los nueve puestos a `team_roles`, sin cambiar las asignaciones existentes. Conserva los permisos actuales: solo el administrador asigna puestos y responsables, y el multiplicador procede siempre del puesto guardado. No se calculan promociones automáticas ni se relacionan con las aportaciones monetarias de clientes.

En Equipo, los puestos de la barra inferior son pulsables y el botón Plan de carrera abre el catálogo completo. Los selectores de perfil y administración comparten el catálogo. Las pruebas de permisos verifican los nueve puestos y el bloqueo de cambios por consultores.
