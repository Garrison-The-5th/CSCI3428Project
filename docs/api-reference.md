# API Reference

Every HTTP endpoint the backend exposes: **96 routes** across seven controllers.

TTG Technology Standards §1.8 requires "detailed documentation covering all
endpoints, parameters, request/response formats, and error codes".

**This table is generated from the route decorators**, so it cannot drift from
the code the way a hand-maintained list does. Regenerate it after adding or
changing a route.

---

## Conventions

**Base URL.** `http://localhost:5002` in development; `/api` behind the
production reverse proxy.

**Authentication.** A Keycloak-issued JWT in `Authorization: Bearer <token>`,
verified RS256 server-side. The one exception is `/public/assignments/:token/*`,
where the token in the path is the credential — see the note under that section.

**Content type.** Requests carrying a body must send
`Content-Type: application/json` (or `multipart/form-data` for uploads).
Anything else is refused with `415`.

**Request bodies** are capped at 2 MB (`JSON_BODY_LIMIT`). Uploaded files are
capped at 10 MB each, with a rolling per-user quota of 60 files / 200 MB per
hour.

### Access labels

| Label | Meaning |
|---|---|
| public | No authentication |
| signed in | Any valid Keycloak session |
| author/admin | Holds the `admin` or `contributor` role, on the client or the realm |
| admin | Holds the `admin` role |
| can edit this course | A global author, or named as a contributor on that course |
| rate limited | Carries a tighter per-user or per-address limit than the global one |

### Error codes

Every error response is JSON of the shape `{ "errorMessage": "..." }`, plus
`correlationId` on a 500.

| Status | Meaning |
|---|---|
| `400` | The request was understood but refused — validation, or a readable service error |
| `401` | No token, an invalid token, or an expired one. The reason is deliberately not disclosed |
| `403` | Authenticated, but not allowed to do this |
| `404` | Not found — **also** returned for content the caller may not see, so the API cannot be used to enumerate what exists |
| `415` | Missing or unsupported `Content-Type` |
| `429` | Rate limited. Carries `Retry-After`, in seconds |
| `500` | Unexpected. Carries a `correlationId` matching a log entry; the message is generic by design |

### Response headers

Every response carries `X-Correlation-Id`, plus the security headers set by
helmet: `Content-Security-Policy`, `X-Content-Type-Options`,
`Strict-Transport-Security` and `Referrer-Policy`.

---

## Endpoints

### `/assignments`

Defined in `backend/src/controllers/**/assignment-controller.ts`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/assignments/` | signed in, author/admin | Links for one course (?courseId=) or one quiz (?quizId=), with progress |
| `GET` | `/assignments/courses` | signed in, author/admin | Every course that has been handed to someone, as summary cards |
| `GET` | `/assignments/insights` | signed in, author/admin, rate limited | Learners and how far they have got, for the dashboard's Student insights |
| `GET` | `/assignments/insights/:email` | signed in, author/admin | One learner's full picture, for the drill-down page |
| `POST` | `/assignments/` | signed in, author/admin, rate limited | One learner's full picture, for the drill-down page |
| `PUT` | `/assignments/:id` | signed in, author/admin | Moves one person's due date |
| `POST` | `/assignments/:id/revoke` | signed in, author/admin | Turns a link off without losing the record or the progress behind it |
| `POST` | `/assignments/:id/restore` | signed in, author/admin | Turns a link back on and tells the person it works again |
| `POST` | `/assignments/:id/resend` | signed in, author/admin | Sends the same message again, on demand |
| `DELETE` | `/assignments/:id` | signed in, author/admin | Sends the same message again, on demand |

### `/auth`

Defined in `backend/src/controllers/**/auth-controller.ts`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/auth/all-users` | signed in, admin | Generous enough for a person, tight enough to stop a script |
| `GET` | `/auth/users` | signed in, admin | Generous enough for a person, tight enough to stop a script |
| `GET` | `/auth/search` | signed in, author/admin | Type-ahead for pickers that name a person — assigning contributors or students |
| `POST` | `/auth/subscribe` | public | Public by design — anyone may put their address down |
| `POST` | `/auth/send-email-to-subscribers` | signed in, admin | Public by design — anyone may put their address down |

### `/curriculum`

