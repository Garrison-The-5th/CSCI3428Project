## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| Trivy (fs) | CVE-2026-90711 — proxy-addr 2.0.7 (CRITICAL, transitive via express) | fixed | 95 | bumped backend proxy-addr -> 2.0.8 |
| Trivy (fs) | CVE-2026-93749 — source-map-js 1.2.1 (HIGH, transitive via postcss) | fixed | 95 | bumped backend + frontend source-map-js -> 1.2.2 |

## Auto-fixed

- `backend/package-lock.json`: proxy-addr 2.0.7 -> 2.0.8 (fixes CVE-2026-90711) and source-map-js 1.2.1 -> 1.2.2 (fixes CVE-2026-93749) via `npm update` (patch bumps, no package.json range change needed).
- `frontend/package-lock.json`: source-map-js 1.2.1 -> 1.2.2 via `npm update` (patch bump; also normalized some `libc` metadata entries npm emits).

## Tests updated (stale assertions from fixes)

- none

## 🚨 Escalated — human attention needed

- none

## Outcome

DONE — Both NEW nightly CVEs (CRITICAL proxy-addr, HIGH source-map-js) were patch-level bumps on transitive deps. Backend test suite, lint, build, and `tsc --noEmit -p backend/tsconfig.json` all passed on the fixed tree. Frontend's `npm test` fails on `jest.config.ts` requiring an unlisted `ts-node` — verified pre-existing on the baseline (fails identically with changes stashed), unrelated to this triage. Preflight rebucket shows NEW=0; REGRESSION=2 is the expected artifact of reconciling against the pre-fix Trivy snapshot and will clear on the next scan.
