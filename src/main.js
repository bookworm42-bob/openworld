import './style.css';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import idleFbxUrl from '../3d_models/boy/Sad Idle.fbx?url';
import walkFbxUrl from '../3d_models/boy/Walking.fbx?url';
import jumpFbxUrl from '../3d_models/boy/Jumping.fbx?url';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x3f4f7a, 32, 118);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 4, 9);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.25, 0);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 3;
controls.maxDistance = 18;

scene.add(new THREE.HemisphereLight(0xbad4ff, 0x47604d, 0.82));
const dirLight = new THREE.DirectionalLight(0xffd6ab, 1.05);
dirLight.position.set(8, 16, 6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
scene.add(dirLight);

const TERRAIN_CHUNK_SIZE = 110;
const TERRAIN_CHUNK_SEGMENTS = 45;
const TERRAIN_VISIBILITY_DISTANCE = 125;

const terrainChunks = [];

function buildTerrainChunk(centerX, centerZ, size = TERRAIN_CHUNK_SIZE, segments = TERRAIN_CHUNK_SEGMENTS) {
  const terrainGeometry = new THREE.PlaneGeometry(size, size, segments, segments);
  terrainGeometry.rotateX(-Math.PI / 2);

  const positions = terrainGeometry.attributes.position;
  const colors = [];
  const lowColor = new THREE.Color(0x2f5a4c);
  const highColor = new THREE.Color(0x7e9f6d);
  const tint = new THREE.Color();

  for (let i = 0; i < positions.count; i += 1) {
    const localX = positions.getX(i);
    const localZ = positions.getZ(i);
    const worldX = localX + centerX;
    const worldZ = localZ + centerZ;

    const rolling = Math.sin(worldX * 0.07) * Math.cos(worldZ * 0.05) * 0.12;
    const patchNoise = Math.sin((worldX + worldZ) * 0.18) * 0.04;
    const y = rolling + patchNoise;

    positions.setY(i, y);

    const blend = THREE.MathUtils.clamp((y + 0.16) / 0.32, 0, 1);
    tint.copy(lowColor).lerp(highColor, blend);
    colors.push(tint.r, tint.g, tint.b);
  }

  terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  terrainGeometry.computeVertexNormals();

  const floor = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02
    })
  );
  floor.position.set(centerX, 0, centerZ);
  floor.receiveShadow = true;
  scene.add(floor);

  const contourOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0xc2d8ab,
      wireframe: true,
      transparent: true,
      opacity: 0.07
    })
  );
  contourOverlay.rotation.x = -Math.PI / 2;
  contourOverlay.position.set(centerX, 0.025, centerZ);
  scene.add(contourOverlay);

  terrainChunks.push({
    center: new THREE.Vector2(centerX, centerZ),
    floor,
    contourOverlay
  });
}

const halfChunk = TERRAIN_CHUNK_SIZE * 0.5;
buildTerrainChunk(-halfChunk, -halfChunk);
buildTerrainChunk(halfChunk, -halfChunk);
buildTerrainChunk(-halfChunk, halfChunk);
buildTerrainChunk(halfChunk, halfChunk);

const loader = new FBXLoader();
const gltfLoader = new GLTFLoader();
const clock = new THREE.Clock();

const DEFAULT_TIME_SCALE = 1;
const SLOW_TIME_SCALE = 0.35;
const urlParams = new URLSearchParams(window.location.search);
let timeScale = urlParams.get('slow') === '1' ? SLOW_TIME_SCALE : DEFAULT_TIME_SCALE;
let slowMode = timeScale !== DEFAULT_TIME_SCALE;

const keys = {
  ArrowUp: false,
  ArrowLeft: false,
  ArrowRight: false,
  Space: false,
  KeyE: false,
  KeyT: false
};

let player;
let mixer;
const actions = {};
let activeAction;
let jumping = false;
let velocityY = 0;
const gravity = 26;
const jumpVelocity = 9;
let groundedY = 0;

const interactable = {
  mesh: null,
  radius: 2.2,
  activated: false,
  promptEl: null,
  statusEl: null
};

const modeHud = {
  el: null
};

