## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| Trivy (deps) | CVE-2026-82417 · qs@6.15.3 (transitive; body-parser/express/superagent) | fixed | 95 | Bumped to qs@6.16.0 via `npm update qs` in backend/ |
| Trivy (deps) | CVE-2026-82562 · qs@6.15.3 (transitive; body-parser/express/superagent) | fixed | 95 | Same 6.16.0 bump covers both advisories |

## Auto-fixed

- Transitive dep bump: `qs` 6.15.3 → 6.16.0 in `backend/package-lock.json`. All three parent ranges (`^6.15.2`, `^6.14.0`, `^6.14.1`) accept 6.16.0, so npm hoisted a single `node_modules/qs` entry with no other lockfile churn. Closes both new `qs` DoS advisories in one action.

## Tests updated (stale assertions from fixes)

- None — the qs bump is a runtime-behavior-neutral patch; all 445 backend unit tests passed unchanged.

## 🚨 Escalated — human attention needed

- None.

## Outcome

DONE — 2 NEW findings triaged (both fixed via one transitive dep bump); 2 PERSISTENT `mysql2` not_affected statements re-validated automatically (no action needed, `reevaluate_after` still future); 0 REEVALUATE / RESOLVED / REGRESSION on the source scan. Pre-flight green: lint, 445/445 backend unit tests, backend + frontend build, backend `tsc --noEmit`. (Post-fix rebucket flags 2 self-consistency "regressions" because `trivy-fs.json` is frozen from the pre-fix scan; those disappear on the next Watch run once trivy re-reads the updated lockfile.)
