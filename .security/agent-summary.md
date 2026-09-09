## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| Trivy (deps) | CVE-2026-77037 · multer@2.2.0 | fixed | 95 | Bumped multer ^2.0.2 → ^2.3.0 in backend/ |
| Trivy (deps) | CVE-2026-77078 · multer@2.2.0 | fixed | 95 | Same 2.3.0 bump |
| Trivy (deps) | CVE-2026-82333 · multer@2.2.0 | fixed | 95 | Same 2.3.0 bump |
| Trivy (deps) | GHSA-2x7j-588g-ccc2 · nodemailer@9.0.5 | fixed | 95 | Bumped nodemailer ^9.0.5 → ^9.1.1 in backend/ |
| Trivy (deps) | GHSA-8m3c-c648-2xjj · nodemailer@9.0.5 | fixed | 95 | Same 9.1.1 bump (9.1.1 fix) |
| Trivy (deps) | GHSA-cc9r-2j5m-2m83 · nodemailer@9.0.5 | fixed | 95 | Same 9.1.1 bump (9.1.0 fix) |
| Trivy (deps) | GHSA-wmmp-3585-3rmp · nodemailer@9.0.5 | fixed | 95 | Same 9.1.1 bump (9.1.0 fix) |

## Auto-fixed

- Direct dep bump: `multer` `^2.0.2` → `^2.3.0` in `backend/package.json`; `node_modules/multer` now resolves to 2.3.0. Closes all three new multer DoS advisories (file-descriptor leak, crafted field name, oversized array index).
- Direct dep bump: `nodemailer` `^9.0.5` → `^9.1.1` in `backend/package.json`; `node_modules/nodemailer` now resolves to 9.1.1. Closes all four new nodemailer advisories (addressparser DoS at 9.1.0, resolveContent legacy-signature bypass at 9.1.1, RFC-5322 comment mis-parsing at 9.1.0, IDN allow-list bypass at 9.1.0).

## Tests updated (stale assertions from fixes)

- None — both bumps are within-major runtime-neutral patches; all 445 backend unit tests passed unchanged.

## 🚨 Escalated — human attention needed

- None.

## Outcome

DONE — 7 NEW findings triaged (all fixed via two direct dep bumps in `backend/package.json`); 2 PERSISTENT `mysql2` not_affected statements from prior triage remain valid (no action needed, `reevaluate_after` still future); 0 REEVALUATE / RESOLVED / REGRESSION on the source scan. Pre-flight green: lint, 445/445 backend unit tests, backend `tsc --noEmit`, backend build. (Post-fix rebucket flags 7 self-consistency "regressions" because `trivy-fs.json` is frozen from the pre-fix scan; those disappear on the next Watch run once trivy re-reads the updated lockfile. Frontend `npm test` is pre-existingly broken because `frontend/node_modules` is not provisioned on this runner — unrelated to the dep bumps.)
