## Triaged

| Source | Finding | Status | Confidence | Action |
|---|---|---|---:|---|
| Semgrep | `direct-response-write` @ `backend/src/controllers/curriculum-controller/curriculum-controller.ts:531` | not_affected | 90% | Documented + `// nosemgrep:` on the line |

Three PERSISTENT findings (mysql2 GHSA-3f6p-5ww8-9rcr, mysql2 GHSA-rgwj-5xj2-c3m3, `dangerouslySetInnerHTML` on `element-view.tsx`) carry future `reevaluate_after` dates from prior statements and were left untouched per protocol.

## Auto-fixed

- None. The only new finding is a Semgrep false positive: `res.send(result)` where `result` is a service-computed `{ released }` object — Express serialises it as JSON, and the attacker never controls any string in the response body. Marked `not_affected` (`vulnerable_code_cannot_be_controlled_by_adversary`, 90% confidence) with a `// nosemgrep:` suppression synced by `sync-suppressions.mjs`.
- Baseline hygiene: `frontend/src/pages/private/admin/course-editor.tsx` failed `simple-import-sort/imports` after the upstream merge (commit `2f05d38`). Ran `eslint --fix` on that one file to restore the green baseline the pre-flight assumes; no behavioural change.

## Tests updated (stale assertions from fixes)

- None.

## 🚨 Escalated — human attention needed

- None.

## Outcome

DONE — one NEW Semgrep finding triaged as `not_affected` with concrete evidence; suppressions synced; pre-existing lint drift on `course-editor.tsx` auto-fixed. Pre-flight suite: lint clean, `backend` unit tests 510/510 pass (integration suites skipped per config), `frontend` tests 57/57 pass, `npm run build` succeeds, backend `tsc --noEmit` clean. Rebucket after write: `new=0`.
