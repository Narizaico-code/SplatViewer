# Reconstruccion Local (Nerfstudio / COLMAP) para Splats .ply

Objetivo: corregir deformaciones de piso/techo mejorando el calculo de poses y la reconstruccion.

## 1. Cuando usarlo
- El piso o techo se doblan, suben o bajan de forma irreal.
- Hay drift evidente en pasillos largos o escenas con poca textura.
- Luma entrega una geometria inconsistente que no se corrige con transforms.

## 2. Entrada recomendada (fotos)
- 80 a 200 fotos con alto solape.
- Dos alturas: ~1.5 m (pecho) y ~0.7 m (cintura/rodilla).
- Cierre de lazo: vuelve al inicio y repite 5 a 10 s del recorrido.
- Camara nivelada, movimiento lento y exposicion estable.

**Guia rapida por dimensiones y densidad:**
- Pasillos o habitaciones pequenas (hasta ~6 m de largo): 80 a 120 fotos.
- Pasillos medianos (6 a 12 m): 120 a 180 fotos.
- Pasillos largos (12 a 20 m): 180 a 260 fotos (mejor dividir en tramos).

**Regla por metro (aprox.):**
- 8 a 12 fotos por metro lineal por altura.
- Con dos alturas: 16 a 24 fotos por metro.

**Como mover los angulos (patron recomendado):**
1. Avanza 0.3 a 0.5 m.
2. Por cada paso, toma 3 fotos: frente, 30 a 45 grados a la izquierda, 30 a 45 grados a la derecha.
3. Cada 2 o 3 pasos, agrega una foto mirando al techo y otra al piso (sin inclinar demasiado).
4. Mantén el horizonte nivelado; evita barridos muy inclinados.

## 3. Si solo tienes video
Extrae fotogramas para evitar redundancia:

```bash
ffmpeg -i input.mp4 -vf fps=3 frames/%04d.jpg
```

## 4. Opcion A: Nerfstudio (recomendado)
Recomendado por simplicidad y control de calidad.

Pasos (ejemplo, confirma con `ns --help` y la documentacion oficial):

```bash
# Procesa datos y calcula poses (COLMAP interno)
ns-process-data images --data ./images --output-dir ./data

# Entrena splats
ns-train splatfacto --data ./data

# Exporta splats
ns-export gaussian-splat --load-config ./outputs/.../config.yml --output-dir ./exports
```

Notas de calidad (GPU 8GB):
- Si hay OOM, baja resolucion de entrada (downscale) o usa menos fotos.
- Mas vistas y solape ayudan mas que subir iteraciones sin control.

## 5. Opcion B: COLMAP + 3DGS (Graphdeco / gsplat)
Flujo general:
1. COLMAP para features, matching, mapping y bundle adjustment.
2. Exporta poses/camaras al formato del entrenador 3DGS.
3. Entrena Gaussian Splatting y exporta a .ply.

Esta ruta da mas control, pero requiere configuracion manual.

## 6. Conversion final a .ply (si hace falta)
Si el export no es .ply, usa SplatTransform:

```bash
splat-transform input.splat output.ply
splat-transform input.ksplat output.ply
```

## 7. Fuentes utiles
- Nerfstudio: https://docs.nerf.studio/
- COLMAP: https://colmap.github.io/
- 3D Gaussian Splatting (Graphdeco): https://github.com/graphdeco-inria/gaussian-splatting
- gsplat (alternativa): https://github.com/nerfstudio-project/gsplat
