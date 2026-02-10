import './style.css';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import idleFbxUrl from '../3d_models/boy/SadIdle.fbx?url';
import walkFbxUrl from '../3d_models/boy/Walking.fbx?url';
import jumpFbxUrl from '../3d_models/boy/Jumping.fbx?url';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  const elapsed = Math.round(performance.now());
  const priorCount = window.__BOOT_DEBUG__?.contextLossCount || 0;
  console.error('[boot-debug] WebGL context lost during boot/runtime', {
    elapsedMs: elapsed,
    contextLossCount: priorCount + 1,
    stages: { ...(window.__BOOT_DEBUG__?.stages || {}) }
  });
  window.__BOOT_DEBUG__ = {
    ...(window.__BOOT_DEBUG__ || {}),
    contextLost: true,
    contextLossCount: priorCount + 1,
    contextLostAtMs: elapsed
  };
});

renderer.domElement.addEventListener('webglcontextrestored', () => {
  console.warn('[boot-debug] WebGL context restored');
  window.__BOOT_DEBUG__ = {
    ...(window.__BOOT_DEBUG__ || {}),
    contextLost: false,
    contextRestoredAtMs: Math.round(performance.now())
  };
});

const TWILIGHT5 = {
  blush: 0xfbbbad,
  rose: 0xee8695,
  slateBlue: 0x4a7a96,
  deepIndigo: 0x333f58,
  night: 0x292831
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(TWILIGHT5.night);
scene.fog = new THREE.Fog(TWILIGHT5.deepIndigo, 24, 106);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 4, 9);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.25, 0);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 3;
controls.maxDistance = 18;

