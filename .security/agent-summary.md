## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| Semgrep | typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml — frontend/src/components/common/element-view.tsx:311 (REEVALUATE touched) | not_affected | 90 | re-confirmed inline_mitigations_already_exist; wrote fresh dated statement with reevaluate_after 2027-01-04 |

## Auto-fixed

- none

## Tests updated (stale assertions from fixes)

- none

## 🚨 Escalated — human attention needed

- none

## Outcome

DONE — Full-tree reconciliation produced 0 NEW, 0 RESOLVED, 0 REGRESSION, 4 PERSISTENT and 1 REEVALUATE (touched). The reevaluate hit `element-view.tsx` because commit 3b7a618 added an `openLinksInNewTab` click handler nearby; the `dangerouslySetInnerHTML` sink on line 311 is unchanged, and the inline mitigation that justified the prior disposition — server-side `sanitizeRichText` (`backend/src/config/rich-text.ts`, invoked at `curriculum-service.ts:1226,1306`) using sanitize-html with a strict allowlist (no script/iframe/event-handlers, javascript: scheme blocked, tight style whitelist) — still holds. Re-confirmed not_affected / inline_mitigations_already_exist, fresh 90-day window. Pre-flight on the merged tree: lint, backend+frontend tests, `npm run build`, and `tsc --noEmit -p backend/tsconfig.json` all green.
