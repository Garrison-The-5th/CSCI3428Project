## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| trivy-fs | CVE-2026-84371 sanitize-html@2.17.6 (MEDIUM, CVSS 5.4) — Stored XSS via SVG SMIL URI-list scheme-policy bypass | fixed | 92 | Bumped backend sanitize-html ^2.17.6 → ^2.17.7 (upstream patch commit apostrophecms/apostrophe@1135516). 45/45 backend/tests/unit/rich-text.test.ts pass. |
| trivy-fs | GHSA-3f6p-5ww8-9rcr mysql2@3.15.3 (HIGH) — Auth plugin downgrade to mysql_clear_password leaks plaintext credentials | not_affected | 90 | vulnerable_code_not_in_execute_path: mysql2 is devOptional transitive of prisma CLI only; datasource provider is postgresql; no source imports mysql2. Same reachability profile as prior GHSA-rgwj-5xj2-c3m3 disposition. reevaluate_after=2026-12-01. |

## Auto-fixed

- `backend/package.json` + `backend/package-lock.json`: sanitize-html ^2.17.6 → ^2.17.7. Closes CVE-2026-84371. Package is actively used by `backend/src/config/rich-text.ts` (called from curriculum-service to sanitize author-written lesson HTML), so the fix path is preferred over an FP call.

## Tests updated (stale assertions from fixes)

- None. sanitize-html 2.17.7 is a patch release; existing 45 rich-text unit tests all still assert correct sanitization behavior and passed unchanged.

## 🚨 Escalated — human attention needed

- None.

## Outcome

DONE — 2 statements written (1 fixed + 1 not_affected), 1 dependency auto-fix applied, .trivyignore + agent-summary re-synced from triage docs, schemas validate, post-fix bucket rebucket reports 0 NEW / 0 REGRESSION / 0 REEVALUATE. Pre-flight lint, backend jest (445/445), backend `tsc --noEmit`, and full `npm run build` are green; the frontend jest config-load failure surfaced by `npm test` is a pre-existing baseline environment issue (frontend/package.json lacks `ts-node`, needed by jest to parse jest.config.ts) and is unrelated to a backend-only dependency bump — flagging here for visibility rather than treating as blocking, per PATH 1 guidance.
