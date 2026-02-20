import * as THREE from 'three';

const captureCanvas = document.createElement('canvas');
const captureCtx = captureCanvas.getContext('2d');
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function clampDimension(value, fallback) {
  const v = Number(value);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(64, Math.min(1024, Math.round(v)));
}

function clampQuality(value) {
  const q = Number(value);
  if (!Number.isFinite(q)) return 0.7;
  return Math.max(0.1, Math.min(1, q / 100));
}

function applyCameraPose(camName, camera, player, heading, nowSeconds) {
  const forward = heading.lengthSq() > 0.0001 ? heading.clone().normalize() : new THREE.Vector3(0, 0, -1);
  tmpRight.crossVectors(forward, WORLD_UP).normalize();

  if (camName === 'firstPerson') {
    tmpPosition.copy(player.position).addScaledVector(WORLD_UP, 1.55);
    tmpLook.copy(tmpPosition).add(forward);
  } else if (camName === 'front') {
    tmpPosition.copy(player.position).addScaledVector(forward, 2.6).addScaledVector(WORLD_UP, 1.5);
    tmpLook.copy(player.position).addScaledVector(WORLD_UP, 1.2);
  } else if (camName === 'orbit') {
    const orbitAngle = nowSeconds * 0.8;
    tmpPosition
      .copy(player.position)
      .addScaledVector(forward, Math.cos(orbitAngle) * 5.2)
      .addScaledVector(tmpRight, Math.sin(orbitAngle) * 5.2)
      .addScaledVector(WORLD_UP, 2.4);
    tmpLook.copy(player.position).addScaledVector(WORLD_UP, 1.1);
  } else {
    return;
  }

  camera.position.copy(tmpPosition);
  camera.lookAt(tmpLook);
}

export function captureFrame({
  request,
  renderer,
  scene,
  camera,
  player,
  heading,
  nowSeconds
}) {
  const cam = request.cam || 'follow';
  const w = clampDimension(request.w, 256);
  const h = clampDimension(request.h, 256);
  const format = request.format === 'png' ? 'image/png' : 'image/jpeg';
  const quality = clampQuality(request.quality);

  const prevPos = camera.position.clone();
  const prevQuat = camera.quaternion.clone();

  applyCameraPose(cam, camera, player, heading, nowSeconds);
  renderer.render(scene, camera);

  captureCanvas.width = w;
  captureCanvas.height = h;
  captureCtx.drawImage(renderer.domElement, 0, 0, w, h);
  const dataUrl = captureCanvas.toDataURL(format, quality);
  const imgB64 = dataUrl.split(',')[1] || '';

  camera.position.copy(prevPos);
  camera.quaternion.copy(prevQuat);

  return {
    type: 'CAPTURED',
    cam,
    imgB64
  };
}
