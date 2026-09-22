# todo — videoToWeb

*actualizado 23 septiembre 2026*

## next steps

- [ ] encoding en dos pasadas (two-pass) para mejor ratio calidad/tamaño
- [ ] thumbnail/preview: extraer un frame como miniatura en la tarjeta
- [ ] estimación de tamaño de salida antes de convertir
- [ ] slider CRF avanzado para control más fino
- [ ] re-convertir con otro preset sin volver a subir el archivo
- [ ] incluir JSZip y SortableJS localmente en vez de CDN (o añadir SRI)
- [ ] og:image para compartir en redes

## hecho

- [x] drag & drop para reordenar videos antes del ZIP (SortableJS)
- [x] pegar desde clipboard (Ctrl+V / Cmd+V)
- [x] open graph tags
- [x] ETA de conversión
- [x] nombre del preset en el badge de cada video card
- [x] refactor a módulos ES (`js/`)
- [x] fix: cancelar ya no marca como error el siguiente video de la cola
- [x] fix: el escalado lo hace ffmpeg (funciona aunque el navegador no lea los metadatos)
- [x] fix: aceptar mkv/flv/etc. aunque `file.type` venga vacío

## notas sobre VP9

El codec actual es VP8 (`libvpx`). VP9 (`libvpx-vp9`) daría ~30-50% mejor compresión, pero causa memory crashes en ffmpeg.wasm (issues #679/#786). Hasta que el soporte de memoria mejore en ffmpeg.wasm, VP8+Vorbis es la combinación más estable.

Si algún día se consigue VP9:
- `CONFIG.VIDEO_CODEC` → `'libvpx-vp9'` (en `js/config.js`)
- CRF de VP9 es más eficiente: high ~15, medium ~30, low ~40
- Añadir `-row-mt 1` para mejor rendimiento
- Quitar `-auto-alt-ref` y `-lag-in-frames` (VP9 los gestiona internamente)
