# openworld-threejs

Open-world Three.js prototype with FBX character animation blending.

## What this includes

- Vite + Three.js app
- Character loaded once from `3d_models/boy/Sad Idle.fbx`
- Additional animation clips loaded from:
  - `3d_models/boy/Walking.fbx`
  - `3d_models/boy/Jumping.fbx`
- Controls:
  - `ArrowUp` or `W` = move forward
  - `ArrowLeft` / `ArrowRight` or `A` / `D` = turn
  - `Space` or `Shift` = jump
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

## Agent API Bridge (v1)

The game runs on the normal Vite dev port, and in parallel starts a local bridge server:

- Game UI: `http://localhost:5173` (or Vite-assigned port)
- Agent API (WebSocket): `ws://localhost:8787`
- Bridge health check (HTTP): `http://localhost:8787`

Bridge behavior:

- `HELLO`, `OBS`, `ACT`, `INTERACT`, `CAPTURE`, `EDIT` message flow
- OBS emission is ticked and rate-limited (default 20 Hz)
- ACT is applied in simulation update (no OS key events)
- ACT times out to neutral after 500ms
- Perception is range + FOV + occlusion filtered (sensor-like; no god-mode)

### Bridge config (env vars)

- `VITE_AGENT_BRIDGE_WS_PORT` (default `8787`)
- `VITE_AGENT_OBS_HZ` (default `20`)
- `VITE_AGENT_PERCEPTION_RANGE` (default `15`)
- `VITE_AGENT_PERCEPTION_FOV_DEG` (default `95`)
- `VITE_AGENT_OBS_MODE` (`realistic` default, `dev` to include `self.pos`)
- `VITE_AGENT_ENABLE_EDIT` (`1` to enable builder `EDIT`; default disabled)

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

## Optional: Legacy CPU/software WebGL validation (headless VPS only)

Only use this when GPU/WebGL isn’t available in your host browser runtime.
Default local mode is GPU-capable browser launch.

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

Legacy software mode (only when required):

```bash
PLAYWRIGHT_LAUNCH_MODE=legacy-software node scripts/msg322-anim-shot.cjs
```

---

## Automation instruction files

Cron workers read these instruction files:

- `automation/programmer.md`
- `automation/reviewer.md`
- `automation/playtest.md`
- `automation/status-report.md`
- `automation/notification-policy.md`

## Managed playtest runner (recommended)

Use one-shot runner so preview/playtest processes are always cleaned up:

```bash
node scripts/playtest-runner.cjs
```

## Slow mode (for playtest)

Two ways:

- URL: `http://127.0.0.1:5173/?slow=1`
- Runtime toggle: press `T`

Slow mode lowers simulation speed so playtest can capture action-by-action screenshots.

## CI

GitHub Actions build check runs on push/PR using:

- `npm ci`
- `npm run build`
