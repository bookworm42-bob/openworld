# Playtest Cron Instructions

Goal: validate that game movement/animations/interactions are actually visible and functioning.

## Mode
Use **slow mode** for deterministic captures:
- URL flag: `?slow=1`
- Optional runtime toggle key: `T`

## Steps
1. Start app and verify it loads.
2. Capture screenshots for:
   - idle
   - forward move
   - right/left move
   - jump (start/mid/land)
   - interact prompt + interact result (E)
3. Verify controls:
   - ArrowUp, ArrowLeft/Right, Space, E, T
4. Record regressions with clear repro steps.

## Output
- Keep 4-8 screenshots max per run.
- Report pass/fail for movement, animation, interaction, and camera behavior.

## Evolving test scope
- As new features land, extend test coverage to include them (not just baseline movement/jump).
- You may add temporary supplemental playtest cron jobs when deeper coverage is needed.
- Remove/disable extra playtest cron jobs when no longer necessary to control noise/cost.
