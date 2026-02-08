import './style.css';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
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
scene.fog = new THREE.Fog(0xd9efff, 35, 120);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 4, 9);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.25, 0);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 3;
controls.maxDistance = 18;

scene.add(new THREE.HemisphereLight(0xdaf0ff, 0x7ec98d, 0.9));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
dirLight.position.set(8, 16, 6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
scene.add(dirLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(220, 220),
  new THREE.MeshStandardMaterial({
    color: 0x3f8a5a,
    roughness: 0.96,
    metalness: 0.02
  })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Add subtle floor variation tiles for visual depth.
const tileGeo = new THREE.PlaneGeometry(220, 220, 30, 30);
const tileMat = new THREE.MeshBasicMaterial({
  color: 0x4b9d64,
  wireframe: true,
  transparent: true,
  opacity: 0.09
});
const gridOverlay = new THREE.Mesh(tileGeo, tileMat);
gridOverlay.rotation.x = -Math.PI / 2;
gridOverlay.position.y = 0.02;
scene.add(gridOverlay);

const loader = new FBXLoader();
const clock = new THREE.Clock();

const keys = {
  ArrowUp: false,
  ArrowLeft: false,
  ArrowRight: false,
  Space: false,
  KeyE: false
};

let player;
let mixer;
const actions = {};
let activeAction;
let jumping = false;
let velocityY = 0;
const gravity = 26;
const jumpVelocity = 9;
const groundY = 0;

const interactable = {
  mesh: null,
  radius: 2.2,
  activated: false,
  promptEl: null,
  statusEl: null
};

const animPaths = {
  idle: idleFbxUrl,
  walk: walkFbxUrl,
  jump: jumpFbxUrl
};

// Use the idle FBX as the single loaded player rig/model source.
const playerPath = animPaths.idle;

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
      color: 0x66d8ff,
      emissive: 0x1f8fff,
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
    orb.material.color.setHex(interactable.activated ? 0x7dffb5 : 0x66d8ff);
    orb.material.emissive.setHex(interactable.activated ? 0x1ba653 : 0x1f8fff);
  }

  interactable.statusEl.textContent = interactable.activated
    ? 'Orb attuned. Ancient mechanism hums to life.'
    : 'Orb calms down.';
  interactable.statusEl.classList.add('show');
  setTimeout(() => interactable.statusEl?.classList.remove('show'), 1400);
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

  if (jumping) {
    velocityY -= gravity * delta;
    player.position.y += velocityY * delta;

    if (player.position.y <= groundY) {
      player.position.y = groundY;
      velocityY = 0;
      jumping = false;

      if (moveVec.lengthSq() > 0 && actions.walk) setAction('walk', 0.14);
      else if (actions.idle) setAction('idle', 0.14);
    }
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
  if (mixer) mixer.update(delta);
  updatePlayer(delta);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

loadCharacterAndAnimations().finally(() => {
  createInteractable();
  render();
});
