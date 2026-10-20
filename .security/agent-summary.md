## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| Semgrep | react-dangerouslysetinnerhtml at `frontend/src/components/common/element-view.tsx:312` | not_affected | 90 | REEVALUATE (touched): sink unchanged; `openLinksInNewTab` only calls `window.open(... 'noopener,noreferrer')`. Lesson text still passes through `sanitizeRichText` on write (curriculum-service.ts:1267, :1356). Fresh 90-day window. |
| Semgrep | direct-response-write at `backend/src/controllers/curriculum-controller/curriculum-controller.ts:533` | not_affected | 90 | REEVALUATE (touched): `res.send(result)` payload is still EditLeaseService.release/releaseAll return value — `{released: boolean}` or `{released: number}`, no user strings; auto-serialised to JSON. Fresh 90-day window. |

## Auto-fixed

- None. Both findings re-confirmed not_affected — no source changes required.

## Tests updated (stale assertions from fixes)

- None.

## 🚨 Escalated — human attention needed

- None.

## Outcome

DONE — 0 NEW findings, 2 PERSISTENT (skipped), 0 RESOLVED, 0 REGRESSION, 2 REEVALUATE (both touched; previously `not_affected`). Both re-verified against current code: the dangerouslySetInnerHTML sink in element-view.tsx still consumes server-sanitised rich text, and the `res.send(result)` in curriculum-controller.ts still returns a server-constructed object with no user-controlled strings. Fresh dated statements written with `reevaluate_after: 2027-01-18`; prior docs remain untouched per the immutability rule.
