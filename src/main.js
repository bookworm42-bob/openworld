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

const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
scene.add(ambientLight);
const hemiLight = new THREE.HemisphereLight(0xf0f8ff, 0xa4c189, 1.6);
scene.add(hemiLight);
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

const worldStageGrade = {
  current: 0,
  target: 0
};

const worldStagePalette = {
  dawn: {
    background: new THREE.Color(0xb7ddff),
    fog: new THREE.Color(0xe7f3ff),
    fogNear: 75,
    fogFar: 320,
    dirColor: new THREE.Color(0xfff6dd),
    dirIntensity: 2.9,
    fillColor: new THREE.Color(0xf5faff),
    fillIntensity: 1.1,
    hemiSky: new THREE.Color(0xf0f8ff),
    hemiGround: new THREE.Color(0xa4c189),
    hemiIntensity: 1.6,
    ambientIntensity: 0.85,
    rimIntensity: 0.35,
    exposure: 1.7
  },
  sanctum: {
    background: new THREE.Color(0xa8c6eb),
    fog: new THREE.Color(0xd4e6ff),
    fogNear: 64,
    fogFar: 286,
    dirColor: new THREE.Color(0xffefc8),
    dirIntensity: 3.05,
    fillColor: new THREE.Color(0xe7f1ff),
    fillIntensity: 1.24,
    hemiSky: new THREE.Color(0xe6f3ff),
    hemiGround: new THREE.Color(0x8ab08a),
    hemiIntensity: 1.73,
    ambientIntensity: 0.93,
    rimIntensity: 0.4,
    exposure: 1.75
  },
  finale: {
    background: new THREE.Color(0x9dc0e3),
    fog: new THREE.Color(0xcce4ff),
    fogNear: 56,
    fogFar: 248,
    dirColor: new THREE.Color(0xfff4db),
    dirIntensity: 3.25,
    fillColor: new THREE.Color(0xe4eeff),
    fillIntensity: 1.35,
    hemiSky: new THREE.Color(0xe2f1ff),
    hemiGround: new THREE.Color(0x86b89a),
    hemiIntensity: 1.86,
    ambientIntensity: 1.01,
    rimIntensity: 0.46,
    exposure: 1.79
  }
};

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

const SANCTUM_OBJECTIVE = {
  id: 'sanctum_core',
  label: 'Sanctum Core',
  position: new THREE.Vector2(83, 56)
};

const RETURN_OBJECTIVE = {
  id: 'return_shrine',
  label: 'Return Shrine',
  position: new THREE.Vector2(-2.8, 2.4)
};

const EPILOGUE_RETURN_TIMER_SEC = THREE.MathUtils.clamp(Number(urlParams.get('returnTimerSec') || 75), 25, 240);
const EPILOGUE_WARNING_THRESHOLDS_SEC = [30, 20, 10, 5];

const QUEST_STAGES = {
  BEACONS_ACTIVE: 'beacons_active',
  SANCTUM_UNLOCKED: 'sanctum_unlocked',
  FINALE_ATTUNING: 'finale_attuning',
  FINALE_COMPLETED: 'finale_completed',
  RETURN_ACTIVE: 'return_active',
  RETURN_FAILED: 'return_failed',
  CYCLE_COMPLETED: 'cycle_completed'
};

const OBJECTIVE_APPROACH = {
  farRadius: 7.2,
  nearRadius: 4.6,
  lockRadius: 2.55,
  lockBearingRad: 0.32,
  attuneRadius: 2.5,
  attuneBearingRad: 0.32,
  lockStableMsRequired: 320,
  slowDownStartRadius: 5.5
};

const ROUTE_HINT_PIPELINE = {
  spawn: new THREE.Vector2(0, 0),
  breadcrumbCount: 7
};

const ROUTE_LEGS = [
  { id: 'leg_spawn_beacon_1', fromId: 'spawn', toId: 'beacon_1', stage: QUEST_STAGES.BEACONS_ACTIVE, objectiveId: 'beacon_1', direction: 'outbound' },
  { id: 'leg_beacon_1_beacon_2', fromId: 'beacon_1', toId: 'beacon_2', stage: QUEST_STAGES.BEACONS_ACTIVE, objectiveId: 'beacon_2', direction: 'outbound' },
  { id: 'leg_beacon_2_beacon_3', fromId: 'beacon_2', toId: 'beacon_3', stage: QUEST_STAGES.BEACONS_ACTIVE, objectiveId: 'beacon_3', direction: 'outbound' },
  { id: 'leg_beacon_3_sanctum_core', fromId: 'beacon_3', toId: SANCTUM_OBJECTIVE.id, stage: QUEST_STAGES.SANCTUM_UNLOCKED, objectiveId: SANCTUM_OBJECTIVE.id, direction: 'outbound' },
  { id: 'leg_sanctum_core_return_shrine', fromId: SANCTUM_OBJECTIVE.id, toId: RETURN_OBJECTIVE.id, stage: QUEST_STAGES.RETURN_ACTIVE, objectiveId: RETURN_OBJECTIVE.id, direction: 'return' }
];

const OBJECTIVE_HANDOFF = {
  settleMs: 1250,
  releaseColliderMs: 900,
  egressRadius: 4.1,
  turnAssist: 0.66
};

const pilgrimageQuest = {
  questId: 'beacon_pilgrimage',
  phase: 'intro',
  questStage: QUEST_STAGES.BEACONS_ACTIVE,
  activeObjectiveId: null,
  finaleObjectiveId: SANCTUM_OBJECTIVE.id,
  returnObjectiveId: RETURN_OBJECTIVE.id,
  finaleUnlocked: false,
  finaleCompleted: false,
  returnActive: false,
  returnFailed: false,
  cycleCompleted: false,
  completedObjectiveIds: [],
  progress: 0,
  radius: 2.8,
  beacons: [],
  sanctum: null,
  returnShrine: null,
  promptEl: null,
  statusEl: null,
  objectiveHudEl: null,
  epilogueHudEl: null,
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
  activeObjectiveDist: null,
  activeObjectiveBearing: null,
  activeBeaconDist: null,
  activeBeaconBearing: null,
  lockAcquiredAtMs: 0,
  lastPhase: 'far',
  lastObjectiveId: null,
  attuneStartedAtMs: 0,
  cueObjectiveId: null,
  cueUntilMs: 0
};

const routeGuidanceRuntime = {
  group: null,
  legs: new Map(),
  activeLegId: null,
  routeHint: null
};

const objectivePacingRuntime = {
  questStartedAtSec: 0,
  objectiveStartedAtSec: new Map(),
  objectiveSplitSec: new Map(),
  lockToAttuneMs: new Map(),
  returnSplitSec: null,
  totalCycleSec: null,
  handoff: {
    active: false,
    startedAtMs: 0,
    settleAtMs: 0,
    releaseColliderUntilMs: 0,
    fromObjectiveId: null,
    toObjectiveId: null,
    settled: false
  }
};