scene.add(new THREE.HemisphereLight(TWILIGHT5.slateBlue, TWILIGHT5.night, 0.92));
const dirLight = new THREE.DirectionalLight(TWILIGHT5.blush, 1.08);
dirLight.position.set(8, 16, 6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
scene.add(dirLight);

// Soft player-focused fill/rim helper to keep silhouette readable against dusk fog.
const playerRimLight = new THREE.DirectionalLight(TWILIGHT5.rose, 0.34);
playerRimLight.position.set(-5, 4, -6);
scene.add(playerRimLight);
scene.add(playerRimLight.target);

const TERRAIN_CHUNK_SIZE = 110;
const TERRAIN_CHUNK_SEGMENTS = 45;
const TERRAIN_VISIBILITY_DISTANCE = 125;

const terrainChunks = [];
const terrainBlendMaterials = [];

function createGroundTexturePalette({ baseHex, accentHex, grainHex, seed = 1 }) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const base = new THREE.Color(baseHex);
  const accent = new THREE.Color(accentHex);
  const grain = new THREE.Color(grainHex);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = Math.sin((x + seed * 11.3) * 0.16) * Math.cos((y + seed * 7.1) * 0.14);
      const patch = Math.sin((x + y) * 0.07 + seed) * 0.5 + 0.5;
      const grainNoise = Math.sin((x * 1.73 + y * 2.41 + seed * 17.0) * 0.35) * 0.5 + 0.5;

      const color = base.clone().lerp(accent, THREE.MathUtils.clamp(0.3 + n * 0.35 + patch * 0.35, 0, 1));
      color.lerp(grain, grainNoise * 0.2);

      ctx.fillStyle = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const stylizedGroundTextures = {
  grass: createGroundTexturePalette({
    baseHex: 0x3d5f6a,
    accentHex: 0x5f8b8a,
    grainHex: 0x2e3d4e,
    seed: 2.2
  }),
  dirt: createGroundTexturePalette({
    baseHex: 0x4a3f45,
    accentHex: 0x6b5457,
    grainHex: 0x332b31,
    seed: 5.6
  })
};

function applyDistanceGroundBlend(material) {
  if (!material || material.userData?.groundBlendApplied) return material;

  material.userData = {
    ...material.userData,
    groundBlendApplied: true
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundGrassMap = { value: stylizedGroundTextures.grass };
    shader.uniforms.uGroundDirtMap = { value: stylizedGroundTextures.dirt };
    shader.uniforms.uGroundBlendNear = { value: 14.0 };
    shader.uniforms.uGroundBlendFar = { value: 96.0 };
    shader.uniforms.uGroundCameraPos = { value: new THREE.Vector3() };

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vGroundWorldPos;'
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvGroundWorldPos = worldPosition.xyz;'
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec3 vGroundWorldPos;
      uniform sampler2D uGroundGrassMap;
      uniform sampler2D uGroundDirtMap;
      uniform float uGroundBlendNear;
      uniform float uGroundBlendFar;
      uniform vec3 uGroundCameraPos;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      vec2 terrainUv = vGroundWorldPos.xz * 0.085;
      vec3 grassTex = texture2D(uGroundGrassMap, terrainUv).rgb;
      vec3 dirtTex = texture2D(uGroundDirtMap, terrainUv * 0.75 + vec2(0.12, -0.08)).rgb;
      float distFade = smoothstep(uGroundBlendNear, uGroundBlendFar, distance(vGroundWorldPos.xz, uGroundCameraPos.xz));
      vec3 distanceTint = mix(vec3(1.04, 1.02, 1.0), vec3(0.86, 0.82, 0.88), distFade);
      vec3 groundTex = mix(grassTex, dirtTex, distFade);
      gl_FragColor.rgb *= groundTex * distanceTint * 1.18;
      #include <dithering_fragment>
      `
    );

    material.userData.groundBlendShader = shader;
  };

  material.needsUpdate = true;
  terrainBlendMaterials.push(material);
  return material;
}

function buildTerrainChunk(centerX, centerZ, size = TERRAIN_CHUNK_SIZE, segments = TERRAIN_CHUNK_SEGMENTS) {
  const terrainGeometry = new THREE.PlaneGeometry(size, size, segments, segments);
  terrainGeometry.rotateX(-Math.PI / 2);

  const positions = terrainGeometry.attributes.position;
  const colors = [];
  const lowColor = new THREE.Color(TWILIGHT5.deepIndigo);
  const highColor = new THREE.Color(TWILIGHT5.slateBlue);
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

  const floorMaterial = applyDistanceGroundBlend(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02
    })
  );

  const floor = new THREE.Mesh(terrainGeometry, floorMaterial);
  floor.position.set(centerX, 0, centerZ);
  floor.receiveShadow = true;
  scene.add(floor);

  const contourOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size, 16, 16),
    new THREE.MeshBasicMaterial({
      color: TWILIGHT5.rose,
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

const bootLoading = {
  startedAtMs: performance.now(),
  overlayEl: null,
  statusEl: null,
  hidden: false
};

const bootStages = {
  coreUiReady: false,
  characterReady: false,
  setDressingReady: false,
  landmarksReady: false,
  renderStarted: false,
  firstFrameRendered: false,
  firstFrameWithCharacterRendered: false
};

function markBootStage(stage, details = '') {
  const elapsed = Math.round(performance.now() - bootLoading.startedAtMs);
  bootStages[stage] = true;
  window.__BOOT_DEBUG__ = {
    ...(window.__BOOT_DEBUG__ || {}),
    startedAtMs: bootLoading.startedAtMs,
    stages: { ...bootStages },
    lastStage: stage,
    elapsedMs: elapsed,
    details
  };
  console.log(`[boot-debug] stage=${stage} at ${elapsed}ms${details ? ` | ${details}` : ''}`);
}

function formatVec3Debug(vec3) {
  if (!vec3) return 'n/a';
  const x = Number.isFinite(vec3.x) ? vec3.x.toFixed(3) : String(vec3.x);
  const y = Number.isFinite(vec3.y) ? vec3.y.toFixed(3) : String(vec3.y);
  const z = Number.isFinite(vec3.z) ? vec3.z.toFixed(3) : String(vec3.z);
  return `(${x}, ${y}, ${z})`;
}

function createBootLoadingOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'boot-loading-overlay';

  const spinner = document.createElement('div');
  spinner.id = 'boot-loading-spinner';
  overlay.appendChild(spinner);

  const status = document.createElement('div');
  status.id = 'boot-loading-status';
  status.textContent = 'Loading world assets…';
  overlay.appendChild(status);

  document.body.appendChild(overlay);
  bootLoading.overlayEl = overlay;
  bootLoading.statusEl = status;
}

function setBootLoadingStatus(text) {
  if (!bootLoading.statusEl || bootLoading.hidden) return;
  bootLoading.statusEl.textContent = text;
}

function hideBootLoadingOverlay(mode = 'complete') {
  if (!bootLoading.overlayEl || bootLoading.hidden) return;
  bootLoading.hidden = true;
  bootLoading.overlayEl.remove();
  const elapsed = Math.round(performance.now() - bootLoading.startedAtMs);
  console.log(`[boot] loading overlay removed (${mode}) after ${elapsed}ms`);
}

function maybeHideBootOverlayAfterFirstRenderableFrame() {
  const worldReady = bootStages.setDressingReady && bootStages.landmarksReady;
  const canHideAfterWorldFrame = worldReady && bootStages.firstFrameRendered;

  if (!canHideAfterWorldFrame) return;

  hideBootLoadingOverlay('world-first-frame');
}

createBootLoadingOverlay();

setTimeout(() => {
  if (bootLoading.hidden) {
    console.log('[boot] 120s check: loading overlay already removed.');
  } else {
    console.error('[boot] 120s check: loading overlay still visible.');
  }
}, 120000);

const assetLoadingManager = new THREE.LoadingManager();
assetLoadingManager.onStart = (url, loaded, total) => {
  console.log(`[boot-debug] asset manager start: ${url || 'n/a'} (${loaded}/${total})`);
  setBootLoadingStatus('Loading world assets…');
};
assetLoadingManager.onProgress = (url, loaded, total) => {
  if (total > 0) setBootLoadingStatus(`Loading world assets… (${loaded}/${total})`);
  console.log(`[boot-debug] asset manager progress: ${url || 'n/a'} (${loaded}/${total})`);
};
assetLoadingManager.onLoad = () => {
  console.log('[boot-debug] asset manager load complete (all pending assets settled)');
};
assetLoadingManager.onError = (url) => {
  console.error('[boot] asset load error:', url);
};

const loader = new FBXLoader(assetLoadingManager);
const gltfLoader = new GLTFLoader(assetLoadingManager);
const clock = new THREE.Clock();

const loadDebugState = {
  fbxInFlight: 0,
  gltfInFlight: 0,
  peakFbxInFlight: 0,
  peakGltfInFlight: 0
};

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

const chunkHud = {
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

const landmarkAssetPaths = {
  tower: '/assets/poly-pizza/tower-quaternius.glb',
  windmill: '/assets/poly-pizza/windmill-poly-google.glb'
};

const ruinAccentAssetPaths = {
  damagedGrave: '/assets/poly-pizza/damaged-grave-kay-lousberg.glb',
  brokenFencePillar: '/assets/poly-pizza/broken-fence-pillar-kay-lousberg.glb'
};

const landmarkLayout = [
  {
    id: 'tower-near',
    type: 'tower',
    position: new THREE.Vector2(20, -14),
    scale: 1
  },
  {
    id: 'ruins-mid',
    type: 'ruins',
    position: new THREE.Vector2(-46, 24),
    scale: 1.2
  },
  {
    id: 'windmill-far',
    type: 'windmill',
    position: new THREE.Vector2(74, 62),
    scale: 1.55
  }
];

// Use the idle FBX as the single loaded player rig/model source.
const playerPath = animPaths.idle;

function getTerrainHeightAt(x, z) {
  const rolling = Math.sin(x * 0.07) * Math.cos(z * 0.05) * 0.12;
  const patchNoise = Math.sin((x + z) * 0.18) * 0.04;
  return rolling + patchNoise;
}

function updatePlayerRimLight() {
  if (!player) return;

  const viewOffset = new THREE.Vector3().subVectors(camera.position, player.position);
  viewOffset.y = Math.max(1.8, Math.abs(viewOffset.y) + 0.8);

  if (viewOffset.lengthSq() < 0.001) {
    viewOffset.set(0, 2.2, 4);
  } else {
    viewOffset.normalize();
    viewOffset.multiplyScalar(7.5);
  }

  playerRimLight.position.copy(player.position).sub(viewOffset);
  playerRimLight.position.y += 3.1;
  playerRimLight.target.position.copy(player.position);
  playerRimLight.target.position.y += 1.1;
}

function updateTerrainChunkVisibility() {
  const referencePosition = player ? player.position : camera.position;

  if (!Number.isFinite(referencePosition.x) || !Number.isFinite(referencePosition.z)) {
    console.warn('[boot-debug] updateTerrainChunkVisibility: non-finite reference position, forcing chunks visible', {
      x: referencePosition.x,
      z: referencePosition.z
    });
    terrainChunks.forEach((chunk) => {
      chunk.floor.visible = true;
      chunk.contourOverlay.visible = true;
    });
    return;
  }

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
  object3d.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object3d);
  if (box.isEmpty()) {
    console.warn('[boot-debug] normalizePlayerScaleAndGround: empty bounds, skipping normalization');
    return false;
  }

  const size = new THREE.Vector3();
  box.getSize(size);

  if (!Number.isFinite(size.y) || size.y <= 0.0001) {
    console.warn('[boot-debug] normalizePlayerScaleAndGround: invalid size.y, skipping normalization', size.y);
    return false;
  }

  const scale = targetHeight / size.y;
  if (!Number.isFinite(scale) || scale < 0.005 || scale > 50) {
    console.warn('[boot-debug] normalizePlayerScaleAndGround: suspicious scale, skipping normalization', {
      sizeY: size.y,
      scale
    });
    return false;
  }

  console.log('[boot-debug] normalizePlayerScaleAndGround: applying', {
    sizeY: Number(size.y.toFixed(4)),
    scale: Number(scale.toFixed(4))
  });

  object3d.scale.multiplyScalar(scale);
  object3d.updateMatrixWorld(true);

  // Recompute and set feet on y=0.
  box.setFromObject(object3d);
  if (!Number.isFinite(box.min.y)) {
    console.warn('[boot-debug] normalizePlayerScaleAndGround: invalid min.y after scaling, skipping ground snap');
    return false;
  }

  object3d.position.y -= box.min.y;
  object3d.updateMatrixWorld(true);

  const stabilizedBox = new THREE.Box3().setFromObject(object3d);
  const stabilizedSize = new THREE.Vector3();
  stabilizedBox.getSize(stabilizedSize);
  console.log('[boot-debug] normalizePlayerScaleAndGround: result', {
    minY: Number(stabilizedBox.min.y.toFixed(4)),
    maxY: Number(stabilizedBox.max.y.toFixed(4)),
    sizeY: Number(stabilizedSize.y.toFixed(4))
  });

  return true;
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
  const startedAt = performance.now();
  loadDebugState.fbxInFlight += 1;
  loadDebugState.peakFbxInFlight = Math.max(loadDebugState.peakFbxInFlight, loadDebugState.fbxInFlight);
  console.log(`[boot-debug] FBX load start: ${path} | inFlight fbx=${loadDebugState.fbxInFlight} gltf=${loadDebugState.gltfInFlight}`);

  try {
    let lastProgressBucket = -1;
    const result = await new Promise((resolve, reject) => {
      loader.load(
        path,
        resolve,
        (event) => {
          if (!event || !Number.isFinite(event.total) || event.total <= 0) return;
          const ratio = event.loaded / event.total;
          const bucket = Math.min(10, Math.max(0, Math.floor(ratio * 10)));
          if (bucket !== lastProgressBucket) {
            lastProgressBucket = bucket;
            console.log(`[boot-debug] FBX progress ${path}: ${Math.round(ratio * 100)}% (${event.loaded}/${event.total})`);
          }
        },
        reject
      );
    });
    const elapsed = Math.round(performance.now() - startedAt);
    console.log(`[boot-debug] FBX load done: ${path} (${elapsed}ms)`);
    return result;
  } catch (error) {
    const elapsed = Math.round(performance.now() - startedAt);
    console.error(`[boot-debug] FBX load failed: ${path} (${elapsed}ms)`, error);
    throw error;
  } finally {
    loadDebugState.fbxInFlight = Math.max(0, loadDebugState.fbxInFlight - 1);
    console.log(`[boot-debug] FBX load settled: ${path} | inFlight fbx=${loadDebugState.fbxInFlight} gltf=${loadDebugState.gltfInFlight}`);
  }
}

async function loadGLTF(path) {
  const startedAt = performance.now();
  loadDebugState.gltfInFlight += 1;
  loadDebugState.peakGltfInFlight = Math.max(loadDebugState.peakGltfInFlight, loadDebugState.gltfInFlight);
  console.log(`[boot-debug] GLTF load start: ${path} | inFlight fbx=${loadDebugState.fbxInFlight} gltf=${loadDebugState.gltfInFlight}`);

  try {
    const result = await new Promise((resolve, reject) => {
      gltfLoader.load(path, resolve, undefined, reject);
    });
    const elapsed = Math.round(performance.now() - startedAt);
    console.log(`[boot-debug] GLTF load done: ${path} (${elapsed}ms)`);
    return result;
  } catch (error) {
    const elapsed = Math.round(performance.now() - startedAt);
    console.error(`[boot-debug] GLTF load failed: ${path} (${elapsed}ms)`, error);
    throw error;
  } finally {
    loadDebugState.gltfInFlight = Math.max(0, loadDebugState.gltfInFlight - 1);
    console.log(`[boot-debug] GLTF load settled: ${path} | inFlight fbx=${loadDebugState.fbxInFlight} gltf=${loadDebugState.gltfInFlight}`);
  }
}

function applyWarmRimAccent(material) {
  if (!material || material.userData?.rimAccentApplied) return material;

  const patched = material.clone();
  patched.userData = { ...patched.userData, rimAccentApplied: true };

  patched.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: new THREE.Color(TWILIGHT5.blush) };
    shader.uniforms.rimStrength = { value: 0.16 };

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      float rim = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 2.6);
      gl_FragColor.rgb += rimColor * rim * rimStrength;
      #include <dithering_fragment>
      `
    );
  };

  patched.needsUpdate = true;
  return patched;
}

