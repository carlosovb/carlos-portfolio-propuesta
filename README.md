# Carlos Caballero Dávila · Portfolio

Propuesta de web personal en español, adaptable a móvil y ordenador, con modos claro y oscuro.

## Estado actual

La página contiene el diseño del portfolio y sus interacciones visuales. El formulario es una demostración: no envía ni almacena datos. El panel privado, RED y la eliminación automática de datos están pendientes de implementación.

## Archivos

- `index.html`: contenido y estructura.
- `css/base.css`: estructura y estilos base.
- `css/styles.css`: estilos de las secciones, efectos y temas de color, separados por comentarios.
- `css/responsive.css`: adaptación a distintos tamaños de pantalla y controles táctiles.
- `js/theme-init.js`: aplicación inicial del tema antes de mostrar la página.
- `js/theme.js`: selector de tema y confirmación del formulario de demostración.
- `js/interactions.js`: animaciones, menús y navegación, separados por función.
- `assets/`: fotografía.
- `finance-background.svg`: fondo decorativo.

## Vista previa local

Con Node.js instalado, ejecutar `node server.cjs` y abrir `http://127.0.0.1:4173`.

Guardar el proyecto en GitHub no publica automáticamente una página web.

## Organización del código

El HTML está dividido por secciones con comentarios. Los archivos utilizan sangría de dos espacios y líneas separadas para facilitar su lectura.

Los estilos se cargan en este orden: `base.css` y `styles.css`. Dentro de `styles.css`, las reglas posteriores ajustan las anteriores; se conserva ese orden para mantener el diseño aprobado.