const epilogueRuntime = {
  active: false,
  startedAtSec: null,
  deadlineAtSec: null,
  budgetSec: EPILOGUE_RETURN_TIMER_SEC,
  warnedThresholds: new Set(),
  warningCooldownMs: 0,
  failed: false,
  completed: false
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

function getQuestStageGrade(stage = pilgrimageQuest.questStage) {
  if (stage === QUEST_STAGES.SANCTUM_UNLOCKED || stage === QUEST_STAGES.FINALE_ATTUNING) return 0.56;
  if (stage === QUEST_STAGES.FINALE_COMPLETED || stage === QUEST_STAGES.RETURN_ACTIVE || stage === QUEST_STAGES.RETURN_FAILED || stage === QUEST_STAGES.CYCLE_COMPLETED) return 1;
  return 0;
}

function updateWorldStageGrade(delta = 0) {
  const blend = THREE.MathUtils.clamp(1 - Math.exp(-Math.max(0, delta) * 1.55), 0.01, 1);
  worldStageGrade.current = THREE.MathUtils.lerp(worldStageGrade.current, worldStageGrade.target, blend);

  const grade = THREE.MathUtils.clamp(worldStageGrade.current, 0, 1);
  const sanctumBlend = THREE.MathUtils.clamp(grade / 0.56, 0, 1);
  const finaleBlend = THREE.MathUtils.clamp((grade - 0.56) / 0.44, 0, 1);

  const activePalette = {
    background: worldStagePalette.dawn.background.clone().lerp(worldStagePalette.sanctum.background, sanctumBlend).lerp(worldStagePalette.finale.background, finaleBlend),
    fog: worldStagePalette.dawn.fog.clone().lerp(worldStagePalette.sanctum.fog, sanctumBlend).lerp(worldStagePalette.finale.fog, finaleBlend),
    dirColor: worldStagePalette.dawn.dirColor.clone().lerp(worldStagePalette.sanctum.dirColor, sanctumBlend).lerp(worldStagePalette.finale.dirColor, finaleBlend),
    fillColor: worldStagePalette.dawn.fillColor.clone().lerp(worldStagePalette.sanctum.fillColor, sanctumBlend).lerp(worldStagePalette.finale.fillColor, finaleBlend),
    hemiSky: worldStagePalette.dawn.hemiSky.clone().lerp(worldStagePalette.sanctum.hemiSky, sanctumBlend).lerp(worldStagePalette.finale.hemiSky, finaleBlend),
    hemiGround: worldStagePalette.dawn.hemiGround.clone().lerp(worldStagePalette.sanctum.hemiGround, sanctumBlend).lerp(worldStagePalette.finale.hemiGround, finaleBlend),
    fogNear: THREE.MathUtils.lerp(THREE.MathUtils.lerp(worldStagePalette.dawn.fogNear, worldStagePalette.sanctum.fogNear, sanctumBlend), worldStagePalette.finale.fogNear, finaleBlend),
    fogFar: THREE.MathUtils.lerp(THREE.MathUtils.lerp(worldStagePalette.dawn.fogFar, worldStagePalette.sanctum.fogFar, sanctumBlend), worldStagePalette.finale.fogFar, finaleBlend),
    dirIntensity: THREE.MathUtils.lerp(THREE.MathUtils.lerp(worldStagePalette.dawn.dirIntensity, worldStagePalette.sanctum.dirIntensity, sanctumBlend), worldStagePalette.finale.dirIntensity, finaleBlend),
    fillIntensity: THREE.MathUtils.lerp(THREE.MathUtils.lerp(worldStagePalette.dawn.fillIntensity, worldStagePalette.sanctum.fillIntensity, sanctumBlend), worldStagePalette.finale.fillIntensity, finaleBlend),
    hemiIntensity: THREE.MathUtils.lerp(THREE.MathUtils.lerp(worldStagePalette.dawn.hemiIntensity, worldStagePalette.sanctum.hemiIntensity, sanctumBlend), worldStagePalette.finale.hemiIntensity, finaleBlend),
    ambientIntensity: THREE.MathUtils.lerp(THREE.MathUtils.lerp(worldStagePalette.dawn.ambientIntensity, worldStagePalette.sanctum.ambientIntensity, sanctumBlend), worldStagePalette.finale.ambientIntensity, finaleBlend),
    rimIntensity: THREE.MathUtils.lerp(THREE.MathUtils.lerp(worldStagePalette.dawn.rimIntensity, worldStagePalette.sanctum.rimIntensity, sanctumBlend), worldStagePalette.finale.rimIntensity, finaleBlend),
    exposure: THREE.MathUtils.lerp(THREE.MathUtils.lerp(worldStagePalette.dawn.exposure, worldStagePalette.sanctum.exposure, sanctumBlend), worldStagePalette.finale.exposure, finaleBlend)
  };

  scene.background.copy(activePalette.background);
  scene.fog.color.copy(activePalette.fog);
  scene.fog.near = activePalette.fogNear;
  scene.fog.far = activePalette.fogFar;
  dirLight.color.copy(activePalette.dirColor);
  dirLight.intensity = activePalette.dirIntensity;
  fillLight.color.copy(activePalette.fillColor);
  fillLight.intensity = activePalette.fillIntensity;
  hemiLight.color.copy(activePalette.hemiSky);
  hemiLight.groundColor.copy(activePalette.hemiGround);
  hemiLight.intensity = activePalette.hemiIntensity;
  ambientLight.intensity = activePalette.ambientIntensity;
  playerRimLight.intensity = activePalette.rimIntensity;
  renderer.toneMappingExposure = activePalette.exposure;
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

function createSanctumCore({ id, label, position }) {
  const group = new THREE.Group();

  const dais = new THREE.Mesh(
    new THREE.CylinderGeometry(1.55, 1.95, 0.52, 36),
    applyWarmRimAccent(new THREE.MeshStandardMaterial({ color: 0x55616d, roughness: 0.53, metalness: 0.2 }))
  );
  dais.position.y = 0.26;
  dais.castShadow = true;
  dais.receiveShadow = true;
  group.add(dais);

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.16, 18, 54),
    applyWarmRimAccent(new THREE.MeshStandardMaterial({ color: 0x6f8ab2, roughness: 0.34, metalness: 0.54 }))
  );
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = 0.62;
  group.add(outerRing);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.48, 1),
    applyWarmRimAccent(new THREE.MeshStandardMaterial({
      color: 0xaed8ff,
      emissive: 0x26589b,
      emissiveIntensity: 0.48,
      roughness: 0.2,
      metalness: 0.1
    }))
  );
  core.position.y = 1.18;
  core.castShadow = true;
  group.add(core);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.6, 15.4, 26, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x9bddff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  beam.position.y = 7.4;
  beam.visible = false;
  group.add(beam);

  const lockRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.9, 0.08, 14, 40),
    new THREE.MeshBasicMaterial({
      color: 0xc4feff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  lockRing.rotation.x = Math.PI / 2;
  lockRing.position.y = 0.44;
  lockRing.visible = false;
  group.add(lockRing);

  const cueRing = new THREE.Mesh(
    new THREE.RingGeometry(1.95, 2.8, 56),
    new THREE.MeshBasicMaterial({
      color: 0xb8f6ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  cueRing.rotation.x = -Math.PI / 2;
  cueRing.position.y = 0.09;
  cueRing.visible = false;
  group.add(cueRing);

  const pathMarker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 2.6, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x85d0ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  pathMarker.position.y = 1.45;
  pathMarker.visible = false;
  group.add(pathMarker);

  const x = position.x;
  const z = position.y;
  const y = getTerrainHeightAt(x, z) + 0.22;
  group.position.set(x, y, z);
  group.userData.agentPerceivable = true;
  group.userData.agentTag = 'sanctum';
  group.userData.agentId = id;
  group.userData.beaconLabel = label;
  scene.add(group);

  registerStaticColliderForObject(group, {
    colliderId: id,
    colliderTag: 'sanctum',
    radiusScale: 0.34,
    radiusPadding: 0.08,
    minRadius: 0.46,
    maxRadius: 1.18
  });

  return {
    id,
    label,
    mesh: group,
    core,
    beam,
    lockRing,
    cueRing,
    pathMarker,
    pulseStartAt: 0,
    pulseType: null,
    state: 'dormant',
    baseCoreY: core.position.y
  };
}

function createReturnShrine({ id, label, position }) {
  const group = new THREE.Group();

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.45, 1.78, 0.5, 34),
    applyWarmRimAccent(new THREE.MeshStandardMaterial({ color: 0x585f74, roughness: 0.48, metalness: 0.26 }))
  );
  plinth.position.y = 0.24;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.18, 0.16, 14, 44),
    applyWarmRimAccent(new THREE.MeshStandardMaterial({ color: 0x7a86ba, roughness: 0.28, metalness: 0.56 }))
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.56;
  group.add(ring);

  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.44, 1),
    applyWarmRimAccent(new THREE.MeshStandardMaterial({
      color: 0xc6d2ff,
      emissive: 0x2f3f95,
      emissiveIntensity: 0.42,
      roughness: 0.18,
      metalness: 0.16
    }))
  );
  core.position.y = 1.05;
  core.castShadow = true;
  group.add(core);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.5, 11.8, 22, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xb79bff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  beam.position.y = 5.9;
  beam.visible = false;
  group.add(beam);

  const lockRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.64, 0.08, 14, 38),
    new THREE.MeshBasicMaterial({
      color: 0xd2c7ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  lockRing.rotation.x = Math.PI / 2;
  lockRing.position.y = 0.38;
  lockRing.visible = false;
  group.add(lockRing);

  const cueRing = new THREE.Mesh(
    new THREE.RingGeometry(1.68, 2.36, 48),
    new THREE.MeshBasicMaterial({
      color: 0xcab8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  cueRing.rotation.x = -Math.PI / 2;
  cueRing.position.y = 0.08;
  cueRing.visible = false;
  group.add(cueRing);

  const pathMarker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 2.3, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xb497ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  pathMarker.position.y = 1.28;
  pathMarker.visible = false;
  group.add(pathMarker);

  const x = position.x;
  const z = position.y;
  const y = getTerrainHeightAt(x, z) + 0.2;
  group.position.set(x, y, z);
  group.userData.agentPerceivable = true;
  group.userData.agentTag = 'return_shrine';
  group.userData.agentId = id;
  group.userData.beaconLabel = label;
  scene.add(group);

  registerStaticColliderForObject(group, {
    colliderId: id,
    colliderTag: 'return_shrine',
    radiusScale: 0.36,
    radiusPadding: 0.09,
    minRadius: 0.48,
    maxRadius: 1.2
  });

  return {
    id,
    label,
    mesh: group,
    core,
    beam,
    lockRing,
    cueRing,
    pathMarker,
    pulseStartAt: 0,
    pulseType: null,
    state: 'dormant',
    baseCoreY: core.position.y
  };
}

function getObjectiveEntityById(objectiveId) {
  if (!objectiveId) return null;
  if (pilgrimageQuest.sanctum?.id === objectiveId) return pilgrimageQuest.sanctum;
  if (pilgrimageQuest.returnShrine?.id === objectiveId) return pilgrimageQuest.returnShrine;
  return pilgrimageQuest.beacons.find((beacon) => beacon.id === objectiveId) || null;
}

function getActiveObjectiveEntity() {
  return getObjectiveEntityById(pilgrimageQuest.activeObjectiveId);
}

function getObjectiveAnchorById(objectiveId) {
  if (objectiveId === 'spawn') return ROUTE_HINT_PIPELINE.spawn;
  if (objectiveId === SANCTUM_OBJECTIVE.id) return SANCTUM_OBJECTIVE.position;
  if (objectiveId === RETURN_OBJECTIVE.id) return RETURN_OBJECTIVE.position;
  const beacon = BEACON_LAYOUT.find((entry) => entry.id === objectiveId);
  return beacon?.position || null;
}

function getActiveRouteLeg() {
  if (!pilgrimageQuest.activeObjectiveId) return null;

  if (pilgrimageQuest.questStage === QUEST_STAGES.RETURN_ACTIVE || pilgrimageQuest.activeObjectiveId === RETURN_OBJECTIVE.id) {
    return ROUTE_LEGS.find((leg) => leg.toId === RETURN_OBJECTIVE.id) || null;
  }

  if (pilgrimageQuest.activeObjectiveId === SANCTUM_OBJECTIVE.id) {
    return ROUTE_LEGS.find((leg) => leg.toId === SANCTUM_OBJECTIVE.id) || null;
  }

  const completedCount = BEACON_LAYOUT.filter((beacon) => pilgrimageQuest.completedObjectiveIds.includes(beacon.id)).length;
  const outboundLegs = ROUTE_LEGS.filter((leg) => leg.direction !== 'return');
  const legIndex = THREE.MathUtils.clamp(completedCount, 0, outboundLegs.length - 1);
  return outboundLegs[legIndex] || null;
}

function getRouteLegPalette(leg) {
  if (leg.direction === 'return') {
    return {
      pip: 0xc8afff,
      beam: 0xb295ff
    };
  }

  if (leg.toId === SANCTUM_OBJECTIVE.id) {
    return {
      pip: 0xa8f4ff,
      beam: 0x95ebff
    };
  }

  return {
    pip: 0x90deff,
    beam: 0x7ed7ff
  };
}

function createRouteGuidanceLayer() {
  if (routeGuidanceRuntime.group) {
    scene.remove(routeGuidanceRuntime.group);
    routeGuidanceRuntime.group.clear();
  }

  const group = new THREE.Group();
  group.name = 'route-guidance-layer';
  scene.add(group);
  routeGuidanceRuntime.group = group;
  routeGuidanceRuntime.legs.clear();
  routeGuidanceRuntime.activeLegId = null;

  for (const leg of ROUTE_LEGS) {
    const from = getObjectiveAnchorById(leg.fromId);
    const to = getObjectiveAnchorById(leg.toId);
    if (!from || !to) continue;

    const legGroup = new THREE.Group();
    legGroup.name = leg.id;
    legGroup.visible = false;

    const palette = getRouteLegPalette(leg);

    const points = [];
    const pips = [];
    const pulseOffsets = [];
    const count = ROUTE_HINT_PIPELINE.breadcrumbCount;

    for (let i = 1; i <= count; i += 1) {
      const t = i / (count + 1);
      const x = THREE.MathUtils.lerp(from.x, to.x, t);
      const z = THREE.MathUtils.lerp(from.y, to.y, t);
      const y = getTerrainHeightAt(x, z) + 0.09;
      points.push(new THREE.Vector3(x, y, z));

      const pip = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.34, 22),
        new THREE.MeshBasicMaterial({
          color: palette.pip,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide
        })
      );
      pip.rotation.x = -Math.PI / 2;
      pip.position.set(x, y, z);
      pip.visible = false;
      legGroup.add(pip);
      pips.push(pip);
      pulseOffsets.push((i * 0.91 + leg.id.length * 0.17) % (Math.PI * 2));
    }

    const legBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 2.5, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: palette.beam,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    const endY = getTerrainHeightAt(to.x, to.y) + 1.5;
    legBeam.position.set(to.x, endY, to.y);
    legBeam.visible = false;
    legGroup.add(legBeam);

    group.add(legGroup);
    routeGuidanceRuntime.legs.set(leg.id, {
      ...leg,
      group: legGroup,
      pips,
      points,
      pulseOffsets,
      legBeam
    });
  }
}

function updateRouteGuidanceVisuals() {
  if (!routeGuidanceRuntime.group) return;

  const nowSec = clock.elapsedTime;
  const activeLeg = getActiveRouteLeg();
  routeGuidanceRuntime.activeLegId = activeLeg?.id || null;

  for (const [legId, entry] of routeGuidanceRuntime.legs.entries()) {
    const active = legId === routeGuidanceRuntime.activeLegId;
    entry.group.visible = active;
    entry.legBeam.visible = active;

    if (!active) {
      entry.pips.forEach((pip) => {
        pip.visible = false;
        if (pip.material) pip.material.opacity = 0;
      });
      if (entry.legBeam.material) entry.legBeam.material.opacity = 0;
      continue;
    }

    entry.pips.forEach((pip, index) => {
      pip.visible = true;
      const pulse = Math.sin(nowSec * 3.8 - index * 0.46 + entry.pulseOffsets[index]) * 0.5 + 0.5;
      const alpha = 0.16 + pulse * 0.46;
      pip.material.opacity = alpha;
      const scale = 0.88 + pulse * 0.36;
      pip.scale.set(scale, scale, scale);
      pip.position.y = entry.points[index].y + pulse * 0.04;
    });

    if (entry.legBeam.material) {
      const beamPulse = Math.sin(nowSec * 2.6) * 0.5 + 0.5;
      entry.legBeam.material.opacity = 0.14 + beamPulse * 0.2;
    }
  }

  if (!player || !activeLeg) {
    routeGuidanceRuntime.routeHint = null;
    return;
  }

  const activeEntry = routeGuidanceRuntime.legs.get(activeLeg.id);
  if (!activeEntry || activeEntry.points.length === 0) {
    routeGuidanceRuntime.routeHint = null;
    return;
  }

  let bestIndex = 0;
  let bestDistSq = Number.POSITIVE_INFINITY;
  activeEntry.points.forEach((point, index) => {
    const dx = point.x - player.position.x;
    const dz = point.z - player.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = index;
    }
  });

  const hintPoint = activeEntry.points[Math.min(activeEntry.points.length - 1, bestIndex + 1)] || activeEntry.points[bestIndex];
  objectiveToTargetVec.subVectors(hintPoint, player.position);
  const hintDist = objectiveToTargetVec.length();

  objectiveFlatForward.copy(lastMoveHeading).setY(0);
  if (objectiveFlatForward.lengthSq() < 0.0001) objectiveFlatForward.set(0, 0, -1);
  else objectiveFlatForward.normalize();

  objectiveFlatToTarget.copy(objectiveToTargetVec).setY(0);
  if (objectiveFlatToTarget.lengthSq() < 0.0001) {
    routeGuidanceRuntime.routeHint = null;
    return;
  }
  objectiveFlatToTarget.normalize();

  const hintBearing = Math.atan2(
    objectiveFlatForward.x * objectiveFlatToTarget.z - objectiveFlatForward.z * objectiveFlatToTarget.x,
    objectiveFlatForward.dot(objectiveFlatToTarget)
  );

  routeGuidanceRuntime.routeHint = {
    id: activeLeg.id,
    legId: activeLeg.id,
    index: bestIndex,
    dist: hintDist,
    bearing: hintBearing,
    objectiveId: activeLeg.objectiveId
  };
}

function getActiveObjectiveGuidance() {
  const activeObjective = getActiveObjectiveEntity();
  if (!player || !activeObjective?.mesh) return null;

  objectiveToTargetVec.subVectors(activeObjective.mesh.position, player.position);
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
    objective: activeObjective
  };
}

