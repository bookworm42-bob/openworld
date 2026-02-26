import * as THREE from 'three';
import { agentBridgeConfig } from './config.js';

const raycaster = new THREE.Raycaster();
raycaster.near = 0.05;

const eye = new THREE.Vector3();
const downOrigin = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const rayDir = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const flatForward = new THREE.Vector3();
const flatToTarget = new THREE.Vector3();
const bbox = new THREE.Box3();
const bboxSize = new THREE.Vector3();

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const SENSOR_DIRECTIONS = {
  front: 0,
  frontLeft: Math.PI / 6,
  frontRight: -Math.PI / 6
};

function isPerceivableRoot(object3d) {
  return Boolean(object3d?.userData?.agentPerceivable);
}

function isMeshPerceivable(mesh) {
  let root = mesh;
  while (root?.parent) {
    if (isPerceivableRoot(root)) return true;
    root = root.parent;
  }
  return false;
}

function getPerceivableRoot(mesh) {
  let root = mesh;
  while (root?.parent) {
    if (isPerceivableRoot(root)) return root;
    root = root.parent;
  }
  return null;
}

function isDescendantOf(object3d, maybeAncestor) {
  let cursor = object3d;
  while (cursor) {
    if (cursor === maybeAncestor) return true;
    cursor = cursor.parent;
  }
  return false;
}

function classifySize(root) {
  bbox.setFromObject(root);
  bbox.getSize(bboxSize);
  const extent = Math.max(bboxSize.x, bboxSize.y, bboxSize.z);
  if (extent < 1.5) return 'S';
  if (extent < 5) return 'M';
  return 'L';
}

function getAffordances(tag) {
  if (tag === 'npc') return ['talk'];
  if (tag === 'beacon' || tag === 'tower') return ['interact'];
  return ['none'];
}

function buildPerceived({
  player,
  forwardDir,
  perceivableRoots,
  occluders,
  latestPerceivedIds
}) {
  const perceived = [];
  const maxRange = agentBridgeConfig.perceptionRange;
  const halfFov = agentBridgeConfig.perceptionFovRad * 0.5;

  eye.copy(player.position);
  eye.y += 1.4;
  flatForward.copy(forwardDir).setY(0).normalize();

  for (const root of perceivableRoots) {
    if (!root.visible || isDescendantOf(root, player)) continue;

    root.getWorldPosition(toTarget);
    toTarget.sub(eye);
    const distance = toTarget.length();
    if (distance < 0.01 || distance > maxRange) continue;

    flatToTarget.copy(toTarget).setY(0);
    if (flatToTarget.lengthSq() < 0.0001) continue;
    flatToTarget.normalize();

    const bearing = Math.atan2(
      flatForward.x * flatToTarget.z - flatForward.z * flatToTarget.x,
      flatForward.dot(flatToTarget)
    );
    if (Math.abs(bearing) > halfFov) continue;

    rayDir.copy(toTarget).normalize();
    raycaster.set(eye, rayDir);
    raycaster.far = distance - 0.05;

    const hits = raycaster.intersectObjects(occluders, true);
    const occluded = hits.some((hit) => {
      if (!hit.object.visible) return false;
      if (!hit.object.isMesh) return false;
      if (!isMeshPerceivable(hit.object)) return true;
      const hitRoot = getPerceivableRoot(hit.object);
      return hitRoot !== root;
    });
    if (occluded) continue;

    if (!root.userData.agentId) {
      root.userData.agentId = `obj_${Math.random().toString(36).slice(2, 8)}`;
    }

    const id = root.userData.agentId;
    latestPerceivedIds.add(id);
    const tag = root.userData.agentTag || root.name || 'object';

    perceived.push({
      id,
      tag,
      dist: Number(distance.toFixed(2)),
      bearing: Number(bearing.toFixed(3)),
      size: classifySize(root),
      aff: getAffordances(tag)
    });
  }

  perceived.sort((a, b) => a.dist - b.dist);
  return perceived;
}

function buildRaySensors(player, forwardDir, occluders) {
  eye.copy(player.position);
  eye.y += 1.25;
  flatForward.copy(forwardDir).setY(0).normalize();
  right.crossVectors(flatForward, WORLD_UP).normalize();

  const result = {};
  for (const [label, angle] of Object.entries(SENSOR_DIRECTIONS)) {
    rayDir
      .copy(flatForward)
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(right, Math.sin(angle))
      .normalize();
    raycaster.set(eye, rayDir);
    raycaster.far = agentBridgeConfig.perceptionRange;
    const hit = raycaster.intersectObjects(occluders, true).find((entry) => !isDescendantOf(entry.object, player));
    result[label] = hit ? Number(hit.distance.toFixed(2)) : agentBridgeConfig.perceptionRange;
  }

  downOrigin.copy(player.position);
  downOrigin.y += 0.5;
  raycaster.set(downOrigin, DOWN);
  raycaster.far = 5;
  const downHit = raycaster.intersectObjects(occluders, true).find((entry) => !isDescendantOf(entry.object, player));
  result.down = downHit ? Number(downHit.distance.toFixed(2)) : 5;

  return result;
}

export function buildObservation({
  nowSeconds,
  tick,
  player,
  velocity,
  grounded,
  heading,
  stuck,
  nav,
  events,
  objective,
  perceivableRoots,
  occluders,
  latestPerceivedIds
}) {
  const forwardDir = heading.lengthSq() > 0.0001 ? heading.clone().normalize() : new THREE.Vector3(0, 0, -1);
  const yaw = Math.atan2(forwardDir.x, forwardDir.z * -1);
  const sensors = buildRaySensors(player, forwardDir, occluders);
  const perceived = buildPerceived({
    player,
    forwardDir,
    perceivableRoots,
    occluders,
    latestPerceivedIds
  });

  const self = {
    yaw: Number(yaw.toFixed(3)),
    vel: {
      x: Number(velocity.x.toFixed(3)),
      y: Number(velocity.y.toFixed(3)),
      z: Number(velocity.z.toFixed(3))
    },
    grounded: Boolean(grounded)
  };

  if (agentBridgeConfig.includeSelfPos) {
    self.pos = {
      x: Number(player.position.x.toFixed(3)),
      y: Number(player.position.y.toFixed(3)),
      z: Number(player.position.z.toFixed(3))
    };
  }

  const sensorPayload = {
    ray: sensors,
    stuck: Boolean(stuck)
  };

  if (nav && typeof nav === 'object') {
    sensorPayload.nav = {
      blocked: Boolean(nav.blocked),
      frontPressure: Number.isFinite(nav.frontPressure) ? Number(nav.frontPressure.toFixed(3)) : 0,
      recentCollision: nav.recentCollision || null,
      blockedForMs: Number.isFinite(nav.blockedForMs) ? Math.max(0, Math.round(nav.blockedForMs)) : 0
    };
  }

  return {
    type: 'OBS',
    t: Number(nowSeconds.toFixed(3)),
    tick,
    self,
    sensors: sensorPayload,
    objective: objective || null,
    perceived,
    events
  };
}