async function loadCharacterAndAnimations() {
  let loadedPlayer = null;

  try {
    console.log('[boot-debug] loadCharacterAndAnimations: start');
    // Load character once.
    loadedPlayer = await loadFBX(playerPath);
    console.log('[boot-debug] player FBX loaded');
    loadedPlayer.position.set(0, 0, 0);
    loadedPlayer.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const normalizedOk = normalizePlayerScaleAndGround(loadedPlayer);
    if (!normalizedOk) {
      throw new Error('Player bounds invalid after FBX load; aborting rig setup for safe fallback.');
    }

    player = loadedPlayer;
    scene.add(player);

    console.log(`[boot-debug] player normalized | pos=${formatVec3Debug(player.position)} scale=${formatVec3Debug(player.scale)}`);

    mixer = new THREE.AnimationMixer(player);

    const idleClip = inferAnimationClip(player);
    if (!idleClip) {
      throw new Error('Idle animation clip missing from player FBX.');
    }

    actions.idle = mixer.clipAction(idleClip);
    actions.idle.setLoop(THREE.LoopRepeat);
    setAction('idle', 0.01);

    // Optional movement clips are loaded later after world staging settles.

    // Reframe camera once character bounds are known.
    const box = new THREE.Box3().setFromObject(player);
    const center = new THREE.Vector3();
    if (!box.isEmpty()) {
      box.getCenter(center);
      if (Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z)) {
        controls.target.copy(center);
        camera.position.set(center.x + 3.2, center.y + 2.2, center.z + 5.8);
      } else {
        console.warn('[boot-debug] camera reframe skipped due to non-finite center', center);
      }
    } else {
      console.warn('[boot-debug] camera reframe skipped due to empty player bounds');
    }

    markBootStage('characterReady', `sceneChildren=${scene.children.length}`);
  } catch (error) {
    console.error('Failed to load model/animations from ./3d_models/boy:', error);

    if (loadedPlayer?.parent) {
      loadedPlayer.parent.remove(loadedPlayer);
      console.warn('[boot-debug] removed invalid player rig from scene before fallback');
    }

    player = null;
    mixer = null;

    // Visual fallback so the scene still works while assets are being added.
    player = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 1.2, 5, 12),
      new THREE.MeshStandardMaterial({ color: 0x3678d6, roughness: 0.7 })
    );
    player.position.set(0, 1, 0);
    player.castShadow = true;
    scene.add(player);

    markBootStage('characterReady', 'fallback-capsule');
  }
}

