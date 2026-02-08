# HEARTBEAT (Manager)

## If there is nothing actionable:
Reply with HEARTBEAT_OK.

## Otherwise do ONLY the minimum actions below:
1) Read ROADMAP.md and tasks.json.
2) If tasks.json has no "ready" tasks:
- Create 1–3 small ready tasks (no big refactors).
3) If there are ready tasks:
- Ensure cron jobs exist for: programmer, reviewer, playtest, status report.
- If a cron job is missing, create it.
4) Post a short status update:
- latest commit/PR
- what changed since last update
- what is queued next
- what is blocked (if anything)
