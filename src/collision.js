import * as THREE from 'three';

const tmpBox = new THREE.Box3();
const tmpSize = new THREE.Vector3();
const tmpCenter = new THREE.Vector3();

const EPSILON = 0.0001;

function gridKey(ix, iz) {
  return `${ix},${iz}`;
}

export class StaticWorldColliders {
  constructor({ cellSize = 6 } = {}) {
    this.cellSize = cellSize;
    this.colliders = [];
    this.grid = new Map();
  }

  clear() {
    this.colliders.length = 0;
    this.grid.clear();
  }

  registerCylinder(collider) {
    const normalized = {
      id: collider.id,
      tag: collider.tag || 'solid',
      x: Number(collider.x) || 0,
      z: Number(collider.z) || 0,
      radius: Math.max(0.2, Number(collider.radius) || 0.5),
      yMin: Number.isFinite(collider.yMin) ? collider.yMin : -Infinity,
      yMax: Number.isFinite(collider.yMax) ? collider.yMax : Infinity
    };

    const index = this.colliders.length;
    this.colliders.push(normalized);

    const minX = normalized.x - normalized.radius;
    const maxX = normalized.x + normalized.radius;
    const minZ = normalized.z - normalized.radius;
    const maxZ = normalized.z + normalized.radius;
    const minCellX = Math.floor(minX / this.cellSize);
    const maxCellX = Math.floor(maxX / this.cellSize);
    const minCellZ = Math.floor(minZ / this.cellSize);
    const maxCellZ = Math.floor(maxZ / this.cellSize);

    for (let ix = minCellX; ix <= maxCellX; ix += 1) {
      for (let iz = minCellZ; iz <= maxCellZ; iz += 1) {
        const key = gridKey(ix, iz);
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(index);
        else this.grid.set(key, [index]);
      }
    }

    return normalized;
  }

  registerFromObject({
    object,
    id,
    tag,
    radiusScale = 0.5,
    radiusPadding = 0.12,
    minRadius = 0.45,
    maxRadius = 9
  }) {
    if (!object) return null;
    tmpBox.setFromObject(object);
    if (tmpBox.isEmpty()) return null;

    tmpBox.getSize(tmpSize);
    tmpBox.getCenter(tmpCenter);

    const radialExtent = Math.max(tmpSize.x, tmpSize.z) * radiusScale + radiusPadding;
    const radius = THREE.MathUtils.clamp(radialExtent, minRadius, maxRadius);

    return this.registerCylinder({
      id,
      tag,
      x: tmpCenter.x,
      z: tmpCenter.z,
      radius,
      yMin: tmpBox.min.y - 0.1,
      yMax: tmpBox.max.y + 0.1
    });
  }

  queryNearby(x, z, radius = 8) {
    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellZ = Math.floor((z - radius) / this.cellSize);
    const maxCellZ = Math.floor((z + radius) / this.cellSize);
    const hit = new Set();

    for (let ix = minCellX; ix <= maxCellX; ix += 1) {
      for (let iz = minCellZ; iz <= maxCellZ; iz += 1) {
        const bucket = this.grid.get(gridKey(ix, iz));
        if (!bucket) continue;
        for (const index of bucket) hit.add(index);
      }
    }

    return [...hit].map((index) => this.colliders[index]);
  }
}

export function resolvePlayerCylinderMotion({
  startX,
  startZ,
  desiredX,
  desiredZ,
  playerRadius,
  playerYMin,
  playerYMax,
  colliders,
  iterations = 4
}) {
  let x = desiredX;
  let z = desiredZ;
  const contacts = [];

  for (let i = 0; i < iterations; i += 1) {
    let moved = false;

    for (const collider of colliders) {
      if (!collider) continue;
      if (playerYMax < collider.yMin || playerYMin > collider.yMax) continue;

      const dx = x - collider.x;
      const dz = z - collider.z;
      const minDist = playerRadius + collider.radius;
      const distSq = dx * dx + dz * dz;

      if (distSq >= minDist * minDist) continue;

      const dist = Math.sqrt(Math.max(distSq, EPSILON));
      let nx = dx / dist;
      let nz = dz / dist;

      if (!Number.isFinite(nx) || !Number.isFinite(nz)) {
        const fallbackX = x - startX;
        const fallbackZ = z - startZ;
        const fallbackLen = Math.hypot(fallbackX, fallbackZ);
        if (fallbackLen > EPSILON) {
          nx = fallbackX / fallbackLen;
          nz = fallbackZ / fallbackLen;
        } else {
          nx = 1;
          nz = 0;
        }
      }

      const penetration = minDist - dist + 0.002;
      x += nx * penetration;
      z += nz * penetration;
      moved = true;

      contacts.push({
        id: collider.id,
        tag: collider.tag,
        penetration: Number(penetration.toFixed(4))
      });
    }

    if (!moved) break;
  }

  const desiredDx = desiredX - startX;
  const desiredDz = desiredZ - startZ;
  const finalDx = x - startX;
  const finalDz = z - startZ;
  const desiredLen = Math.hypot(desiredDx, desiredDz);
  const finalLen = Math.hypot(finalDx, finalDz);
  const blockedRatio = desiredLen > EPSILON ? THREE.MathUtils.clamp(1 - finalLen / desiredLen, 0, 1) : 0;

  return {
    x,
    z,
    contacts,
    blockedRatio,
    desiredLen,
    finalLen
  };
}