async function loadDeferredMovementAnimations() {
  if (!mixer || !player) {
    console.warn('[boot-debug] loadDeferredMovementAnimations skipped: player or mixer not ready');
    return;
  }

  const startedAt = performance.now();
  console.log('[boot-debug] deferred movement clip load: start');

  try {
    const [walkFbx, jumpFbx] = await Promise.all([loadFBX(animPaths.walk), loadFBX(animPaths.jump)]);
    const walkClip = inferAnimationClip(walkFbx);
    const jumpClip = inferAnimationClip(jumpFbx);

    if (!walkClip || !jumpClip) {
      console.warn('[boot-debug] walk/jump clips missing; movement animation disabled');
      return;
    }

    actions.walk = mixer.clipAction(walkClip);
    actions.jump = mixer.clipAction(jumpClip);
    actions.walk.setLoop(THREE.LoopRepeat);
    actions.jump.setLoop(THREE.LoopOnce, 1);
    actions.jump.clampWhenFinished = true;

    const elapsed = Math.round(performance.now() - startedAt);
    console.log(`[boot-debug] deferred movement clip load: complete (${elapsed}ms)`);
  } catch (error) {
    const elapsed = Math.round(performance.now() - startedAt);
    console.warn(`[boot-debug] deferred movement clip load: failed (${elapsed}ms); continuing with idle-only animation`, error);
  }
}

