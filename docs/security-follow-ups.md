# Security and Compliance Follow-Ups

Known gaps against the TTG Technology Standards that are **not** closed in code,
each with why it was deferred and what closing it involves. Referenced from the
source at the point each one bites.

Last reviewed: 10 August 2026.

---

## 1. Assignment tokens travel in the URL — §3.2.1, §3.9.1

**Status:** deviation, mitigated, not closed.

§3.2.1 says plainly: "Verify the application never reveals session tokens in URL
parameters", and §3.9.1 repeats it for API URLs. The guest assignment token
appears in both — the entry link `/a/<token>` and every subsequent call to
`/public/assignments/:token/...`.

**Why it is still there.** The token *is* the product feature. The whole point
of the external-learner flow is that a contractor can be emailed a link and
complete an induction without an account. A link that cannot be clicked is not a
link.

**What is mitigating it now:**

- 256 bits of entropy (`randomBytes(32)`), so guessing is not a threat.
- Per-recipient, per-item — one link opens exactly one course or quiz.
- Instant revocation, optional expiry, and a 90-day inactivity timeout.
- Uniform `404` on every failure, so tokens cannot be probed for.
- Masked out of application logs by `request-logger.ts`.
- Rate limited at 120 reads / 60 writes per minute.

**What closing it properly looks like.** Exchange the URL token once, at
`/a/<token>`, for a short-lived session credential held in a `Secure`,
`HttpOnly`, `SameSite=Lax` cookie, and have the guest API read that instead. The
URL token then becomes single-use. This is a real piece of work — it touches the
guest context, every `assignmentApi` call and the public controller — and it
belongs with the "compliance-grade identity" project rather than being bolted on.

---

## 2. No antivirus scanning of uploads — §3.8.4

**Status:** deferred, needs infrastructure.

§3.8.4 requires files from untrusted sources to be "scanned by antivirus
scanners to prevent upload and serving of known malicious content". Nothing
scans them today.

**What is mitigating it now.** Uploads are constrained harder than they were:
a seven-format allow list, content-based type verification by magic bytes
(`detectType` in `config/media-upload.ts`), SVG and script-bearing extensions
refused outright, a 10 MB per-file cap and a per-user hourly quota. Files are
stored as base64 in PostgreSQL rather than on disk, so nothing is ever written
to a filesystem path or served from the web root, and nothing can be executed.

**What closing it looks like.** A ClamAV sidecar in the Kubernetes deployment,
called from `normalizeUpload` before the buffer is stored, failing closed. The
integration point is one function; the work is the infrastructure and the
operational question of what happens when the scanner is down.

---

## 3. SVG uploads are refused rather than sanitised — §3.3.2

**Status:** closed as "disabled"; reopening it needs sanitisation.

§3.3.2 offers three options for user-supplied SVG: sanitise, disable, or
sandbox. Disabling is implemented, which satisfies the standard — but it does
lose a genuinely useful format for diagrams and logos.

**To restore SVG support**, sanitise on write exactly as author rich text is
handled in `config/rich-text.ts`: strip `<script>`, `<foreignObject>`, every
`on*` handler, and any external reference, then re-serialise. Do not simply
allow the MIME type back onto the list — uploaded media is served from a `data:`
URI on the app's own origin, so an unsanitised SVG executes as the application.

---

## 4. Rate limiting is per-process — §3.7

**Status:** works today, blocks horizontal scaling.

The limiter in `controllers/middleware/rate-limit.ts` holds its counters in
memory. That is correct for the single container the app runs in now, but it
resets on restart and does not coordinate across replicas. The same is true of
the per-user upload quota.

**Before running more than one replica**, move both to Redis, or apply the limit
at the ingress. Until then, scaling the deployment silently multiplies every
limit by the replica count.

Related: `TRUST_PROXY` must be set in any environment behind a proxy, or every
visitor shares one bucket. The app warns about this at startup — see
`config/client-address.ts`.

