## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| Trivy (npm) | GHSA-rgwj-5xj2-c3m3 — mysql2 3.15.3 (decompression-bomb DoS in compressed MySQL protocol handler) | not_affected | 90% | Suppressed via VEX (`vulnerable_code_not_in_execute_path`) — mysql2 is a `devOptional` transitive of the `prisma` CLI; our Prisma datasource is `postgresql` and no source imports `mysql2`, so the vulnerable code path (compressed MySQL protocol) is never entered. |

## Auto-fixed

- None. This Watch run produced only a not_affected disposition.

## Tests updated (stale assertions from fixes)

- None.

## 🚨 Escalated — human attention needed

- None.

## Outcome

DONE — one NEW dependency finding tonight. mysql2 3.15.3 (transitive optional dep of the `prisma` CLI, `devOptional` in the lockfile) picked up a MEDIUM DoS advisory (GHSA-rgwj-5xj2-c3m3). Verified our Prisma datasource is `postgresql` and no source imports `mysql2`, so the compressed-MySQL-protocol code path is unreachable in our runtime and build. Wrote a `not_affected / vulnerable_code_not_in_execute_path` statement, re-synced `.trivyignore`, and the rebucket now shows `NEW: 0`. Preflight lint + backend tests (445/445 pass) + build + `tsc --noEmit` all green; the frontend `jest` failure on the local runner is a pre-existing env issue (`jest.config.ts` needs `ts-node` under node 20.20.2; repo declares `"engines": { "node": "^24.0.0" }`) unrelated to this triage-doc-only change and will be re-evaluated by the Janus PR gate under the proper node engine.
