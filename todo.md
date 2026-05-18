# todo — videoToWeb

*5 marzo 2026*

## next steps

- [ ] encoding en dos pasadas (two-pass) para mejor ratio calidad/tamaño
- [ ] thumbnail/preview: extraer un frame como miniatura en la tarjeta
- [ ] estimación de tamaño de salida antes de convertir
- [ ] ETA de conversión (tiempo restante estimado)
- [ ] slider CRF avanzado para control más fino
- [ ] re-convertir con otro preset sin volver a subir el archivo
- [ ] pegar desde clipboard (Ctrl+V / Cmd+V)
- [ ] open graph tags para compartir en redes
- [x] drag & drop para reordenar videos antes del ZIP (SortableJS)

## notas sobre VP9

El codec actual es VP8 (`libvpx`). VP9 (`libvpx-vp9`) daría ~30-50% mejor compresión, pero causa memory crashes en ffmpeg.wasm (issues #679/#786). Hasta que el soporte de memoria mejore en ffmpeg.wasm, VP8+Vorbis es la combinación más estable.

Si algún día se consigue VP9:
- `CONFIG.VIDEO_CODEC` → `'libvpx-vp9'`
- CRF de VP9 es más eficiente: high ~15, medium ~30, low ~40
- Añadir `-row-mt 1` para mejor rendimiento
- Quitar `-auto-alt-ref` y `-lag-in-frames` (VP9 los gestiona internamente)

## otras mejoras pendientes

- [ ] incluir JSZip localmente (~100KB) en vez de CDN para funcionar 100% offline
- [ ] mostrar nombre del preset usado en el badge de cada video card
