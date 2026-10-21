## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| trivy-fs | CVE-2026-113654 — sanitize-html HTML sanitization bypass via improper noscript tag handling (MEDIUM, CVSS 4.7) | fixed | 95 | Bumped `sanitize-html` ^2.17.7 → ^2.18.0 in `backend/package.json`; `npm install` resolved to 2.18.1. |
| trivy-fs | CVE-2026-113661 — sanitize-html XSS via unsafe meta refresh content attributes (MEDIUM, CVSS 5.4) | fixed | 95 | Closed by the same bump. |

## Auto-fixed

- `backend/package.json`: `sanitize-html` ^2.17.7 → ^2.18.0 (installed 2.18.1 via lockfile refresh). Only call site is `backend/src/config/rich-text.ts:54` (`sanitizeRichText`), used to sanitise author-written lesson HTML before storage.
- `backend/package-lock.json` picked up incidental patch-level drift within existing caret ranges: dayjs 1.11.21→1.11.23, is-plain-object 5.0.0→5.1.0, launder 1.7.1→1.7.2, nanoid 3.3.18→3.3.20, postcss 8.5.25→8.5.31. All transitive, no API changes.

## Tests updated (stale assertions from fixes)

- None — no behaviour change in the sanitiser output surfaced for existing tests.

## 🚨 Escalated — human attention needed

- None.

## Outcome

DONE — both NEW sanitize-html CVEs closed by a single patch-level dep bump. Backend unit suite 678/678 passing (22 suites), `rich-text` sanitiser suite 52/52 passing, root `npm run lint` clean, backend `tsc --noEmit` clean, `npm run build` clean. The post-reconcile preflight shows 0 NEW findings; the 2 bucketed "regressions" are a known artifact of comparing newly-written `status=fixed` statements against the pre-fix `trivy-fs.json` input — the next full scan on the merged PR will see them gone from the tree.
