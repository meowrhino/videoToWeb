# videoToLilVideo 🎬

**Compresor de video WebM optimizado para web** - Reduce el tamaño de tus videos hasta un 90% manteniendo excelente calidad.

## ✨ Características

- 🎯 **3 Opciones de Compresión** - Alta Calidad, Balance, Máxima Compresión
- 🌐 **100% en el navegador** - Sin backend, sin uploads a servidores
- 📱 **Responsive** - Funciona en desktop y móvil
- ⚡ **Rápido** - Procesamiento local con FFmpeg.js
- 🎨 **Interfaz simple** - Arrastra, suelta, descarga
- 🔀 **Reordena arrastrando** - Cambia el orden de los videos antes de descargar el ZIP (también con touch en móvil)
- 🔒 **Privado** - Tus videos nunca salen de tu dispositivo
- 📐 **Auto-escalado** - Optimiza automáticamente a 720p HD

## 🚀 Uso

1. Abre videoToLilVideo
2. Selecciona tu opción de compresión:
   - **Alta Calidad**: Para videos con movimiento
   - **Balance**: Recomendado para uso general ⭐
   - **Máxima Compresión**: Para videos estáticos o muy largos
3. Arrastra tus videos o haz clic para seleccionar
4. Espera a que se compriman
5. (Opcional) Arrastra las tarjetas de video para reordenarlas antes de descargar el ZIP
6. Descarga tus videos optimizados en WebM

## 🎛️ Opciones de Compresión

### Alta Calidad (CRF 30)
- **Bitrate máximo**: 2500 kbps
- **Tamaño esperado**: ~10-12 MB (para 720p, 40s)
- **Reducción**: ~75-80%
- **Ideal para**: Videos con movimiento, deportes, gaming
- **Calidad**: ★★★★★ Excelente

### Balance (CRF 33) ⭐ Recomendado
- **Bitrate máximo**: 1500 kbps
- **Tamaño esperado**: ~6-8 MB (para 720p, 40s)
- **Reducción**: ~84-88%
- **Ideal para**: Uso general, videos corporativos, tutoriales
- **Calidad**: ★★★★☆ Muy buena

### Máxima Compresión (CRF 37)
- **Bitrate máximo**: 1000 kbps
- **Tamaño esperado**: ~4-5 MB (para 720p, 40s)
- **Reducción**: ~90-92%
- **Ideal para**: Presentaciones, videos estáticos, videos muy largos
- **Calidad**: ★★★☆☆ Buena

## 🔧 Tecnología

- **FFmpeg.js** - FFmpeg compilado a WebAssembly
- **VP8 (libvpx)** - Codec de video optimizado con bitrates específicos
- **Opus** - Codec de audio de alta calidad
- **HTML5** + **CSS3** + **Vanilla JavaScript**

### Parámetros Técnicos

**VP8 con Bitrates Específicos**:
- Codec: libvpx (VP8)
- Resolución máxima: 720p HD (evita OOM)
- CRF range: 30-37 (menor = mejor calidad)
- Bitrates máximos: 2500k (Alta), 1500k (Balance), 1000k (Máxima)
- CPU-used: 2 (mejor calidad)
- Auto-alt-ref: 1 (mejor compresión)

## 📊 Resultados Esperados

| Video Original | Alta Calidad | Balance | Máxima | Mejor Opción |
|----------------|--------------|---------|--------|--------------|
| 50 MB (720p, 40s) | ~11 MB | ~7 MB | ~5 MB | Balance |
| 100 MB (1080p→720p) | ~11 MB | ~7 MB | ~5 MB | Balance |
| 200 MB (4K→720p) | ~11 MB | ~7 MB | ~5 MB | Máxima |

*Resultados aproximados. Pueden variar según el contenido del video.*

## ⚙️ Configuración Avanzada

Puedes modificar `script.js` para ajustar parámetros:

