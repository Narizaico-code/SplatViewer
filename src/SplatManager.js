import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import * as THREE from 'three'

export class SplatManager {
    constructor({
        scene,
        renderer,
        camera,
        maxBytes = 200 * 1024 * 1024,
        allowPly = false,
        renderOrder = 1,
        disableDepthTest = true
    }) {
        this.scene = scene
        this.renderer = renderer
        this.camera = camera
        this.maxBytes = maxBytes
        this.allowPly = allowPly
        this.renderOrder = renderOrder
        this.disableDepthTest = disableDepthTest
        this.debug = true
        this.viewer = null
        this.activeLoad = null
    }

    async load(url, { onProgress, transform } = {}) {
        console.log('[Splat] Iniciando carga:', url)
        await this.dispose()
        const fileMeta = await this.#assertFileBudget(url)
        if (fileMeta.ok) {
            const mb = fileMeta.bytes ? Math.round(fileMeta.bytes / (1024 * 1024)) : null
            console.log('[Splat] Archivo encontrado', mb ? `(${mb} MB)` : '')
        } else {
            console.log('[Splat] Archivo encontrado (sin HEAD)')
        }

        const sharedMemory = false // FORZADO A FALSE
        const gpuSort = false // FORZADO A FALSE

        if (this.debug) {
            console.log('[Splat] crossOriginIsolated:', sharedMemory)
            console.log('[Splat] gpuAcceleratedSort:', gpuSort)
        }

            const viewer = new GaussianSplats3D.Viewer({
      selfDrivenMode: false,
      renderer: this.renderer,
      camera: this.camera,
      useBuiltInControls: false,
      ignoreDevicePixelRatio: false,
      gpuAcceleratedSort: gpuSort,
      sharedMemoryForWorkers: sharedMemory,
      renderMode: GaussianSplats3D.RenderMode.Always,
      sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
      splatRenderMode: GaussianSplats3D.SplatRenderMode.ThreeD,
      sphericalHarmonicsDegree: 0, 
      enableOptionalEffects: false 
      // threeScene: this.scene  <-- BORRAR ESTO
    })

    this.viewer = viewer
    //this.scene.add(viewer) // <-- AÑADIR ESTO
    console.log('[Splat] Anadido a la escena')

        const options = {
            showLoadingUI: false,
            format: this.#getSceneFormat(url),
            splatAlphaRemovalThreshold: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
            onProgress
        }

        if (transform) {
            options.position = transform.position ?? options.position
            options.rotation = transform.rotation ?? options.rotation
            options.scale = transform.scale ?? options.scale
        }

        // Keep a handle so we can abort if the user swaps models mid-load.
        this.activeLoad = viewer.addSplatScene(url, options)
        await this.activeLoad
        console.log('[Splat] Puntos cargados');

        if (viewer.splatMesh) {
            this.scene.add(viewer.splatMesh)
            console.log('[Splat] SplatMesh anadido a la escena principal')
        }

        console.log('[Splat] SplatMesh existe:', Boolean(viewer.splatMesh))
        if (this.debug) {
            const splatBuffer = viewer.splatMesh?.splatBuffer
            const bufferCount = splatBuffer?.splatCount ?? splatBuffer?.getSplatCount?.()
            const treeCount = viewer.splatMesh?.splatTree?.splatCount
            console.log('[Splat] SplatBuffer count:', bufferCount ?? null)
            console.log('[Splat] SplatTree count:', treeCount ?? null)
            const sceneCount = viewer.getSceneCount?.() ?? null
            const scene0 = viewer.getSplatScene?.(0)
            const scene0BufferCount = scene0?.splatBuffer?.splatCount ?? scene0?.splatBuffer?.getSplatCount?.()
            console.log('[Splat] Scene count:', sceneCount)
            console.log('[Splat] Scene0 buffer count:', scene0BufferCount ?? null)
            const meshSplatCount = viewer.splatMesh?.getSplatCount?.() ?? null
            const meshMaxSplatCount = viewer.splatMesh?.getMaxSplatCount?.() ?? null
            console.log('[Splat] Mesh splat count:', meshSplatCount)
            console.log('[Splat] Mesh max splat count:', meshMaxSplatCount)
            console.log('[Splat] Render ready:', viewer.splatRenderReady)
            console.log('[Splat] Sort worker:', Boolean(viewer.sortWorker))
            await this.#logFileHeader(url)
        }
        this.#logMeshDetails(viewer.splatMesh)

        const scene0 = viewer.getSplatScene?.(0)
        const scene0BufferCount = scene0?.splatBuffer?.splatCount ?? scene0?.splatBuffer?.getSplatCount?.()
        if (scene0BufferCount === 0) {
            console.warn('[Splat] Scene buffer empty. Trying KSplatLoader.loadFromURL fallback...')
            const splatBuffer = await GaussianSplats3D.KSplatLoader.loadFromURL(url, onProgress, false)
            const bufferCount = splatBuffer?.splatCount ?? splatBuffer?.getSplatCount?.()
            console.log('[Splat] KSplatLoader buffer count:', bufferCount ?? null)

            if (bufferCount && bufferCount > 0) {
                const bufferOptions = {
                    position: options.position,
                    rotation: options.rotation || options.orientation,
                    scale: options.scale,
                    splatAlphaRemovalThreshold: options.splatAlphaRemovalThreshold
                }
                await viewer.addSplatBuffers(
                    [splatBuffer],
                    [bufferOptions],
                    true,
                    false,
                    false,
                    true,
                    true,
                    true
                )
                console.log('[Splat] addSplatBuffers() completed')
            }
        }

        const scene0ForRebuild = viewer.getSplatScene?.(0)
        const scene0Buffer = scene0ForRebuild?.splatBuffer
        const scene0BufferCount2 = scene0Buffer?.splatCount ?? scene0Buffer?.getSplatCount?.()
        const meshSplatCount2 = viewer.splatMesh?.getSplatCount?.() ?? null
        if (scene0BufferCount2 && scene0BufferCount2 > 0 && meshSplatCount2 === 0) {
            console.warn('[Splat] Forcing addSplatBuffers from scene0 buffer')
            const bufferOptions = {
                position: options.position,
                rotation: options.rotation || options.orientation,
                scale: options.scale,
                splatAlphaRemovalThreshold: options.splatAlphaRemovalThreshold
            }
            await viewer.addSplatBuffers(
                [scene0Buffer],
                [bufferOptions],
                true,
                false,
                false,
                true,
                true,
                true,
                true
            )
            console.log('[Splat] addSplatBuffers(force) completed')
            console.log('[Splat] Mesh splat count (after):', viewer.splatMesh?.getSplatCount?.() ?? null)
        }

        this.#applyRenderOverrides(viewer)

        const centerTarget = viewer.splatMesh ?? viewer
        const centerInfo = this.#centerAndScale(centerTarget)
        if (centerInfo) {
            console.log('[Splat] Centrado y escalado', centerInfo)
        }
    }

