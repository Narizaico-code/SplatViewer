# Post-Mortem Técnico: Visor de Gaussian Splatting en WebXR (Meta Quest)

Este documento consolida las lecciones aprendidas, los desafíos superados y la arquitectura final estabilizada durante el desarrollo de una experiencia inmersiva WebXR para visualizar Gaussian Splatting en hardware standalone (Meta Quest).

---

## 1. Visibilidad y Renderizado (El Problema del Vacío Negro)

**El Desafío:**
A pesar de que el archivo se cargaba, se parseaba y el buffer de la GPU registraba los vértices (`instanceCount` correcto), el modelo no era visible en el canvas, mientras que otros objetos de Three.js (como luces o mallas primitivas) sí se mostraban.

**La Causa:**
1. **Falta de Envío de Texturas/SplatBuffer a GPU:** El worker de ordenamiento (`gpuAcceleratedSort` / `sharedMemoryForWorkers`) fallaba silenciosamente en el entorno de desarrollo al no poder resolver completamente las dependencias de memoria o extensiones de WebGL2 para Transform Feedback en la configuración de Vite, provocando que los "draw calls" (las llamadas para dibujar los puntos) fueran cero.
2. **Atributos PLY No Estándar (Efectos Opcionales):** Herramientas como Luma AI o SuperSplat introducen propiedades custom en el archivo `.ply` (ej. `nxx`). Activar `sphericalHarmonicsDegree: 2` y `enableOptionalEffects: true` causaba que el parser interno fallara al mapear estos shaders, dejando el `SplatMesh` vacío.

**La Solución Final:**
- Se **desactivó temporalmente el SharedArrayBuffer y GPUSort** en el entorno local (`sharedMemory: false`, `gpuAcceleratedSort: false`) para forzar un fallback de ordenamiento por CPU que garantizó el paso de los datos al buffer de dibujo.
- Se configuró el `Viewer` nativo (en lugar del `DropInViewer` acoplado al árbol de Three.js) de forma híbrida: **`sphericalHarmonicsDegree: 0` y `enableOptionalEffects: false`**. Esto fuerza al parser a extraer exclusivamente los colores base y posiciones, esquivando corrupciones del header del `.ply`.
- Se gestionó el orden del render (`renderOrder: 2`) y se aplicó un pase limpio llamando explícitamente a `viewer.update()` por frame para actualizar los Splats antes de llamar a `renderer.render(scene, camera)`.

---

## 2. Optimización de Archivos y Formatos

*(Aclaración a la instrucción: No descartamos .ksplat/.spz en favor de .ply por VRAM, al contrario. El `.ply` original se usó en esta depuración para **bypassear errores de compresión/conversión corrupta** que sucedieron offline).*

**El Flujo Correcto Aprendido:**
- **.ply es solo para debug:** El `.ply` base (sin compresión) es gigante y poco eficiente para la red y la memoria. Lo usamos solo como "fuente de la verdad" para comprobar que los datos crudos sí funcionaban.
- **Workflow de Producción Ideal:** Un `.ply` estándar con `SH Band 0` generado en el editor (ej. SuperSplat) debe ser convertido al formato comprimido (`.ksplat` o `.spz`) **mediante la utilidad oficial de la librería**. Los archivos demasiado comprimidos o con layouts de memoria agresivos fallan en navegadores móviles (Meta Browser limitando memoria del heap).
- **Importancia COOP/COEP:** Para habilitar los `Worker Threads` ultrarrápidos y el `SharedArrayBuffer` en producción, el servidor (Vite o el hosting final) **debe** devolver los headers:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
Sin esto, la librería desactiva la memoria compartida, desplomando los FPS.

**Estado actual (assets locales):**
- El escenario por defecto ahora apunta a `gs_Parte_de_atr_s_pasillo_pi.compressed.ply` en `public/`. Para cambiar de escena, basta con actualizar `MODEL_URL` en `src/main.js`.

---