```javascript
const CONFIG = {
  MAX_WIDTH: 1280,                    // Ancho máximo (720p HD)
  MAX_HEIGHT: 720,                    // Alto máximo (720p HD)
  
  // Bitrates máximos por opción
  VIDEO_BITRATE_ALTA: '2500k',        // Alta Calidad
  VIDEO_BITRATE_BALANCE: '1500k',     // Balance
  VIDEO_BITRATE_MAXIMA: '1000k',      // Máxima Compresión
  
  CRF_MIN: 30,                        // CRF para Alta Calidad
  DEFAULT_CRF: 33,                    // CRF para Balance
  CRF_MAX: 37,                        // CRF para Máxima
  
  VIDEO_CODEC: 'libvpx',              // VP8 codec
  AUDIO_CODEC: 'libopus',             // Opus codec
  CPU_USED: '2',                      // Velocidad encoding
  AUTO_ALT_REF: '1',                  // Mejor compresión
};
```

## 🐛 Limitaciones Conocidas

- **Videos muy largos (>30 min)** pueden causar problemas de memoria en el navegador
- **Videos >720p** son escalados automáticamente a 720p para evitar OOM
- **Navegadores antiguos** sin soporte WebAssembly no funcionarán
- **VP8 requiere bitrate máximo** para que CRF funcione correctamente

## 💡 Consejos de Uso

### Por Tipo de Video

| Tipo de Video | Opción Recomendada | CRF |
|---------------|-------------------|-----|
| Deportes, acción, gaming | Alta Calidad | 30 |
| Tutoriales, vlogs, corporativos | Balance | 33 |
| Presentaciones, screencasts | Máxima Compresión | 37 |
| Videos muy largos (>30 min) | Máxima Compresión | 37 |

### Consejos Generales

- **Para videos grandes**: Considera dividirlos antes de comprimir
- **Primera vez**: Prueba las 3 opciones con el mismo video para comparar
- **Videos con mucho movimiento**: Usa Alta Calidad (CRF 30)
- **Videos estáticos**: Usa Máxima Compresión (CRF 37)
- **Compatibilidad**: WebM es soportado por todos los navegadores modernos

## 🆚 Diferencias con videoToWeb

| Característica | videoToWeb | videoToLilVideo |
|----------------|------------|-----------------|
| Codec | VP8 | VP8 con bitrates específicos |
| Opciones | Slider CRF | 3 opciones predefinidas |
| Compresión | Buena | Mejor (~30% mejor) |
| Velocidad | Rápida | Rápida |
| Resolución máx | 720p | 720p |
| CRF range | 24-38 | 30-37 |
| Bitrate | Variable | Específico por opción |
| Objetivo | Conversión rápida | Mejor compresión |
| Interfaz | Slider técnico | Botones simples |

## 📁 Documentación Técnica

Toda la investigación y proceso de desarrollo está documentado en la carpeta [`procesoManus/`](./procesoManus/):

- **INFORME_FINAL.md** - Resumen ejecutivo del proyecto
- **INFORME_ANALISIS_PROBLEMA_CRF.md** - Análisis técnico del problema VP8 CRF
- **analisis_configuraciones_vp8.md** - Comparativa de configuraciones probadas
- **guia_opciones_calidad.md** - Guía de uso de las 3 opciones
- Y más documentos de investigación y debugging

## 🤝 Créditos

Creado por [meowrhino.studio](https://meowrhino.studio)

Powered by:
- [FFmpeg.js / ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)
- [VP8 Codec](https://www.webmproject.org/vp8/)
- [Opus Audio Codec](https://opus-codec.org/)

## 📄 Licencia

MIT License - Úsalo libremente

---

**¿Necesitas comprimir videos para tu web?** videoToLilVideo es la herramienta perfecta para reducir el peso sin sacrificar calidad.

🎯 **3 opciones simples** | 🚀 **100% en el navegador** | 🔒 **Totalmente privado**
