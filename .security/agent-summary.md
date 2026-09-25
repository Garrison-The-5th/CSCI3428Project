## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| Semgrep | `direct-response-write` @ `backend/src/controllers/curriculum-controller/curriculum-controller.ts:532` (REEVALUATE, touched) | not_affected | 90% | Re-verified: same reasoning still holds; refreshed 90-day window |

Three PERSISTENT findings (mysql2 `GHSA-3f6p-5ww8-9rcr`, mysql2 `GHSA-rgwj-5xj2-c3m3`, `dangerouslySetInnerHTML` on `element-view.tsx`) carry future `reevaluate_after` dates from prior statements and were left untouched per protocol.

## Auto-fixed

- None. Merge commit `2f05d38` (edit-lease work) touched the file where the sole SAST XSS finding sits, which triggered a REEVALUATE of the prior `not_affected` disposition. On re-reading, both defences still hold: `EditLeaseService.release/releaseAll` return `{released: boolean|number}` (derived from a Prisma `updateMany` count) — no user-controlled string reaches `res.send`, and Express serialises the object as JSON so a browser would not render it as HTML. Wrote a new dated statement (`2026-09-11-pr34622331476-edit-lease-release-reevaluate-still-safe.sast.json`) with `reevaluate_after=2026-12-10`. Suppressions synced; no code or dependency change required.

## Tests updated (stale assertions from fixes)

- None.

## 🚨 Escalated — human attention needed

- None.

## Outcome

DONE — one REEVALUATE (touched) handled with a re-confirmed `not_affected` statement carrying a future `reevaluate_after`; no NEW / RESOLVED / REGRESSION findings; suppressions synced (no `.trivyignore` diff). Pre-flight: `npm run lint` clean, backend `npm test` 510/510 pass (integration skipped per config), `npm run build` succeeds, backend `tsc --noEmit` clean. Frontend jest could not launch here (missing `ts-node` peer dep on this runner) — unrelated to this triage's file changes (the only diff is a new triage doc under `.security/sast/`); the Janus PR gate on the bot-sec PR will re-verify in its own environment.
