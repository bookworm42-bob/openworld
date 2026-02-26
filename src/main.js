import './style.css';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AgentBridgeClient } from './agentBridge/client.js';
import { buildObservation } from './agentBridge/perception.js';
import { captureFrame } from './agentBridge/capture.js';
import { StaticWorldColliders, resolvePlayerCylinderMotion } from './collision.js';
import idleFbxUrl from '../3d_models/boy/SadIdle.fbx?url';
import walkFbxUrl from '../3d_models/boy/Walking.fbx?url';
import jumpFbxUrl from '../3d_models/boy/Jumping.fbx?url';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
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

const DAYLIGHT5 = {
  sunWarm: 0xfff1cc,
  skyBlue: 0x87bff5,
  skyHaze: 0xcfe4ff,
  meadow: 0x6f8f63,
  meadowShade: 0x4e6a4a,
  stone: 0x8f9d8e,
  clay: 0xc68864
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7ddff);
scene.fog = new THREE.Fog(0xe7f3ff, 75, 320);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 4, 9);
const cameraLookTarget = new THREE.Vector3(0, 1.2, 0);
const cameraFollowOffset = new THREE.Vector3();
const cameraFollowDesiredPos = new THREE.Vector3();
const cameraFollowDesiredLook = new THREE.Vector3();
const playerForward = new THREE.Vector3();
const playerMoveDirection = new THREE.Vector3();
const playerTargetQuat = new THREE.Quaternion();
const playerFacingBasis = new THREE.Matrix4();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3(0, 0, 0);
const playerTurnQuat = new THREE.Quaternion();
const lastMoveHeading = new THREE.Vector3(0, 0, -1);
const objectiveToTargetVec = new THREE.Vector3();
const objectiveFlatForward = new THREE.Vector3();
const objectiveFlatToTarget = new THREE.Vector3();
let cameraFollowInitialized = false;
const PLAYER_TURN_SPEED = 1.8;
const PLAYER_VISUAL_YAW_OFFSET = Math.PI;
const PLAYER_FACING_OFFSET_QUAT = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, PLAYER_VISUAL_YAW_OFFSET);

const CAMERA_FOLLOW = {
  distance: 6.4,
  height: 2.8,
  lookHeight: 1.35,
  positionSharpness: 7.2,
  lookSharpness: 10.0
};

renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.7;

scene.add(new THREE.AmbientLight(0xffffff, 0.85));
scene.add(new THREE.HemisphereLight(0xf0f8ff, 0xa4c189, 1.6));
const dirLight = new THREE.DirectionalLight(0xfff6dd, 2.9);
dirLight.position.set(14, 22, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.normalBias = 0.02;
dirLight.shadow.bias = -0.00005;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xf5faff, 1.1);
fillLight.position.set(-13, 14, -12);
scene.add(fillLight);

