## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| trivy | CVE-2026-111181 (body-parser DoS via unhandled decompression stream error) @ `pkg:npm/body-parser@2.3.0` | fixed | 95 | PATH 1: added `body-parser: ^2.4.0` to `backend/package.json` overrides; lockfile now resolves `body-parser@2.4.0` (transitive via `express@^5.1.0`). |
| trivy | CVE-2026-110180 (fast-uri security policy bypass via host canonicalization) @ `pkg:npm/fast-uri@3.1.8` | fixed | 95 | PATH 1: lifted existing override `fast-uri: ^3.1.7` → `^3.1.9` in `backend/package.json`; lockfile resolves `fast-uri@3.1.9` (devOptional transitive via `ajv`). |
| trivy | CVE-2026-110306 (fast-uri XSS via improper URI scheme decoding) @ `pkg:npm/fast-uri@3.1.8` | fixed | 95 | PATH 1: covered by the same fast-uri override bump above. |
| trivy | CVE-2026-113872 (multer DoS via aborted request during async file filtering) @ `pkg:npm/multer@2.4.0` | fixed | 95 | PATH 1: bumped direct backend dep `multer` from `^2.4.0` → `^2.5.0`; lockfile resolves `multer@2.5.0`. |
| trivy | GHSA-85x2-q946-cp5h (nodemailer: `>` in quoted local-part ends angle-addr early) @ `pkg:npm/nodemailer@10.0.12` | fixed | 95 | PATH 1: bumped direct backend dep `nodemailer` from `^10.0.2` → `^10.1.4`; lockfile resolves `nodemailer@10.2.1`. |
| trivy | GHSA-8c8m-p3m8-cjg8 (nodemailer: nested comment ends early in addressparser) @ `pkg:npm/nodemailer@10.0.12` | fixed | 95 | PATH 1: covered by the same nodemailer bump above. |
| trivy | GHSA-m943-m63m-w62w (nodemailer: `;` in quoted string ends address group early) @ `pkg:npm/nodemailer@10.0.12` | fixed | 95 | PATH 1: covered by the same nodemailer bump above. |

## Auto-fixed

- `backend/package.json`: `multer` `^2.4.0` → `^2.5.0`, `nodemailer` `^10.0.2` → `^10.1.4`; `overrides.fast-uri` `^3.1.7` → `^3.1.9`; added `overrides.body-parser` `^2.4.0`.
- `backend/package-lock.json`: refreshed by `npm install`; now resolves `body-parser@2.4.0`, `fast-uri@3.1.9`, `multer@2.5.0`, `nodemailer@10.2.1` — all at or above the advisory fix versions.

## Tests updated (stale assertions from fixes)

- None. All 680 backend unit tests pass unchanged.

## 🚨 Escalated — human attention needed

- None.

## Outcome

DONE — 7 NEW dependency CVEs all closed via PATH 1 (dep bumps). Verified end-to-end: `npm install` clean in backend, `npm run lint` green, backend unit tests 680/680 passing (integration suites skipped — no DB on this runner, same as the base-branch state), `npx tsc --noEmit -p backend/tsconfig.json` green, `npm run build` green. Rebucket shows `NEW=0`. The 7 REGRESSION entries in the preflight output are an expected cross-current artifact: this run's `trivy-fs.json` was captured before the lockfile bump and still names the pre-fix versions, so marking them `fixed` in the same run makes them look "reappeared"; the next nightly Trivy scan will scan the bumped lockfile and the findings will be genuinely absent. Pre-existing frontend `jest`/`ts-node` wiring issue is unrelated to these changes (we touched backend only) and the Janus PR gate on the bot-sec PR will re-run on a fresh CI environment.
