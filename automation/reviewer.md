# Reviewer Cron Instructions

1. Review latest feature branches for correctness/risk.
2. Run build/tests as needed (`npm run build`).
3. If all good:
   - Merge reviewed feature branch(es) into `main`.
   - Prefer fast-forward when possible.
   - Push `main` to origin.
4. If not good:
   - Do not merge.
   - Report blocking issues + exact fixes.

Merge policy:
- Only merge when build passes and no obvious regressions are found.
- Summarize what was merged and what remains.
