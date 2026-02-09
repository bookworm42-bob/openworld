# openworld-threejs

Open-world Three.js prototype with FBX character animation blending.

## What this includes

- Vite + Three.js app
- Character loaded once from `3d_models/boy/Sad Idle.fbx`
- Additional animation clips loaded from:
  - `3d_models/boy/Walking.fbx`
  - `3d_models/boy/Jumping.fbx`
- Controls:
  - `ArrowUp` = move forward
  - `ArrowLeft` / `ArrowRight` = strafe
  - `Space` = jump
  - `E` = interact
  - `T` = toggle slow mode

## Run locally (recommended, normal setup)

This is the non-hacky path for your local machine (with normal browser GPU/WebGL support).

### 1) Install dependencies

```bash
npm install
```

### 2) Start dev server

```bash
npm run dev
```

Open the local URL shown by Vite (usually `http://127.0.0.1:5173` or similar).

### 3) Production build

```bash
npm run build
npm run preview
```

---

## Asset requirements

The app expects these files in the repo:

- `3d_models/boy/Sad Idle.fbx`
- `3d_models/boy/Walking.fbx`
- `3d_models/boy/Jumping.fbx`

If they are missing, animation loading will fail and fallback rendering may be used.

---

## Optional: CPU/software WebGL validation (headless VPS)

Only use this when GPU/WebGL isn’t available in your host browser runtime.

### WebGL probe

```bash
node test-webgl.cjs
```

Expected output:

```text
WEBGL_OK: true
```

### Deterministic animation screenshot capture

1) Start dev server:

```bash
npm run dev -- --host 127.0.0.1 --port 4174
```

2) Run scripted capture:

```bash
node scripts/msg322-anim-shot.cjs
```

Screenshots are written to `artifacts/`.

---

## Automation instruction files

Cron workers read these instruction files:

- `automation/programmer.md`
- `automation/reviewer.md`
- `automation/playtest.md`
- `automation/status-report.md`

## Slow mode (for playtest)

Two ways:

- URL: `http://127.0.0.1:5173/?slow=1`
- Runtime toggle: press `T`

Slow mode lowers simulation speed so playtest can capture action-by-action screenshots.

## CI

GitHub Actions build check runs on push/PR using:

- `npm ci`
- `npm run build`

## Performance budget tracking

Run a build with budget checks:

```bash
npm run build:budget
```

Current gzip budgets enforced by `scripts/check-bundle-budget.cjs`:

- JS bundles: 320 KB
- CSS bundles: 32 KB
- Static assets (`.glb`, `.fbx`, images): 420 KB