    async dispose() {
        if (this.activeLoad && typeof this.activeLoad.abort === 'function') {
            this.activeLoad.abort()
        }
        this.activeLoad = null

        if (this.viewer) {
            this.scene.remove(this.viewer)
            // Critical: dispose the viewer to release GPU buffers and textures.
            await this.viewer.dispose()
            this.viewer = null
        }

        // Flush cached render lists to help VRAM release in Quest browser.
        this.renderer.renderLists.dispose()
        this.renderer.info.reset()
    }

    getViewer() {
        return this.viewer
    }

    async #assertFileBudget(url) {
        const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
        if (ext === 'ply' && !this.allowPly) {
            throw new Error('PLY is disabled for performance reasons. Use .ksplat or .spz.')
        }

        const { ok, bytes } = await this.#getContentLength(url)
        if (bytes !== null && bytes > this.maxBytes) {
            const mb = Math.round(bytes / (1024 * 1024))
            throw new Error(`Splat too large (${mb} MB). Reduce size or re-export.`)
        }

        return { ok, bytes }
    }

    async #getContentLength(url) {
        try {
            const response = await fetch(url, { method: 'HEAD' })
            if (!response.ok) {
                return { ok: false, bytes: null }
            }
            const length = response.headers.get('content-length')
            return { ok: true, bytes: length ? Number(length) : null }
        } catch {
            return { ok: false, bytes: null }
        }
    }

    #getSceneFormat(url) {
        const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
        if (ext === 'ksplat') return GaussianSplats3D.SceneFormat.KSplat
        if (ext === 'ply') return GaussianSplats3D.SceneFormat.Ply
        if (ext === 'splat') return GaussianSplats3D.SceneFormat.Splat
        return undefined
    }

    async #logFileHeader(url) {
        try {
            const response = await fetch(url)
            if (!response.ok) {
                console.log('[Splat] Header fetch failed:', response.status)
                return
            }
            const buffer = await response.arrayBuffer()
            const bytes = new Uint8Array(buffer.slice(0, 16))
            const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ')
            console.log('[Splat] File header (16 bytes):', hex)
        } catch (error) {
            console.log('[Splat] Header fetch error:', error)
        }
    }

    #centerAndScale(target, targetSize = 1.5) {
        const box = new THREE.Box3().setFromObject(target)
        if (box.isEmpty()) {
            return null
        }

        const size = new THREE.Vector3()
        const center = new THREE.Vector3()
        box.getSize(size)
        box.getCenter(center)

        const maxDim = Math.max(size.x, size.y, size.z) || 1
        const scale = targetSize / maxDim

        if (target?.scale?.setScalar) {
            target.scale.setScalar(scale)
        }
        if (target?.position?.sub) {
            target.position.sub(center.multiplyScalar(scale))
        }

        return {
            center: center.toArray(),
            size: size.toArray(),
            scale
        }
    }

    #applyRenderOverrides(viewer) {
        if (viewer.renderOrder !== undefined) {
            viewer.renderOrder = this.renderOrder
        }
        if (viewer.layers?.set) {
            viewer.layers.set(0)
        }

        const splatMesh = viewer.splatMesh
        if (!splatMesh || !splatMesh.material) {
            return
        }

        splatMesh.renderOrder = this.renderOrder
        splatMesh.layers.enableAll()
        if (splatMesh.layers?.set) {
            splatMesh.layers.set(0)
        }
        splatMesh.frustumCulled = false
        splatMesh.visible = true

        const materials = Array.isArray(splatMesh.material) ? splatMesh.material : [splatMesh.material]
        for (const material of materials) {
            if (this.disableDepthTest) {
                material.depthTest = false
                material.depthWrite = false
            }
            material.blending = THREE.NormalBlending
            material.premultipliedAlpha = false
            material.transparent = true
            console.log('[Splat] Material opacity:', material.opacity)
            if (material.opacity === 0) {
                material.opacity = 1
            }
            material.colorWrite = true
            material.needsUpdate = true
        }

        // No forced debug scale here; scale is handled by centering logic.
    }

    #logMeshDetails(splatMesh) {
        if (!this.debug || !splatMesh) {
            return
        }

        const geometry = splatMesh.geometry
        const material = splatMesh.material
        const attributes = geometry?.attributes ? Object.keys(geometry.attributes) : []
        const positionCount = geometry?.attributes?.position?.count ?? null
        const centerCount = geometry?.attributes?.center?.count ?? null
        const colorCount = geometry?.attributes?.color?.count ?? null
        const indexCount = geometry?.index?.count ?? null
        const instanceCount = geometry?.instanceCount ?? null
        const drawRange = geometry?.drawRange ?? null

        console.log('[Splat] Mesh attrs:', attributes)
        console.log('[Splat] Mesh counts:', {
            positionCount,
            centerCount,
            colorCount,
            indexCount,
            instanceCount,
            drawRange
        })
        console.log('[Splat] Mesh flags:', {
            visible: splatMesh.visible,
            renderOrder: splatMesh.renderOrder,
            frustumCulled: splatMesh.frustumCulled,
            layers: splatMesh.layers?.mask
        })

        const materials = Array.isArray(material) ? material : [material]
        console.log('[Splat] Material types:', materials.map((mat) => mat?.type))
    }
}
