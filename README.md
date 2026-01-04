# Conversor de Video a WebM

Una herramienta web simple, rápida y privada para convertir tus videos al formato WebM directamente en tu navegador.

[Ver Demo en Vivo](https://meowrhino.github.io/videoToWeb/)

![Captura de pantalla de la aplicación](https://i.imgur.com/rY42eA8.png)

## ✨ Características

- **100% Privado**: Todos los archivos se procesan localmente en tu navegador. Ningún dato se sube a un servidor.
- **Rápido y Eficiente**: Utiliza el poder de WebAssembly para conversiones rápidas sin sobrecargar tu sistema.
- **Interfaz Sencilla**: Arrastra y suelta tus videos, ajusta la calidad y descarga. ¡Eso es todo!
- **Control de Calidad**: Ajusta el valor de CRF (Constant Rate Factor) para encontrar el balance perfecto entre calidad y tamaño de archivo.
- **Soporte Amplio de Formatos**: Convierte desde los formatos más comunes como MP4, MOV, AVI, MKV y más.
- **Funciona Offline**: Una vez que la página ha cargado, la herramienta funciona sin necesidad de una conexión a internet.

## ⚙️ ¿Cómo Funciona? (Arquitectura)

Esta aplicación es un **cliente web puro** construido con HTML, CSS y JavaScript vanilla. La conversión de video se realiza a través de **`ffmpeg.js`**, una versión de FFmpeg compilada a WebAssembly.

El flujo de trabajo es el siguiente:

1.  **Carga de FFmpeg**: Al iniciar, la aplicación carga `ffmpeg.js` en un **Web Worker**. Esto permite que el proceso de conversión se ejecute en un hilo secundario, evitando que la interfaz de usuario se congele.
2.  **Selección de Archivos**: El usuario selecciona uno o más archivos de video.
3.  **Procesamiento en el Worker**: El script principal lee cada video como un `ArrayBuffer` y lo envía al Web Worker junto con los comandos de conversión. Los codecs utilizados son **VP8 para video** y **Opus para audio**, el estándar para WebM. Para evitar casos en los que un WebM pese más que el MP4 (p.ej. vídeos de WhatsApp), la app usa "constrained quality" (CRF + bitrate objetivo) y reintenta una vez si el resultado sale más grande.
4.  **Recepción de Resultados**: Una vez que la conversión finaliza, el worker devuelve el video resultante como un `Blob` (un objeto de archivo en memoria).
5.  **Descarga**: El script crea una URL local para este `Blob` y la usa para iniciar la descarga en el navegador del usuario.

## 🛠️ Stack Tecnológico

- **HTML5**: Para la estructura semántica de la página.
- **CSS3**: Para el diseño y la apariencia visual, con un enfoque en la simplicidad y la usabilidad.
- **JavaScript (ES6+)**: Para toda la lógica de la aplicación, manejo de eventos y manipulación del DOM.
- **FFmpeg.js**: La librería clave que ejecuta la conversión de video en el navegador a través de WebAssembly.
- **Web Workers**: Para asegurar que la aplicación se mantenga rápida y receptiva durante el proceso de conversión.

## 🚀 Cómo Usar

1.  **Abre la página**: Navega a la [página de la demo](https://meowrhino.github.io/videoToWeb/).
2.  **Selecciona tus videos**: Arrastra y suelta tus archivos de video en el área designada, o haz clic para seleccionarlos desde tu ordenador.
3.  **Ajusta la Calidad (Opcional)**: Usa el slider de CRF para ajustar la calidad de la conversión. Un valor más bajo significa mayor calidad y mayor tamaño de archivo.
4.  **Espera la Conversión**: Las tarjetas de los videos mostrarán el progreso de la conversión.
5.  **Descarga**: Una vez completado, haz clic en el botón "descargar" en cada tarjeta o usa el botón "descargar todo" para guardar todos los videos convertidos.

## 📄 Licencia

Este proyecto es de código abierto y está disponible bajo la [Licencia MIT](LICENSE).