const animPaths = {
  idle: idleFbxUrl,
  walk: walkFbxUrl,
  jump: jumpFbxUrl
};

const natureKitPaths = {
  tree: '/assets/nature-kit/tree_oak.glb',
  rock: '/assets/nature-kit/rock_smallE.glb',
  logStack: '/assets/nature-kit/log_stackLarge.glb'
};

// Use the idle FBX as the single loaded player rig/model source.
const playerPath = animPaths.idle;

function getTerrainHeightAt(x, z) {
  const rolling = Math.sin(x * 0.07) * Math.cos(z * 0.05) * 0.12;
  const patchNoise = Math.sin((x + z) * 0.18) * 0.04;
  return rolling + patchNoise;
}

function updateTerrainChunkVisibility() {
  const referencePosition = player ? player.position : camera.position;
  terrainChunks.forEach((chunk) => {
    const dx = referencePosition.x - chunk.center.x;
    const dz = referencePosition.z - chunk.center.y;
    const isVisible = Math.hypot(dx, dz) <= TERRAIN_VISIBILITY_DISTANCE;
    chunk.floor.visible = isVisible;
    chunk.contourOverlay.visible = isVisible;
  });
}

function setAction(nextName, fade = 0.2) {
  const next = actions[nextName];
  if (!next || activeAction === next) return;

  next.enabled = true;
  next.reset().fadeIn(fade).play();
  if (activeAction) activeAction.fadeOut(fade);
  activeAction = next;
}

function normalizePlayerScaleAndGround(object3d, targetHeight = 1.8) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  box.getSize(size);

  if (size.y > 0.0001) {
    const scale = targetHeight / size.y;
    object3d.scale.multiplyScalar(scale);
  }

  // Recompute and set feet on y=0.
  box.setFromObject(object3d);
  object3d.position.y -= box.min.y;
}

function inferAnimationClip(object3d) {
  if (object3d.animations?.length) return object3d.animations[0];
  let found = null;
  object3d.traverse((child) => {
    if (!found && child.animations?.length) found = child.animations[0];
  });
  return found;
}

async function loadFBX(path) {
  return await new Promise((resolve, reject) => {
    loader.load(path, resolve, undefined, reject);
  });
}

async function loadGLTF(path) {
  return await new Promise((resolve, reject) => {
    gltfLoader.load(path, resolve, undefined, reject);
  });
}

async function loadCharacterAndAnimations() {
  try {
    // Load character once.
    player = await loadFBX(playerPath);
    player.position.set(0, 0, 0);
    player.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(player);
    normalizePlayerScaleAndGround(player);

    mixer = new THREE.AnimationMixer(player);

    // Load only extra animation sources; player model is already loaded once from idle FBX.
    const [walkFbx, jumpFbx] = await Promise.all([
      loadFBX(animPaths.walk),
      loadFBX(animPaths.jump)
    ]);

    const idleClip = inferAnimationClip(player);
    const walkClip = inferAnimationClip(walkFbx);
    const jumpClip = inferAnimationClip(jumpFbx);

    if (!idleClip || !walkClip || !jumpClip) {
      throw new Error('One or more animation clips missing from FBX files.');
    }

    // These clips come from the same rig family; direct binding is more stable than retargeting here.
    actions.idle = mixer.clipAction(idleClip);
    actions.walk = mixer.clipAction(walkClip);
    actions.jump = mixer.clipAction(jumpClip);

    actions.walk.setLoop(THREE.LoopRepeat);
    actions.idle.setLoop(THREE.LoopRepeat);
    actions.jump.setLoop(THREE.LoopOnce, 1);
    actions.jump.clampWhenFinished = true;

    setAction('idle', 0.01);

    // Reframe camera once character bounds are known.
    const box = new THREE.Box3().setFromObject(player);
    const center = new THREE.Vector3();
    box.getCenter(center);
    controls.target.copy(center);
    camera.position.set(center.x + 3.2, center.y + 2.2, center.z + 5.8);
  } catch (error) {
    console.error('Failed to load model/animations from ./3d_models/boy:', error);

    // Visual fallback so the scene still works while assets are being added.
    player = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 1.2, 5, 12),
      new THREE.MeshStandardMaterial({ color: 0x3678d6, roughness: 0.7 })
    );
    player.position.set(0, 1, 0);
    player.castShadow = true;
    scene.add(player);
  }
}