function clearObjectiveCueIfExpired(nowMs = performance.now()) {
  if (objectiveApproachRuntime.cueUntilMs > 0 && nowMs >= objectiveApproachRuntime.cueUntilMs) {
    objectiveApproachRuntime.cueUntilMs = 0;
    objectiveApproachRuntime.cueObjectiveId = null;
    if (pilgrimageQuest.nextCueEl) pilgrimageQuest.nextCueEl.classList.remove('show');
  }
}

function triggerNextObjectiveCue(objective, message = null) {
  if (!objective) return;
  objectiveApproachRuntime.cueObjectiveId = objective.id;
  objectiveApproachRuntime.cueUntilMs = performance.now() + 2600;
  if (pilgrimageQuest.nextCueEl) {
    pilgrimageQuest.nextCueEl.textContent = message || `${objective.label} now active`;
    pilgrimageQuest.nextCueEl.classList.add('show');
  }
}

function updateObjectiveSnapshotRuntime(nowMs = performance.now()) {
  clearObjectiveCueIfExpired(nowMs);

  const guidance = getActiveObjectiveGuidance();
  if (!guidance) {
    objectiveApproachRuntime.phase = pilgrimageQuest.phase === 'completed' ? 'complete' : 'far';
    objectiveApproachRuntime.lockStableMs = 0;
    objectiveApproachRuntime.canAttune = false;
    objectiveApproachRuntime.activeObjectiveDist = null;
    objectiveApproachRuntime.activeObjectiveBearing = null;
    objectiveApproachRuntime.activeBeaconDist = null;
    objectiveApproachRuntime.activeBeaconBearing = null;
    return null;
  }

  const dist = guidance.dist;
  const bearing = guidance.bearing;
  objectiveApproachRuntime.activeObjectiveDist = dist;
  objectiveApproachRuntime.activeObjectiveBearing = bearing;
  objectiveApproachRuntime.activeBeaconDist = dist;
  objectiveApproachRuntime.activeBeaconBearing = bearing;

  let nextPhase = 'far';
  if (dist <= OBJECTIVE_APPROACH.lockRadius) nextPhase = 'lock';
  else if (dist <= OBJECTIVE_APPROACH.nearRadius) nextPhase = 'approach';

  const lockBearingThreshold = Math.min(OBJECTIVE_APPROACH.lockBearingRad, OBJECTIVE_APPROACH.attuneBearingRad + 0.04);
  const lockDistThreshold = Math.min(OBJECTIVE_APPROACH.lockRadius, OBJECTIVE_APPROACH.attuneRadius + 0.08);
  const facingGood = Math.abs(bearing) <= lockBearingThreshold;
  const inLockWindow = nextPhase === 'lock' && dist <= lockDistThreshold && facingGood;

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
    objectiveId: guidance.objective.id,
    inInteractionRange: dist <= pilgrimageQuest.radius,
    inAttuneRadius: dist <= OBJECTIVE_APPROACH.attuneRadius,
    phase: objectiveApproachRuntime.phase,
    lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
    canAttune: objectiveApproachRuntime.canAttune
  };
}

function updateObjectiveLockSignals(nowMs = performance.now()) {
  const activeObjective = getActiveObjectiveEntity();
  const activeId = activeObjective?.id || null;
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
        pilgrimageQuest.lockHudEl.textContent = `${activeObjective.label} lock stable · attune ready`;
      } else if (currentPhase === 'lock') {
        pilgrimageQuest.lockHudEl.classList.remove('locked');
        const pct = Math.round(Math.min(100, (objectiveApproachRuntime.lockStableMs / OBJECTIVE_APPROACH.lockStableMsRequired) * 100));
        pilgrimageQuest.lockHudEl.textContent = `Stabilizing lock… ${pct}%`;
      } else if (currentPhase === 'approach') {
        pilgrimageQuest.lockHudEl.classList.remove('locked');
        pilgrimageQuest.lockHudEl.textContent = `Approach ${activeObjective.label} and align`;
      } else {
        pilgrimageQuest.lockHudEl.classList.remove('locked');
        pilgrimageQuest.lockHudEl.textContent = `Tracking ${activeObjective.label}`;
      }
    }
  }

  const prevPhase = objectiveApproachRuntime.lastPhase;
  if (activeId && prevPhase !== 'lock' && currentPhase === 'lock') {
    rememberQuestEvent('objective_lock_acquired', {
      objectiveId: activeId,
      lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
      activeObjectiveDist: Number((objectiveApproachRuntime.activeObjectiveDist || 0).toFixed(2)),
      activeObjectiveBearing: Number((objectiveApproachRuntime.activeObjectiveBearing || 0).toFixed(3)),
      activeBeaconDist: Number((objectiveApproachRuntime.activeObjectiveDist || 0).toFixed(2)),
      activeBeaconBearing: Number((objectiveApproachRuntime.activeObjectiveBearing || 0).toFixed(3))
    });
  }

  if (activeId && prevPhase === 'lock' && currentPhase !== 'lock') {
    rememberQuestEvent('objective_lock_lost', {
      objectiveId: activeId,
      phase: currentPhase,
      lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
      activeObjectiveDist: Number((objectiveApproachRuntime.activeObjectiveDist || 0).toFixed(2)),
      activeObjectiveBearing: Number((objectiveApproachRuntime.activeObjectiveBearing || 0).toFixed(3)),
      activeBeaconDist: Number((objectiveApproachRuntime.activeObjectiveDist || 0).toFixed(2)),
      activeBeaconBearing: Number((objectiveApproachRuntime.activeObjectiveBearing || 0).toFixed(3))
    });
  }

  objectiveApproachRuntime.lastPhase = currentPhase;
  clearObjectiveCueIfExpired(nowMs);
}

