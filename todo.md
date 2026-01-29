### TODO

#### VP9 - Opciones para migrar en el futuro

El build actual de FFmpeg WASM (`ffmpeg-worker-webm.js`) fue compilado con `--disable-vp9`. Solo incluye el encoder `libvpx_vp8`. VP9 daría ~30-50% mejor compresión a la misma calidad percibida.

**Opcion 1: Buscar un build de ffmpeg.wasm con VP9 sin SharedArrayBuffer**

- El proyecto [Kagami/ffmpeg.js](https://github.com/nicholaschuayunzhi/nicholaschuayunzhi.github.io) tenía builds con VP9 pero las URLs de gh-pages dieron 404.
- Buscar forks o builds alternativos de ffmpeg.js que incluyan `--enable-encoder=libvpx_vp9` y NO requieran `SharedArrayBuffer`.
- El build debe funcionar como Web Worker standalone (sin COOP/COEP headers), ya que GitHub Pages no los soporta.
- Tamaño esperado del WASM: ~12-15MB (vs ~9MB actual con solo VP8).

**Opcion 2: Recompilar el WASM con VP9**

- Partir del proyecto [nicholaschuayunzhi/nicholaschuayunzhi.github.io](https://nicholaschuayunzhi.github.io) o del Makefile de [nicholaschuayunzhi/nicholaschuayunzhi.github.io](https://nicholaschuayunzhi.github.io).
- Modificar el script de build para añadir `--enable-encoder=libvpx_vp9` al configure de FFmpeg.
- Requiere: Emscripten SDK, libvpx compilado con VP9, paciencia.
- Paso clave: en el `./configure` de FFmpeg, cambiar `--enable-encoder=libvpx_vp8` a `--enable-encoder=libvpx_vp8 --enable-encoder=libvpx_vp9`.
- Compilar con `emmake make` y generar el .js + WASM embebido.

**Si se consigue VP9, cambios en script.js:**

- `CONFIG.VIDEO_CODEC` pasaría de `'libvpx'` a `'libvpx-vp9'`
- Los CRF de VP9 van de 0-63 igual que VP8 pero son más eficientes, ajustar presets:
  - high: CRF 15, bitrate 0 (calidad constante pura)
  - medium: CRF 30, bitrate 0
  - low: CRF 40, bitrate 800k, 480p, 24fps
- Añadir `-row-mt 1` para mejor rendimiento en VP9
- Quitar `-auto-alt-ref` y `-lag-in-frames` (VP9 los maneja internamente)

#### Otras mejoras pendientes

- Incluir JSZip localmente (~100KB) en vez de cargarlo desde CDN para funcionar 100% offline
- Considerar mostrar el nombre del preset usado en el badge de cada video card