async function createSetDressing() {
  const propAnchors = [
    { x: -6.5, z: -4.2, scale: 1.2 },
    { x: 7.4, z: 4.6, scale: 0.9 },
    { x: -9.2, z: 6.8, scale: 1.05 }
  ];

  try {
    const [treeGltf, rockGltf, logStackGltf] = await Promise.all([
      loadGLTF(natureKitPaths.tree),
      loadGLTF(natureKitPaths.rock),
      loadGLTF(natureKitPaths.logStack)
    ]);

    propAnchors.forEach((anchor, index) => {
      const tree = treeGltf.scene.clone(true);
      tree.position.set(anchor.x, getTerrainHeightAt(anchor.x, anchor.z), anchor.z);
      tree.scale.setScalar(anchor.scale * 1.45);
      tree.rotation.y = 0.6 + index * 0.9;
      tree.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(tree);

      const rock = rockGltf.scene.clone(true);
      const rockX = anchor.x + 1.1;
      const rockZ = anchor.z + 0.4;
      rock.position.set(rockX, getTerrainHeightAt(rockX, rockZ), rockZ);
      rock.scale.setScalar(anchor.scale * 0.9);
      rock.rotation.y = index * 0.8;
      rock.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(rock);

      const logs = logStackGltf.scene.clone(true);
      const logX = anchor.x - 0.95;
      const logZ = anchor.z + 0.2;
      logs.position.set(logX, getTerrainHeightAt(logX, logZ), logZ);
      logs.scale.setScalar(anchor.scale * 0.95);
      logs.rotation.y = -0.3 + index * 0.45;
      logs.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(logs);
    });
  } catch (error) {
    console.warn('Nature Kit props failed to load, using primitive fallback:', error);

    const fallbackMaterial = new THREE.MeshStandardMaterial({ color: 0x8b7b67, roughness: 0.85, metalness: 0.02 });
    propAnchors.forEach((anchor, index) => {
      const fallback = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 1.1, 6), fallbackMaterial);
      fallback.position.set(anchor.x, getTerrainHeightAt(anchor.x, anchor.z) + 0.55, anchor.z);
      fallback.scale.setScalar(anchor.scale);
      fallback.rotation.y = index * 0.7;
      fallback.castShadow = true;
      fallback.receiveShadow = true;
      scene.add(fallback);
    });
  }
}

function createInteractable() {
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.6, 0.25, 24),
    new THREE.MeshStandardMaterial({ color: 0x4a5b75, roughness: 0.55, metalness: 0.35 })
  );
  base.position.set(4.5, 0.12, -2.8);
  base.receiveShadow = true;

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 24, 24),
    new THREE.MeshStandardMaterial({
      color: 0x9ed6ff,
      emissive: 0x4b7fd3,
      emissiveIntensity: 0.7,
      roughness: 0.25,
      metalness: 0.12
    })
  );
  orb.position.y = 0.42;
  orb.castShadow = true;
  base.add(orb);

  interactable.mesh = base;
  scene.add(base);

  interactable.promptEl = document.createElement('div');
  interactable.promptEl.id = 'interaction-prompt';
  interactable.promptEl.textContent = 'Press E to inspect glowing orb';
  document.body.appendChild(interactable.promptEl);

  interactable.statusEl = document.createElement('div');
  interactable.statusEl.id = 'interaction-status';
  document.body.appendChild(interactable.statusEl);

  modeHud.el = document.createElement('div');
  modeHud.el.id = 'mode-hud';
  document.body.appendChild(modeHud.el);
  updateModeHud();
}

function updateInteractionUI(canInteract) {
  if (!interactable.promptEl) return;
  interactable.promptEl.style.opacity = canInteract ? '1' : '0';
  interactable.promptEl.style.transform = canInteract ? 'translate(-50%, 0)' : 'translate(-50%, 6px)';
}

