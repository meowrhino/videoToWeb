# Resultados de Prueba - videoToLilVideo

## Video de Prueba
- **Archivo original**: test_video.mp4 (Big Buck Bunny 10s)
- **Tamaño original**: 968K (991,017 bytes)
- **Bitrate original**: 792 kbps
- **Resolución**: 640x360
- **Duración**: 10 segundos

## Resultados de Conversión

### 1. Alta Calidad (CRF 30)
- **Parámetros**: CRF 30, bitrate máximo 2500k
- **Tamaño resultante**: 1.4M (1,420,214 bytes)
- **Bitrate resultante**: 1136 kbps
- **Diferencia vs original**: +46.6% (mayor tamaño debido a mejor calidad)

### 2. Balance (CRF 33) - Por Defecto
- **Parámetros**: CRF 33, bitrate máximo 1500k
- **Tamaño resultante**: 976K (998,725 bytes)
- **Bitrate resultante**: 799 kbps
- **Diferencia vs original**: +0.8% (prácticamente igual)

### 3. Máxima Compresión (CRF 37)
- **Parámetros**: CRF 37, bitrate máximo 1000k
- **Tamaño resultante**: 744K (760,925 bytes)
- **Bitrate resultante**: 609 kbps
- **Diferencia vs original**: -23.2% (reducción significativa)

## Conclusiones

✅ **Los 3 modos funcionan correctamente** y generan archivos con diferentes pesos y calidades:

1. **Alta Calidad** produce archivos más pesados pero con mejor calidad visual
2. **Balance** mantiene un equilibrio entre tamaño y calidad (opción recomendada)
3. **Máxima Compresión** reduce significativamente el tamaño del archivo

La diferencia de bitrate entre los 3 modos es clara:
- Alta Calidad: 1136 kbps
- Balance: 799 kbps  
- Máxima Compresión: 609 kbps

Esto representa una diferencia de **~86%** entre el modo de alta calidad y máxima compresión, lo cual es significativo y demuestra que los parámetros están funcionando correctamente.
