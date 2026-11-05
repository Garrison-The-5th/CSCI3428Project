## Summary

**Overall impact on us: ✅ LOW.** Two Semgrep `direct-response-write` XSS sinks triaged as `not_affected`: one NEW sink added by the first-login walkthrough in `tour-controller.ts`, and one re-verification of the existing `curriculum-controller.ts` sink because its file was touched by the same merged PR.

| | Count |
|---|---:|
| ✅ Not exposed | 2 |

## Triaged

| Source | Finding | Status | Confidence | Impact on us | Action |
|---|---|---|---:|---|---|
| Semgrep | `direct-response-write` @ `backend/src/controllers/tour-controller/tour-controller.ts:52` | not_affected | 90 | ✅ Not exposed | New sink — triaged + inline `nosemgrep` added |
| Semgrep | `direct-response-write` @ `backend/src/controllers/curriculum-controller/curriculum-controller.ts:539` | not_affected | 90 | ✅ Not exposed | REEVALUATE (touched) — re-verified; fresh 90-day window |

## Auto-fixed

- None (no exposed findings).

## Verification

| Check | Result |
|---|---|
| `npm run lint` | ✅ pass |
| `npm test` (backend unit) | ✅ pass (228/228) |
| `npm test` (backend integration) | ✅ pass (63 skipped — require DB) |
| `npm test` (frontend) | ⚠️ pre-existing env gap: `ts-node` missing from frontend devDeps in this runner; the Janus PR gate has it and will run it on the bot-sec PR |
| `npx tsc --noEmit -p backend/tsconfig.json` | ✅ pass |
| `npm run build` | ✅ pass |

## Tests updated (stale assertions from fixes)

- None.

## 🚨 Escalated — human attention needed

- None.

## 🚨 REGRESSION

- None.

## Outcome

DONE — one NEW SAST finding and one REEVALUATE (touched) processed. Both are `direct-response-write` sinks that pass Express-serialised JSON built from validated enum/integer/server-computed fields; browsers cannot render `application/json` as HTML, so neither is exposed. Triage doc `.security/sast/2026-11-03-pr41717717047-tour-and-edit-lease-xss-sinks.sast.json` written, schema-valid, and matches the standing pattern for these sinks. Inline `// nosemgrep` added to `tour-controller.ts:52` to match the existing marker on the sibling sink. Rebucket: 0 NEW.