function createLandmarkTower(scale, materials) {
  const group = new THREE.Group();

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.35, 8.5, 8), materials.stone);
  shaft.position.y = 4.25;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);

  const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.1, 10), materials.accent);
  crown.position.y = 8.85;
  crown.castShadow = true;
  crown.receiveShadow = true;
  group.add(crown);

  group.scale.setScalar(scale);
  return group;
}

function createLandmarkRuins(scale, materials) {
  const group = new THREE.Group();
  const blocks = [
    { x: -2.4, z: -1.1, h: 2.8, w: 1.3, d: 1.1 },
    { x: -0.7, z: 0.9, h: 3.4, w: 1.1, d: 1.2 },
    { x: 1.5, z: -0.4, h: 2.4, w: 1.4, d: 1.05 },
    { x: 2.8, z: 1.3, h: 3.1, w: 1.2, d: 1.25 }
  ];

  blocks.forEach((block, index) => {
    const piece = new THREE.Mesh(new THREE.BoxGeometry(block.w, block.h, block.d), index % 2 === 0 ? materials.stone : materials.accent);
    piece.position.set(block.x, block.h * 0.5, block.z);
    piece.rotation.y = 0.1 * index;
    piece.castShadow = true;
    piece.receiveShadow = true;
    group.add(piece);
  });

  const arch = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.55, 1), materials.stone);
  arch.position.set(0.35, 3.65, 0.35);
  arch.rotation.y = 0.12;
  arch.castShadow = true;
  arch.receiveShadow = true;
  group.add(arch);

  group.scale.setScalar(scale);
  return group;
}

function createLandmarkWindmillFallback(scale, materials) {
  const group = new THREE.Group();

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.85, 6.5, 10), materials.stone);
  base.position.y = 3.25;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 12), materials.accent);
  hub.rotation.z = Math.PI * 0.5;
  hub.position.set(0, 6.2, 0.5);
  hub.castShadow = true;
  hub.receiveShadow = true;
  group.add(hub);

  for (let i = 0; i < 4; i += 1) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.4, 0.08), materials.accent);
    blade.position.set(0, 6.2, 0.5);
    blade.rotation.z = (Math.PI * 0.5 * i) + Math.PI * 0.15;
    blade.castShadow = true;
    blade.receiveShadow = true;
    group.add(blade);
  }

  group.scale.setScalar(scale);
  return group;
}

