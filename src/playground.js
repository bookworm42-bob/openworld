import './playground.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import boyIdleFbxUrl from '../3d_models/boy/SadIdle.fbx?url';
import boyWalkFbxUrl from '../3d_models/boy/Walking.fbx?url';
import boyJumpFbxUrl from '../3d_models/boy/Jumping.fbx?url';

const characterPresets = new Map([
  [
    'boy',
    {
      id: 'boy',
      label: 'Boy (default)',
      modelUrl: boyIdleFbxUrl,
      animationUrls: [boyIdleFbxUrl, boyWalkFbxUrl, boyJumpFbxUrl]
    }
  ]
]);

const assetPresets = new Map([
  ['tower', { id: 'tower', label: 'Tower', url: '/assets/poly-pizza/tower-quaternius.glb' }],
  ['windmill', { id: 'windmill', label: 'Windmill', url: '/assets/poly-pizza/windmill-poly-google.glb' }],
  ['fence-pillar', { id: 'fence-pillar', label: 'Broken Fence Pillar', url: '/assets/poly-pizza/broken-fence-pillar-kay-lousberg.glb' }],
  ['grave', { id: 'grave', label: 'Damaged Grave', url: '/assets/poly-pizza/damaged-grave-kay-lousberg.glb' }],
  ['tree', { id: 'tree', label: 'Tree Oak', url: '/assets/nature-kit/tree_oak.glb' }],
  ['rock', { id: 'rock', label: 'Rock Small', url: '/assets/nature-kit/rock_smallE.glb' }],
  ['log-stack', { id: 'log-stack', label: 'Log Stack', url: '/assets/nature-kit/log_stackLarge.glb' }]
]);

const refs = {
  canvasHost: document.getElementById('canvas-host'),
  status: document.getElementById('status'),
  tabCharacters: document.getElementById('tab-characters'),
  tabAssets: document.getElementById('tab-assets'),
  charactersPanel: document.getElementById('characters-panel'),
  assetsPanel: document.getElementById('assets-panel'),
  characterSelect: document.getElementById('character-select'),
  animationSelect: document.getElementById('animation-select'),
  pauseAnimationButton: document.getElementById('pause-animation-btn'),
  speedInput: document.getElementById('speed-input'),
  speedValue: document.getElementById('speed-value'),
  modelSelect: document.getElementById('model-select')
};

const appState = {
  mode: 'characters',
  speed: 1,
  paused: false,
  clock: new THREE.Clock(),
  currentCharacter: null,
  currentAsset: null,
  currentAnimationName: null
};