## 3. Locomoción y Sistema de XR Rig

**El Desafío (Ejes Relativos):**
Al aplicar entrada de joystick a la rotación de la cámara (`activeCamera.getWorldDirection`), el avance se desajustaba cuando el usuario rotaba en el mundo real o cuando el Rig central (`cameraGroup`) rotaba usando *Snap Turning*. La cámara terminaba moviéndose a la izquierda cuando el usuario quería ir al frente.

**La Solución Matemática Estabilizada:**
WebXR ancla la "cámara" a la cabeza del usuario localmente, separada de las transformaciones del padre en el grafo de escena en algunos contextos de matriz. 
La forma correcta de avanzar en base a "Hacia dónde mira el usuario":
1. **Extraer el Vector Base:** Usar el cuaternión absoluto: `const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(activeCamera.quaternion)`
2. **Conversión a Mundo y Normalización:** 
   ```javascript
   cameraGroup.localToWorld(forward)
   forward.sub(cameraGroup.position) // Convertir posición global en dirección pura
   forward.y = 0 // Restringir vuelo
   forward.normalize()
   ```
3. **Mapeo Realista de Joysticks Quest:** El eje Y hacia adelante en Quest devuelve valores negativos (`-1`). Por lo que la velocidad aplicada a Z debe multiplicar por el valor invertido.
4. **Sincronización:** Se forzó a Three.js a propagar estos movimientos manualmente al final del ciclo de inputs usando `cameraGroup.updateMatrixWorld(true)`.

**Modo Desktop (sin VR):**
- Se habilitó movimiento con `WASD` y flechas, reutilizando la misma base de cálculo de `forward/right`.
- El rig se mueve en el eje horizontal y el `OrbitControls.target` se desplaza junto al jugador para mantener la órbita coherente.
- La colisión de escritorio usa el mismo raycast frontal contra el collider `.collision.glb`.

---

## 4. Alineación Espacial y Ejes del Modelo

**El Desafío:**
Los programas de exportación 3D y gaussian splatting (como Polycam o SuperSplat) utilizan convenciones de ejes diferentes a Three.js (a menudo Z-up o Y-down). El modelo se cargaba acostado y de espaldas, o sumergido bajo el suelo `(y=0)`.

**La Solución Final:**
- El offset de posición se alejó del `(0,0,0)` para no aparecer "dentro" del modelo: `position: [0, 0, -3]`.
- En lugar de adivinar cuaterniones manuales (`[-0.707, 0, 0, 0.707]`), se utilizó una conversión explícita desde Euler (en grados convertidos a radianes) para inyectar rotaciones racionales. 
- *Ejemplo Final:* `-90° en X` (para levantar el modelo de Z-up a Y-up) y `180° en Y` (para girarlo hacia el usuario).

---

## 5. Configuración de Hardware (Meta Quest / Standalone)

Para maximizar el presupuesto de rendimiento y alcanzar los ansiados **72fps constantes**, el WebGLRenderer requiere una dieta estricta:

- **`antialias: false`**: El MSAA base de WebGL es devastador para la tasa de relleno (fill rate) de la VRAM en la resolución del Quest 3.
- **`powerPreference: 'high-performance'`**: Fuerza al procesador XR2 de Qualcomm a liberar ciclos de reloj para la GPU.
- **`precision: 'mediump'`**: Suficiente para color de texturas, reduciendo operaciones en shaders comparado a `highp`.
- **`ReferenceSpaceType: 'local-floor'`**: Crucial. Ubica el 0,0,0 global al nivel del suelo real de la habitación del jugador, permitiendo usar un piso físico 3D sin estar flotando o hundido.
- **Dynamic DPR:** Se bloqueó un ratio de píxeles (`renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))`) evitando que el visor intente renderizar a densidades excesivas (>2x) que colapsarían el framerate instantáneamente.

---

## 6. Colisiones Automatizadas (SplatTransform 2.0)