async function loadGLTFEntriesConcurrent(entries, label) {
  const settled = await Promise.all(
    entries.map(async ([type, path]) => {
      const startedAt = performance.now();
      console.log(`[boot-debug] ${label} asset queued: ${type} (${path})`);

      try {
        const gltf = await loadGLTF(path);
        const elapsed = Math.round(performance.now() - startedAt);
        console.log(`[boot-debug] ${label} asset complete: ${type} (${elapsed}ms)`);
        return [type, gltf];
      } catch (error) {
        const elapsed = Math.round(performance.now() - startedAt);
        console.warn(`[boot-debug] ${label} asset failed: ${type} (${elapsed}ms)`, error);
        return [type, null];
      }
    })
  );

  return Object.fromEntries(settled);
}

async function loadLandmarkAssets() {
  const rawAssets = await loadGLTFEntriesConcurrent(Object.entries(landmarkAssetPaths), 'landmark');
  const normalized = {};

  Object.entries(rawAssets).forEach(([type, gltf]) => {
    normalized[type] = gltf?.scene || null;
  });

  return normalized;
}

async function createLandmarks() {
  console.log('[boot-debug] createLandmarks: start');
  const stoneMaterial = applyWarmRimAccent(new THREE.MeshStandardMaterial({ color: TWILIGHT5.slateBlue, roughness: 0.91, metalness: 0.03 }));
  const accentMaterial = applyWarmRimAccent(new THREE.MeshStandardMaterial({ color: TWILIGHT5.rose, roughness: 0.74, metalness: 0.08 }));
  const materials = { stone: stoneMaterial, accent: accentMaterial };
  const landmarkAssets = await loadLandmarkAssets();

  landmarkLayout.forEach((landmark, index) => {
    let mesh;
    const importedAsset = landmarkAssets[landmark.type];

    if (importedAsset) {
      mesh = importedAsset.clone(true);
      mesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (Array.isArray(child.material)) {
            child.material = child.material.map((material) => applyWarmRimAccent(material));
          } else {
            child.material = applyWarmRimAccent(child.material);
          }
        }
      });
    } else if (landmark.type === 'tower') {
      mesh = createLandmarkTower(landmark.scale, materials);
    } else if (landmark.type === 'ruins') {
      mesh = createLandmarkRuins(landmark.scale, materials);
    } else {
      mesh = createLandmarkWindmillFallback(landmark.scale, materials);
    }

    const x = landmark.position.x;
    const z = landmark.position.y;
    const y = getTerrainHeightAt(x, z);

    mesh.scale.multiplyScalar(landmark.scale);
    mesh.position.set(x, y, z);
    mesh.rotation.y = 0.25 + index * 0.9;
    mesh.name = landmark.id;
    scene.add(mesh);
  });

  markBootStage('landmarksReady', `sceneChildren=${scene.children.length}`);
}