function getObjectiveSnapshot() {
  const guidance = updateObjectiveSnapshotRuntime();
  const returnTimeRemainingSec = getReturnTimeRemainingSec();
  const epilogueActive = pilgrimageQuest.questStage === QUEST_STAGES.RETURN_ACTIVE && epilogueRuntime.active;

  return {
    questId: pilgrimageQuest.questId,
    phase: pilgrimageQuest.phase,
    questStage: pilgrimageQuest.questStage,
    activeObjectiveId: pilgrimageQuest.activeObjectiveId,
    finaleObjectiveId: pilgrimageQuest.finaleObjectiveId,
    returnObjectiveId: pilgrimageQuest.returnObjectiveId,
    finaleUnlocked: pilgrimageQuest.finaleUnlocked,
    finaleCompleted: pilgrimageQuest.finaleCompleted,
    returnActive: pilgrimageQuest.returnActive,
    returnFailed: pilgrimageQuest.returnFailed,
    cycleCompleted: pilgrimageQuest.cycleCompleted,
    epilogueActive,
    returnTimeBudgetSec: epilogueRuntime.budgetSec,
    returnTimeRemainingSec: Number.isFinite(returnTimeRemainingSec) ? Number(returnTimeRemainingSec.toFixed(3)) : null,
    completedObjectiveIds: [...pilgrimageQuest.completedObjectiveIds],
    progress: Number(pilgrimageQuest.progress.toFixed(3)),
    finaleProgress: pilgrimageQuest.finaleCompleted ? 1 : pilgrimageQuest.finaleUnlocked ? 0.5 : 0,
    returnSplitSec: Number.isFinite(objectivePacingRuntime.returnSplitSec) ? Number(objectivePacingRuntime.returnSplitSec.toFixed(3)) : null,
    totalCycleSec: Number.isFinite(objectivePacingRuntime.totalCycleSec) ? Number(objectivePacingRuntime.totalCycleSec.toFixed(3)) : null,
    objectiveSplitSec: objectivePacingRuntime.objectiveSplitSec.has(pilgrimageQuest.activeObjectiveId)
      ? Number(objectivePacingRuntime.objectiveSplitSec.get(pilgrimageQuest.activeObjectiveId).toFixed(3))
      : (objectivePacingRuntime.objectiveStartedAtSec.has(pilgrimageQuest.activeObjectiveId)
          ? Number((clock.elapsedTime - objectivePacingRuntime.objectiveStartedAtSec.get(pilgrimageQuest.activeObjectiveId)).toFixed(3))
          : null),
    questElapsedSec: getQuestElapsedSec(),
    routeHintId: routeGuidanceRuntime.routeHint?.id || null,
    routeHintIndex: Number.isFinite(routeGuidanceRuntime.routeHint?.index) ? routeGuidanceRuntime.routeHint.index : null,
    routeHintDist: Number.isFinite(routeGuidanceRuntime.routeHint?.dist) ? Number(routeGuidanceRuntime.routeHint.dist.toFixed(2)) : null,
    routeHintBearing: Number.isFinite(routeGuidanceRuntime.routeHint?.bearing) ? Number(routeGuidanceRuntime.routeHint.bearing.toFixed(3)) : null,
    guidance: guidance
      ? {
        dist: Number(guidance.dist.toFixed(2)),
        bearing: Number(guidance.bearing.toFixed(3)),
        objectiveId: guidance.objectiveId,
        inInteractionRange: guidance.inInteractionRange,
        inAttuneRadius: guidance.inAttuneRadius,
        approachPhase: guidance.phase,
        lockStableMs: guidance.lockStableMs,
        canAttune: guidance.canAttune,
        routeHintId: routeGuidanceRuntime.routeHint?.id || null,
        routeHintIndex: Number.isFinite(routeGuidanceRuntime.routeHint?.index) ? routeGuidanceRuntime.routeHint.index : null,
        routeHintDist: Number.isFinite(routeGuidanceRuntime.routeHint?.dist) ? Number(routeGuidanceRuntime.routeHint.dist.toFixed(2)) : null,
        routeHintBearing: Number.isFinite(routeGuidanceRuntime.routeHint?.bearing) ? Number(routeGuidanceRuntime.routeHint.bearing.toFixed(3)) : null,
        objectiveSplitSec: objectivePacingRuntime.objectiveStartedAtSec.has(guidance.objectiveId)
          ? Number((clock.elapsedTime - objectivePacingRuntime.objectiveStartedAtSec.get(guidance.objectiveId)).toFixed(3))
          : null,
        questElapsedSec: getQuestElapsedSec()
      }
      : null,
    approachPhase: objectiveApproachRuntime.phase,
    lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
    canAttune: Boolean(objectiveApproachRuntime.canAttune),
    activeObjectiveDist: Number.isFinite(objectiveApproachRuntime.activeObjectiveDist)
      ? Number(objectiveApproachRuntime.activeObjectiveDist.toFixed(2))
      : null,
    activeObjectiveBearing: Number.isFinite(objectiveApproachRuntime.activeObjectiveBearing)
      ? Number(objectiveApproachRuntime.activeObjectiveBearing.toFixed(3))
      : null,
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

function showQuestCompletionBanner(message = null) {
  if (!pilgrimageQuest.completionBannerEl) return;
  if (message) pilgrimageQuest.completionBannerEl.textContent = message;
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

function setSanctumVisualState(nextState) {
  const sanctum = pilgrimageQuest.sanctum;
  if (!sanctum || sanctum.state === nextState) return;
  sanctum.state = nextState;

  if (nextState === 'dormant') {
    sanctum.core.material.emissive.setHex(0x254977);
    sanctum.core.material.emissiveIntensity = 0.42;
    sanctum.beam.visible = false;
    sanctum.pathMarker.visible = false;
  } else if (nextState === 'unlocked') {
    sanctum.core.material.emissive.setHex(0x3b8fff);
    sanctum.core.material.emissiveIntensity = 1.15;
    sanctum.beam.material.color.setHex(0x97e0ff);
    sanctum.beam.material.opacity = 0.5;
    sanctum.beam.visible = true;
    sanctum.pathMarker.material.opacity = 0.5;
    sanctum.pathMarker.visible = true;
  } else {
    sanctum.core.material.emissive.setHex(0x55ffc8);
    sanctum.core.material.emissiveIntensity = 1.28;
    sanctum.beam.material.color.setHex(0x73ffcf);
    sanctum.beam.material.opacity = 0.56;
    sanctum.beam.visible = true;
    sanctum.pathMarker.material.opacity = 0.65;
    sanctum.pathMarker.visible = true;
  }
}

function setReturnShrineVisualState(nextState) {
  const shrine = pilgrimageQuest.returnShrine;
  if (!shrine || shrine.state === nextState) return;
  shrine.state = nextState;

  if (nextState === 'active') {
    shrine.core.material.emissive.setHex(0x8f7cff);
    shrine.core.material.emissiveIntensity = 1.24;
    shrine.beam.material.color.setHex(0xc6a7ff);
    shrine.beam.material.opacity = 0.58;
    shrine.beam.visible = true;
    shrine.pathMarker.visible = true;
    shrine.pathMarker.material.opacity = 0.54;
  } else if (nextState === 'completed') {
    shrine.core.material.emissive.setHex(0x6dffcf);
    shrine.core.material.emissiveIntensity = 1.3;
    shrine.beam.material.color.setHex(0x8effd7);
    shrine.beam.material.opacity = 0.63;
    shrine.beam.visible = true;
    shrine.pathMarker.visible = true;
    shrine.pathMarker.material.opacity = 0.68;
  } else if (nextState === 'failed') {
    shrine.core.material.emissive.setHex(0xff8f9f);
    shrine.core.material.emissiveIntensity = 1.08;
    shrine.beam.material.color.setHex(0xffa6bd);
    shrine.beam.material.opacity = 0.44;
    shrine.beam.visible = true;
    shrine.pathMarker.visible = true;
    shrine.pathMarker.material.opacity = 0.42;
  } else {
    shrine.core.material.emissive.setHex(0x2f3f95);
    shrine.core.material.emissiveIntensity = 0.42;
    shrine.beam.visible = false;
    shrine.pathMarker.visible = false;
  }
}

function getQuestTotalObjectives() {
  return BEACON_LAYOUT.length + 2;
}

function syncBeaconQuestPhase() {
  const completedBeacons = BEACON_LAYOUT.filter((beacon) => pilgrimageQuest.completedObjectiveIds.includes(beacon.id)).length;
  const sanctumCompleted = pilgrimageQuest.completedObjectiveIds.includes(pilgrimageQuest.finaleObjectiveId);
  const returnCompleted = pilgrimageQuest.completedObjectiveIds.includes(pilgrimageQuest.returnObjectiveId);
  const totalObjectives = getQuestTotalObjectives();
  pilgrimageQuest.progress = Number(((completedBeacons + (sanctumCompleted ? 1 : 0) + (returnCompleted ? 1 : 0)) / totalObjectives).toFixed(3));

  pilgrimageQuest.beacons.forEach((beacon) => {
    if (pilgrimageQuest.completedObjectiveIds.includes(beacon.id)) setBeaconVisualState(beacon, 'completed');
    else if (!pilgrimageQuest.finaleUnlocked && beacon.id === BEACON_LAYOUT[completedBeacons]?.id) setBeaconVisualState(beacon, 'active');
    else setBeaconVisualState(beacon, 'inactive');
  });

  if (pilgrimageQuest.cycleCompleted) {
    pilgrimageQuest.questStage = QUEST_STAGES.CYCLE_COMPLETED;
    pilgrimageQuest.phase = 'completed';
    pilgrimageQuest.activeObjectiveId = null;
  } else if (pilgrimageQuest.returnFailed) {
    pilgrimageQuest.questStage = QUEST_STAGES.RETURN_FAILED;
    pilgrimageQuest.phase = 'return_failed';
    pilgrimageQuest.activeObjectiveId = null;
  } else if (pilgrimageQuest.returnActive) {
    pilgrimageQuest.questStage = QUEST_STAGES.RETURN_ACTIVE;
    pilgrimageQuest.phase = RETURN_OBJECTIVE.id;
    pilgrimageQuest.activeObjectiveId = RETURN_OBJECTIVE.id;
  } else if (completedBeacons >= BEACON_LAYOUT.length) {
    if (sanctumCompleted) {
      pilgrimageQuest.questStage = QUEST_STAGES.FINALE_COMPLETED;
      pilgrimageQuest.phase = SANCTUM_OBJECTIVE.id;
      pilgrimageQuest.activeObjectiveId = SANCTUM_OBJECTIVE.id;
      pilgrimageQuest.finaleCompleted = true;
    } else {
      pilgrimageQuest.questStage = QUEST_STAGES.SANCTUM_UNLOCKED;
      pilgrimageQuest.phase = SANCTUM_OBJECTIVE.id;
      pilgrimageQuest.activeObjectiveId = SANCTUM_OBJECTIVE.id;
      pilgrimageQuest.finaleUnlocked = true;
    }
  } else {
    const nextBeacon = BEACON_LAYOUT[completedBeacons];
    pilgrimageQuest.questStage = QUEST_STAGES.BEACONS_ACTIVE;
    pilgrimageQuest.phase = nextBeacon.id;
    pilgrimageQuest.activeObjectiveId = nextBeacon.id;
    pilgrimageQuest.finaleUnlocked = false;
    pilgrimageQuest.finaleCompleted = false;
  }

  if (pilgrimageQuest.sanctum) {
    if (pilgrimageQuest.finaleCompleted) setSanctumVisualState('completed');
    else if (pilgrimageQuest.finaleUnlocked) setSanctumVisualState('unlocked');
    else setSanctumVisualState('dormant');
  }

  if (pilgrimageQuest.returnShrine) {
    if (pilgrimageQuest.cycleCompleted) setReturnShrineVisualState('completed');
    else if (pilgrimageQuest.returnFailed) setReturnShrineVisualState('failed');
    else if (pilgrimageQuest.returnActive) setReturnShrineVisualState('active');
    else setReturnShrineVisualState('dormant');
  }

  worldStageGrade.target = getQuestStageGrade(pilgrimageQuest.questStage);
  updateObjectiveHud();
}

function resetEpilogueRuntime() {
  epilogueRuntime.active = false;
  epilogueRuntime.startedAtSec = null;
  epilogueRuntime.deadlineAtSec = null;
  epilogueRuntime.budgetSec = EPILOGUE_RETURN_TIMER_SEC;
  epilogueRuntime.warnedThresholds.clear();
  epilogueRuntime.warningCooldownMs = 0;
  epilogueRuntime.failed = false;
  epilogueRuntime.completed = false;
}

function beginReturnEpilogue() {
  epilogueRuntime.active = true;
  epilogueRuntime.failed = false;
  epilogueRuntime.completed = false;
  epilogueRuntime.warnedThresholds.clear();
  epilogueRuntime.startedAtSec = Number(clock.elapsedTime.toFixed(3));
  epilogueRuntime.deadlineAtSec = Number((epilogueRuntime.startedAtSec + epilogueRuntime.budgetSec).toFixed(3));
}

function getReturnTimeRemainingSec() {
  if (!epilogueRuntime.active || !Number.isFinite(epilogueRuntime.deadlineAtSec)) return null;
  return Number(Math.max(0, epilogueRuntime.deadlineAtSec - clock.elapsedTime).toFixed(3));
}

function handleReturnTimeout() {
  if (!epilogueRuntime.active || epilogueRuntime.failed || pilgrimageQuest.cycleCompleted) return;

  epilogueRuntime.failed = true;
  epilogueRuntime.active = false;
  pilgrimageQuest.returnActive = false;
  pilgrimageQuest.returnFailed = true;
  pilgrimageQuest.activeObjectiveId = null;

  rememberQuestEvent('return_failed', {
    objectiveId: pilgrimageQuest.returnObjectiveId,
    returnSplitSec: Number((clock.elapsedTime - (epilogueRuntime.startedAtSec || clock.elapsedTime)).toFixed(3)),
    totalCycleSec: getQuestElapsedSec(),
    returnTimeBudgetSec: epilogueRuntime.budgetSec,
    returnTimeRemainingSec: 0,
    reason: 'return_timeout',
    questStage: QUEST_STAGES.RETURN_FAILED,
    questElapsedSec: getQuestElapsedSec()
  });

  syncBeaconQuestPhase();
  resetObjectiveApproachRuntime();
  showQuestStatus('Return window collapsed. Pilgrimage resetting…');

  setTimeout(() => {
    startBeaconQuest();
    showQuestStatus('Cycle reset. Begin the pilgrimage again.');
  }, 1400);
}

function updateEpilogueTimer() {
  if (!epilogueRuntime.active || pilgrimageQuest.questStage !== QUEST_STAGES.RETURN_ACTIVE) return;

  const remainingSec = getReturnTimeRemainingSec();
  if (!Number.isFinite(remainingSec)) return;

  for (const threshold of EPILOGUE_WARNING_THRESHOLDS_SEC) {
    if (remainingSec <= threshold && !epilogueRuntime.warnedThresholds.has(threshold)) {
      epilogueRuntime.warnedThresholds.add(threshold);
      rememberQuestEvent('return_timer_warning', {
        objectiveId: pilgrimageQuest.returnObjectiveId,
        thresholdSec: threshold,
        returnTimeRemainingSec: Number(remainingSec.toFixed(3)),
        questElapsedSec: getQuestElapsedSec()
      });
      if (threshold <= 10 && performance.now() > epilogueRuntime.warningCooldownMs) {
        showQuestStatus(`Epilogue unstable: ${Math.ceil(remainingSec)}s to reach the return shrine.`);
        epilogueRuntime.warningCooldownMs = performance.now() + 2000;
      }
    }
  }

  if (remainingSec <= 0.0001) {
    handleReturnTimeout();
  }
}

function resetObjectiveApproachRuntime() {
  objectiveApproachRuntime.phase = pilgrimageQuest.phase === 'completed' ? 'complete' : 'far';
  objectiveApproachRuntime.lockStableMs = 0;
  objectiveApproachRuntime.canAttune = false;
  objectiveApproachRuntime.activeObjectiveDist = null;
  objectiveApproachRuntime.activeObjectiveBearing = null;
  objectiveApproachRuntime.activeBeaconDist = null;
  objectiveApproachRuntime.activeBeaconBearing = null;
  objectiveApproachRuntime.lockAcquiredAtMs = 0;
  objectiveApproachRuntime.lastPhase = objectiveApproachRuntime.phase;
  objectiveApproachRuntime.lastObjectiveId = pilgrimageQuest.activeObjectiveId;
  objectiveApproachRuntime.attuneStartedAtMs = 0;
  routeGuidanceRuntime.routeHint = null;
}

function beginObjectiveTiming(objectiveId) {
  if (!objectiveId) return;
  objectivePacingRuntime.objectiveStartedAtSec.set(objectiveId, Number(clock.elapsedTime.toFixed(3)));
}

function beginObjectiveHandoff(fromObjectiveId, toObjectiveId = null) {
  const nowMs = performance.now();
  objectivePacingRuntime.handoff.active = true;
  objectivePacingRuntime.handoff.startedAtMs = nowMs;
  objectivePacingRuntime.handoff.settleAtMs = nowMs + OBJECTIVE_HANDOFF.settleMs;
  objectivePacingRuntime.handoff.releaseColliderUntilMs = nowMs + OBJECTIVE_HANDOFF.releaseColliderMs;
  objectivePacingRuntime.handoff.fromObjectiveId = fromObjectiveId;
  objectivePacingRuntime.handoff.toObjectiveId = toObjectiveId;
  objectivePacingRuntime.handoff.settled = false;
  rememberQuestEvent('objective_handoff_started', {
    fromObjectiveId,
    toObjectiveId,
    settleMs: OBJECTIVE_HANDOFF.settleMs
  });
}

function settleObjectiveHandoffIfReady(nowMs = performance.now()) {
  if (!objectivePacingRuntime.handoff.active || objectivePacingRuntime.handoff.settled || nowMs < objectivePacingRuntime.handoff.settleAtMs) return;

  objectivePacingRuntime.handoff.settled = true;
  rememberQuestEvent('objective_handoff_settled', {
    fromObjectiveId: objectivePacingRuntime.handoff.fromObjectiveId,
    toObjectiveId: objectivePacingRuntime.handoff.toObjectiveId,
    settleMs: Math.round(nowMs - objectivePacingRuntime.handoff.startedAtMs)
  });
  objectivePacingRuntime.handoff.active = false;
}

function getQuestElapsedSec() {
  const elapsed = clock.elapsedTime - objectivePacingRuntime.questStartedAtSec;
  return Number(Math.max(0, elapsed).toFixed(3));
}

function startBeaconQuest() {
  pilgrimageQuest.phase = 'intro';
  pilgrimageQuest.questStage = QUEST_STAGES.BEACONS_ACTIVE;
  pilgrimageQuest.activeObjectiveId = BEACON_LAYOUT[0]?.id || null;
  pilgrimageQuest.finaleObjectiveId = SANCTUM_OBJECTIVE.id;
  pilgrimageQuest.returnObjectiveId = RETURN_OBJECTIVE.id;
  pilgrimageQuest.finaleUnlocked = false;
  pilgrimageQuest.finaleCompleted = false;
  pilgrimageQuest.returnActive = false;
  pilgrimageQuest.returnFailed = false;
  pilgrimageQuest.cycleCompleted = false;
  pilgrimageQuest.completedObjectiveIds = [];
  pilgrimageQuest.progress = 0;
  pilgrimageQuest.recentEvents.length = 0;

  objectivePacingRuntime.questStartedAtSec = Number(clock.elapsedTime.toFixed(3));
  objectivePacingRuntime.objectiveStartedAtSec.clear();
  objectivePacingRuntime.objectiveSplitSec.clear();
  objectivePacingRuntime.lockToAttuneMs.clear();
  objectivePacingRuntime.returnSplitSec = null;
  objectivePacingRuntime.totalCycleSec = null;
  objectivePacingRuntime.handoff.active = false;
  objectivePacingRuntime.handoff.fromObjectiveId = null;
  objectivePacingRuntime.handoff.toObjectiveId = null;

  resetEpilogueRuntime();
  syncBeaconQuestPhase();
  resetObjectiveApproachRuntime();
  beginObjectiveTiming(pilgrimageQuest.activeObjectiveId);

  rememberQuestEvent('objective_started', {
    objectiveId: pilgrimageQuest.activeObjectiveId,
    phase: pilgrimageQuest.phase,
    questStage: pilgrimageQuest.questStage,
    progress: pilgrimageQuest.progress,
    questElapsedSec: getQuestElapsedSec()
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

  pilgrimageQuest.epilogueHudEl = document.createElement('div');
  pilgrimageQuest.epilogueHudEl.id = 'objective-epilogue-hud';
  document.body.appendChild(pilgrimageQuest.epilogueHudEl);

  pilgrimageQuest.lockHudEl = document.createElement('div');
  pilgrimageQuest.lockHudEl.id = 'objective-lock-hud';
  document.body.appendChild(pilgrimageQuest.lockHudEl);

  pilgrimageQuest.nextCueEl = document.createElement('div');
  pilgrimageQuest.nextCueEl.id = 'objective-next-cue';
  document.body.appendChild(pilgrimageQuest.nextCueEl);

  pilgrimageQuest.completionBannerEl = document.createElement('div');
  pilgrimageQuest.completionBannerEl.id = 'quest-complete-banner';
  pilgrimageQuest.completionBannerEl.textContent = 'Pilgrimage Cycle Complete · Return secured';
  document.body.appendChild(pilgrimageQuest.completionBannerEl);
}

function createBeaconPilgrimageQuest() {
  worldColliders.clear();
  staticColliderSeq = 0;
  pilgrimageQuest.beacons = BEACON_LAYOUT.map(createBeacon);
  pilgrimageQuest.sanctum = createSanctumCore(SANCTUM_OBJECTIVE);
  pilgrimageQuest.returnShrine = createReturnShrine(RETURN_OBJECTIVE);
  createRouteGuidanceLayer();
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

function getNearestInteractableInRange() {
  if (!player) return null;
  const interactables = [...pilgrimageQuest.beacons];
  if (pilgrimageQuest.sanctum) interactables.push(pilgrimageQuest.sanctum);
  if (pilgrimageQuest.returnShrine) interactables.push(pilgrimageQuest.returnShrine);

  let best = null;
  for (const objective of interactables) {
    const dist = player.position.distanceTo(objective.mesh.position);
    if (dist <= pilgrimageQuest.radius && (!best || dist < best.dist)) {
      best = { objective, dist };
    }
  }
  return best;
}

function updateInteractionUI() {
  if (!pilgrimageQuest.promptEl) return;

  const nearby = getNearestInteractableInRange();
  if (!nearby) {
    pilgrimageQuest.promptEl.style.opacity = '0';
    pilgrimageQuest.promptEl.style.transform = 'translate(-50%, 6px)';
    return;
  }

  const activeObjective = getActiveObjectiveEntity();
  if (nearby.objective.id === activeObjective?.id) {
    if (objectiveApproachRuntime.canAttune) {
      pilgrimageQuest.promptEl.textContent = `Press E to attune ${nearby.objective.label}`;
    } else if (objectiveApproachRuntime.phase === 'lock') {
      pilgrimageQuest.promptEl.textContent = `Hold alignment for attunement lock on ${nearby.objective.label}`;
    } else {
      pilgrimageQuest.promptEl.textContent = `Approach and align with ${nearby.objective.label}`;
    }
  } else if (pilgrimageQuest.phase === 'completed') {
    pilgrimageQuest.promptEl.textContent = `${nearby.objective.label} is already attuned`;
  } else {
    pilgrimageQuest.promptEl.textContent = `${nearby.objective.label} is dormant. Follow the active objective signal.`;
  }

  pilgrimageQuest.promptEl.style.opacity = '1';
  pilgrimageQuest.promptEl.style.transform = 'translate(-50%, 0)';
}

function updateObjectiveHud() {
  if (!pilgrimageQuest.objectiveHudEl) return;

  const routeHint = routeGuidanceRuntime.routeHint;
  const hintSuffix = routeHint && Number.isFinite(routeHint.dist)
    ? ` · route ${Math.max(0, Math.round(routeHint.dist))}m`
    : '';

  if (pilgrimageQuest.questStage === QUEST_STAGES.CYCLE_COMPLETED) {
    pilgrimageQuest.objectiveHudEl.textContent = 'Objective: Return shrine stabilized · pilgrimage cycle complete';
    pilgrimageQuest.objectiveHudEl.classList.add('complete');
    return;
  }

  if (pilgrimageQuest.questStage === QUEST_STAGES.RETURN_FAILED) {
    pilgrimageQuest.objectiveHudEl.textContent = 'Objective: Return window collapsed · cycle reset incoming';
    pilgrimageQuest.objectiveHudEl.classList.remove('complete');
    return;
  }

  if (pilgrimageQuest.questStage === QUEST_STAGES.RETURN_ACTIVE) {
    const remainingSec = getReturnTimeRemainingSec();
    const remainingTxt = Number.isFinite(remainingSec) ? `${Math.max(0, Math.ceil(remainingSec))}s` : '--';
    pilgrimageQuest.objectiveHudEl.textContent = `Objective: Extract to the Return Shrine · ${remainingTxt} remaining${hintSuffix}`;
    pilgrimageQuest.objectiveHudEl.classList.remove('complete');
    return;
  }

  if (pilgrimageQuest.questStage === QUEST_STAGES.FINALE_COMPLETED) {
    pilgrimageQuest.objectiveHudEl.textContent = 'Objective: Sanctum attuned · begin extraction to spawn shrine';
    pilgrimageQuest.objectiveHudEl.classList.remove('complete');
    return;
  }

  pilgrimageQuest.objectiveHudEl.classList.remove('complete');

  if (pilgrimageQuest.questStage === QUEST_STAGES.SANCTUM_UNLOCKED || pilgrimageQuest.questStage === QUEST_STAGES.FINALE_ATTUNING) {
    pilgrimageQuest.objectiveHudEl.textContent = `Objective: Enter the Sanctum and attune the core · Finale${hintSuffix}`;
    return;
  }

  const activeBeacon = getActiveBeacon();
  const completed = BEACON_LAYOUT.filter((beacon) => pilgrimageQuest.completedObjectiveIds.includes(beacon.id)).length;
  pilgrimageQuest.objectiveHudEl.textContent = `Objective: Attune ${activeBeacon?.label || 'next beacon'} · ${completed}/3 beacons complete${hintSuffix}`;
}

function updateEpilogueHud() {
  if (!pilgrimageQuest.epilogueHudEl) return;

  if (pilgrimageQuest.questStage !== QUEST_STAGES.RETURN_ACTIVE) {
    pilgrimageQuest.epilogueHudEl.classList.remove('show', 'critical');
    pilgrimageQuest.epilogueHudEl.textContent = '';
    return;
  }

  const remainingSec = getReturnTimeRemainingSec();
  const budgetSec = epilogueRuntime.budgetSec;
  if (!Number.isFinite(remainingSec)) {
    pilgrimageQuest.epilogueHudEl.classList.remove('show', 'critical');
    pilgrimageQuest.epilogueHudEl.textContent = '';
    return;
  }

  const ratio = budgetSec > 0 ? remainingSec / budgetSec : 0;
  const critical = remainingSec <= 10 || ratio <= 0.18;
  pilgrimageQuest.epilogueHudEl.classList.add('show');
  pilgrimageQuest.epilogueHudEl.classList.toggle('critical', critical);
  pilgrimageQuest.epilogueHudEl.textContent = `Epilogue unstable · return to shrine in ${Math.max(0, Math.ceil(remainingSec))}s`;
}

function triggerBeaconPulse(beacon, pulseType = 'attune') {
  if (!beacon) return;
  beacon.pulseStartAt = clock.elapsedTime;
  beacon.pulseType = pulseType;
}

function completeActiveObjective(objective) {
  if (!objective || pilgrimageQuest.completedObjectiveIds.includes(objective.id)) return;

  pilgrimageQuest.completedObjectiveIds.push(objective.id);
  triggerBeaconPulse(objective, 'attune');

  const objectiveStartedAtSec = objectivePacingRuntime.objectiveStartedAtSec.get(objective.id);
  const objectiveSplitSec = Number.isFinite(objectiveStartedAtSec)
    ? Number((clock.elapsedTime - objectiveStartedAtSec).toFixed(3))
    : null;
  if (Number.isFinite(objectiveSplitSec)) {
    objectivePacingRuntime.objectiveSplitSec.set(objective.id, objectiveSplitSec);
  }

  const lockToAttuneMs = (objectiveApproachRuntime.attuneStartedAtMs > 0 && objectiveApproachRuntime.lockAcquiredAtMs > 0)
    ? Math.max(0, Math.round(objectiveApproachRuntime.attuneStartedAtMs - objectiveApproachRuntime.lockAcquiredAtMs))
    : null;
  if (Number.isFinite(lockToAttuneMs)) {
    objectivePacingRuntime.lockToAttuneMs.set(objective.id, lockToAttuneMs);
  }

  const objectiveProgress = Number((pilgrimageQuest.completedObjectiveIds.length / getQuestTotalObjectives()).toFixed(3));
  rememberQuestEvent('objective_completed', {
    objectiveId: objective.id,
    progress: objectiveProgress,
    questStage: pilgrimageQuest.questStage,
    objectiveSplitSec,
    lockToAttuneMs,
    questElapsedSec: getQuestElapsedSec()
  });
  rememberQuestEvent('objective_split', {
    objectiveId: objective.id,
    objectiveSplitSec,
    lockToAttuneMs,
    questElapsedSec: getQuestElapsedSec()
  });

  showQuestStatus(`${objective.label} attuned.`);
  enqueueBridgeEvent('interaction', {
    targetId: objective.id,
    result: 'attuned'
  });

  if (objective.id === pilgrimageQuest.finaleObjectiveId) {
    pilgrimageQuest.finaleCompleted = true;
    pilgrimageQuest.returnActive = true;
    pilgrimageQuest.returnFailed = false;
    pilgrimageQuest.questStage = QUEST_STAGES.RETURN_ACTIVE;
    pilgrimageQuest.phase = RETURN_OBJECTIVE.id;
    pilgrimageQuest.activeObjectiveId = pilgrimageQuest.returnObjectiveId;

    beginReturnEpilogue();
    objectivePacingRuntime.returnSplitSec = null;
    objectivePacingRuntime.totalCycleSec = null;

    rememberQuestEvent('finale_completed', {
      objectiveId: objective.id,
      progress: pilgrimageQuest.progress,
      objectiveSplitSec,
      lockToAttuneMs,
      returnObjectiveId: pilgrimageQuest.returnObjectiveId,
      returnTimeBudgetSec: epilogueRuntime.budgetSec,
      questElapsedSec: getQuestElapsedSec()
    });
    rememberQuestEvent('return_started', {
      objectiveId: pilgrimageQuest.returnObjectiveId,
      fromObjectiveId: objective.id,
      returnTimeBudgetSec: epilogueRuntime.budgetSec,
      returnTimeRemainingSec: epilogueRuntime.budgetSec,
      questElapsedSec: getQuestElapsedSec()
    });

    beginObjectiveHandoff(objective.id, pilgrimageQuest.returnObjectiveId);
    beginObjectiveTiming(pilgrimageQuest.returnObjectiveId);
    rememberQuestEvent('objective_started', {
      objectiveId: pilgrimageQuest.returnObjectiveId,
      phase: pilgrimageQuest.phase,
      questStage: pilgrimageQuest.questStage,
      progress: pilgrimageQuest.progress,
      returnTimeBudgetSec: epilogueRuntime.budgetSec,
      returnTimeRemainingSec: epilogueRuntime.budgetSec,
      questElapsedSec: getQuestElapsedSec()
    });

    const returnObjective = getObjectiveEntityById(pilgrimageQuest.returnObjectiveId);
    if (returnObjective) {
      triggerBeaconPulse(returnObjective, 'next_cue');
      triggerNextObjectiveCue(returnObjective, `Epilogue unstable · return in ${epilogueRuntime.budgetSec}s`);
    }

    syncBeaconQuestPhase();
    resetObjectiveApproachRuntime();
    showQuestStatus(`Sanctum attuned. Return to spawn shrine in ${epilogueRuntime.budgetSec}s.`);
    return;
  }

  if (objective.id === pilgrimageQuest.returnObjectiveId) {
    epilogueRuntime.active = false;
    epilogueRuntime.completed = true;
    pilgrimageQuest.returnActive = false;
    pilgrimageQuest.returnFailed = false;
    pilgrimageQuest.cycleCompleted = true;
    pilgrimageQuest.questStage = QUEST_STAGES.CYCLE_COMPLETED;
    pilgrimageQuest.phase = 'completed';
    pilgrimageQuest.activeObjectiveId = null;

    objectivePacingRuntime.returnSplitSec = Number((clock.elapsedTime - (epilogueRuntime.startedAtSec || clock.elapsedTime)).toFixed(3));
    objectivePacingRuntime.totalCycleSec = getQuestElapsedSec();

    syncBeaconQuestPhase();
    resetObjectiveApproachRuntime();

    rememberQuestEvent('return_completed', {
      objectiveId: objective.id,
      progress: pilgrimageQuest.progress,
      objectiveSplitSec,
      lockToAttuneMs,
      returnSplitSec: objectivePacingRuntime.returnSplitSec,
      totalCycleSec: objectivePacingRuntime.totalCycleSec,
      returnTimeBudgetSec: epilogueRuntime.budgetSec,
      returnTimeRemainingSec: getReturnTimeRemainingSec() ?? 0,
      questElapsedSec: getQuestElapsedSec()
    });
    rememberQuestEvent('pilgrimage_cycle_completed', {
      objectiveId: objective.id,
      progress: pilgrimageQuest.progress,
      returnSplitSec: objectivePacingRuntime.returnSplitSec,
      totalCycleSec: objectivePacingRuntime.totalCycleSec,
      returnTimeBudgetSec: epilogueRuntime.budgetSec,
      questStage: pilgrimageQuest.questStage,
      questElapsedSec: getQuestElapsedSec()
    });
    rememberQuestEvent('quest_completed', {
      objectiveId: objective.id,
      progress: pilgrimageQuest.progress,
      questStage: pilgrimageQuest.questStage,
      totalCycleSec: objectivePacingRuntime.totalCycleSec,
      questElapsedSec: getQuestElapsedSec()
    });

    showQuestCompletionBanner('Pilgrimage Cycle Complete · Return secured');
    showQuestStatus('Return shrine attuned. Cycle complete.');
    objectivePacingRuntime.handoff.active = false;
    objectivePacingRuntime.handoff.fromObjectiveId = null;
    objectivePacingRuntime.handoff.toObjectiveId = null;
    return;
  }

  const completedBeacons = BEACON_LAYOUT.filter((beacon) => pilgrimageQuest.completedObjectiveIds.includes(beacon.id)).length;
  if (completedBeacons >= BEACON_LAYOUT.length) {
    pilgrimageQuest.questStage = QUEST_STAGES.SANCTUM_UNLOCKED;
    syncBeaconQuestPhase();
    resetObjectiveApproachRuntime();
    beginObjectiveHandoff(objective.id, pilgrimageQuest.activeObjectiveId);
    beginObjectiveTiming(pilgrimageQuest.activeObjectiveId);
    rememberQuestEvent('finale_unlocked', {
      objectiveId: pilgrimageQuest.finaleObjectiveId,
      progress: pilgrimageQuest.progress,
      questStage: pilgrimageQuest.questStage,
      questElapsedSec: getQuestElapsedSec()
    });
    rememberQuestEvent('objective_started', {
      objectiveId: pilgrimageQuest.activeObjectiveId,
      phase: pilgrimageQuest.phase,
      questStage: pilgrimageQuest.questStage,
      progress: pilgrimageQuest.progress,
      questElapsedSec: getQuestElapsedSec()
    });
    triggerBeaconPulse(pilgrimageQuest.sanctum, 'next_cue');
    triggerNextObjectiveCue(pilgrimageQuest.sanctum, 'Sanctum unlocked · follow the sky beam');
    showQuestStatus(`${objective.label} attuned. Sanctum unlocked to the northeast.`);
    return;
  }

  const nextBeacon = BEACON_LAYOUT[completedBeacons];
  syncBeaconQuestPhase();
  resetObjectiveApproachRuntime();
  beginObjectiveHandoff(objective.id, pilgrimageQuest.activeObjectiveId);
  beginObjectiveTiming(pilgrimageQuest.activeObjectiveId);
  rememberQuestEvent('objective_started', {
    objectiveId: pilgrimageQuest.activeObjectiveId,
    phase: pilgrimageQuest.phase,
    questStage: pilgrimageQuest.questStage,
    progress: pilgrimageQuest.progress,
    questElapsedSec: getQuestElapsedSec()
  });
  const nextObjective = nextBeacon ? getObjectiveEntityById(nextBeacon.id) : null;
  if (nextObjective) {
    triggerBeaconPulse(nextObjective, 'next_cue');
    triggerNextObjectiveCue(nextObjective);
    showQuestStatus(`${objective.label} attuned. ${nextObjective.label} is now active.`);
  }
}

function tryTriggerInteraction(targetId = null) {
  if (!player) return false;

  const targetObjective = targetId
    ? getObjectiveEntityById(targetId)
    : getNearestInteractableInRange()?.objective;
  if (!targetObjective) return false;

  const distance = player.position.distanceTo(targetObjective.mesh.position);
  if (distance > pilgrimageQuest.radius) return false;

  updateObjectiveSnapshotRuntime();

  if (pilgrimageQuest.phase === 'completed') {
    showQuestStatus('The pilgrimage is already complete.');
    enqueueBridgeEvent('interaction', {
      targetId: targetObjective.id,
      result: 'already_completed'
    });
    return true;
  }

  if (targetObjective.id !== pilgrimageQuest.activeObjectiveId) {
    showQuestStatus(`${targetObjective.label} rejects attunement. Follow the active objective signal.`);
    rememberQuestEvent('rejected', {
      objectiveId: targetObjective.id,
      expectedObjectiveId: pilgrimageQuest.activeObjectiveId,
      progress: pilgrimageQuest.progress,
      reason: 'out_of_order'
    });
    enqueueBridgeEvent('interaction', {
      targetId: targetObjective.id,
      result: 'rejected_out_of_order'
    });
    return true;
  }

  if (!objectiveApproachRuntime.canAttune) {
    showQuestStatus('Attunement lock not stable yet. Align with the active objective.');
    enqueueBridgeEvent('interaction', {
      targetId: targetObjective.id,
      result: 'lock_unstable',
      lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs)
    });
    return true;
  }

  objectiveApproachRuntime.attuneStartedAtMs = performance.now();
  if (targetObjective.id === pilgrimageQuest.finaleObjectiveId && pilgrimageQuest.questStage !== QUEST_STAGES.FINALE_ATTUNING) {
    pilgrimageQuest.questStage = QUEST_STAGES.FINALE_ATTUNING;
    worldStageGrade.target = getQuestStageGrade(pilgrimageQuest.questStage);
    rememberQuestEvent('finale_started', {
      objectiveId: targetObjective.id,
      lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
      activeObjectiveDist: Number((objectiveApproachRuntime.activeObjectiveDist || distance).toFixed(2)),
      activeObjectiveBearing: Number((objectiveApproachRuntime.activeObjectiveBearing || 0).toFixed(3))
    });
  }

  rememberQuestEvent('attunement_started', {
    objectiveId: targetObjective.id,
    lockStableMs: Math.round(objectiveApproachRuntime.lockStableMs),
    activeObjectiveDist: Number((objectiveApproachRuntime.activeObjectiveDist || distance).toFixed(2)),
    activeObjectiveBearing: Number((objectiveApproachRuntime.activeObjectiveBearing || 0).toFixed(3)),
    activeBeaconDist: Number((objectiveApproachRuntime.activeObjectiveDist || distance).toFixed(2)),
    activeBeaconBearing: Number((objectiveApproachRuntime.activeObjectiveBearing || 0).toFixed(3)),
    objectiveSplitSec: objectivePacingRuntime.objectiveStartedAtSec.has(targetObjective.id)
      ? Number((clock.elapsedTime - objectivePacingRuntime.objectiveStartedAtSec.get(targetObjective.id)).toFixed(3))
      : null,
    questElapsedSec: getQuestElapsedSec(),
    questStage: pilgrimageQuest.questStage
  });
  completeActiveObjective(targetObjective);
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
      const cueVisible = objectiveApproachRuntime.cueObjectiveId === beacon.id && objectiveApproachRuntime.cueUntilMs > performance.now();
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

  const sanctum = pilgrimageQuest.sanctum;
  if (!sanctum?.core) return;

  const sanctumPulse = Math.sin(t * 2.9) * 0.5 + 0.5;
  sanctum.core.position.y = sanctum.baseCoreY + (sanctum.state === 'completed' ? 0.14 : 0.08) * sanctumPulse;
  sanctum.core.rotation.y += 0.012;

  if (sanctum.lockRing) {
    const lockVisible = sanctum.id === activeId && objectiveApproachRuntime.phase === 'lock';
    sanctum.lockRing.visible = lockVisible;
    if (lockVisible) {
      sanctum.lockRing.material.opacity = objectiveApproachRuntime.canAttune ? 0.93 : 0.32 + sanctumPulse * 0.45;
      sanctum.lockRing.scale.setScalar(objectiveApproachRuntime.canAttune ? 1.06 : 0.98 + sanctumPulse * 0.14);
    }
  }

  if (sanctum.cueRing) {
    const cueVisible = objectiveApproachRuntime.cueObjectiveId === sanctum.id && objectiveApproachRuntime.cueUntilMs > performance.now();
    sanctum.cueRing.visible = cueVisible;
    if (cueVisible) {
      sanctum.cueRing.material.opacity = 0.26 + sanctumPulse * 0.42;
      const cueScale = 1 + sanctumPulse * 0.34;
      sanctum.cueRing.scale.set(cueScale, cueScale, cueScale);
    }
  }

  if (sanctum.pathMarker?.material) {
    if (pilgrimageQuest.finaleUnlocked && !pilgrimageQuest.finaleCompleted) {
      sanctum.pathMarker.visible = true;
      sanctum.pathMarker.material.opacity = 0.2 + sanctumPulse * 0.42;
    } else if (pilgrimageQuest.returnActive) {
      sanctum.pathMarker.visible = true;
      sanctum.pathMarker.material.opacity = 0.42 + sanctumPulse * 0.22;
    } else if (pilgrimageQuest.finaleCompleted) {
      sanctum.pathMarker.visible = true;
      sanctum.pathMarker.material.opacity = 0.56 + sanctumPulse * 0.24;
    }
  }

  if (sanctum.pulseStartAt > 0 && sanctum.pulseType) {
    const elapsed = t - sanctum.pulseStartAt;
    const duration = sanctum.pulseType === 'next_cue' ? 2.2 : 1.4;
    if (elapsed >= duration) {
      sanctum.pulseStartAt = 0;
      sanctum.pulseType = null;
    } else {
      const k = elapsed / duration;
      const burst = (1 - k) * (sanctum.pulseType === 'next_cue' ? 0.55 : 0.72);
      sanctum.core.scale.setScalar(1 + burst * 0.3);
      sanctum.core.material.emissiveIntensity += burst;
      sanctum.beam.visible = true;
      sanctum.beam.material.opacity = Math.min(0.96, sanctum.beam.material.opacity + burst * 0.66);
    }
  } else {
    sanctum.core.scale.setScalar(1);
  }

  const returnShrine = pilgrimageQuest.returnShrine;
  if (!returnShrine?.core) return;

  const returnPulse = Math.sin(t * 3.4 + 1.8) * 0.5 + 0.5;
  returnShrine.core.position.y = returnShrine.baseCoreY + (pilgrimageQuest.returnActive ? 0.16 : 0.08) * returnPulse;
  returnShrine.core.rotation.y += pilgrimageQuest.returnActive ? 0.024 : 0.012;

  if (returnShrine.lockRing) {
    const lockVisible = returnShrine.id === activeId && objectiveApproachRuntime.phase === 'lock';
    returnShrine.lockRing.visible = lockVisible;
    if (lockVisible) {
      returnShrine.lockRing.material.opacity = objectiveApproachRuntime.canAttune ? 0.92 : 0.3 + returnPulse * 0.48;
      returnShrine.lockRing.scale.setScalar(objectiveApproachRuntime.canAttune ? 1.08 : 0.96 + returnPulse * 0.16);
    }
  }

  if (returnShrine.cueRing) {
    const cueVisible = objectiveApproachRuntime.cueObjectiveId === returnShrine.id && objectiveApproachRuntime.cueUntilMs > performance.now();
    returnShrine.cueRing.visible = cueVisible;
    if (cueVisible) {
      returnShrine.cueRing.material.opacity = 0.24 + returnPulse * 0.44;
      const cueScale = 1 + returnPulse * 0.38;
      returnShrine.cueRing.scale.set(cueScale, cueScale, cueScale);
    }
  }

  if (returnShrine.pathMarker?.material) {
    if (pilgrimageQuest.returnActive) {
      returnShrine.pathMarker.visible = true;
      returnShrine.pathMarker.material.opacity = 0.34 + returnPulse * 0.5;
    } else if (pilgrimageQuest.cycleCompleted) {
      returnShrine.pathMarker.visible = true;
      returnShrine.pathMarker.material.opacity = 0.62 + returnPulse * 0.24;
    } else if (pilgrimageQuest.returnFailed) {
      returnShrine.pathMarker.visible = true;
      returnShrine.pathMarker.material.opacity = 0.28 + returnPulse * 0.24;
    }
  }

  if (returnShrine.pulseStartAt > 0 && returnShrine.pulseType) {
    const elapsed = t - returnShrine.pulseStartAt;
    const duration = returnShrine.pulseType === 'next_cue' ? 2.3 : 1.45;
    if (elapsed >= duration) {
      returnShrine.pulseStartAt = 0;
      returnShrine.pulseType = null;
    } else {
      const k = elapsed / duration;
      const burst = (1 - k) * (returnShrine.pulseType === 'next_cue' ? 0.58 : 0.68);
      returnShrine.core.scale.setScalar(1 + burst * 0.28);
      returnShrine.core.material.emissiveIntensity += burst * 0.95;
      returnShrine.beam.visible = true;
      returnShrine.beam.material.opacity = Math.min(0.96, returnShrine.beam.material.opacity + burst * 0.62);
    }
  } else {
    returnShrine.core.scale.setScalar(1);
  }
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
  settleObjectiveHandoffIfReady(nowMs);
  const bridgeAct = agentBridge.getActState(nowMs);
  const keyboardTurn = ((keys.ArrowRight || keys.KeyD) ? 1 : 0) - ((keys.ArrowLeft || keys.KeyA) ? 1 : 0);
  const keyboardForward = (keys.ArrowUp || keys.KeyW) ? 1 : 0;
  const turnInput = clampAxis(keyboardTurn + bridgeAct.turn);
  const forwardInput = clampAxis(keyboardForward + bridgeAct.forward);
  const movingForward = Math.abs(forwardInput) > 0.05;
  const objectiveGuidance = updateObjectiveSnapshotRuntime(nowMs);

  let handoffTurnAssist = 0;
  if (objectivePacingRuntime.handoff.active && nowMs <= objectivePacingRuntime.handoff.settleAtMs) {
    const previousObjective = getObjectiveEntityById(objectivePacingRuntime.handoff.fromObjectiveId);
    if (previousObjective?.mesh) {
      objectiveToTargetVec.subVectors(player.position, previousObjective.mesh.position);
      const awayDist = objectiveToTargetVec.length();
      if (awayDist < OBJECTIVE_HANDOFF.egressRadius) {
        objectiveFlatForward.copy(lastMoveHeading).setY(0);
        if (objectiveFlatForward.lengthSq() < 0.0001) objectiveFlatForward.set(0, 0, -1);
        else objectiveFlatForward.normalize();

        objectiveFlatToTarget.copy(objectiveToTargetVec).setY(0);
        if (objectiveFlatToTarget.lengthSq() > 0.0001) {
          objectiveFlatToTarget.normalize();
          const awayBearing = Math.atan2(
            objectiveFlatForward.x * objectiveFlatToTarget.z - objectiveFlatForward.z * objectiveFlatToTarget.x,
            objectiveFlatForward.dot(objectiveFlatToTarget)
          );
          const awayFactor = 1 - THREE.MathUtils.clamp(awayDist / OBJECTIVE_HANDOFF.egressRadius, 0, 1);
          handoffTurnAssist = clampAxis(awayBearing * OBJECTIVE_HANDOFF.turnAssist * awayFactor);
        }
      }
    }
  }

  const effectiveTurnInput = clampAxis(turnInput + handoffTurnAssist);

  if (!jumping && bridgeAct.jump) {
    jumping = true;
    velocityY = jumpVelocity;
    if (actions.jump) setAction('jump', 0.08);
  }

  const closeObjectiveDist = objectiveGuidance?.dist ?? Number.POSITIVE_INFINITY;
  const closeObjectiveBearing = Math.abs(objectiveGuidance?.bearing ?? 0);
  const isNearObjective = Number.isFinite(closeObjectiveDist) && closeObjectiveDist <= OBJECTIVE_APPROACH.nearRadius;
  const turnDamping = isNearObjective ? THREE.MathUtils.clamp(closeObjectiveDist / OBJECTIVE_APPROACH.nearRadius, 0.42, 1) : 1;

  if (effectiveTurnInput !== 0) {
    // Tank-style steering: rotate heading at a capped yaw speed.
    playerTurnQuat.setFromAxisAngle(WORLD_UP, -effectiveTurnInput * PLAYER_TURN_SPEED * turnDamping * delta);
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

    if (objectivePacingRuntime.handoff.active && nowMs <= objectivePacingRuntime.handoff.settleAtMs) {
      objectiveSlow = Math.max(objectiveSlow, 0.82);
    }

    desiredX += playerMoveDirection.x * moveSpeed * forwardInput * objectiveSlow * delta;
    desiredZ += playerMoveDirection.z * moveSpeed * forwardInput * objectiveSlow * delta;

    if (actions.walk && !jumping) setAction('walk', 0.16);
  } else if (actions.idle && !jumping) {
    setAction('idle', 0.2);
  }

  const playerYMin = player.position.y + 0.05;
  const playerYMax = playerYMin + playerCollider.height;
  const handoffReleaseColliderId = (objectivePacingRuntime.handoff.active && nowMs <= objectivePacingRuntime.handoff.releaseColliderUntilMs)
    ? objectivePacingRuntime.handoff.fromObjectiveId
    : null;
  const nearbyColliders = worldColliders
    .queryNearby(desiredX, desiredZ, 8.5)
    .filter((collider) => !handoffReleaseColliderId || collider.id !== handoffReleaseColliderId);
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

  updateRouteGuidanceVisuals();
  updateEpilogueTimer();
  updateObjectiveHud();
  updateEpilogueHud();
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
    updateWorldStageGrade(scaledDelta);
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
