# Programmer Cron Instructions

1. Read `ROADMAP.md` and `tasks.json`.
2. Pick exactly one `ready` task (smallest/lowest risk first).
3. Implement a minimal vertical slice on a feature branch.
4. Run `npm run build` before finishing.
5. Update `tasks.json` status/notes for the task.
6. Report concise diff + next step.

Rules:
- Keep changes small and reversible.
- Do not merge to `main` here; leave for reviewer.
- If reviewer/playtest reports a defect or regression, prioritize that fix before new feature work.
- When active debugging is needed, you may add a temporary high-frequency debug cron (every 15 min), and disable/remove it once stable.