async function createSetDressing() {
  console.log('[boot-debug] createSetDressing: start');
  const propAnchors = [
    { x: -6.5, z: -4.2, scale: 1.2 },
    { x: 7.4, z: 4.6, scale: 0.9 },
    { x: -9.2, z: 6.8, scale: 1.05 }
  ];

  const foregroundTreeClusters = [
    { x: -11.5, z: -9.4, scale: 1.32, rotation: 0.35 },
    { x: 10.9, z: -8.7, scale: 1.22, rotation: -0.6 }
  ];

  const foregroundRockCluster = { x: -2.4, z: -11.4, scale: 1.15, rotation: 0.22 };
  const ruinAccentAnchors = [
    { x: -24, z: 11, scale: 1.05, rotation: 0.4, type: 'damagedGrave' },
    { x: -35, z: 19, scale: 1.2, rotation: -0.2, type: 'brokenFencePillar' },
    { x: 33, z: 24, scale: 0.95, rotation: 0.1, type: 'damagedGrave' },
    { x: 58, z: 46, scale: 1.15, rotation: -0.55, type: 'brokenFencePillar' }
  ];

  try {
    const stagedGlbAssets = await loadGLTFEntriesConcurrent(
      [
        ['tree', natureKitPaths.tree],
        ['rock', natureKitPaths.rock],
        ['logStack', natureKitPaths.logStack],
        ['damagedGrave', ruinAccentAssetPaths.damagedGrave],
        ['brokenFencePillar', ruinAccentAssetPaths.brokenFencePillar]
      ],
      'set-dressing'
    );

    const treeGltf = stagedGlbAssets.tree;
    const rockGltf = stagedGlbAssets.rock;
    const logStackGltf = stagedGlbAssets.logStack;
    const damagedGraveGltf = stagedGlbAssets.damagedGrave;
    const brokenFencePillarGltf = stagedGlbAssets.brokenFencePillar;

    if (!treeGltf || !rockGltf || !logStackGltf) {
      throw new Error('Critical Nature Kit assets missing for set dressing.');
    }

    const placeNatureProp = (source, { x, z, scale, rotation = 0 }) => {
      const mesh = source.scene.clone(true);
      mesh.position.set(x, getTerrainHeightAt(x, z), z);
      mesh.scale.setScalar(scale);
      mesh.rotation.y = rotation;
      mesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(mesh);
    };

    propAnchors.forEach((anchor, index) => {
      placeNatureProp(treeGltf, {
        x: anchor.x,
        z: anchor.z,
        scale: anchor.scale * 1.45,
        rotation: 0.6 + index * 0.9
      });

      placeNatureProp(rockGltf, {
        x: anchor.x + 1.1,
        z: anchor.z + 0.4,
        scale: anchor.scale * 0.9,
        rotation: index * 0.8
      });

      placeNatureProp(logStackGltf, {
        x: anchor.x - 0.95,
        z: anchor.z + 0.2,
        scale: anchor.scale * 0.95,
        rotation: -0.3 + index * 0.45
      });
    });

    // Foreground framing pass near spawn: two tree clusters + one low rock cluster.
    foregroundTreeClusters.forEach((cluster) => {
      placeNatureProp(treeGltf, cluster);
      placeNatureProp(rockGltf, {
        x: cluster.x + Math.sign(cluster.x) * -1.15,
        z: cluster.z + 0.8,
        scale: cluster.scale * 0.62,
        rotation: cluster.rotation * -0.8
      });
    });

    placeNatureProp(rockGltf, foregroundRockCluster);

    const ruinAccentSources = {
      damagedGrave: damagedGraveGltf,
      brokenFencePillar: brokenFencePillarGltf
    };

    ruinAccentAnchors.forEach((anchor) => {
      const source = ruinAccentSources[anchor.type];
      if (!source) return;
      placeNatureProp(source, anchor);
    });
  } catch (error) {
    console.warn('Nature Kit/ruin props failed to load, using primitive fallback:', error);

    const fallbackMaterial = new THREE.MeshStandardMaterial({ color: 0x8b7b67, roughness: 0.85, metalness: 0.02 });
    const placeFallback = ({ x, z, scale, rotation = 0 }) => {
      const fallback = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 1.1, 6), fallbackMaterial);
      fallback.position.set(x, getTerrainHeightAt(x, z) + 0.55, z);
      fallback.scale.setScalar(scale);
      fallback.rotation.y = rotation;
      fallback.castShadow = true;
      fallback.receiveShadow = true;
      scene.add(fallback);
    };

    propAnchors.forEach((anchor, index) => {
      placeFallback({ x: anchor.x, z: anchor.z, scale: anchor.scale, rotation: index * 0.7 });
    });

    foregroundTreeClusters.forEach((cluster) => {
      placeFallback(cluster);
    });
    placeFallback(foregroundRockCluster);

    ruinAccentAnchors.forEach((anchor) => {
      placeFallback({ ...anchor, scale: anchor.scale * 0.7 });
    });
  }

  markBootStage('setDressingReady', `sceneChildren=${scene.children.length}`);
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

  chunkHud.el = document.createElement('div');
  chunkHud.el.id = 'chunk-hud';
  document.body.appendChild(chunkHud.el);
  updateChunkHud();
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

function formatPlayerChunkIndex(position) {
  const chunkIndex = terrainChunks.findIndex((chunk) => {
    const withinX = Math.abs(position.x - chunk.center.x) <= halfChunk;
    const withinZ = Math.abs(position.z - chunk.center.y) <= halfChunk;
    return withinX && withinZ;
  });

  if (chunkIndex === -1) return 'out-of-grid';

  const chunk = terrainChunks[chunkIndex];
  const gridX = chunk.center.x < 0 ? 0 : 1;
  const gridZ = chunk.center.y < 0 ? 0 : 1;
  return `${chunkIndex} (x:${gridX}, z:${gridZ})`;
}

