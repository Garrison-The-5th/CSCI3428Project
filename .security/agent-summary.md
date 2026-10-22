## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| semgrep | typescript.react.security.audit.react-dangerouslysetinnerhtml @ frontend/src/components/common/element-view.tsx:325 | not_affected (re-confirmed) | 90 | REEVALUATE (touched): write-time `sanitizeRichText` mitigation still in place. Fresh 90-day window. |
| semgrep | javascript.express.security.audit.xss.direct-response-write @ backend/src/controllers/curriculum-controller/curriculum-controller.ts:536 | not_affected (re-confirmed) | 90 | REEVALUATE (touched): `res.send(result)` payload is still server-constructed `{released: boolean\|number}` with no user strings. Fresh 90-day window. |

## Auto-fixed

- None.

## Tests updated (stale assertions from fixes)

- None.

## 🚨 Escalated — human attention needed

- None.

## Outcome

DONE — 2 REEVALUATE (touched) SAST findings re-verified against the current merged tree. Both prior `not_affected` dispositions still hold: the `dangerouslySetInnerHTML` sink at element-view.tsx:325 is still protected by `sanitizeRichText` on write (backend/src/config/rich-text.ts:57, called from curriculum-service.ts:1320 and :1413), and the `res.send(result)` at curriculum-controller.ts:536 still returns a server-constructed `{released: boolean\|number}` from EditLeaseService with no attacker-controlled strings. New superseding statements written with `reevaluate_after=2027-01-20`. Schema validation OK; `.trivyignore` regenerated identically; NEW=0. No source changes; lint green. Backend/frontend node_modules were not installed on the runner so npm test / build / tsc couldn't run here — not a concern given the change is JSON-only and the base branch was green from the PR gate.