Defined in `backend/src/controllers/**/curriculum-controller.ts`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/curriculum/courses` | signed in | Learner view: the published courses assigned to this person |
| `GET` | `/curriculum/courses/editable` | signed in | Courses this person may edit: everything for a global author, only the ones they are named on for a contributor |
| `GET` | `/curriculum/courses/:id/contributors` | signed in | Courses this person may edit: everything for a global author, only the ones they are named on for a contributor |
| `PUT` | `/curriculum/courses/:id/contributors` | signed in, author/admin | Only a global author may change who can edit a course |
| `GET` | `/curriculum/courses/manage` | signed in, author/admin | Author view: drafts included |
| `GET` | `/curriculum/deleted` | signed in, author/admin | Everything in the recycle bin, for the admin dashboard |
| `POST` | `/curriculum/deleted/restore-all` | signed in, author/admin | Restores every deleted course and module in one go |
| `DELETE` | `/curriculum/deleted` | signed in, author/admin | Empties the recycle bin |
| `DELETE` | `/curriculum/deleted/courses/:id` | signed in, author/admin | Permanently removes one deleted course |
| `DELETE` | `/curriculum/deleted/modules/:id` | signed in, author/admin | Permanently removes one deleted module |
| `GET` | `/curriculum/courses/:id` | signed in | One course for a learner |
| `POST` | `/curriculum/courses` | signed in, author/admin | Creates a course from just a name; everything else is set by editing it |
| `PUT` | `/curriculum/courses/:id` | signed in, can edit this course | Creates a course from just a name; everything else is set by editing it |
| `POST` | `/curriculum/courses/:id/publish` | signed in, can edit this course | Puts the course live as a new version |
| `GET` | `/curriculum/courses/:id/publication` | signed in, can edit this course | Whether there is anything to publish, and what |
| `GET` | `/curriculum/versions/:id` | signed in, author/admin | One archived version's full tree, for the editor's read-only view |
| `DELETE` | `/curriculum/courses/:id` | signed in, can edit this course | Soft delete — the course moves to the recycle bin and can be restored |
| `POST` | `/curriculum/courses/:id/restore` | signed in, author/admin | Soft delete — the course moves to the recycle bin and can be restored |
| `POST` | `/curriculum/courses/:id/image` | signed in, can edit this course, upload quota | Uploads the course cover photo shown on the Learning page |
| `GET` | `/curriculum/courses/:courseId/sections` | signed in, can edit this course | Uploads the course cover photo shown on the Learning page |
| `POST` | `/curriculum/courses/:courseId/sections` | signed in, can edit this course | A section takes a title and the place in the course it should occupy |
| `PUT` | `/curriculum/sections/:id` | signed in, can edit this course | A section takes a title and the place in the course it should occupy |
| `DELETE` | `/curriculum/sections/:id` | signed in, can edit this course | Soft delete — the section and its modules move to the recycle bin |
| `POST` | `/curriculum/sections/:id/restore` | signed in, author/admin | Soft delete — the section and its modules move to the recycle bin |
| `DELETE` | `/curriculum/deleted/sections/:id` | signed in, author/admin | Permanently removes one deleted section |
| `POST` | `/curriculum/courses/:courseId/modules` | signed in, can edit this course | Permanently removes one deleted section |
| `PUT` | `/curriculum/courses/:courseId/structure` | signed in, can edit this course | Applies a new grid for the whole course — used by drag-to-reorder |
| `PUT` | `/curriculum/modules/:id` | signed in, can edit this course | Applies a new grid for the whole course — used by drag-to-reorder |
| `DELETE` | `/curriculum/modules/:id` | signed in, can edit this course | Soft delete — the module moves to the recycle bin and can be restored |
| `POST` | `/curriculum/modules/:id/restore` | signed in, author/admin | Soft delete — the module moves to the recycle bin and can be restored |
| `POST` | `/curriculum/modules/:id/image` | signed in, can edit this course, upload quota | Uploads an image or PDF and stores it on the module as an element |
| `POST` | `/curriculum/modules/:id/view` | signed in | Modules auto-complete on view, so opening one records progress |
| `POST` | `/curriculum/elements/:id/view` | signed in | Records one piece of content as seen |
| `PUT` | `/curriculum/modules/:id/content-order` | signed in, can edit this course | Reorders a module's content, where elements and quizzes are interleaved |
| `POST` | `/curriculum/modules/:moduleId/elements` | signed in, can edit this course | Reorders a module's content, where elements and quizzes are interleaved |
| `PUT` | `/curriculum/elements/:id` | signed in, can edit this course | Reorders a module's content, where elements and quizzes are interleaved |
| `DELETE` | `/curriculum/elements/:id` | signed in, can edit this course | Reorders a module's content, where elements and quizzes are interleaved |
| `GET` | `/curriculum/progress` | signed in | What this learner has already done |
| `GET` | `/curriculum/dashboard` | signed in | Everything the home dashboard needs for the signed-in user |
| `GET` | `/curriculum/instructors` | signed in, author/admin | Authors only |
| `POST` | `/curriculum/instructors` | signed in, author/admin | Authors only |
| `PUT` | `/curriculum/instructors/:id` | signed in, author/admin | Authors only |
| `POST` | `/curriculum/instructors/:id/photo` | signed in, author/admin, upload quota | Authors only |
| `DELETE` | `/curriculum/instructors/:id` | signed in, author/admin | Authors only |
| `GET` | `/curriculum/courses/:courseId/notes` | signed in | Authors only |
| `POST` | `/curriculum/courses/:courseId/notes` | signed in | Authors only |
| `PUT` | `/curriculum/notes/:id` | signed in | Authors only |
| `DELETE` | `/curriculum/notes/:id` | signed in | Authors only |

### `/me`

Defined in `backend/src/controllers/**/privacy-controller.ts`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/me/data` | signed in, rate limited | Downloads everything held about the caller, as a JSON attachment |
| `DELETE` | `/me/data` | signed in, rate limited | Erases the caller's personal data |

### `/public/assignments`

