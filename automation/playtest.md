# Playtest Cron Instructions

Goal: validate that game movement/animations/interactions are actually visible and functioning.

## Required runner (important)
Use **Playwright headless Chromium with SwiftShader/software rendering** for validation.
Do **not** rely on host-browser snapshots when WebGL may be unavailable.

Preferred scripts:
- `node scripts/playwright-anim-check.cjs`
- `node scripts/msg322-anim-shot.cjs`
- `node scripts/msg335-forward-held.cjs` (for held-forward evidence)

## Mode
Use **slow mode** for deterministic captures:
- URL flag: `?slow=1`
- Optional runtime toggle key: `T`

## Steps
1. Start dev server (prefer fixed port):
   - `npm run dev -- --host 127.0.0.1 --port 4174`
2. Run Playwright capture script(s) against `http://127.0.0.1:4174/?slow=1`.
3. Capture screenshots for:
   - idle
   - forward move
   - right/left move
   - jump (start/mid/land)
   - interact prompt + interact result (E)
4. Verify controls:
   - ArrowUp, ArrowLeft/Right, Space, E, T
5. Record regressions with clear repro steps.

## Output
- Keep 4-8 screenshots max per run.
- Report pass/fail for movement, animation, interaction, and camera behavior.

## Evolving test scope
- As new features land, extend test coverage to include them (not just baseline movement/jump).
- You may add temporary supplemental playtest cron jobs when deeper coverage is needed.
- Remove/disable extra playtest cron jobs when no longer necessary to control noise/cost.
