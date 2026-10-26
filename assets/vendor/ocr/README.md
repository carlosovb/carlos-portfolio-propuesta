# Lector local de capturas

Archivos fijados a Tesseract.js 5.1.1 y tesseract.js-core 5.1.1, descargados de sus paquetes npm mediante jsDelivr. Modelo spa de tessdata 4.0.0_fast, servido por tessdata.projectnaptha.com. Licencias Apache 2.0 adjuntas.

Se sirven desde el mismo origen. No se contacta con un CDN durante la lectura ni se envían imágenes a ningún servicio. La biblioteca se carga al elegir la primera captura. El worker se termina al finalizar, cancelar o cambiar de ficha. `cacheMethod: none` evita guardar datos del lector en IndexedDB. Las capturas y el texto no se almacenan.

API oficial: https://github.com/naptha/tesseract.js/blob/v5.1.1/docs/api.md

Se conservan los cuatro núcleos y sus WASM para la selección automática según soporte SIMD y LSTM. No editar archivos generados de terceros.