// Soft player-focused fill/rim helper to keep silhouette readable while moving.
const playerRimLight = new THREE.DirectionalLight(0xffe2be, 0.35);
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
    baseHex: 0x78ae62,
    accentHex: 0xa4d685,
    grainHex: 0x608f50,
    seed: 2.2
  }),
  dirt: createGroundTexturePalette({
    baseHex: 0x987753,
    accentHex: 0xc19768,
    grainHex: 0x7b5f42,
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
      vec3 distanceTint = mix(vec3(1.16, 1.14, 1.08), vec3(1.02, 1.03, 1.05), distFade);
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
  const lowColor = new THREE.Color(0x6c915c);
  const highColor = new THREE.Color(0x89b872);
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
      color: DAYLIGHT5.clay,
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
  KeyW: false,
  ArrowLeft: false,
  KeyA: false,
  ArrowRight: false,
  KeyD: false,
  Space: false,
  ShiftLeft: false,
  ShiftRight: false,
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

const BEACON_LAYOUT = [
  { id: 'beacon_1', label: 'Beacon I', position: new THREE.Vector2(5.5, -4.2) },
  { id: 'beacon_2', label: 'Beacon II', position: new THREE.Vector2(25, -15.2) },
  { id: 'beacon_3', label: 'Beacon III', position: new THREE.Vector2(60, 28) }
];

const OBJECTIVE_APPROACH = {
  farRadius: 7.2,
  nearRadius: 4.6,
  lockRadius: 2.55,
  lockBearingRad: 0.32,
  attuneRadius: 2.45,
  attuneBearingRad: 0.22,
  lockStableMsRequired: 320,
  slowDownStartRadius: 5.5
};

const pilgrimageQuest = {
  questId: 'beacon_pilgrimage',
  phase: 'intro',
  activeObjectiveId: null,
  completedObjectiveIds: [],
  progress: 0,
  radius: 2.8,
  beacons: [],
  promptEl: null,
  statusEl: null,
  objectiveHudEl: null,
  lockHudEl: null,
  nextCueEl: null,
  completionBannerEl: null,
  completionBannerTimer: null,
  recentEvents: []
};

const objectiveApproachRuntime = {
  phase: 'far',
  lockStableMs: 0,
  canAttune: false,
  activeBeaconDist: null,
  activeBeaconBearing: null,
  lockAcquiredAtMs: 0,
  lastPhase: 'far',
  lastObjectiveId: null,
  attuneStartedAtMs: 0,
  cueBeaconId: null,
  cueUntilMs: 0
};

const modeHud = {
  el: null
};

const chunkHud = {
  el: null
};

const bridgeVelocity = new THREE.Vector3();
const bridgeLastPlayerPos = new THREE.Vector3();
const bridgeLatestPerceivedIds = new Set();
const bridgePerceivableRoots = [];
const bridgeOccluders = [];
const bridgeEvents = [];
let bridgeObsTick = 0;
let bridgeStuckCounter = 0;

const playerCollider = {
  radius: 0.42,
  height: 1.75
};

const worldColliders = new StaticWorldColliders({ cellSize: 6 });
let staticColliderSeq = 0;

const collisionRuntime = {
  blocked: false,
  blockedSinceMs: 0,
  blockedForMs: 0,
  frontPressure: 0,
  recentCollision: null,
  recoveryNoted: false,
  lastCollisionEventAtMs: 0
};

function clampAxis(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return THREE.MathUtils.clamp(n, -1, 1);
}

function enqueueBridgeEvent(type, extra = {}) {
  bridgeEvents.push({
    type,
    at: Number(clock.elapsedTime.toFixed(3)),
    ...extra
  });
  if (bridgeEvents.length > 12) bridgeEvents.shift();
}

function nextColliderId(prefix = 'solid') {
  staticColliderSeq += 1;
  return `${prefix}_${String(staticColliderSeq).padStart(3, '0')}`;
}

function registerStaticColliderForObject(object, {
  colliderId,
  colliderTag,
  radiusScale = 0.5,
  radiusPadding = 0.12,
  minRadius = 0.45,
  maxRadius = 9
} = {}) {
  if (!object) return null;

  const id = colliderId
    || object.userData?.agentId
    || object.name
    || nextColliderId(colliderTag || object.userData?.agentTag || 'solid');

  const tag = colliderTag || object.userData?.agentTag || 'solid';

  const collider = worldColliders.registerFromObject({
    object,
    id,
    tag,
    radiusScale,
    radiusPadding,
    minRadius,
    maxRadius
  });

  if (!collider) return null;

  object.userData = {
    ...object.userData,
    colliderId: collider.id,
    colliderTag: collider.tag
  };

  return collider;
}

function recomputeBridgePerceptionSets() {
  bridgePerceivableRoots.length = 0;
  bridgeOccluders.length = 0;
  scene.traverseVisible((object) => {
    if (object.isMesh) bridgeOccluders.push(object);
    if (object.userData?.agentPerceivable) bridgePerceivableRoots.push(object);
  });
}

async function onBridgeCaptureRequest(request) {
  if (!player) {
    return { type: 'CAPTURED', cam: request.cam || 'follow', imgB64: '' };
  }
  return captureFrame({
    request,
    renderer,
    scene,
    camera,
    player,
    heading: lastMoveHeading,
    nowSeconds: clock.elapsedTime
  });
}

async function onBridgeEditRequest(request) {
  return {
    type: 'EDITED',
    op: request.op || 'UNKNOWN',
    result: 'unsupported'
  };
}

const agentBridge = new AgentBridgeClient({
  onCapture: onBridgeCaptureRequest,
  onEdit: onBridgeEditRequest
});

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

function snapPlayerFacingToHeading(heading) {
  if (!player || heading.lengthSq() < 0.0001) return;

  playerFacingBasis.lookAt(ORIGIN, heading, WORLD_UP);
  playerTargetQuat.setFromRotationMatrix(playerFacingBasis);
  playerTargetQuat.multiply(PLAYER_FACING_OFFSET_QUAT);
  player.quaternion.copy(playerTargetQuat);
}

function updateFollowCamera(delta, forceSnap = false) {
  if (!player) return;

  if (lastMoveHeading.lengthSq() > 0.0001) {
    playerForward.copy(lastMoveHeading).normalize();
  } else {
    playerForward.set(0, 0, -1).applyQuaternion(player.quaternion);
    playerForward.y = 0;
    if (playerForward.lengthSq() < 0.0001) {
      playerForward.set(0, 0, -1);
    } else {
      playerForward.normalize();
    }
  }

  cameraFollowOffset.copy(playerForward).multiplyScalar(-CAMERA_FOLLOW.distance);
  cameraFollowOffset.y = CAMERA_FOLLOW.height;

  cameraFollowDesiredPos.copy(player.position).add(cameraFollowOffset);
  cameraFollowDesiredLook.copy(player.position);
  cameraFollowDesiredLook.y += CAMERA_FOLLOW.lookHeight;

  if (forceSnap || !cameraFollowInitialized) {
    camera.position.copy(cameraFollowDesiredPos);
    cameraLookTarget.copy(cameraFollowDesiredLook);
    camera.lookAt(cameraLookTarget);
    cameraFollowInitialized = true;
    return;
  }

  const posLerp = 1 - Math.exp(-CAMERA_FOLLOW.positionSharpness * delta);
  const lookLerp = 1 - Math.exp(-CAMERA_FOLLOW.lookSharpness * delta);

  camera.position.lerp(cameraFollowDesiredPos, posLerp);
  cameraLookTarget.lerp(cameraFollowDesiredLook, lookLerp);
  camera.lookAt(cameraLookTarget);
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

function createInPlaceClip(clip, label = 'clip') {
  if (!clip) return clip;

  const POSITION_SUFFIX = '.position';
  const ROOT_NODE_PATTERN = /(hips|pelvis|root|armature|rootnode|mixamorig)/i;
  let removedTracks = 0;

  const keptTracks = clip.tracks.filter((track) => {
    if (!track.name.endsWith(POSITION_SUFFIX)) return true;
    const nodePath = track.name.slice(0, -POSITION_SUFFIX.length);
    const isRootPositionTrack = ROOT_NODE_PATTERN.test(nodePath);
    if (isRootPositionTrack) removedTracks += 1;
    return !isRootPositionTrack;
  });

  if (removedTracks === 0) return clip;

  const inPlaceClip = clip.clone();
  inPlaceClip.tracks = keptTracks.map((track) => track.clone());
  inPlaceClip.resetDuration();
  inPlaceClip.name = `${clip.name || label}-in-place`;

  console.log(`[boot-debug] createInPlaceClip(${label}): removed ${removedTracks} root-position tracks`);
  return inPlaceClip;
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
    shader.uniforms.rimColor = { value: new THREE.Color(0xffd8a8) };
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
    bridgeLastPlayerPos.copy(player.position);
    snapPlayerFacingToHeading(lastMoveHeading);

    console.log(`[boot-debug] player normalized | pos=${formatVec3Debug(player.position)} scale=${formatVec3Debug(player.scale)}`);

    mixer = new THREE.AnimationMixer(player);

    const idleClip = createInPlaceClip(inferAnimationClip(player), 'idle');
    if (!idleClip) {
      throw new Error('Idle animation clip missing from player FBX.');
    }

    actions.idle = mixer.clipAction(idleClip);
    actions.idle.setLoop(THREE.LoopRepeat);
    setAction('idle', 0.01);

    // Optional movement clips are loaded later after world staging settles.

    // Snap follow camera once character bounds are known.
    const box = new THREE.Box3().setFromObject(player);
    const center = new THREE.Vector3();
    if (!box.isEmpty()) {
      box.getCenter(center);
      if (Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z)) {
        cameraFollowInitialized = false;
        updateFollowCamera(0, true);
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
    bridgeLastPlayerPos.copy(player.position);
    snapPlayerFacingToHeading(lastMoveHeading);

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
    const walkClip = createInPlaceClip(inferAnimationClip(walkFbx), 'walk');
    const jumpClip = createInPlaceClip(inferAnimationClip(jumpFbx), 'jump');

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

async function loadGLTFEntriesSequential(entries, label) {
  const results = [];

  for (const [type, path] of entries) {
    const startedAt = performance.now();
    console.log(`[boot-debug] ${label} asset queued: ${type} (${path})`);

    try {
      const gltf = await loadGLTF(path);
      const elapsed = Math.round(performance.now() - startedAt);
      console.log(`[boot-debug] ${label} asset complete: ${type} (${elapsed}ms)`);
      results.push([type, gltf]);
    } catch (error) {
      const elapsed = Math.round(performance.now() - startedAt);
      console.warn(`[boot-debug] ${label} asset failed: ${type} (${elapsed}ms)`, error);
      results.push([type, null]);
    }
  }

  return Object.fromEntries(results);
}

async function loadLandmarkAssets() {
  const rawAssets = await loadGLTFEntriesSequential(Object.entries(landmarkAssetPaths), 'landmark');
  const normalized = {};

  Object.entries(rawAssets).forEach(([type, gltf]) => {
    normalized[type] = gltf?.scene || null;
  });

  return normalized;
}

async function createLandmarks() {
  console.log('[boot-debug] createLandmarks: start');
  const stoneMaterial = applyWarmRimAccent(new THREE.MeshStandardMaterial({ color: DAYLIGHT5.stone, roughness: 0.91, metalness: 0.03 }));
  const accentMaterial = applyWarmRimAccent(new THREE.MeshStandardMaterial({ color: DAYLIGHT5.clay, roughness: 0.74, metalness: 0.08 }));
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
    mesh.userData.agentPerceivable = true;
    mesh.userData.agentTag = landmark.type;
    mesh.userData.agentId = landmark.id;
    scene.add(mesh);

    registerStaticColliderForObject(mesh, {
      colliderId: landmark.id,
      colliderTag: landmark.type,
      radiusScale: landmark.type === 'ruins' ? 0.58 : 0.5,
      radiusPadding: landmark.type === 'ruins' ? 0.45 : 0.3,
      minRadius: landmark.type === 'ruins' ? 1.9 : 1.3,
      maxRadius: landmark.type === 'ruins' ? 4.8 : 4
    });
  });

  markBootStage('landmarksReady', `sceneChildren=${scene.children.length}`);
}

async function createSetDressing() {
  console.log('[boot-debug] createSetDressing: start');
  let perceivablePropSeq = 0;
  let staticPropSeq = 0;
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
    const stagedGlbAssets = await loadGLTFEntriesSequential(
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

    const placeNatureProp = (source, { x, z, scale, rotation = 0, perceivable = false, agentTag = 'object' }) => {
      const mesh = source.scene.clone(true);
      mesh.position.set(x, getTerrainHeightAt(x, z), z);
      mesh.scale.setScalar(scale);
      mesh.rotation.y = rotation;

      let stableId = `${agentTag}-solid-${String(staticPropSeq).padStart(3, '0')}`;
      staticPropSeq += 1;

      if (perceivable) {
        mesh.userData.agentPerceivable = true;
        mesh.userData.agentTag = agentTag;
        stableId = `${agentTag}-${perceivablePropSeq}`;
        mesh.userData.agentId = stableId;
        perceivablePropSeq += 1;
      }

      mesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(mesh);

      registerStaticColliderForObject(mesh, {
        colliderId: stableId,
        colliderTag: agentTag,
        radiusScale: agentTag === 'tree' ? 0.42 : 0.5,
        radiusPadding: agentTag === 'tree' ? 0.16 : 0.12,
        minRadius: agentTag === 'tree' ? 0.55 : 0.48,
        maxRadius: agentTag === 'tree' ? 1.9 : 1.6
      });
    };

    propAnchors.forEach((anchor, index) => {
      placeNatureProp(treeGltf, {
        x: anchor.x,
        z: anchor.z,
        scale: anchor.scale * 1.45,
        rotation: 0.6 + index * 0.9,
        perceivable: true,
        agentTag: 'tree'
      });

      placeNatureProp(rockGltf, {
        x: anchor.x + 1.1,
        z: anchor.z + 0.4,
        scale: anchor.scale * 0.9,
        rotation: index * 0.8,
        perceivable: true,
        agentTag: 'rock'
      });

      placeNatureProp(logStackGltf, {
        x: anchor.x - 0.95,
        z: anchor.z + 0.2,
        scale: anchor.scale * 0.95,
        rotation: -0.3 + index * 0.45,
        perceivable: true,
        agentTag: 'log'
      });
    });

    // Foreground framing pass near spawn: two tree clusters + one low rock cluster.
    foregroundTreeClusters.forEach((cluster) => {
      placeNatureProp(treeGltf, { ...cluster, perceivable: true, agentTag: 'tree' });
      placeNatureProp(rockGltf, {
        x: cluster.x + Math.sign(cluster.x) * -1.15,
        z: cluster.z + 0.8,
        scale: cluster.scale * 0.62,
        rotation: cluster.rotation * -0.8,
        perceivable: true,
        agentTag: 'rock'
      });
    });

    placeNatureProp(rockGltf, { ...foregroundRockCluster, perceivable: true, agentTag: 'rock' });

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
    const placeFallback = ({ x, z, scale, rotation = 0, perceivable = false, agentTag = 'object' }) => {
      const fallback = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 1.1, 6), fallbackMaterial);
      fallback.position.set(x, getTerrainHeightAt(x, z) + 0.55, z);
      fallback.scale.setScalar(scale);
      fallback.rotation.y = rotation;
      fallback.castShadow = true;
      fallback.receiveShadow = true;

      let stableId = `${agentTag}-solid-${String(staticPropSeq).padStart(3, '0')}`;
      staticPropSeq += 1;
      if (perceivable) {
        fallback.userData.agentPerceivable = true;
        fallback.userData.agentTag = agentTag;
        stableId = `${agentTag}-${perceivablePropSeq}`;
        fallback.userData.agentId = stableId;
        perceivablePropSeq += 1;
      }
      scene.add(fallback);

      registerStaticColliderForObject(fallback, {
        colliderId: stableId,
        colliderTag: agentTag,
        radiusScale: 0.5,
        radiusPadding: 0.1,
        minRadius: 0.45,
        maxRadius: 1.2
      });
    };

    propAnchors.forEach((anchor, index) => {
      placeFallback({ x: anchor.x, z: anchor.z, scale: anchor.scale, rotation: index * 0.7, perceivable: true, agentTag: 'tree' });
    });

    foregroundTreeClusters.forEach((cluster) => {
      placeFallback({ ...cluster, perceivable: true, agentTag: 'tree' });
    });
    placeFallback({ ...foregroundRockCluster, perceivable: true, agentTag: 'rock' });

    ruinAccentAnchors.forEach((anchor) => {
      placeFallback({ ...anchor, scale: anchor.scale * 0.7 });
    });
  }

  markBootStage('setDressingReady', `sceneChildren=${scene.children.length}`);
}

function createBeacon({ id, label, position }) {
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.8, 0.38, 28),
    applyWarmRimAccent(new THREE.MeshStandardMaterial({ color: 0x43546b, roughness: 0.56, metalness: 0.24 }))
  );

  const topRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.08, 12, 36),
    applyWarmRimAccent(new THREE.MeshStandardMaterial({ color: 0x5d7aa1, roughness: 0.35, metalness: 0.48 }))
  );
  topRing.rotation.x = Math.PI / 2;
  topRing.position.y = 0.28;
  base.add(topRing);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 24),
    applyWarmRimAccent(new THREE.MeshStandardMaterial({
      color: 0x84a7d9,
      emissive: 0x274b82,
      emissiveIntensity: 0.55,
      roughness: 0.26,
      metalness: 0.12
    }))
  );
  core.position.y = 0.62;
  core.castShadow = true;
  base.add(core);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.3, 8.8, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x86d4ff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  beam.position.y = 4.8;
  beam.visible = false;
  base.add(beam);

  const lockRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.055, 10, 30),
    new THREE.MeshBasicMaterial({
      color: 0xb8ecff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  lockRing.rotation.x = Math.PI / 2;
  lockRing.position.y = 0.48;
  lockRing.visible = false;
  base.add(lockRing);

  const cueRing = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.16, 44),
    new THREE.MeshBasicMaterial({
      color: 0xa9f6ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  cueRing.rotation.x = -Math.PI / 2;
  cueRing.position.y = 0.07;
  cueRing.visible = false;
  base.add(cueRing);

  const x = position.x;
  const z = position.y;
  const y = getTerrainHeightAt(x, z) + 0.19;
  base.position.set(x, y, z);
  base.receiveShadow = true;
  base.castShadow = true;
  base.userData.agentPerceivable = true;
  base.userData.agentTag = 'beacon';
  base.userData.agentId = id;
  base.userData.beaconLabel = label;
  scene.add(base);

  registerStaticColliderForObject(base, {
    colliderId: id,
    colliderTag: 'beacon',
    radiusScale: 0.56,
    radiusPadding: 0.15,
    minRadius: 0.64,
    maxRadius: 1.12
  });

  return {
    id,
    label,
    mesh: base,
    core,
    beam,
    lockRing,
    cueRing,
    pulseStartAt: 0,
    pulseType: null,
    state: 'inactive',
    baseCoreY: core.position.y
  };
}

function getActiveBeaconGuidance() {
  const activeBeacon = getActiveBeacon();
  if (!player || !activeBeacon?.mesh) return null;

  objectiveToTargetVec.subVectors(activeBeacon.mesh.position, player.position);
  const dist = objectiveToTargetVec.length();

  objectiveFlatForward.copy(lastMoveHeading).setY(0);
  if (objectiveFlatForward.lengthSq() < 0.0001) objectiveFlatForward.set(0, 0, -1);
  else objectiveFlatForward.normalize();

  objectiveFlatToTarget.copy(objectiveToTargetVec).setY(0);
  if (objectiveFlatToTarget.lengthSq() < 0.0001) return null;
  objectiveFlatToTarget.normalize();

  const bearing = Math.atan2(
    objectiveFlatForward.x * objectiveFlatToTarget.z - objectiveFlatForward.z * objectiveFlatToTarget.x,
    objectiveFlatForward.dot(objectiveFlatToTarget)
  );

  return {
    dist,
    bearing,
    beacon: activeBeacon
  };
}

function clearObjectiveCueIfExpired(nowMs = performance.now()) {
  if (objectiveApproachRuntime.cueUntilMs > 0 && nowMs >= objectiveApproachRuntime.cueUntilMs) {
    objectiveApproachRuntime.cueUntilMs = 0;
    objectiveApproachRuntime.cueBeaconId = null;
    if (pilgrimageQuest.nextCueEl) pilgrimageQuest.nextCueEl.classList.remove('show');
  }
}

function triggerNextObjectiveCue(beacon) {
  if (!beacon) return;
  objectiveApproachRuntime.cueBeaconId = beacon.id;
  objectiveApproachRuntime.cueUntilMs = performance.now() + 2400;
  if (pilgrimageQuest.nextCueEl) {
    pilgrimageQuest.nextCueEl.textContent = `${beacon.label} now active`;
    pilgrimageQuest.nextCueEl.classList.add('show');
  }
}

function updateObjectiveSnapshotRuntime(nowMs = performance.now()) {
  clearObjectiveCueIfExpired(nowMs);

  const guidance = getActiveBeaconGuidance();
  if (!guidance) {
    objectiveApproachRuntime.phase = pilgrimageQuest.phase === 'completed' ? 'complete' : 'far';
    objectiveApproachRuntime.lockStableMs = 0;
    objectiveApproachRuntime.canAttune = false;
    objectiveApproachRuntime.activeBeaconDist = null;
    objectiveApproachRuntime.activeBeaconBearing = null;
    return null;
  }

  const dist = guidance.dist;
  const bearing = guidance.bearing;
  objectiveApproachRuntime.activeBeaconDist = dist;
  objectiveApproachRuntime.activeBeaconBearing = bearing;

  let nextPhase = 'far';
  if (dist <= OBJECTIVE_APPROACH.lockRadius) nextPhase = 'lock';
  else if (dist <= OBJECTIVE_APPROACH.nearRadius) nextPhase = 'approach';

  const facingGood = Math.abs(bearing) <= OBJECTIVE_APPROACH.lockBearingRad;
  const inLockWindow = nextPhase === 'lock' && facingGood;

  if (objectiveApproachRuntime.lastObjectiveId !== pilgrimageQuest.activeObjectiveId) {
    objectiveApproachRuntime.lockStableMs = 0;
    objectiveApproachRuntime.lockAcquiredAtMs = 0;
    objectiveApproachRuntime.canAttune = false;
    objectiveApproachRuntime.lastPhase = 'far';
    objectiveApproachRuntime.lastObjectiveId = pilgrimageQuest.activeObjectiveId;
  }

  if (inLockWindow) {
    if (objectiveApproachRuntime.lockAcquiredAtMs <= 0) objectiveApproachRuntime.lockAcquiredAtMs = nowMs;
    objectiveApproachRuntime.lockStableMs = Math.max(0, nowMs - objectiveApproachRuntime.lockAcquiredAtMs);
  } else {
    objectiveApproachRuntime.lockStableMs = 0;
    objectiveApproachRuntime.lockAcquiredAtMs = 0;
  }

  objectiveApproachRuntime.phase = nextPhase;
  objectiveApproachRuntime.canAttune = nextPhase === 'lock'
    && dist <= OBJECTIVE_APPROACH.attuneRadius
    && Math.abs(bearing) <= OBJECTIVE_APPROACH.attuneBearingRad
    && objectiveApproachRuntime.lockStableMs >= OBJECTIVE_APPROACH.lockStableMsRequired;

  return {
    dist,
    bearing,
    inInteractionRange: dist <= pilgrimageQuest.radius,
    inAttuneRadius: dist <= OBJECTIVE_APPROACH.attuneRadius,
    phase: objectiveApproachRuntime.phase,
    lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
    canAttune: objectiveApproachRuntime.canAttune
  };
}

function updateObjectiveLockSignals(nowMs = performance.now()) {
  const activeBeacon = getActiveBeacon();
  const activeId = activeBeacon?.id || null;
  const currentPhase = objectiveApproachRuntime.phase;
  const lockNow = objectiveApproachRuntime.canAttune;

  if (pilgrimageQuest.lockHudEl) {
    if (pilgrimageQuest.phase === 'completed' || !activeId) {
      pilgrimageQuest.lockHudEl.classList.remove('show', 'locked');
      pilgrimageQuest.lockHudEl.textContent = '';
    } else {
      pilgrimageQuest.lockHudEl.classList.add('show');
      if (lockNow) {
        pilgrimageQuest.lockHudEl.classList.add('locked');
        pilgrimageQuest.lockHudEl.textContent = `${activeBeacon.label} lock stable · attune ready`;
      } else if (currentPhase === 'lock') {
        pilgrimageQuest.lockHudEl.classList.remove('locked');
        const pct = Math.round(Math.min(100, (objectiveApproachRuntime.lockStableMs / OBJECTIVE_APPROACH.lockStableMsRequired) * 100));
        pilgrimageQuest.lockHudEl.textContent = `Stabilizing lock… ${pct}%`;
      } else if (currentPhase === 'approach') {
        pilgrimageQuest.lockHudEl.classList.remove('locked');
        pilgrimageQuest.lockHudEl.textContent = `Approach ${activeBeacon.label} and align`;
      } else {
        pilgrimageQuest.lockHudEl.classList.remove('locked');
        pilgrimageQuest.lockHudEl.textContent = `Tracking ${activeBeacon.label}`;
      }
    }
  }

  const prevPhase = objectiveApproachRuntime.lastPhase;
  if (activeId && prevPhase !== 'lock' && currentPhase === 'lock') {
    rememberQuestEvent('objective_lock_acquired', {
      objectiveId: activeId,
      lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
      activeBeaconDist: Number((objectiveApproachRuntime.activeBeaconDist || 0).toFixed(2)),
      activeBeaconBearing: Number((objectiveApproachRuntime.activeBeaconBearing || 0).toFixed(3))
    });
  }

  if (activeId && prevPhase === 'lock' && currentPhase !== 'lock') {
    rememberQuestEvent('objective_lock_lost', {
      objectiveId: activeId,
      phase: currentPhase,
      lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
      activeBeaconDist: Number((objectiveApproachRuntime.activeBeaconDist || 0).toFixed(2)),
      activeBeaconBearing: Number((objectiveApproachRuntime.activeBeaconBearing || 0).toFixed(3))
    });
  }

  objectiveApproachRuntime.lastPhase = currentPhase;
  clearObjectiveCueIfExpired(nowMs);
}

function getObjectiveSnapshot() {
  const guidance = updateObjectiveSnapshotRuntime();

  return {
    questId: pilgrimageQuest.questId,
    phase: pilgrimageQuest.phase,
    activeObjectiveId: pilgrimageQuest.activeObjectiveId,
    completedObjectiveIds: [...pilgrimageQuest.completedObjectiveIds],
    progress: Number(pilgrimageQuest.progress.toFixed(3)),
    guidance: guidance
      ? {
        dist: Number(guidance.dist.toFixed(2)),
        bearing: Number(guidance.bearing.toFixed(3)),
        inInteractionRange: guidance.inInteractionRange,
        inAttuneRadius: guidance.inAttuneRadius,
        approachPhase: guidance.phase,
        lockStableMs: guidance.lockStableMs,
        canAttune: guidance.canAttune
      }
      : null,
    approachPhase: objectiveApproachRuntime.phase,
    lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
    canAttune: Boolean(objectiveApproachRuntime.canAttune),
    activeBeaconDist: Number.isFinite(objectiveApproachRuntime.activeBeaconDist)
      ? Number(objectiveApproachRuntime.activeBeaconDist.toFixed(2))
      : null,
    activeBeaconBearing: Number.isFinite(objectiveApproachRuntime.activeBeaconBearing)
      ? Number(objectiveApproachRuntime.activeBeaconBearing.toFixed(3))
      : null,
    recentEvents: pilgrimageQuest.recentEvents.slice(-6).map((entry) => ({ ...entry }))
  };
}

function rememberQuestEvent(type, extra = {}) {
  const entry = {
    type,
    at: Number(clock.elapsedTime.toFixed(3)),
    ...extra
  };
  pilgrimageQuest.recentEvents.push(entry);
  if (pilgrimageQuest.recentEvents.length > 16) pilgrimageQuest.recentEvents.shift();
  enqueueBridgeEvent(type, extra);
}

function showQuestStatus(message) {
  if (!pilgrimageQuest.statusEl) return;
  pilgrimageQuest.statusEl.textContent = message;
  pilgrimageQuest.statusEl.classList.add('show');
  setTimeout(() => pilgrimageQuest.statusEl?.classList.remove('show'), 1700);
}

function showQuestCompletionBanner() {
  if (!pilgrimageQuest.completionBannerEl) return;
  if (pilgrimageQuest.completionBannerTimer) clearTimeout(pilgrimageQuest.completionBannerTimer);
  pilgrimageQuest.completionBannerEl.classList.add('show');
  pilgrimageQuest.completionBannerTimer = setTimeout(() => {
    pilgrimageQuest.completionBannerEl?.classList.remove('show');
  }, 2600);
}

function setBeaconVisualState(beacon, nextState) {
  if (!beacon || beacon.state === nextState) return;
  beacon.state = nextState;

  if (!beacon.core?.material || !beacon.beam?.material) return;

  const coreMaterial = beacon.core.material;
  const beamMaterial = beacon.beam.material;

  if (nextState === 'active') {
    coreMaterial.color.setHex(0xa2e3ff);
    coreMaterial.emissive.setHex(0x3a91ff);
    coreMaterial.emissiveIntensity = 1.2;
    beamMaterial.color.setHex(0x9be2ff);
    beamMaterial.opacity = 0.62;
    beacon.beam.visible = true;
  } else if (nextState === 'completed') {
    coreMaterial.color.setHex(0xb7ffd2);
    coreMaterial.emissive.setHex(0x2ea76a);
    coreMaterial.emissiveIntensity = 0.95;
    beamMaterial.color.setHex(0x65ffad);
    beamMaterial.opacity = 0.32;
    beacon.beam.visible = true;
  } else {
    coreMaterial.color.setHex(0x7692b8);
    coreMaterial.emissive.setHex(0x253f63);
    coreMaterial.emissiveIntensity = 0.38;
    beamMaterial.color.setHex(0x5672a0);
    beamMaterial.opacity = 0.12;
    beacon.beam.visible = false;
  }
}

function getActiveBeacon() {
  if (!pilgrimageQuest.activeObjectiveId) return null;
  return pilgrimageQuest.beacons.find((beacon) => beacon.id === pilgrimageQuest.activeObjectiveId) || null;
}

function syncBeaconQuestPhase() {
  const completed = pilgrimageQuest.completedObjectiveIds.length;
  pilgrimageQuest.progress = completed / BEACON_LAYOUT.length;

  if (completed >= BEACON_LAYOUT.length) {
    pilgrimageQuest.phase = 'completed';
    pilgrimageQuest.activeObjectiveId = null;
  } else {
    const nextBeacon = BEACON_LAYOUT[completed];
    pilgrimageQuest.phase = nextBeacon.id;
    pilgrimageQuest.activeObjectiveId = nextBeacon.id;
  }

  pilgrimageQuest.beacons.forEach((beacon) => {
    if (pilgrimageQuest.completedObjectiveIds.includes(beacon.id)) setBeaconVisualState(beacon, 'completed');
    else if (beacon.id === pilgrimageQuest.activeObjectiveId) setBeaconVisualState(beacon, 'active');
    else setBeaconVisualState(beacon, 'inactive');
  });

  updateObjectiveHud();
}

function resetObjectiveApproachRuntime() {
  objectiveApproachRuntime.phase = pilgrimageQuest.phase === 'completed' ? 'complete' : 'far';
  objectiveApproachRuntime.lockStableMs = 0;
  objectiveApproachRuntime.canAttune = false;
  objectiveApproachRuntime.activeBeaconDist = null;
  objectiveApproachRuntime.activeBeaconBearing = null;
  objectiveApproachRuntime.lockAcquiredAtMs = 0;
  objectiveApproachRuntime.lastPhase = objectiveApproachRuntime.phase;
  objectiveApproachRuntime.lastObjectiveId = pilgrimageQuest.activeObjectiveId;
  objectiveApproachRuntime.attuneStartedAtMs = 0;
}

function startBeaconQuest() {
  pilgrimageQuest.phase = 'intro';
  pilgrimageQuest.activeObjectiveId = BEACON_LAYOUT[0]?.id || null;
  pilgrimageQuest.completedObjectiveIds = [];
  pilgrimageQuest.progress = 0;
  pilgrimageQuest.recentEvents.length = 0;
  syncBeaconQuestPhase();
  resetObjectiveApproachRuntime();
  rememberQuestEvent('objective_started', {
    objectiveId: pilgrimageQuest.activeObjectiveId,
    phase: pilgrimageQuest.phase,
    progress: pilgrimageQuest.progress
  });
}

function createBeaconQuestUi() {
  pilgrimageQuest.promptEl = document.createElement('div');
  pilgrimageQuest.promptEl.id = 'interaction-prompt';
  pilgrimageQuest.promptEl.textContent = 'Approach the active beacon and press E to attune';
  document.body.appendChild(pilgrimageQuest.promptEl);

  pilgrimageQuest.statusEl = document.createElement('div');
  pilgrimageQuest.statusEl.id = 'interaction-status';
  document.body.appendChild(pilgrimageQuest.statusEl);

  pilgrimageQuest.objectiveHudEl = document.createElement('div');
  pilgrimageQuest.objectiveHudEl.id = 'objective-hud';
  document.body.appendChild(pilgrimageQuest.objectiveHudEl);

  pilgrimageQuest.lockHudEl = document.createElement('div');
  pilgrimageQuest.lockHudEl.id = 'objective-lock-hud';
  document.body.appendChild(pilgrimageQuest.lockHudEl);

  pilgrimageQuest.nextCueEl = document.createElement('div');
  pilgrimageQuest.nextCueEl.id = 'objective-next-cue';
  document.body.appendChild(pilgrimageQuest.nextCueEl);

  pilgrimageQuest.completionBannerEl = document.createElement('div');
  pilgrimageQuest.completionBannerEl.id = 'quest-complete-banner';
  pilgrimageQuest.completionBannerEl.textContent = 'Pilgrimage Complete';
  document.body.appendChild(pilgrimageQuest.completionBannerEl);
}

function createBeaconPilgrimageQuest() {
  worldColliders.clear();
  staticColliderSeq = 0;
  pilgrimageQuest.beacons = BEACON_LAYOUT.map(createBeacon);
  createBeaconQuestUi();
  startBeaconQuest();

  modeHud.el = document.createElement('div');
  modeHud.el.id = 'mode-hud';
  document.body.appendChild(modeHud.el);
  updateModeHud();

  chunkHud.el = document.createElement('div');
  chunkHud.el.id = 'chunk-hud';
  document.body.appendChild(chunkHud.el);
  updateChunkHud();
}

function getNearestBeaconInRange() {
  if (!player || pilgrimageQuest.beacons.length === 0) return null;

  let best = null;
  for (const beacon of pilgrimageQuest.beacons) {
    const dist = player.position.distanceTo(beacon.mesh.position);
    if (dist <= pilgrimageQuest.radius && (!best || dist < best.dist)) {
      best = { beacon, dist };
    }
  }
  return best;
}

function updateInteractionUI() {
  if (!pilgrimageQuest.promptEl) return;

  const nearby = getNearestBeaconInRange();
  if (!nearby) {
    pilgrimageQuest.promptEl.style.opacity = '0';
    pilgrimageQuest.promptEl.style.transform = 'translate(-50%, 6px)';
    return;
  }

  const activeBeacon = getActiveBeacon();
  if (nearby.beacon.id === activeBeacon?.id) {
    if (objectiveApproachRuntime.canAttune) {
      pilgrimageQuest.promptEl.textContent = `Press E to attune ${nearby.beacon.label}`;
    } else if (objectiveApproachRuntime.phase === 'lock') {
      pilgrimageQuest.promptEl.textContent = `Hold alignment for attunement lock on ${nearby.beacon.label}`;
    } else {
      pilgrimageQuest.promptEl.textContent = `Approach and align with ${nearby.beacon.label}`;
    }
  } else if (pilgrimageQuest.phase === 'completed') {
    pilgrimageQuest.promptEl.textContent = `${nearby.beacon.label} is already attuned`;
  } else {
    pilgrimageQuest.promptEl.textContent = `${nearby.beacon.label} is dormant. Follow the active beam.`;
  }

  pilgrimageQuest.promptEl.style.opacity = '1';
  pilgrimageQuest.promptEl.style.transform = 'translate(-50%, 0)';
}

function updateObjectiveHud() {
  if (!pilgrimageQuest.objectiveHudEl) return;

  if (pilgrimageQuest.phase === 'completed') {
    pilgrimageQuest.objectiveHudEl.textContent = 'Objective: Pilgrimage complete · 3/3 beacons attuned';
    pilgrimageQuest.objectiveHudEl.classList.add('complete');
    return;
  }

  pilgrimageQuest.objectiveHudEl.classList.remove('complete');
  const activeBeacon = getActiveBeacon();
  const completed = pilgrimageQuest.completedObjectiveIds.length;
  pilgrimageQuest.objectiveHudEl.textContent = `Objective: Attune ${activeBeacon?.label || 'next beacon'} · ${completed}/3 complete`;
}

function triggerBeaconPulse(beacon, pulseType = 'attune') {
  if (!beacon) return;
  beacon.pulseStartAt = clock.elapsedTime;
  beacon.pulseType = pulseType;
}

function completeActiveBeacon(beacon) {
  if (!beacon || pilgrimageQuest.completedObjectiveIds.includes(beacon.id)) return;

  pilgrimageQuest.completedObjectiveIds.push(beacon.id);
  triggerBeaconPulse(beacon, 'attune');
  rememberQuestEvent('objective_completed', {
    objectiveId: beacon.id,
    progress: Number((pilgrimageQuest.completedObjectiveIds.length / BEACON_LAYOUT.length).toFixed(3))
  });

  const before = pilgrimageQuest.activeObjectiveId;
  syncBeaconQuestPhase();
  resetObjectiveApproachRuntime();

  showQuestStatus(`${beacon.label} attuned.`);
  enqueueBridgeEvent('interaction', {
    targetId: beacon.id,
    result: 'attuned'
  });

  if (pilgrimageQuest.phase === 'completed') {
    rememberQuestEvent('quest_completed', {
      objectiveId: beacon.id,
      progress: pilgrimageQuest.progress
    });
    showQuestCompletionBanner();
    showQuestStatus('All beacons aligned. Pilgrimage complete.');
  } else if (before !== pilgrimageQuest.activeObjectiveId) {
    rememberQuestEvent('objective_started', {
      objectiveId: pilgrimageQuest.activeObjectiveId,
      phase: pilgrimageQuest.phase,
      progress: pilgrimageQuest.progress
    });
    const nextBeacon = getActiveBeacon();
    if (nextBeacon) {
      triggerBeaconPulse(nextBeacon, 'next_cue');
      triggerNextObjectiveCue(nextBeacon);
      showQuestStatus(`${beacon.label} attuned. ${nextBeacon.label} is now active.`);
    }
  }
}

function tryTriggerInteraction(targetId = null) {
  if (!player) return false;

  const targetBeacon = targetId
    ? pilgrimageQuest.beacons.find((beacon) => beacon.id === targetId)
    : getNearestBeaconInRange()?.beacon;
  if (!targetBeacon) return false;

  const distance = player.position.distanceTo(targetBeacon.mesh.position);
  if (distance > pilgrimageQuest.radius) return false;

  updateObjectiveSnapshotRuntime();

  if (pilgrimageQuest.phase === 'completed') {
    showQuestStatus('The pilgrimage is already complete.');
    enqueueBridgeEvent('interaction', {
      targetId: targetBeacon.id,
      result: 'already_completed'
    });
    return true;
  }

  if (targetBeacon.id !== pilgrimageQuest.activeObjectiveId) {
    showQuestStatus(`${targetBeacon.label} rejects attunement. Follow the active beacon.`);
    rememberQuestEvent('rejected', {
      objectiveId: targetBeacon.id,
      expectedObjectiveId: pilgrimageQuest.activeObjectiveId,
      progress: pilgrimageQuest.progress,
      reason: 'out_of_order'
    });
    enqueueBridgeEvent('interaction', {
      targetId: targetBeacon.id,
      result: 'rejected_out_of_order'
    });
    return true;
  }

  if (!objectiveApproachRuntime.canAttune) {
    showQuestStatus('Attunement lock not stable yet. Align with the active beacon.');
    enqueueBridgeEvent('interaction', {
      targetId: targetBeacon.id,
      result: 'lock_unstable',
      lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs)
    });
    return true;
  }

  objectiveApproachRuntime.attuneStartedAtMs = performance.now();
  rememberQuestEvent('attunement_started', {
    objectiveId: targetBeacon.id,
    lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
    activeBeaconDist: Number((objectiveApproachRuntime.activeBeaconDist || distance).toFixed(2)),
    activeBeaconBearing: Number((objectiveApproachRuntime.activeBeaconBearing || 0).toFixed(3))
  });
  completeActiveBeacon(targetBeacon);
  return true;
}

function updateBeaconVisuals() {
  const t = clock.elapsedTime;
  const activeId = pilgrimageQuest.activeObjectiveId;

  pilgrimageQuest.beacons.forEach((beacon, index) => {
    if (!beacon.core) return;
    const pulse = Math.sin(t * (2.1 + index * 0.35)) * 0.5 + 0.5;

    if (beacon.state === 'active') {
      beacon.core.position.y = beacon.baseCoreY + pulse * 0.09;
      beacon.core.material.emissiveIntensity = 0.95 + pulse * 0.55;
      beacon.beam.material.opacity = 0.4 + pulse * 0.35;
      beacon.beam.visible = true;
    } else if (beacon.state === 'completed') {
      beacon.core.position.y = beacon.baseCoreY + Math.sin(t * 1.3 + index) * 0.025;
      beacon.core.material.emissiveIntensity = 0.72 + pulse * 0.18;
      beacon.beam.material.opacity = 0.22 + pulse * 0.14;
      beacon.beam.visible = true;
    } else {
      beacon.core.position.y = beacon.baseCoreY + Math.sin(t * 0.9 + index) * 0.018;
      beacon.core.material.emissiveIntensity = 0.25 + pulse * 0.12;
      beacon.beam.visible = false;
    }

    if (beacon.lockRing) {
      const lockVisible = beacon.id === activeId && objectiveApproachRuntime.phase === 'lock';
      beacon.lockRing.visible = lockVisible;
      if (lockVisible) {
        const lockGlow = 0.28 + Math.min(1, objectiveApproachRuntime.lockStableMs / OBJECTIVE_APPROACH.lockStableMsRequired) * 0.62;
        beacon.lockRing.material.opacity = objectiveApproachRuntime.canAttune ? 0.9 : lockGlow;
        const ringScale = objectiveApproachRuntime.canAttune ? 1.08 : 0.97 + pulse * 0.08;
        beacon.lockRing.scale.setScalar(ringScale);
      }
    }

    if (beacon.cueRing) {
      const cueVisible = objectiveApproachRuntime.cueBeaconId === beacon.id && objectiveApproachRuntime.cueUntilMs > performance.now();
      beacon.cueRing.visible = cueVisible;
      if (cueVisible) {
        const cuePulse = Math.sin(t * 5.2 + index * 0.8) * 0.5 + 0.5;
        beacon.cueRing.material.opacity = 0.24 + cuePulse * 0.38;
        const cueScale = 1 + cuePulse * 0.3;
        beacon.cueRing.scale.set(cueScale, cueScale, cueScale);
      }
    }

    if (beacon.pulseStartAt > 0 && beacon.pulseType) {
      const elapsed = t - beacon.pulseStartAt;
      const duration = beacon.pulseType === 'next_cue' ? 1.8 : 1.25;
      if (elapsed >= duration) {
        beacon.pulseStartAt = 0;
        beacon.pulseType = null;
      } else {
        const k = elapsed / duration;
        const amp = beacon.pulseType === 'next_cue' ? 0.4 : 0.65;
        const burst = (1 - k) * amp;
        beacon.core.scale.setScalar(1 + burst * 0.28);
        beacon.core.material.emissiveIntensity += burst * 0.95;
        if (beacon.beam?.material) {
          beacon.beam.visible = true;
          beacon.beam.material.opacity = Math.min(0.92, beacon.beam.material.opacity + burst * 0.72);
        }
      }
    } else {
      beacon.core.scale.setScalar(1);
    }
  });
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
  if (e.code === 'Space' || e.code === 'ArrowUp') e.preventDefault();

  const jumpPressed = e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight';
  if (isDown && jumpPressed && player && !jumping) {
    jumping = true;
    velocityY = jumpVelocity;
    if (actions.jump) setAction('jump', 0.08);
  }

  if (isDown && e.code === 'KeyE' && player) {
    tryTriggerInteraction();
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
  const nowMs = performance.now();
  const bridgeAct = agentBridge.getActState(nowMs);
  const keyboardTurn = ((keys.ArrowRight || keys.KeyD) ? 1 : 0) - ((keys.ArrowLeft || keys.KeyA) ? 1 : 0);
  const keyboardForward = (keys.ArrowUp || keys.KeyW) ? 1 : 0;
  const turnInput = clampAxis(keyboardTurn + bridgeAct.turn);
  const forwardInput = clampAxis(keyboardForward + bridgeAct.forward);
  const movingForward = Math.abs(forwardInput) > 0.05;
  const objectiveGuidance = updateObjectiveSnapshotRuntime(nowMs);

  if (!jumping && bridgeAct.jump) {
    jumping = true;
    velocityY = jumpVelocity;
    if (actions.jump) setAction('jump', 0.08);
  }

  const closeObjectiveDist = objectiveGuidance?.dist ?? Number.POSITIVE_INFINITY;
  const closeObjectiveBearing = Math.abs(objectiveGuidance?.bearing ?? 0);
  const isNearObjective = Number.isFinite(closeObjectiveDist) && closeObjectiveDist <= OBJECTIVE_APPROACH.nearRadius;
  const turnDamping = isNearObjective ? THREE.MathUtils.clamp(closeObjectiveDist / OBJECTIVE_APPROACH.nearRadius, 0.42, 1) : 1;

  if (turnInput !== 0) {
    // Tank-style steering: rotate heading at a capped yaw speed.
    playerTurnQuat.setFromAxisAngle(WORLD_UP, -turnInput * PLAYER_TURN_SPEED * turnDamping * delta);
    lastMoveHeading.applyQuaternion(playerTurnQuat).normalize();
  }

  const startX = player.position.x;
  const startZ = player.position.z;
  let desiredX = startX;
  let desiredZ = startZ;

  playerMoveDirection.set(0, 0, 0);
  if (movingForward) {
    playerMoveDirection.copy(lastMoveHeading);

    let objectiveSlow = 1;
    if (Number.isFinite(closeObjectiveDist) && closeObjectiveDist <= OBJECTIVE_APPROACH.slowDownStartRadius) {
      const span = OBJECTIVE_APPROACH.slowDownStartRadius - OBJECTIVE_APPROACH.attuneRadius;
      const normalized = THREE.MathUtils.clamp((closeObjectiveDist - OBJECTIVE_APPROACH.attuneRadius) / Math.max(0.0001, span), 0, 1);
      objectiveSlow = 0.34 + normalized * 0.66;
      if (closeObjectiveBearing > 0.85 && closeObjectiveDist < OBJECTIVE_APPROACH.lockRadius + 0.7) {
        objectiveSlow *= 0.7;
      }
    }

    desiredX += playerMoveDirection.x * moveSpeed * forwardInput * objectiveSlow * delta;
    desiredZ += playerMoveDirection.z * moveSpeed * forwardInput * objectiveSlow * delta;

    if (actions.walk && !jumping) setAction('walk', 0.16);
  } else if (actions.idle && !jumping) {
    setAction('idle', 0.2);
  }

  const playerYMin = player.position.y + 0.05;
  const playerYMax = playerYMin + playerCollider.height;
  const nearbyColliders = worldColliders.queryNearby(desiredX, desiredZ, 8.5);
  const motionResult = resolvePlayerCylinderMotion({
    startX,
    startZ,
    desiredX,
    desiredZ,
    playerRadius: playerCollider.radius,
    playerYMin,
    playerYMax,
    colliders: nearbyColliders,
    iterations: isNearObjective ? 6 : 4
  });

  player.position.x = motionResult.x;
  player.position.z = motionResult.z;
  snapPlayerFacingToHeading(lastMoveHeading);

  const nowCollisionMs = performance.now();
  if (motionResult.contacts.length > 0) {
    const strongestContact = motionResult.contacts.reduce(
      (best, contact) => (contact.penetration > best.penetration ? contact : best),
      motionResult.contacts[0]
    );
    collisionRuntime.recentCollision = {
      colliderId: strongestContact.id || 'solid_unknown',
      colliderTag: strongestContact.tag || 'solid',
      at: Number(clock.elapsedTime.toFixed(3))
    };
    if (nowCollisionMs - collisionRuntime.lastCollisionEventAtMs > 220) {
      enqueueBridgeEvent('collision', {
        colliderId: collisionRuntime.recentCollision.colliderId,
        colliderTag: collisionRuntime.recentCollision.colliderTag,
        blockedRatio: Number(motionResult.blockedRatio.toFixed(3))
      });
      collisionRuntime.lastCollisionEventAtMs = nowCollisionMs;
    }
  }

  collisionRuntime.frontPressure = motionResult.blockedRatio;
  const collisionBlocked = movingForward && motionResult.blockedRatio > 0.38;
  if (collisionBlocked) {
    if (!collisionRuntime.blocked) {
      collisionRuntime.blocked = true;
      collisionRuntime.blockedSinceMs = nowCollisionMs;
      collisionRuntime.blockedForMs = 0;
      collisionRuntime.recoveryNoted = false;
    }
    collisionRuntime.blockedForMs = Math.max(0, nowCollisionMs - collisionRuntime.blockedSinceMs);
  } else if (collisionRuntime.blocked) {
    if (collisionRuntime.blockedForMs > 600) {
      enqueueBridgeEvent('collision_resolved', {
        blockedForMs: Math.round(collisionRuntime.blockedForMs),
        colliderId: collisionRuntime.recentCollision?.colliderId || null,
        colliderTag: collisionRuntime.recentCollision?.colliderTag || null
      });
      enqueueBridgeEvent('nav_recovery', {
        reason: 'collision_cleared',
        blockedForMs: Math.round(collisionRuntime.blockedForMs)
      });
    }
    collisionRuntime.blocked = false;
    collisionRuntime.blockedSinceMs = 0;
    collisionRuntime.blockedForMs = 0;
    collisionRuntime.recoveryNoted = true;
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

      if (movingForward && actions.walk) setAction('walk', 0.14);
      else if (actions.idle) setAction('idle', 0.14);
    }
  } else {
    groundedY = terrainY;
    player.position.y = groundedY;
  }

  updateInteractionUI();
  updateObjectiveLockSignals(nowMs);
  updateBeaconVisuals();

  if (agentBridge.consumeOneShotInteract(nowMs)) {
    tryTriggerInteraction();
  }

  const queuedInteract = agentBridge.consumeInteractRequest();
  if (queuedInteract) {
    const interactionTargetId = queuedInteract.targetId || pilgrimageQuest.activeObjectiveId || null;
    const ok = tryTriggerInteraction(interactionTargetId);
    agentBridge.send({
      type: 'INTERACTED',
      targetId: interactionTargetId || 'beacon_unknown',
      result: ok ? 'ok' : 'out_of_range'
    });
  }

  const previousX = bridgeLastPlayerPos.x;
  const previousY = bridgeLastPlayerPos.y;
  const previousZ = bridgeLastPlayerPos.z;
  bridgeLastPlayerPos.copy(player.position);
  if (delta > 0) {
    bridgeVelocity.set(
      (player.position.x - previousX) / delta,
      (player.position.y - previousY) / delta,
      (player.position.z - previousZ) / delta
    );
  } else {
    bridgeVelocity.set(0, 0, 0);
  }
  const movedSq = (player.position.x - previousX) ** 2 + (player.position.z - previousZ) ** 2;
  if (movingForward && movedSq < 0.000001) bridgeStuckCounter += 1;
  else bridgeStuckCounter = 0;
}

function updateBridge(nowMs) {
  if (!player) return;

  if (agentBridge.shouldSendObs(nowMs)) {
    recomputeBridgePerceptionSets();
    const obs = buildObservation({
      nowSeconds: clock.elapsedTime,
      tick: bridgeObsTick,
      player,
      velocity: bridgeVelocity,
      grounded: !jumping,
      heading: lastMoveHeading,
      stuck: bridgeStuckCounter > 8,
      nav: {
        blocked: collisionRuntime.blocked,
        frontPressure: collisionRuntime.frontPressure,
        recentCollision: collisionRuntime.recentCollision,
        blockedForMs: collisionRuntime.blocked ? collisionRuntime.blockedForMs : 0
      },
      events: bridgeEvents.splice(0, bridgeEvents.length),
      objective: getObjectiveSnapshot(),
      perceivableRoots: bridgePerceivableRoots,
      occluders: bridgeOccluders,
      latestPerceivedIds: bridgeLatestPerceivedIds
    });
    agentBridge.sendObs(obs);
    bridgeObsTick += 1;
  }

  void agentBridge.pumpCaptureRequests({
    renderer,
    scene,
    camera,
    player,
    heading: lastMoveHeading,
    nowSeconds: clock.elapsedTime
  });
  void agentBridge.pumpEditRequests({
    scene,
    player
  });
}

let renderLoopStarted = false;
let renderExceptionCount = 0;

function render() {
  try {
    const delta = clock.getDelta();
    const scaledDelta = delta * timeScale;
    if (mixer) mixer.update(scaledDelta);
    updatePlayer(scaledDelta);
    updateBridge(performance.now());
    updateFollowCamera(scaledDelta);
    updatePlayerRimLight();
    updateTerrainChunkVisibility();
    terrainBlendMaterials.forEach((material) => {
      material.userData?.groundBlendShader?.uniforms?.uGroundCameraPos?.value.copy(camera.position);
    });
    updateChunkHud();
    renderer.render(scene, camera);

    if (!bootStages.firstFrameRendered) {
      markBootStage(
        'firstFrameRendered',
        `children=${scene.children.length} camera=${formatVec3Debug(camera.position)} target=${formatVec3Debug(cameraLookTarget)} player=${formatVec3Debug(player?.position)}`
      );
    }

    if (bootStages.characterReady && !bootStages.firstFrameWithCharacterRendered) {
      markBootStage(
        'firstFrameWithCharacterRendered',
        `children=${scene.children.length} camera=${formatVec3Debug(camera.position)} target=${formatVec3Debug(cameraLookTarget)} player=${formatVec3Debug(player?.position)}`
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
  markBootStage('renderStarted', `${reason} | camera=${formatVec3Debug(camera.position)} target=${formatVec3Debug(cameraLookTarget)} player=${formatVec3Debug(player?.position)}`);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

(async () => {
  const bootStartedAt = performance.now();

  try {
    agentBridge.connect();
    createBeaconPilgrimageQuest();
    markBootStage('coreUiReady', 'HUD + beacon quest created');

    // Start rendering immediately so world/terrain still appears even if character load is slow.
    ensureRenderLoopStarted('post-core-ui');

    console.log('[boot-debug] init chain: serialize character -> world staging to avoid high asset decode contention, then deferred movement clips');

    setBootLoadingStatus('Loading player rig…');

    const characterStartedAt = performance.now();
    await loadCharacterAndAnimations();
    console.log(`[boot-debug] loadCharacterAndAnimations: complete (${Math.round(performance.now() - characterStartedAt)}ms) | inFlight now fbx=${loadDebugState.fbxInFlight} gltf=${loadDebugState.gltfInFlight}`);

    setBootLoadingStatus('Loading world dressing…');

    const stageFactories = [
      { name: 'createSetDressing', run: createSetDressing },
      { name: 'createLandmarks', run: createLandmarks }
    ];

    const worldResults = [];
    for (const { name, run } of stageFactories) {
      const startedAt = performance.now();
      console.log(`[boot-debug] ${name}: queued (sequential) | inFlight before run fbx=${loadDebugState.fbxInFlight} gltf=${loadDebugState.gltfInFlight}`);
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

    const failedWorldStages = worldResults.filter((result) => result.status === 'rejected');
    if (failedWorldStages.length > 0) {
      console.warn('[boot-debug] world stages settled with failures', failedWorldStages.map((result) => result.name));
    }

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