---

## 5. The Keycloak public key is static configuration — §3.10.1

**Status:** unchanged from the original audit.

`PUBLICKEY` is pasted into the environment rather than fetched from Keycloak's
JWKS endpoint. A key rotation therefore breaks all authentication silently and
completely, and the fix is a redeploy rather than a refresh.

**What closing it looks like.** Fetch and cache the JWKS from
`{KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/certs`, select the key by
the token's `kid`, and re-fetch on an unknown `kid`. `jwks-rsa` does this in
about fifteen lines inside `auth-middleware.ts`.

---

## 6. Test coverage is below the §5.1.1 target

**Status:** substantial suite in place, target not yet met.

§5.1.1 sets "≥ 80% coverage on core logic module". The suite is now 362 backend
tests and 30 frontend tests where there were none, and four areas are at or
above the target and pinned so they cannot regress:

| Area | Coverage |
|---|---|
| `config/` (sanitisation, validation, uploads) | ~90% |
| `services/enrolment-service/` | 100% |
| `services/insights-service/` | ~95% |
| `services/publication-service/` | ~85% |
| `services/notification-service/` | ~80% |

Still short of 80%, in rough order of how much each is worth:

| Area | Coverage | Why it matters |
|---|---|---|
| `services/curriculum-service/` | ~46% | The numbering grid and renumbering pass — the most intricate logic in the codebase |
| `services/quiz-service/` | ~39% | Grading is covered; question CRUD and the recycle-bin paths are not |
| `services/assignment-service/` | ~24% | Token issuing and throttling covered; the guest-session catalogue is not |
| `services/email-service/` | ~49% | Composition covered; the Gmail transport is not |
| `services/privacy-service/` | 0% | New in this pass; needs integration tests against a real database |
| `services/auth-service/` | ~6% | Thin, but `getOrCreateUser` is on every authenticated request |
| `services/table-service/` | 0% | Boilerplate demo data; lowest value |

The thresholds in `backend/jest.config.ts` are deliberately set just under the
current numbers so they act as a **ratchet** — coverage can only go up, and each
service gets pinned at 80% as it arrives there. Setting them to 80% today would
simply fail every build, which teaches the team to bypass the gate.

Frontend coverage is lower again: `element-view` and `new-badge` are covered,
the pages are not. Page-level behaviour is partly covered by the Playwright
suite instead.

---

## 7. E2E cannot yet sign in — §5.1.1

**Status:** written, skipped pending realm configuration.

The Playwright suite covers authentication *gates*, failure states, data
submission and the security headers for real. The signed-in journeys — reaching
the dashboard, opening a course, exporting personal data — are written but
skipped behind `E2E_TEST_USER` / `E2E_TEST_PASSWORD`.

They are skipped rather than omitted so the gap shows up in the run report. To
enable them, create a dedicated test user in the Keycloak realm and set those
two variables plus `E2E_BASE_URL` in CI.

---

## 8. Media is base64 in PostgreSQL

**Status:** architectural, unchanged, and the largest remaining structural issue.

Cover photos, module images and PDFs are stored base64 in the database and
travel inline in the course JSON. Published snapshots carry a second copy. This
is not a standards violation as such, but it drives the payload sizes, the 2 MB
body limit and the upload quotas above, and it will get harder to migrate the
more content accumulates.

Moving to object storage with a dedicated media endpoint is the single highest-
value refactor available.

---

## 9. Accessibility has not been audited — §2.6.3

**Status:** partially addressed, no formal audit.

Keyboard navigation is genuinely good — arrow-key course stepping, focus-visible
rings, ARIA roles on dialogs and the quiz timer. What is missing is a WCAG 2.2
AA pass: colour contrast has never been measured, and author-uploaded
instructional images have no way to carry alt text, because the element model
has no field for it.

Adding `altText` to `Element` is a migration and an editor field, and is
prerequisite to any real accessibility claim.