function updateChunkHud() {
  if (!chunkHud.el) return;

  const activeChunks = terrainChunks.reduce((count, chunk) => count + (chunk.floor.visible ? 1 : 0), 0);
  const referencePosition = player ? player.position : camera.position;
  const playerChunk = formatPlayerChunkIndex(referencePosition);
  chunkHud.el.textContent = `Chunks: ${activeChunks}/${terrainChunks.length} · Player chunk: ${playerChunk}`;
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

let renderLoopStarted = false;
let renderExceptionCount = 0;

function render() {
  try {
    const delta = clock.getDelta();
    const scaledDelta = delta * timeScale;
    if (mixer) mixer.update(scaledDelta);
    updatePlayer(scaledDelta);
    updatePlayerRimLight();
    updateTerrainChunkVisibility();
    terrainBlendMaterials.forEach((material) => {
      material.userData?.groundBlendShader?.uniforms?.uGroundCameraPos?.value.copy(camera.position);
    });
    updateChunkHud();
    controls.update();
    renderer.render(scene, camera);

    if (!bootStages.firstFrameRendered) {
      markBootStage(
        'firstFrameRendered',
        `children=${scene.children.length} camera=${formatVec3Debug(camera.position)} target=${formatVec3Debug(controls.target)} player=${formatVec3Debug(player?.position)}`
      );
    }

    if (bootStages.characterReady && !bootStages.firstFrameWithCharacterRendered) {
      markBootStage(
        'firstFrameWithCharacterRendered',
        `children=${scene.children.length} camera=${formatVec3Debug(camera.position)} target=${formatVec3Debug(controls.target)} player=${formatVec3Debug(player?.position)}`
      );

      if (!bootStages.setDressingReady || !bootStages.landmarksReady) {
        console.log(
          `[boot-debug] character frame rendered before world dressing settled | setDressingReady=${bootStages.setDressingReady} landmarksReady=${bootStages.landmarksReady}`
        );
      }
    }

    maybeHideBootOverlayAfterFirstRenderableFrame();
  } catch (error) {
    renderExceptionCount += 1;
    console.error('[boot-debug] render frame exception', {
      count: renderExceptionCount,
      error,
      player: formatVec3Debug(player?.position),
      camera: formatVec3Debug(camera?.position),
      stages: { ...bootStages }
    });
  }

  requestAnimationFrame(render);
}

function ensureRenderLoopStarted(reason = 'unknown') {
  if (renderLoopStarted) {
    console.log(`[boot-debug] render loop already started (${reason})`);
    return;
  }

  renderLoopStarted = true;
  console.log(`[boot-debug] starting render loop (${reason})`);
  render();
  markBootStage('renderStarted', `${reason} | camera=${formatVec3Debug(camera.position)} target=${formatVec3Debug(controls.target)} player=${formatVec3Debug(player?.position)}`);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

(async () => {
  const bootStartedAt = performance.now();

  try {
    createInteractable();
    markBootStage('coreUiReady', 'HUD + interactable created');

    // Start rendering immediately so world/terrain still appears even if character load is slow.
    ensureRenderLoopStarted('post-core-ui');

    console.log('[boot-debug] init chain: prioritize world lane before player lane to avoid FBX decode contention starving world staging');

    setBootLoadingStatus('Loading world dressing…');

    const stageFactories = [
      { name: 'createSetDressing', run: createSetDressing },
      { name: 'createLandmarks', run: createLandmarks }
    ];

    const worldStartedAt = performance.now();
    const worldResults = [];
    for (const { name, run } of stageFactories) {
      const startedAt = performance.now();
      console.log(`[boot-debug] ${name}: queued (sequential world lane) | inFlight before run fbx=${loadDebugState.fbxInFlight} gltf=${loadDebugState.gltfInFlight}`);
      try {
        await run();
        const elapsed = Math.round(performance.now() - startedAt);
        console.log(`[boot-debug] ${name}: complete (${elapsed}ms) | inFlight after run fbx=${loadDebugState.fbxInFlight} gltf=${loadDebugState.gltfInFlight}`);
        worldResults.push({ name, status: 'fulfilled' });
      } catch (error) {
        const elapsed = Math.round(performance.now() - startedAt);
        console.error(`[boot-debug] ${name}: failed (${elapsed}ms)`, error);
        worldResults.push({ name, status: 'rejected', reason: error });
      }
    }

    const worldElapsed = Math.round(performance.now() - worldStartedAt);
    console.log(`[boot-debug] world lane: settled (${worldElapsed}ms)`);

    const failedWorldStages = worldResults.filter((result) => result.status === 'rejected');
    if (failedWorldStages.length > 0) {
      console.warn('[boot-debug] world stages settled with failures', failedWorldStages.map((result) => result.name));
    }

    setBootLoadingStatus('Loading player rig…');
    const characterStartedAt = performance.now();
    console.log('[boot-debug] character lane: queued after world lane settled');
    await loadCharacterAndAnimations();
    console.log(`[boot-debug] character lane: settled (${Math.round(performance.now() - characterStartedAt)}ms) | inFlight now fbx=${loadDebugState.fbxInFlight} gltf=${loadDebugState.gltfInFlight}`);

    setBootLoadingStatus('Loading movement clips…');
    await loadDeferredMovementAnimations();

    const elapsed = Math.round(performance.now() - bootStartedAt);
    console.log(
      `[boot-debug] boot sequence settled in ${elapsed}ms | stages=${JSON.stringify(bootStages)} | peakInFlight fbx=${loadDebugState.peakFbxInFlight} gltf=${loadDebugState.peakGltfInFlight}`
    );
    window.__BOOT_DEBUG__ = {
      ...(window.__BOOT_DEBUG__ || {}),
      peakInFlight: {
        fbx: loadDebugState.peakFbxInFlight,
        gltf: loadDebugState.peakGltfInFlight
      }
    };
  } catch (error) {
    console.error('[boot] failed to initialize world core:', error);
    hideBootLoadingOverlay('error');
  }
})();