Defined in `backend/src/controllers/**/public-assignment-controller.ts`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/public/assignments/:token/session` | public | Who this link belongs to — used to greet the guest and prove the link works |
| `GET` | `/public/assignments/:token/courses` | public | Every course assigned to this email |
| `GET` | `/public/assignments/:token/quizzes` | public | Every quiz assigned to this email, directly or through a course |
| `GET` | `/public/assignments/:token/dashboard` | public | The same dashboard a signed-in learner gets, over assigned content only |
| `GET` | `/public/assignments/:token/progress` | public | The same dashboard a signed-in learner gets, over assigned content only |
| `POST` | `/public/assignments/:token/modules/:moduleId/view` | public | The same dashboard a signed-in learner gets, over assigned content only |
| `POST` | `/public/assignments/:token/elements/:elementId/view` | public | One piece of content seen — what unlocks the next on a sequential course |
| `POST` | `/public/assignments/:token/quizzes/:quizId/start` | public | Starts the clock on an assigned quiz, or reports the one already running |
| `POST` | `/public/assignments/:token/quizzes/:quizId/attempt` | public | Starts the clock on an assigned quiz, or reports the one already running |
| `GET` | `/public/assignments/:token/courses/:courseId/new` | public | What arrived in this course since the link holder last worked on it |
| `GET` | `/public/assignments/:token/courses/:courseId/notes` | public | What arrived in this course since the link holder last worked on it |
| `POST` | `/public/assignments/:token/courses/:courseId/notes` | public | What arrived in this course since the link holder last worked on it |
| `PUT` | `/public/assignments/:token/notes/:noteId` | public | What arrived in this course since the link holder last worked on it |
| `DELETE` | `/public/assignments/:token/notes/:noteId` | public | What arrived in this course since the link holder last worked on it |

### `/quizzes`

Defined in `backend/src/controllers/**/quiz-controller.ts`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/quizzes/` | signed in | Learner view: the quizzes this person can reach, with the correct answers stripped out |
| `GET` | `/quizzes/manage` | signed in, author/admin | Author view: drafts included, answers intact so they can be edited |
| `GET` | `/quizzes/deleted` | signed in, author/admin | Author view: drafts included, answers intact so they can be edited |
| `POST` | `/quizzes/deleted/restore-all` | signed in, author/admin | Restores every deleted quiz in one go |
| `DELETE` | `/quizzes/deleted` | signed in, author/admin | Permanently removes every deleted quiz |
| `DELETE` | `/quizzes/deleted/:id` | signed in, author/admin | Permanently removes one deleted quiz |
| `GET` | `/quizzes/:id` | signed in | One quiz for a learner: authenticated, scoped to what they can reach |
| `POST` | `/quizzes/` | signed in, can edit this course | One quiz for a learner: authenticated, scoped to what they can reach |
| `PUT` | `/quizzes/:id` | signed in, can edit this course | One quiz for a learner: authenticated, scoped to what they can reach |
| `DELETE` | `/quizzes/:id` | signed in, can edit this course | Soft delete — the quiz moves to the recycle bin and can be restored |
| `POST` | `/quizzes/:id/restore` | signed in, author/admin | Soft delete — the quiz moves to the recycle bin and can be restored |
| `POST` | `/quizzes/:id/start` | signed in | Starts the clock, or reports the clock already running |
| `POST` | `/quizzes/:id/attempt` | signed in, rate limited | Grades server-side and records the attempt so the quiz stops being outstanding |
| `POST` | `/quizzes/:quizId/questions` | signed in, can edit this course | Grades server-side and records the attempt so the quiz stops being outstanding |
| `PUT` | `/quizzes/questions/:id` | signed in, can edit this course | Grades server-side and records the attempt so the quiz stops being outstanding |
| `DELETE` | `/quizzes/questions/:id` | signed in, can edit this course | Grades server-side and records the attempt so the quiz stops being outstanding |

### `/table-members`

Defined in `backend/src/controllers/**/table-controller.ts`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/table-members/` | signed in | File: table-controller |

---

## Guest routes and their token

`/public/assignments/:token/*` authenticates on the token in the path. Two
things follow from that, and both are deliberate:

- **Every failure is a `404`**, whatever actually went wrong — unknown, revoked,
  expired, idle, or pointing at unpublished content. A uniform status means a
  probe cannot tell a real token from a fake one. The body still carries a
  `reason` field so the page can explain itself to the person holding the link.
- **The token is masked in logs.** `request-logger.ts` rewrites the path to
  `/public/assignments/:token/...` before writing it, because the token is a
  credential and §3.4.1 forbids logging those.

A token in a URL is itself a known deviation from §3.2.1 — recorded in
[security-follow-ups.md](./security-follow-ups.md).

## Subject-access routes

`/me/data` acts only on the caller, taken from the verified token. There is
deliberately no `:userId` parameter: a subject-access route that accepts an id
is one authorisation slip away from being a bulk personal-data export, which is
the risk §3.5.3 exists to prevent.

---

## Regenerating this document

The route table is extracted from the `@controller` / `@get` / `@post`
decorators. After changing a route, re-run the generator and commit the result
alongside the code change.
