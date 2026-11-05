## Summary

**Overall impact on us: ✅ LOW.** One Semgrep `direct-response-write` XSS sink in `tour-controller.ts` re-verified because its file was touched by the previous security triage commit (which added the inline `// nosemgrep:` marker above the sink). Standing `not_affected` disposition re-confirmed against unchanged source; fresh 90-day window.

| | Count |
|---|---:|
| ✅ Not exposed | 1 |

## Triaged

| Source | Finding | Status | Confidence | Impact on us | Action |
|---|---|---|---:|---|---|
| Semgrep | `direct-response-write` @ `backend/src/controllers/tour-controller/tour-controller.ts:53` | not_affected | 90 | ✅ Not exposed | REEVALUATE (touched) — re-verified; fresh 90-day window |

## Auto-fixed

- None (no exposed findings).

## Verification

| Check | Result |
|---|---|
| `npm run lint` | ✅ pass |
| `npm test` (backend unit) | ✅ pass (738/738) |
| `npm test` (backend integration) | ✅ pass (63 skipped — require DB) |
| `npm test` (frontend) | ✅ pass (238/238) |
| `npx tsc --noEmit -p backend/tsconfig.json` | ✅ pass |
| `npm run build` | ✅ pass |

## Tests updated (stale assertions from fixes)

- None.

## 🚨 Escalated — human attention needed

- None.

## 🚨 REGRESSION

- None.

## Outcome

DONE — one REEVALUATE (touched) processed, zero NEW / RESOLVED / REGRESSION. The `tour-controller.ts:53` sink sends the return of `TourService.save`, shaped `{ status: TourStatus, step: number, tutorialCourseId: string | null }`: `status` is strict-validated against the Prisma `TourStatus` enum, `step` is coerced through `boundedInteger`, and `tutorialCourseId` is a server-computed id. No `req.body` string reaches the response, and Express `res.send` on an object serialises to `application/json`, which browsers cannot render as HTML. Triage doc `.security/sast/2026-11-05-pr42072850150-tour-controller-reeval-still-safe.sast.json` written, schema-valid. Rebucket: 0 NEW.