const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa5c5eb);
scene.fog = new THREE.Fog(0xc9ddf7, 30, 120);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
camera.position.set(4.2, 2.9, 6.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
refs.canvasHost.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 1.5;
controls.maxDistance = 40;

const hemi = new THREE.HemisphereLight(0xeaf5ff, 0x6f7b5e, 1.1);
scene.add(hemi);

const ambient = new THREE.AmbientLight(0xffffff, 1.15);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xfff7df, 1.45);
key.position.set(7, 10, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.00006;
key.shadow.normalBias = 0.02;
scene.add(key);

const fill = new THREE.DirectionalLight(0xc8e2ff, 0.6);
fill.position.set(-9, 6, -7);
scene.add(fill);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(22, 80),
  new THREE.MeshStandardMaterial({ color: 0x799e6a, roughness: 0.88, metalness: 0.04 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(40, 40, 0x2c405f, 0x4f678a);
grid.position.y = 0.002;
scene.add(grid);

const axis = new THREE.AxesHelper(1.2);
axis.position.set(0, 0.02, 0);
scene.add(axis);

function setStatus(message) {
  refs.status.textContent = message;
}

function clearSelect(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function addOption(el, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  el.appendChild(option);
}

function extensionOf(path = '') {
  const clean = path.split('?')[0].split('#')[0];
  const i = clean.lastIndexOf('.');
  return i >= 0 ? clean.slice(i + 1).toLowerCase() : '';
}

function fileStem(path = '', fallback = 'item') {
  const clean = path.split('?')[0].split('#')[0];
  const name = clean.split('/').pop() || fallback;
  return name.replace(/\.[^.]+$/, '');
}

async function loadAsset(url, label = 'asset') {
  const ext = extensionOf(url);
  if (ext === 'fbx') {
    const root = await fbxLoader.loadAsync(url);
    return { root, animations: root.animations || [], kind: 'fbx', label };
  }
  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await gltfLoader.loadAsync(url);
    return { root: gltf.scene, animations: gltf.animations || [], kind: 'gltf', label };
  }
  throw new Error(`Unsupported file type for ${label}: ${ext || '(none)'}`);
}

function setCastShadows(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

function normalizeCharacter(root) {
  setCastShadows(root);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 0.0001) root.scale.multiplyScalar(1.75 / size.y);

  const boxScaled = new THREE.Box3().setFromObject(root);
  if (boxScaled.isEmpty()) return;
  const center = boxScaled.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= boxScaled.min.y;
}

function normalizeAsset(root) {
  setCastShadows(root);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0.0001) root.scale.multiplyScalar(Math.min(4.5 / maxDim, 6));

  const boxScaled = new THREE.Box3().setFromObject(root);
  if (!boxScaled.isEmpty()) root.position.y -= boxScaled.min.y;
}

function clearCharacter() {
  const current = appState.currentCharacter;
  if (!current) return;
  current.mixer.stopAllAction();
  scene.remove(current.root);
  appState.currentCharacter = null;
  appState.currentAnimationName = null;
}

function clearAsset() {
  const current = appState.currentAsset;
  if (!current) return;
  if (current.mixer) current.mixer.stopAllAction();
  scene.remove(current.root);
  appState.currentAsset = null;
}

function clearPreview() {
  clearCharacter();
  clearAsset();
}

function refreshCharacterSelect() {
  clearSelect(refs.characterSelect);
  for (const [id, def] of characterPresets.entries()) {
    addOption(refs.characterSelect, id, def.label);
  }
}

function refreshAssetSelect() {
  clearSelect(refs.modelSelect);
  for (const [id, def] of assetPresets.entries()) {
    addOption(refs.modelSelect, id, def.label);
  }
}

function refreshAnimationSelect() {
  clearSelect(refs.animationSelect);
  const current = appState.currentCharacter;
  if (!current || current.actions.size === 0) {
    refs.animationSelect.disabled = true;
    return;
  }

  refs.animationSelect.disabled = false;
  for (const name of current.actions.keys()) addOption(refs.animationSelect, name, name);
  if (!current.actions.has(appState.currentAnimationName)) {
    appState.currentAnimationName = refs.animationSelect.options[0].value;
  }
  refs.animationSelect.value = appState.currentAnimationName;
}

function applyAnimationSpeed() {
  const current = appState.currentCharacter;
  if (!current || !appState.currentAnimationName) return;
  const action = current.actions.get(appState.currentAnimationName);
  if (!action) return;
  action.setEffectiveTimeScale(appState.paused ? 0 : appState.speed);
}

function playAnimation(name) {
  const current = appState.currentCharacter;
  if (!current) return;
  const next = current.actions.get(name);
  if (!next) return;

  const prev = appState.currentAnimationName ? current.actions.get(appState.currentAnimationName) : null;
  if (prev && prev !== next) prev.fadeOut(0.2);

  next.reset();
  next.setLoop(THREE.LoopRepeat, Infinity);
  next.clampWhenFinished = false;
  next.enabled = true;
  next.fadeIn(0.18);
  next.play();
  appState.currentAnimationName = name;
  appState.paused = false;
  applyAnimationSpeed();
  refs.animationSelect.value = name;
  setStatus(`Character: ${refs.characterSelect.value} | Animation: ${name}`);
}

async function loadCharacterPreview() {
  clearPreview();
  const characterId = refs.characterSelect.value;
  const def = characterPresets.get(characterId);
  if (!def) return;

  const base = await loadAsset(def.modelUrl, def.label);
  normalizeCharacter(base.root);
  scene.add(base.root);

  const current = {
    id: def.id,
    label: def.label,
    root: base.root,
    mixer: new THREE.AnimationMixer(base.root),
    actions: new Map()
  };
  appState.currentCharacter = current;

  for (const animUrl of def.animationUrls) {
    try {
      const loaded = await loadAsset(animUrl, animUrl);
      const clip = loaded.animations[0];
      if (!clip) continue;
      const name = fileStem(animUrl, 'anim');
      if (current.actions.has(name)) continue;
      current.actions.set(name, current.mixer.clipAction(clip));
    } catch (error) {
      setStatus(`Failed to load animation ${animUrl}: ${error.message}`);
    }
  }

  refreshAnimationSelect();
  if (refs.animationSelect.options.length > 0) {
    playAnimation(refs.animationSelect.options[0].value);
  } else {
    setStatus(`Character loaded: ${def.label} (no animations found).`);
  }
}

async function loadAssetPreview() {
  clearPreview();
  const assetId = refs.modelSelect.value;
  const def = assetPresets.get(assetId);
  if (!def) return;

  const loaded = await loadAsset(def.url, def.label);
  normalizeAsset(loaded.root);
  scene.add(loaded.root);

  let mixer = null;
  if (loaded.animations.length > 0) {
    mixer = new THREE.AnimationMixer(loaded.root);
    loaded.animations.forEach((clip) => mixer.clipAction(clip).play());
  }
  appState.currentAsset = { id: def.id, label: def.label, root: loaded.root, mixer };
  setStatus(`Asset preview: ${def.label}`);
}

function setMode(mode) {
  appState.mode = mode;
  const charMode = mode === 'characters';
  refs.tabCharacters.classList.toggle('active', charMode);
  refs.tabAssets.classList.toggle('active', !charMode);
  refs.tabCharacters.setAttribute('aria-selected', charMode ? 'true' : 'false');
  refs.tabAssets.setAttribute('aria-selected', charMode ? 'false' : 'true');
  refs.charactersPanel.classList.toggle('hidden', !charMode);
  refs.assetsPanel.classList.toggle('hidden', charMode);

  if (charMode) {
    loadCharacterPreview().catch((error) => setStatus(`Character preview failed: ${error.message}`));
  } else {
    loadAssetPreview().catch((error) => setStatus(`Asset preview failed: ${error.message}`));
  }
}

function resizeRenderer() {
  const width = refs.canvasHost.clientWidth;
  const height = refs.canvasHost.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

refs.tabCharacters.addEventListener('click', () => {
  if (appState.mode !== 'characters') setMode('characters');
});

refs.tabAssets.addEventListener('click', () => {
  if (appState.mode !== 'assets') setMode('assets');
});

refs.characterSelect.addEventListener('change', () => {
  if (appState.mode !== 'characters') return;
  loadCharacterPreview().catch((error) => setStatus(`Character preview failed: ${error.message}`));
});

refs.animationSelect.addEventListener('change', () => {
  if (appState.mode !== 'characters') return;
  playAnimation(refs.animationSelect.value);
});

refs.pauseAnimationButton.addEventListener('click', () => {
  if (appState.mode !== 'characters' || !appState.currentCharacter) return;
  appState.paused = !appState.paused;
  applyAnimationSpeed();
  setStatus(
    `Character: ${refs.characterSelect.value} | Animation: ${appState.currentAnimationName} | ${appState.paused ? 'Paused' : 'Running'}`
  );
});

refs.speedInput.addEventListener('input', () => {
  appState.speed = Number.parseFloat(refs.speedInput.value);
  refs.speedValue.textContent = `${appState.speed.toFixed(2)}x`;
  applyAnimationSpeed();
});

refs.modelSelect.addEventListener('change', () => {
  if (appState.mode !== 'assets') return;
  loadAssetPreview().catch((error) => setStatus(`Asset preview failed: ${error.message}`));
});

window.addEventListener('resize', resizeRenderer);

function animate() {
  requestAnimationFrame(animate);
  const delta = appState.clock.getDelta();
  if (appState.currentCharacter?.mixer) appState.currentCharacter.mixer.update(delta);
  if (appState.currentAsset?.mixer) appState.currentAsset.mixer.update(delta);
  controls.update();
  renderer.render(scene, camera);
}

refreshCharacterSelect();
refreshAssetSelect();
refs.speedValue.textContent = `${appState.speed.toFixed(2)}x`;
resizeRenderer();
animate();
setMode('characters');
