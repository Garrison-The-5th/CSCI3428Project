# Code Structure

A learning platform built on the TTG full-stack boilerplate: React + Vite frontend,
Express + Prisma backend, PostgreSQL, Keycloak for authentication.

## Contents

- [The domain in one page](#the-domain-in-one-page)
- [Project root](#project-root)
- [Backend](#backend)
- [Frontend](#frontend)
- [How the three audiences differ](#how-the-three-audiences-differ)
- [Before you change anything](#before-you-change-anything)
- [Conventions worth knowing](#conventions-worth-knowing)

Companion documents: [API Reference](./api-reference.md) (every route),
[UX Design](./ux-design.md) (navigation paths and per-page rationale),
[Testing](./testing.md) (how to run each suite),
[Security Follow-Ups](./security-follow-ups.md) (known gaps and why).

---

## The domain in one page

```
Course ─┬─ Module ─── Section ─┬─ Element   (TEXT | YOUTUBE | IMAGE | PDF | CANVAS)
        │                      └─ Quiz ──── Question ──── Option
        ├─ CoursePublication  (a frozen snapshot per published version)
        ├─ Instructor         (many-to-many, credited on the course page)
        ├─ Assignment         (PLATFORM enrolment or a tokenized LINK)
        ├─ createdBy          (the User who made it, and so owns it)
        ├─ contributors       (other Users allowed to edit this one course)
        └─ CourseMapNode ──── CourseMapItem ─── Section   (directed learning only)
              └─ CourseMapEdge  (parent → child, and the quiz option offering it)
```

26 Prisma models in total. Beyond the tree above: `SectionProgress` and
`ElementProgress` (what a learner has opened), `QuizAttempt`, `QuizAnswer` and
`QuizSession` (results, the frozen paper, and the server-anchored clock on a
timed quiz), `CourseCompletion` (stamped at 100%), `EditLease` (who has a module
or question open), `Note`, `User`, and the four remaining directed-learning
tables — `CourseMapImport`, `CourseMapSubgraph` (another course's whole map
linked in, read-only), `DirectedLayerQuiz` and `DirectedChoice`.

- A **Course** is what the UI calls a "lesson". Created by name, then edited.
- A **Module** is a named group of sections and supplies the first digit of every
  section number inside it. Authors may tint one from a closed eight-colour palette.
- A **Section** lives inside a module. Its number (`2.3`) means "third section of the
  second module" — position in the grid is the only source of truth, and there is no
  free-text number field. `sortKey` is the zero-padded form so `1.10` sorts after `1.2`.
  Every write that can disturb the grid ends by calling `CurriculumService.renumberCourse`.
- **Elements and quizzes share one ordering sequence** inside a section, so a quiz
  can sit between two pieces of content.
- Every **Quiz** belongs to exactly one section. A course's quizzes are its sections'
  quizzes.
- Progress: `SectionProgress` (a section auto-completes on view), `ElementProgress`
  (finer grained, so a sequential course can unlock item by item), `QuizAttempt`,
  `QuizSession` (the deadline on a timed quiz, stored server-side), and
  `CourseCompletion` (stamped at 100%, used to detect new content later).

### Directed learning

Opt-in per lesson, through `Course.directedLearning`, and off on everything that
predates it. When it is on the course is no longer read straight through: its
sections are arranged into **CourseMapNode** boxes on a 2D canvas, connected by
**CourseMapEdge** rows, and each layer of the resulting tree gets a generated
`DIRECTED` quiz (**DirectedLayerQuiz**) asking the learner which branches apply.
Their answer is kept in **DirectedChoice**, keyed on the node rather than the
quiz option so it survives the author redrawing a connection.

Three rules carry the design:

- The **root** is where every learner starts. One per map, never deletable, and
  it can never be given a parent.
- **Depth is one more than the shallowest parent**, so a node reachable by a
  short route is offered as soon as that route allows. A node may have several
  parents — shared training belongs under every project that needs it — and
  ticking any one of them brings it in.
- A section of *this* course must be on the map before the course may be
  published. Sections imported from another course (**CourseMapImport**) need
  not be: taking three of a course's four sections is the point of importing.

The learner never sees any of this. `directed-path.ts` projects the published
snapshot down to the branches they picked and rewrites it into ordinary modules
and sections in map order — depth top to bottom, canvas `x` left to right — so
the player, the progress sums and the dashboard all read a normal course. Section
ids are never reminted, which is what lets somebody drop a branch and take it
back with their progress intact.

A layer quiz is generated per depth but **served per learner**. It is put in
front of somebody only when a route into that depth starts at a node they can
already see, and it then offers only those routes. A branch that simply ends
therefore ends: picking it does not produce a further question whose every answer
leads somewhere unreachable.

### The default tutorial and the first-login tour

One course carries `Course.isDefaultTutorial` — at most one, enforced by a
partial unique index in the migration. It is a real lesson, edited in the
Course Editor and published like any other, but it reaches people differently:

- **Everybody holds it without an assignment.** `EnrolmentService.forEmail`
  adds it to every signed-in person's enrolment, and
  `AssignmentService.getSessionCatalogue` adds it to what every link opens,
  both with no deadline. Every learner read goes through one of those two, so
  that is the whole of making it visible. No `Assignment` row ever names it,
  which is also what keeps it out of the admin dashboard's figures.
- **Nobody can take it away.** `DefaultTutorialService.assertNotTutorial`
  refuses deleting, unpublishing, changing its kind and assigning it, for
  everyone. The Course Editor hides those controls for it.
- **Only admins edit it.** `CurriculumGateway.accessibleCourses` excludes it for
  anyone who is not an admin, which covers every editor listing and
  `requireCourseEditor` at once.
- **It is created on start-up**, by `ensureDefaultTutorial`
  (`default-tutorial-bootstrap.ts`), because production never runs the seed and
  only `PublicationService` can build the snapshot learners read. The seed calls
  the same function.

The **first-login tour** (`frontend/src/components/tour/`) walks a new person
through the sidebar and into that course. Where each person is in it is
`User.tourStatus` / `User.tourStep` for an account (`/me/tour`), and
localStorage keyed by a hash of the link for a guest. The migration that added
those columns marked everyone who had already signed in as `SKIPPED`.

### Versioned publishing

**Learners never read the rows an author is editing.** They read a snapshot taken
when someone pressed Publish, stored on `CoursePublication`. That one indirection
is what makes "nothing reaches a learner until it is published" true of *edits* as
well as additions. `Course.publishedVersion` points at the version being served;
`Course.draftUpdatedAt` is touched by every edit and compared against the
publication's timestamp to answer "are there unpublished changes?".

Ids stay stable across a publish, so learner progress survives every version.
Superseded versions stay readable for 14 days (`ARCHIVE_DAYS`) and are then swept.

---

## Project root

```
/
├── config/                    # Keycloak login theme
├── frontend/                  # React app
├── backend/                   # Express API
├── docker-compose-dev.yml     # postgres + keycloak + backend + frontend
├── docker-compose.yml         # production images
└── .env                       # DB credentials; DB_NAME must match backend/.env
```

Both `docker-compose-dev.yml` services and a local `npm run dev` must point at the
**same database**. `DB_NAME` in the root `.env` and the database in
`backend/.env`'s `DATABASE_URL` are easy to let drift apart.

---

## Backend

```
backend/
├── prisma/
│   ├── schema.prisma          # the whole data model
│   ├── prisma-client.ts       # shared PrismaClient + connect/disconnect
│   ├── prisma.config.ts       # NOTE: Prisma 7 looks for this in the CWD, so the
│   │                          #   npm scripts pass --config prisma/prisma.config.ts
│   ├── seed.ts
│   └── migrations/            # applied by `migrate deploy` when the container starts
│
├── scripts/                   # *check.ts — end-to-end checks against a real
│                              #   database, run by `npm run test:smoke`
└── src/
    ├── index.ts               # Express setup, controller imports, error handler,
    │                          #   and the daily recycle-bin / archive sweep
    ├── app-router.ts          # single shared Router the decorators register onto
    │
    ├── config/                # pure rules with no database access
    │   ├── canvas.ts          # canvas layout cleaning — every item rebuilt field by field
    │   ├── media-upload.ts    # uploads: magic-byte sniffing, HEIC → JPEG, PDF passthrough
    │   ├── rich-text.ts       # sanitises author HTML before it is stored
    │   ├── validation.ts      # length limits, dates, emails, safe URLs
    │   ├── app-url.ts         # the public URL used in email links
    │   ├── client-address.ts  # caller IP behind proxies (TRUST_PROXY)
    │   ├── module-colors.ts   # the closed module/section colour palette
    │   └── logger.ts          # pino, plus the security-event log
    │
    ├── controllers/           # HTTP layer, wired by decorators
    │   ├── decorators/        # @controller @get @post @put @del @use
    │   ├── middleware/        # content-type, rate-limit, request-logger
    │   ├── http-errors.ts     # NotFound/Conflict errors and the shared `fail` responder
    │   ├── auth-controller/
    │   │   ├── auth-middleware.ts           # verifies the JWT, attaches req.user/req.auth
    │   │   ├── authorization-middleware.ts  # requireRole / requireAnyRole / requireAuthor
    │   │   └── course-access-middleware.ts  # requireCourseEditor — per-course access,
    │   │                                    #   draft marking, edit attribution
    │   ├── curriculum-controller/   # courses, modules, sections, elements, notes,
    │   │                            #   instructors, contributors, versions, progress
    │   ├── course-map-controller/   # directed-learning map
    │   ├── quiz-controller/
    │   ├── assignment-controller/   # author-facing assignment management
    │   ├── public-controller/       # token-authenticated guest routes
    │   ├── privacy-controller/      # data export and erasure for the signed-in user
    │   ├── tour-controller/         # /me/tour — the first-login walkthrough's state
    │   └── table-controller/        # demo data table
    │
    ├── services/              # business logic; no HTTP knowledge
    │   ├── curriculum-service/      # course/module/section/element rules, the numbering grid
    │   ├── publication-service/     # publish, snapshots, versions, "new since you started"
    │   ├── course-map-service/      # the map, layer-quiz generation; directed-path.ts
    │   │                            #   narrows a snapshot to one learner's branches
    │   ├── quiz-service/            # grading, answer redaction, timed runs, quiz kinds
    │   ├── assignment-service/      # tokens, guest sessions, link lifecycle
    │   ├── enrolment-service/       # what a signed-in learner has been given, and by when
    │   ├── dashboard-service/       # progress figures, shared by learners and guests
    │   ├── insights-service/        # the admin dashboard's Student insights
    │   ├── notification-service/    # "new content" emails
    │   ├── email-service/           # SMTP via app password
    │   ├── edit-lease-service/      # advisory "someone else is editing this" claims
    │   ├── edit-attribution-service/# "last edited by" stamps
    │   ├── privacy-service/         # export and erasure
    │   ├── default-tutorial-service/# the course everybody has; created on start-up
    │   ├── tour-service/            # where a signed-in person is in the first-login tour
    │   ├── admin-access-service/    # granting roles through Keycloak
    │   ├── auth-service/            # user rows and Keycloak sign-in matching
    │   └── table-service/           # demo data table
    │
    └── gateways/              # all Prisma (and Keycloak admin API) access lives here
        ├── curriculum-gateway/  quiz-gateway/  assignment-gateway/  auth-gateway/
        ├── publication-gateway/  course-map-gateway/  edit-lease-gateway/
        └── keycloak-gateway/
```

### Backend rules

**Controller → Service → Gateway, one direction only.** Controllers never touch
Prisma; gateways never contain business rules.

**A controller only exists if `index.ts` imports it.** The decorators register
routes at import time, so a new controller that nobody imports silently 404s.

**Two views of the catalogue.** `/curriculum/courses` and `/quizzes` are the learner
view (published, not deleted, quiz answers stripped). `/curriculum/courses/manage`
and `/quizzes/manage` are the author view (drafts included, answers intact). Keep
them separate — that separation is what stops answers leaking.

**Deleting is soft.** Courses, sections and quizzes set `deletedAt` and appear in the
Admin Dashboard recycle bin. Only the `/deleted/...` routes hard delete, and they
refuse anything not already in the bin.

**`req.params` is `string | string[]` in Express 5.** Every controller has a small
`param(req, name)` helper; use it rather than reading params directly.

---

## Frontend

```
frontend/src/
├── index.tsx                  # AuthProvider → GuestProvider → EditorAccessProvider
│                              #   → NewContentProvider → App
├── app.tsx                    # routing; also decides whether to show the app shell
│
├── contexts/
│   ├── auth-context.tsx       # Keycloak session; isAdmin / isAuthor
│   ├── guest-context.tsx      # assignment-link session (token in sessionStorage)
│   ├── editor-access-context.tsx  # which courses this person may edit
│   ├── new-content-context.tsx    # courses with content added since they finished
│   └── edit-locks-context.tsx     # who else is editing this course, and what that locks
│
├── services/                  # everything that talks to the API
│   ├── curriculum-api.ts      # courses, sections, elements, notes, versions
│   ├── quiz-api.ts            # quizzes, questions, attempts
│   ├── assignment-api.ts      # author assignment management + public guest endpoints
│   ├── course-map-api.ts      # directed-learning map
│   ├── learner-api.ts         # ⭐ one interface over the JWT and token APIs
│   ├── course-progress.ts     # unlocking and progress rules, client side
│   ├── due-dates.ts           # how a deadline reads
│   ├── one-time-link.ts
│   └── tour-store.ts          # where the tour keeps its place: server or browser
│
├── hooks/
│   └── use-auto-save.ts       # debounced save; no save buttons in the editor
│
├── components/
│   ├── protected-route.tsx    # authenticated / admin / author / canEdit gates
│   ├── common/
│   │   ├── element-view.tsx   # ⭐ renders section content + plainPreview() helper
│   │   ├── element-editor.tsx # one auto-saving content row with a live preview
│   │   ├── rich-text-editor.tsx, rich-text-table.ts  # toolbar, tables, cell resizing
│   │   ├── quiz-runner.tsx    # taking a quiz, used everywhere quizzes appear
│   │   ├── quiz-editor.tsx, question-fields.tsx, quiz-timer.tsx
│   │   ├── assign-panel.tsx, assignment-roster.tsx  # hand out and manage assignments
│   │   ├── new-badge.tsx, edited-tag.tsx, privacy-notice.tsx, color-picker.tsx
│   │   └── confirm-dialog.tsx, toast-notification.tsx, unauthorized.tsx
│   ├── canvas/                # canvas element: model (pure geometry), editor, view
│   ├── navbar/
│   ├── tour/                  # first-login walkthrough: tour-steps.ts (the script and
│   │                          #   all its wording), tour-context (TourProvider, useTour),
│   │                          #   tour-overlay (spotlight), use-tour-target, tour-signal
│   └── ui/                    # shadcn-style primitives + progress-donut, toggle-switch
│
├── pages/
│   ├── private/
│   │   ├── home/home.tsx              # dashboard: progress rings, due dates, new content
│   │   ├── learning/                  # learning.tsx (card grid), course-landing.tsx,
│   │   │                              #   course-player.tsx (content left, rail right)
│   │   ├── quizzes/                   # quizzes.tsx, quiz-landing.tsx, quiz-player.tsx,
│   │   │                              #   standalone-quiz.tsx
│   │   ├── admin/
│   │   │   ├── admin-learning.tsx     # lesson library (published / drafts)
│   │   │   ├── admin-quizzes.tsx      # quiz sets
│   │   │   ├── course-editor.tsx      # the editor, reached by clicking a card
│   │   │   ├── course-editor-list.tsx # contributors' cut-down lesson list
│   │   │   └── editor/                # the editor's panes: structure, landing page,
│   │   │                              #   quizzes, access, versions, course-map/
│   │   ├── admin-page/                # admin dashboard: assigned learning, student
│   │   │                              #   insights, recycle bin
│   │   └── users/, profile/, contact-us/, table/
│   └── public/
│       ├── assignment-entry.tsx       # /a/:token — starts a guest session
│       └── login.tsx, about.tsx, public-page/
│
└── utils/
    ├── http-helper.ts         # fetch wrapper; refreshes the Keycloak token
    ├── get-navbar-data.tsx    # sidebar contents per audience
    ├── keycloak.ts, logger.ts
    └── utils.ts               # API_BASE_URL (localhost in dev, /api in production)
```

### Frontend rules

**Learner pages never branch on how you signed in.** They call `useLearnerApi()`,
which returns either the JWT-backed or token-backed implementation of the same
interface. Add a learner feature there and it works for both audiences at once.

**One renderer for lesson content.** `ElementView` renders it; `plainPreview()`
summarises it for lists and rails. Lesson text is stored as HTML, so anything that
shows a snippet must go through `plainPreview` or it will display raw tags — this
has bitten twice.

**The editor auto-saves.** `useAutoSave` writes ~0.7s after typing stops. There are
no save buttons in `CourseEditor`, and adding content is done by typing and moving
on rather than pressing Add.

**Route gates.** `<ProtectedRoute>` takes `isAdmin`, `isAuthor` or `canEdit`.
`canEdit` is derived from the courses you are named on, so removing someone from
their last course revokes it with no cleanup step.

---

## How the three audiences differ

| | Signed-in learner | Author / admin | Guest on a link |
|---|---|---|---|
| Enters via | Keycloak | Keycloak | `/a/<token>` |
| Sees | published content assigned to them on the platform | drafts of courses they own or are named on | only what was assigned to their email by link |
| Sidebar | Home, Profile, Learning, Quizzes, Contact | + authoring / admin items | learner items only |
| API | JWT endpoints | JWT + `/manage` endpoints | `/public/assignments/:token/...` |
| Progress stored against | their User row | — | the User row for that email |

A guest's progress lands on a normal `User` row keyed by email, so if they later
sign in through Keycloak with the same address they inherit their history.

---

## Before you change anything

Most rules here live inside one function and are commented there. These span
several files, and **every one of them fails silently** — no error, no failing
test, just behaviour that is quietly wrong. Check the list before a change in
the area it names.

1. **New fields and the snapshot.** Learners read `CoursePublication`, never the
   live rows. `PublicationService.buildSnapshot` picks **Course, Module and
   Section** fields by name, so a new field there never reaches learners until
   it is added to that list. **Elements and quizzes** are copied whole, so a new
   field there reaches learners automatically — including one they must not see.
   Strip those in `redactCourse` (`curriculum-service.ts`) or `redactAnswers`
   (`quiz-service.ts`).
2. **A new canvas item property needs adding on the server too.** `cleanItem` in
   `config/canvas.ts` rebuilds every item field by field from an allow-list, so
   a property added only in `canvas-model.ts` / `canvas-editor.tsx` is dropped
   on the next save. Pictures are never sent with a save: they enter the pool
   only through the upload route and are merged back in by `mergeCanvasLayout`.
3. **A new rich-text toolbar feature needs the sanitiser widened.** Tags,
   attributes and inline styles not allowed by `config/rich-text.ts` are
   stripped on write. It looks right in the editor and is gone after a reload.
4. **Route guards: order and kind both matter.** Decorators apply bottom-up, so
   the `@use` written lowest runs first — `authenticateAndAttachUser` always goes
   at the bottom. A content edit should be guarded by `requireCourseEditor`,
   which also marks the draft as changed so the editor shows "unpublished
   changes". Routes guarded only by `requireAuthor` (the recycle-bin restores)
   must call `CurriculumGateway.touchDraft` themselves; routes that change
   nothing a learner reads pass `marksDraftEdited: false`.
5. **Anything that moves modules or sections must renumber.** Do it in a
   transaction and finish with `CurriculumService.renumberCourse`. The unique
   index on `(courseId, number)` counts soft-deleted rows, which is why rows are
   parked on throwaway values first — see `renumberCourse` and `parkModuleOrder`.
6. **The course map owns some content.** Directed-learning layer quizzes, and the
   modules and sections they live in, are generated by `CourseMapService`. Code
   that edits modules, sections or quizzes has to refuse those (see
   `layerModuleIds` and `assertNotDirected`), and any change to the map's shape
   must end with the quizzes being regenerated.
7. **Visibility comes from assignments, not from publishing.** Publishing makes a
   course *eligible*; a signed-in learner sees it only once it is assigned to
   them as `PLATFORM` (`EnrolmentService`). A `LINK` assignment never turns into
   an enrolment. Deadlines are per assignment and the lock is computed on the
   server (`withLearnerDueDate`) — never decide in the browser whether something
   is past due.
8. **Progress rules exist twice on the client.** `course-player.tsx` repeats the
   unlocking logic in `services/course-progress.ts` (`idOf` / `shutLayers`). The
   player and the dashboard disagree if only one is changed.
9. **A new learner feature goes through `learner-api.ts`,** in both the
   signed-in and the token implementation, or it works for one audience only.
10. **A new route is not live until its controller is imported in `index.ts`,**
   and should be added to [the API reference](./api-reference.md) by hand.
11. **The tour finds things by `data-tour`.** Renaming or removing one of those
   attributes on the sidebar, Home, Learning, Profile, the course page or the
   player makes that step fall back to a centred card. Adding or removing a step
   in `tour-steps.ts` means changing `TOUR_STEP_COUNT` in `config/validation.ts`
   as well, or the server refuses to save the last steps.

---

## Conventions worth knowing

**Files and folders are kebab-case, imports are absolute.** `curriculum-service.ts`,
`course-player.tsx`, imported as `@/services/curriculum-service/curriculum-service`.
Both are TTG Technology Standards requirements (§1.5, §1.10). The backend resolves
the alias through `tsconfig-paths` in development and `tsc-alias` at build time.

**Every file opens with a header block** naming the file, its purpose, its author
and the date (§1.6).


**Roles come from Keycloak, client *or* realm.** `admin` and `contributor` are
accepted from either mapping — `authMiddleware` unions them, and the frontend
mirrors that rule so the UI never offers something the API will refuse. In this
realm `admin` is a **realm** role.

**A role says you may author; the course says whose it is.** `Course.createdById`
is stamped at creation and `contributors` is how it is shared, so a lesson or
quiz set is reachable by the person who made it and by whoever they named — and
by nobody else, whatever role they hold. `CurriculumGateway.accessibleCourses` is
the single expression of that rule; every listing and `requireCourseEditor` go
through it. Its one concession is `includeUnowned`: courses created before this
column existed carry a null `createdById`, and those stay with the global authors
rather than with nobody.

**Quiz answers are stripped server-side.** `redactAnswers()` removes `isCorrect`
before a quiz reaches a learner. Correct answers come back only after submission,
and only if the author enabled "show answers".

**Author HTML is sanitised on write**, not on render — `config/richText.ts`. The
learner view uses `dangerouslySetInnerHTML`, which is only safe because of that.

**Media is base64 in Postgres** (cover photos, section images, PDFs) and travels
inline in the course JSON. Convenient, but the payload grows quickly; a dedicated
media endpoint is the obvious next refactor.

**Migrations run on container start.** The backend image runs
`prisma migrate deploy` before the server, so a deployment applies whatever
migrations are committed. `migrate deploy` never generates one — a schema change
without its migration folder simply does not reach the database.

### Known gaps

Kept short here; the full list with reasoning lives in
[security-follow-ups.md](./security-follow-ups.md).
- The public-route rate limiter resolves the caller through `config/clientAddress.ts`,
  which needs `TRUST_PROXY` set in the deployment environment to the number of proxy
  hops (Cloudflare -> ingress). If it is unset in production every visitor shares one
  bucket; the app warns about this at startup. It is still per-process, so it also
  needs shared storage before running more than one replica.
- Deleting a section or quiz removes it from learners only at the next publish —
  the version they are reading still contains it. This is the publishing model
  working as intended, but it surprises people.
- The route table in [api-reference.md](./api-reference.md) is maintained by
  hand and has fallen behind the code (124 rows documented; 129 routes declared).