function triggerInteraction() {
  if (!interactable.mesh || !interactable.statusEl) return;

  interactable.activated = !interactable.activated;
  const orb = interactable.mesh.children[0];
  if (orb?.material) {
    orb.material.color.setHex(interactable.activated ? 0xb5ffc8 : 0x9ed6ff);
    orb.material.emissive.setHex(interactable.activated ? 0x2b965f : 0x4b7fd3);
  }

  interactable.statusEl.textContent = interactable.activated
    ? 'Orb attuned. Ancient mechanism hums to life.'
    : 'Orb calms down.';
  interactable.statusEl.classList.add('show');
  setTimeout(() => interactable.statusEl?.classList.remove('show'), 1400);
}

function updateModeHud() {
  if (!modeHud.el) return;
  modeHud.el.textContent = slowMode ? 'SLOW MODE: ON (T)' : 'SLOW MODE: OFF (T)';
  modeHud.el.classList.toggle('active', slowMode);
}

function onKey(isDown, e) {
  if (!(e.code in keys)) return;
  keys[e.code] = isDown;
  if (e.code === 'Space') e.preventDefault();

  if (isDown && e.code === 'Space' && player && !jumping) {
    jumping = true;
    velocityY = jumpVelocity;
    if (actions.jump) setAction('jump', 0.08);
  }

  if (isDown && e.code === 'KeyE' && player && interactable.mesh) {
    const distance = player.position.distanceTo(interactable.mesh.position);
    if (distance <= interactable.radius) triggerInteraction();
  }

  if (isDown && e.code === 'KeyT') {
    slowMode = !slowMode;
    timeScale = slowMode ? SLOW_TIME_SCALE : DEFAULT_TIME_SCALE;
    updateModeHud();
  }
}

window.addEventListener('keydown', (e) => onKey(true, e));
window.addEventListener('keyup', (e) => onKey(false, e));

function updatePlayer(delta) {
  if (!player) return;

  const moveSpeed = 4.4;

  const moveVec = new THREE.Vector3();
  if (keys.ArrowUp) moveVec.z -= 1;
  if (keys.ArrowLeft) moveVec.x -= 1;
  if (keys.ArrowRight) moveVec.x += 1;

  if (moveVec.lengthSq() > 0) {
    moveVec.normalize().multiplyScalar(moveSpeed * delta);
    player.position.add(moveVec);

    if (actions.walk && !jumping) setAction('walk', 0.16);

    const lookTarget = player.position.clone().add(new THREE.Vector3(moveVec.x, 0, moveVec.z));
    player.lookAt(lookTarget);
  } else if (actions.idle && !jumping) {
    setAction('idle', 0.2);
  }

  const terrainY = getTerrainHeightAt(player.position.x, player.position.z);

  if (jumping) {
    velocityY -= gravity * delta;
    player.position.y += velocityY * delta;

    if (player.position.y <= terrainY) {
      player.position.y = terrainY;
      velocityY = 0;
      jumping = false;
      groundedY = terrainY;

      if (moveVec.lengthSq() > 0 && actions.walk) setAction('walk', 0.14);
      else if (actions.idle) setAction('idle', 0.14);
    }
  } else {
    groundedY = terrainY;
    player.position.y = groundedY;
  }

  // soft camera follow
  const desiredTarget = player.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  controls.target.lerp(desiredTarget, 1 - Math.pow(0.001, delta));

  if (interactable.mesh) {
    const distance = player.position.distanceTo(interactable.mesh.position);
    const canInteract = distance <= interactable.radius;
    updateInteractionUI(canInteract);

    const orb = interactable.mesh.children[0];
    if (orb) {
      const t = clock.elapsedTime;
      orb.position.y = 0.42 + Math.sin(t * 2.2) * 0.06;
      orb.material.emissiveIntensity = interactable.activated ? 1.05 : 0.65 + (Math.sin(t * 4.4) + 1) * 0.12;
    }
  }
}

function render() {
  const delta = clock.getDelta();
  const scaledDelta = delta * timeScale;
  if (mixer) mixer.update(scaledDelta);
  updatePlayer(scaledDelta);
  updateTerrainChunkVisibility();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

loadCharacterAndAnimations().finally(async () => {
  await createSetDressing();
  createInteractable();
  render();
});
