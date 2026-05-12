import * as THREE from 'three'

const SOLID_LEAF_MARKER = 0xff000000 >>> 0

function popcount(n) {
  n >>>= 0
  n -= (n >>> 1) & 0x55555555
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333)
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function getChildOffset(mask, octant) {
  const prefix = (1 << octant) - 1
  return popcount(mask & prefix)
}

export class VoxelCollision {
  constructor({ jsonUrl, binUrl, outsideIsSolid = true }) {
    this.jsonUrl = jsonUrl
    this.binUrl = binUrl
    this.outsideIsSolid = outsideIsSolid
    this.ready = false

    this.gridMin = new THREE.Vector3()
    this.gridMax = new THREE.Vector3()
    this.worldToLocal = new THREE.Matrix4()
    this.tempLocal = new THREE.Vector3()
    this.tempWorld = new THREE.Vector3()

    this.nodes = null
    this.leafData = null
    this.treeDepth = 0
    this.voxelResolution = 0.05
    this.nx = 0
    this.ny = 0
    this.nz = 0
  }

  async load() {
    const [metaResponse, binResponse] = await Promise.all([
      fetch(this.jsonUrl),
      fetch(this.binUrl)
    ])

    if (!metaResponse.ok) {
      throw new Error(`Voxel metadata load failed: ${metaResponse.status}`)
    }
    if (!binResponse.ok) {
      throw new Error(`Voxel binary load failed: ${binResponse.status}`)
    }

    const metadata = await metaResponse.json()
    const binBuffer = await binResponse.arrayBuffer()

    const nodeCount = metadata.nodeCount ?? 0
    const leafDataCount = metadata.leafDataCount ?? 0
    const expectedCount = nodeCount + leafDataCount

    const all = new Uint32Array(binBuffer)
    if (all.length < expectedCount) {
      throw new Error(`Voxel bin size mismatch (expected ${expectedCount}, got ${all.length})`)
    }

    this.nodes = all.subarray(0, nodeCount)
    this.leafData = all.subarray(nodeCount, nodeCount + leafDataCount)

    this.gridMin.set(metadata.gridBounds.min[0], metadata.gridBounds.min[1], metadata.gridBounds.min[2])
    this.gridMax.set(metadata.gridBounds.max[0], metadata.gridBounds.max[1], metadata.gridBounds.max[2])

    this.voxelResolution = metadata.voxelResolution
    this.treeDepth = metadata.treeDepth

    const gridSizeX = this.gridMax.x - this.gridMin.x
    const gridSizeY = this.gridMax.y - this.gridMin.y
    const gridSizeZ = this.gridMax.z - this.gridMin.z

    this.nx = Math.round(gridSizeX / this.voxelResolution)
    this.ny = Math.round(gridSizeY / this.voxelResolution)
    this.nz = Math.round(gridSizeZ / this.voxelResolution)

    this.ready = true
  }

  setTransformFromObject(object3d) {
    if (!object3d) return
    object3d.updateMatrixWorld(true)
    this.worldToLocal.copy(object3d.matrixWorld).invert()
  }

  isSolidWorld(worldPosition) {
    if (!this.ready) return false

    this.tempLocal.copy(worldPosition).applyMatrix4(this.worldToLocal)

    const ix = Math.floor((this.tempLocal.x - this.gridMin.x) / this.voxelResolution)
    const iy = Math.floor((this.tempLocal.y - this.gridMin.y) / this.voxelResolution)
    const iz = Math.floor((this.tempLocal.z - this.gridMin.z) / this.voxelResolution)

    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) {
      return this.outsideIsSolid
    }

    return this._isVoxelSolid(ix, iy, iz)
  }

  capsuleIntersects(basePosition, height, radius) {
    if (!this.ready) return false

    const foot = Math.min(0.1, height * 0.1)
    const mid = height * 0.5
    const head = Math.max(height - 0.1, mid)
    const heights = [foot, mid, head]

    const offsets = [
      [0, 0],
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius]
    ]

    for (let i = 0; i < heights.length; i++) {
      const y = heights[i]
      for (let j = 0; j < offsets.length; j++) {
        const [ox, oz] = offsets[j]
        this.tempWorld.set(basePosition.x + ox, basePosition.y + y, basePosition.z + oz)
        if (this.isSolidWorld(this.tempWorld)) {
          return true
        }
      }
    }

    return false
  }

  _isVoxelSolid(ix, iy, iz) {
    if (!this.nodes || !this.leafData || this.nodes.length === 0) {
      return false
    }

    const bx = ix >> 2
    const by = iy >> 2
    const bz = iz >> 2

    let nodeIndex = 0

    for (let level = this.treeDepth - 1; level >= 0; level--) {
      const node = this.nodes[nodeIndex] >>> 0

      if (node === SOLID_LEAF_MARKER) {
        return true
      }

      const childMask = node >>> 24
      if (childMask === 0) {
        const leafIndex = node & 0x00ffffff
        const lo = this.leafData[leafIndex * 2] >>> 0
        const hi = this.leafData[leafIndex * 2 + 1] >>> 0
        const lx = ix & 3
        const ly = iy & 3
        const lz = iz & 3
        const bitIdx = lx + (ly << 2) + (lz << 4)
        if (bitIdx < 32) {
          return ((lo >>> bitIdx) & 1) === 1
        }
        return ((hi >>> (bitIdx - 32)) & 1) === 1
      }

      const xBit = (bx >> level) & 1
      const yBit = (by >> level) & 1
      const zBit = (bz >> level) & 1
      const octant = xBit | (yBit << 1) | (zBit << 2)

      if (((childMask >> octant) & 1) === 0) {
        return false
      }

      const baseOffset = node & 0x00ffffff
      nodeIndex = baseOffset + getChildOffset(childMask, octant)

      if (nodeIndex >= this.nodes.length) {
        return false
      }
    }

    return false
  }
}