**Objetivo:** Los splats no tienen geometría de colisión (solo puntos), así que se genera un **proxy de colisión** con SplatTransform 2.0.

**Pipeline final aplicado (escena abierta / pasillo):**
- Entrada: `public/gs_Parte_de_atr_s_pasillo_pi.compressed.ply`.
- Comando usado (overwrite):
  ```bash
  npx @playcanvas/splat-transform -w public/gs_Parte_de_atr_s_pasillo_pi.compressed.ply \
    --filter-cluster --seed-pos -0.5,2.5,-1.5 \
    --voxel-floor-fill \
    -K smooth \
    public/gs_Parte_de_atr_s_pasillo_pi.voxel.json
  ```
- Salidas generadas:
  - `public/gs_Parte_de_atr_s_pasillo_pi.voxel.json`
  - `public/gs_Parte_de_atr_s_pasillo_pi.voxel.bin`
  - `public/gs_Parte_de_atr_s_pasillo_pi.collision.glb`

**Nota de validación (pipeline descartado):**
- Con `--voxel-external-fill --voxel-carve` no se generó malla (0 triángulos) porque el seed era accesible desde el exterior y el carve eliminó todo el espacio navegable. Por eso se cambió a `--voxel-floor-fill`.

**Integración en runtime (Three.js):**
- Se carga el collider con `GLTFLoader` y se deja **invisible** (material oculto), pero activo para raycast.
- Se usa una capa dedicada (`COLLISION_LAYER = 1`) para evitar interferencias visuales.
- La locomoción XR hace un raycast frontal y **bloquea el avance** si hay pared dentro de `PLAYER_RADIUS`.
- El collider se alinea con el `splatMesh` usando `matrixWorld` tras cargar el splat.

**Ajustes recomendados:**
- `PLAYER_RADIUS` controla cuán cerca puedes pegarte a paredes.
- `PLAYER_HEIGHT` controla la altura del rayo (mitad del cuerpo).
- Si hay atravesos, baja `--voxel-params` (voxel más fino) o prueba `-K faces`.

---

## 7. Fuentes y Referencias

- Reddit (anuncio de SplatTransform 2.0 y colisiones): https://www.reddit.com/r/GaussianSplatting/comments/1t4f4xr/splattransform_20_automated_collision_generation/
- Repo oficial: https://github.com/playcanvas/splat-transform
- Release notes v2.0.0: https://github.com/playcanvas/splat-transform/releases/tag/v2.0.0
- Nota tecnica (Radiance Fields): https://radiancefields.com/playcanvas-releases-splat-transform-2.0
- Splat de ejemplo del video: https://superspl.at/scene/b0703bc1

**Trazabilidad de comandos y decisiones:**
- Pipeline base (`--filter-cluster`, `--seed-pos`, `--voxel-*-fill`, `-K`) tomado del README del repo (seccion Voxel/Collision).
- Ajuste del seed a `-0.5,2.5,-1.5` proviene del log de `splat-transform` al resolver el seed no ocupado.
- Cambio de `--voxel-external-fill --voxel-carve` a `--voxel-floor-fill` se decide por el resultado del log (0 triangulos / no navigable cells).
- Reddit y Radiance Fields se usan como contexto de la feature, no como fuente de comandos.

---

### Conclusión para Escalado Futuro
1. **Validar antes de programar:** Si la pantalla está en negro, la primera prueba debe ser revisar si los vértices/SH-Bands del `.ply` empatan con la configuración del visor (`sphericalHarmonicsDegree: 0`).
2. **Priorizar WebXR Inputs Universales:** Nunca asumir que `axes[2]` siempre será X. Manejar longitud de array y deadzones (`0.2`).
3. **Optimización de Archivo Obligatoria:** Este proyecto fue estabilizado debuggeando un `.ply`. El siguiente paso inmediato para escalar a modelos más grandes es depurar el convertidor `create-ksplat.js` para asegurar archivos que pesen el 10% del actual.
