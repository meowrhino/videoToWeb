# convertidor de vídeo a webm

convertidor de videos a formato webm completamente funcional en el navegador usando ffmpeg.wasm. sin límites de tamaño ni duración, solo limitado por la capacidad del navegador.

## características

- ✅ conversión completamente en el navegador (sin servidor)
- ✅ interfaz drag & drop intuitiva
- ✅ soporte para múltiples formatos: mp4, mov, avi, mkv, flv, etc.
- ✅ control de calidad mediante crf (15-40)
- ✅ progreso en tiempo real con porcentaje
- ✅ preview del video convertido
- ✅ comparación de tamaño original vs webm
- ✅ descarga individual o masiva en zip
- ✅ sin límites de tamaño ni duración

## uso

1. abre `index.html` en tu navegador
2. espera a que ffmpeg se cargue (solo la primera vez)
3. arrastra videos o haz clic para seleccionar archivos
4. ajusta el crf según tus necesidades de calidad
5. espera a que se complete la conversión
6. descarga los videos convertidos

## parámetros de calidad (crf)

- **15-20**: calidad máxima, archivos grandes
- **25-32**: buen balance calidad/tamaño (recomendado)
- **35-40**: menor calidad, archivos pequeños

**presets recomendados por resolución:**
- 480p: crf 33
- 720p: crf 32
- 1080p: crf 31

## despliegue en github pages

1. crea un repositorio en github
2. sube los archivos: `index.html`, `styles.css`, `script.js`
3. ve a settings → pages
4. selecciona la rama main y carpeta root
5. guarda y espera unos minutos
6. tu convertidor estará disponible en `https://tuusuario.github.io/nombre-repo`

## tecnologías

- html5
- css3
- javascript vanilla (es6+)
- ffmpeg.wasm 0.12.10
- jszip 3.10.1

## notas técnicas

- todo el procesamiento ocurre en el navegador del usuario
- no se envía ningún dato a servidores externos
- requiere navegadores modernos con soporte para webassembly
- el rendimiento depende del hardware del usuario
- videos muy grandes pueden consumir mucha memoria ram

## compatibilidad

- chrome/edge 90+
- firefox 89+
- safari 15.4+
- opera 76+

## licencia

código libre para uso personal y comercial
