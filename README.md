# videoToWeb 🎬

**Conversor de vídeos a WebM en el navegador.** Sin backend y sin subir nada a ningún servidor: todo se procesa en tu dispositivo con [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm).

👉 https://meowrhino.github.io/videoToWeb/

## ✨ Características

- 🔒 **Privado**: los vídeos nunca salen de tu dispositivo
- 🎯 **3 calidades**: 1080, 720p (recomendado) y 480p
- 📥 **Varias formas de añadir vídeos**: arrastrar, seleccionar o pegar (Ctrl+V / Cmd+V)
- 🧵 **Cola secuencial** con progreso, ETA y cancelación
- 🔀 **Reordenar** tarjetas arrastrando (también en móvil, manteniendo pulsado) antes de descargar el ZIP
- 📦 **Descarga individual o en ZIP**

## 🎛️ Presets

VP8 en modo VBR limitado: el CRF marca el piso de calidad y `-b:v` el techo de bitrate. El vídeo solo se reduce (nunca se amplía) y se mantiene la relación de aspecto.

| Preset | Resolución máx. | CRF | Techo vídeo | Audio | cpu-used | FPS |
|---|---|---|---|---|---|---|
| 1080 | 1920×1080 | 10 | 1500k | 128k | 4 | original |
| 720p ⭐ | 1280×720 | 20 | 1200k | 96k | 5 | original |
| 480p | 854×480 | 33 | 800k | 96k | 8 | 24 |

Se configuran en [`js/config.js`](js/config.js).

## 🔧 Tecnología

- **ffmpeg.wasm 0.12** con core multi-thread (`@ffmpeg/core-mt`, ~31 MB desde jsDelivr)
- **VP8 (`libvpx`) + Vorbis (`libvorbis`)** en contenedor WebM
  - VP9 da mejor compresión, pero en ffmpeg.wasm se queda sin memoria (issues #679 y #786)
  - Opus provoca un stack overflow en WASM (issue #591)
- **[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)** añade los headers COOP/COEP necesarios para usar `SharedArrayBuffer` en GitHub Pages. La primera visita recarga la página una vez.
- Los archivos de ≥200 MB se montan con **WORKERFS**, que los lee directamente sin copiarlos a la memoria WASM
- HTML + CSS + JavaScript con módulos ES nativos, sin paso de build
- [SortableJS](https://github.com/SortableJS/Sortable) para reordenar y [JSZip](https://stuk.github.io/jszip/) (se carga solo al pulsar "descargar todo")

## 📁 Estructura

```
index.html            página
styles.css            estilos
coi-serviceworker.js  headers COOP/COEP (SharedArrayBuffer)
ffmpeg.js             @ffmpeg/ffmpeg 0.12 (UMD)
814.ffmpeg.js         worker que carga ffmpeg.js (no borrar)
js/
  main.js             punto de entrada: eventos del DOM
  config.js           CONFIG y PRESETS
  state.js            estado global y creación de videos
  queue.js            añadir archivos, cola secuencial, cancelar/eliminar
  converter.js        argumentos de ffmpeg y conversión de un video
  ffmpeg-loader.js    carga/terminación de ffmpeg.wasm
  metadata.js         duración y resolución vía <video>
  downloads.js        descarga individual, ZIP y log
  utils.js            formateo y helpers
  ui/dom.js           referencias al DOM y estado del área de subida
  ui/cards.js         render y actualización de tarjetas
  ui/notifications.js avisos flotantes
```

## 🧪 Desarrollo local

Los módulos ES y el service worker necesitan un servidor HTTP (no funciona abriendo el archivo con `file://`):

```bash
python3 -m http.server 5503
```

Luego abre http://localhost:5503. Con `CONFIG.DEBUG_LOGS = true` se activan los logs en consola, la descarga del log de cada conversión y un botón para convertir un mismo vídeo en las 3 calidades.

## 🐛 Limitaciones

- La memoria de WASM es limitada: los archivos muy grandes (>500 MB) o muy largos pueden fallar
- Hace falta un navegador moderno con WebAssembly y `SharedArrayBuffer`
- Si el navegador no sabe decodificar el formato (p. ej. HEVC), la tarjeta no muestra duración ni resolución, pero la conversión funciona igual

## 🤝 Créditos

Creado por [meowrhino.studio](https://meowrhino.studio). Licencia MIT.
