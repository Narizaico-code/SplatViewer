import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SplatManager } from './SplatManager.js'

const MODEL_URL = '/gs_Minecraft_cow.ply'
const MAX_SPLAT_BYTES = 200 * 1024 * 1024

const canvas = document.getElementById('xr-canvas')
const loadingEl = document.getElementById('loading')
const enterVrButton = document.getElementById('enter-vr')

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0a0a0c)

// --- ESCENARIO Y GROUND PLANE ---
const groundGeometry = new THREE.CircleGeometry(50, 64)
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.2 })
const ground = new THREE.Mesh(groundGeometry, groundMaterial)
ground.rotation.x = -Math.PI / 2
scene.add(ground)

const grid = new THREE.GridHelper(50, 50, 0x2a2a2a, 0x111111)
scene.add(grid)

// Luces base para iluminar el suelo
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
scene.add(ambientLight)
const dirLight = new THREE.DirectionalLight(0xffffff, 1)
dirLight.position.set(5, 10, 5)
scene.add(dirLight)

// --- JERARQUÍA DE CÁMARA (XR RIG) ---
const cameraGroup = new THREE.Group()
scene.add(cameraGroup)

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 500)
// Altura promedio de un humano en Desktop (en XR local-floor domina el tracking de las Quest)
camera.position.set(0, 1.6, 3) 
camera.lookAt(0, 1.6, 0)
camera.layers.enable(0)
cameraGroup.add(camera)

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: true,
  powerPreference: 'high-performance',
  precision: 'mediump'
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setSize(window.innerWidth, window.innerHeight, false)
renderer.xr.enabled = true
renderer.xr.setReferenceSpaceType('local-floor')
renderer.autoClear = true

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 1.6, 0)
controls.enableDamping = true
controls.rotateSpeed = 0.6
controls.zoomSpeed = 0.7

const splatManager = new SplatManager({
  scene,
  renderer,
  camera,
  maxBytes: MAX_SPLAT_BYTES,
  allowPly: true,
  renderOrder: 2,
  disableDepthTest: true
})

function setLoading(isLoading, text = 'Loading splat...') {
  loadingEl.textContent = text
  loadingEl.classList.toggle('hidden', !isLoading)
}

async function loadInitialSplat() {
  setLoading(true)
  try {
    // Calcular la rotación usando Euler para facilitar el ajuste.
    // Ej: -90 en X la levanta (si estaba acostada), 180 en Y la gira hacia ti.
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(-10), // Rotación X
      THREE.MathUtils.degToRad(185), // Rotación Y
      THREE.MathUtils.degToRad(179),   // Rotación Z
      'XYZ'
    );
    const quat = new THREE.Quaternion().setFromEuler(euler);

    await splatManager.load(MODEL_URL, {
      onProgress: (progress) => {
        if (typeof progress === 'number') {
          const percent = Math.round(progress * 100)
          setLoading(true, `Loading splat... ${percent}%`)
        }
      },
      transform: {
        position: [0, 0, -3], // Posicionado a 3 metros al frente de la cámara
        rotation: [quat.x, quat.y, quat.z, quat.w], 
        scale: [1, 1, 1]
      }
    })
    controls.update()
    setLoading(false)
  } catch (error) {
    console.error(error)
    setLoading(true, error.message || 'Failed to load splat')
  }
}

function updateRendererSize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(window.innerWidth, window.innerHeight, false)
}

async function enterVR() {
  if (!navigator.xr) {
    alert('WebXR not available in this browser')
    return
  }

  enterVrButton.disabled = true

  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor']
    })
    renderer.xr.setSession(session)

    session.addEventListener('end', () => {
      enterVrButton.disabled = false
    })
  } catch (error) {
    console.error(error)
    enterVrButton.disabled = false
  }
}

enterVrButton.addEventListener('click', enterVR)
window.addEventListener('resize', updateRendererSize)
window.addEventListener('pagehide', () => {
  splatManager.dispose()
})

// --- SISTEMA DE LOCOMOCIÓN WEBXR ---
const moveSpeed = 0.05
const velocity = new THREE.Vector3()

// Guardar los tiempos para controlar el Snap Turn
const frameLog = { lastSnap: 0 }

function handleXRInputs(activeCamera) {
  const session = renderer.xr.getSession()
  if (!session || !session.inputSources) return

  for (const source of session.inputSources) {
    if (!source.gamepad) continue

    const gamepad = source.gamepad
    
    // Ejes de Quest 2/3/Pro (generalmente 2 y 3) con fallback a 0 y 1
    let xAxis = gamepad.axes.length > 2 ? gamepad.axes[2] : gamepad.axes[0] || 0
    let yAxis = gamepad.axes.length > 3 ? gamepad.axes[3] : gamepad.axes[1] || 0

    // Deadzone de 0.2 para evitar drift
    if (Math.abs(xAxis) < 0.2) xAxis = 0
    if (Math.abs(yAxis) < 0.2) yAxis = 0

    if (xAxis === 0 && yAxis === 0) continue

    if (source.handedness === 'left') {
      // 1. Obtener el vector "Adelante" (-Z) de la cámara en su espacio local
      const forward = new THREE.Vector3(0, 0, -1)
      forward.applyQuaternion(activeCamera.quaternion)
      
      // 2. Proyectar al mundo usando la matriz del grupo (rig)
      cameraGroup.localToWorld(forward)
      forward.sub(cameraGroup.position) // Obtener el vector direccional puro
      
      // 3. Restringir movimiento al plano horizontal (suelo)
      forward.y = 0 
      forward.normalize()

      // 4. Calcular el vector lateral derecho
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()

      // 5. Aplicar velocidad (en Quest, -yAxis es empujar el stick hacia adelante)
      velocity.copy(forward).multiplyScalar(-yAxis * moveSpeed)
      velocity.add(right.multiplyScalar(xAxis * moveSpeed))

      // Aplicar movimiento al Rig contenedor
      cameraGroup.position.add(velocity)
      
    } else if (source.handedness === 'right') {
      // Snap Turn (Rotación por pasos para evitar mareo)
      const now = performance.now()
      if (now - frameLog.lastSnap > 300) { // Cooldown de 300ms
        if (xAxis > 0.5) {
          cameraGroup.rotation.y -= Math.PI / 4 
          frameLog.lastSnap = now
        } else if (xAxis < -0.5) {
          cameraGroup.rotation.y += Math.PI / 4 
          frameLog.lastSnap = now
        }
      }
    }
  }
  
  // CRÍTICO: Forzar la actualización de la matriz del grupo para que WebXR refleje el cambio
  cameraGroup.updateMatrixWorld(true)
}
// --- CICLO PRINCIPAL DE RENDERIZADO ---
renderer.setAnimationLoop(() => {
  const xrCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera
  const activeCamera = xrCamera.isArrayCamera ? xrCamera.cameras[0] : xrCamera

  if (renderer.xr.isPresenting) {
    handleXRInputs(activeCamera)
  } else {
    controls.update()
  }

  const viewer = splatManager.getViewer()
  if (viewer) {
    viewer.update()
  }

  // 4. Renderizar escena completa (Three.js dibujará el splatMesh automáticamente)
  renderer.render(scene, camera)
})

loadInitialSplat()