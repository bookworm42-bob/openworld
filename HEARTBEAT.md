# HEARTBEAT (Manager)

## If there is nothing actionable:
Reply with HEARTBEAT_OK.

## Otherwise do ONLY the minimum actions below:
1) Read `ROADMAP.md`, `tasks.json`, and `automation/notification-policy.md`.
2) If `tasks.json` has no `ready` tasks:
- Create 1-3 small ready tasks (no big refactors).
3) If there are ready tasks:
- Ensure cron jobs exist for: programmer, reviewer, playtest, status report.
- If a cron job is missing, create it.
4) Before sending any message, apply notification policy:
- if no meaningful state change and no escalation threshold hit, reply `HEARTBEAT_OK`.
- do not send repeating "no change" or repeated blocker/failure messages.
5) If sending an update, keep it short and include only changed fields:
- latest commit/PR (only if changed),
- what changed since last update,
- what is queued next,
- blockers only if new/changed/cleared.
