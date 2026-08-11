# Code Structure

A learning platform built on the TTG full-stack boilerplate: React + Vite frontend,
Express + Prisma backend, PostgreSQL, Keycloak for authentication.

## Contents

- [The domain in one page](#the-domain-in-one-page)
- [Project root](#project-root)
- [Backend](#backend)
- [Frontend](#frontend)
- [How the three audiences differ](#how-the-three-audiences-differ)
- [Conventions worth knowing](#conventions-worth-knowing)

Companion documents: [API Reference](./api-reference.md) (every route),
[UX Design](./ux-design.md) (navigation paths and per-page rationale),
[Testing](./testing.md) (how to run each suite),
[Security Follow-Ups](./security-follow-ups.md) (known gaps and why).

---

## The domain in one page

```
Course ─┬─ Section ─── Module ─┬─ Element   (TEXT | YOUTUBE | IMAGE | PDF)
        │                      └─ Quiz ──── Question ──── Option
        ├─ CoursePublication  (a frozen snapshot per published version)
        ├─ Instructor         (many-to-many, credited on the course page)
        ├─ Assignment         (PLATFORM enrolment or a tokenized LINK)
        └─ contributors       (Users allowed to edit this one course)
```

17 Prisma models in total. Beyond the tree above: `ModuleProgress` and
`ElementProgress` (what a learner has opened), `QuizAttempt` and `QuizSession`
(results and the server-anchored clock on a timed quiz), `CourseCompletion`
(stamped at 100%), `Note`, and `User`.

- A **Course** is what the UI calls a "lesson". Created by name, then edited.
- A **Section** is a named group of modules and supplies the first digit of every
  module number inside it. Authors may tint one from a closed eight-colour palette.
- A **Module** lives inside a section. Its number (`2.3`) means "third module of the
  second section" — position in the grid is the only source of truth, and there is no
  free-text number field. `sortKey` is the zero-padded form so `1.10` sorts after `1.2`.
  Every write that can disturb the grid ends by calling `CurriculumService.renumberCourse`.
- **Elements and quizzes share one ordering sequence** inside a module, so a quiz
  can sit between two pieces of content.
- Every **Quiz** belongs to exactly one module. A course's quizzes are its modules'
  quizzes.
- Progress: `ModuleProgress` (a module auto-completes on view), `ElementProgress`
  (finer grained, so a sequential course can unlock item by item), `QuizAttempt`,
  `QuizSession` (the deadline on a timed quiz, stored server-side), and
  `CourseCompletion` (stamped at 100%, used to detect new content later).

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
├── config/                    # Keycloak realm config, shared with the frontend
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
│   └── migrations/            # 11 migrations; not run automatically on deploy
│
└── src/
    ├── index.ts               # Express setup, controller imports, JSON error handler
    ├── AppRouter.ts           # single shared Router the decorators register onto
    │
    ├── config/
    │   ├── mediaUpload.ts     # uploads for course media; HEIC → JPEG, PDF passthrough
    │   └── richText.ts        # sanitises author HTML before it is stored
    │
    ├── controllers/           # HTTP layer, wired by decorators
    │   ├── decorators/        # @controller @get @post @put @del @use
    │   ├── authController/
    │   │   ├── authController.ts
    │   │   ├── authMiddleware.ts          # verifies the JWT, attaches req.user/req.auth
    │   │   └── authorizationMiddleware.ts # requireRole / requireAnyRole / requireAuthor
    │   ├── CurriculumController/          # courses, modules, elements, notes,
    │   │                                  #   instructors, contributors, progress
    │   ├── quizController/
    │   ├── assignmentController/          # author-facing link management
    │   ├── publicController/
    │   │   ├── publicAssignmentController.ts  # token-authenticated guest routes
    │   │   └── rateLimit.ts                   # in-memory throttle for those routes
    │   └── tableController/
    │
    ├── services/              # business logic; no HTTP knowledge
    │   ├── curriculumService/ # course/module/element rules, numbering, ordering
    │   ├── quizService/       # grading, answer redaction, question validation
    │   ├── dashboardService/  # progress figures, shared by learners and guests
    │   ├── assignmentService/ # tokens, guest sessions, scoping
    │   ├── authService/       # getOrCreateUser (keyed on email)
    │   ├── emailService/      # Gmail API broadcast (needs GOOGLE_GMAIL_API_CONFIG)
    │   └── tableService/
    │
    └── gateways/              # all Prisma access lives here
        ├── curriculumGateway/
        ├── quizGateway/
        ├── assignmentGateway/
        └── authGateway/
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

**Deleting is soft.** Courses, modules and quizzes set `deletedAt` and appear in the
Admin Dashboard recycle bin. Only the `/deleted/...` routes hard delete, and they
refuse anything not already in the bin.

**`req.params` is `string | string[]` in Express 5.** Every controller has a small
`param(req, name)` helper; use it rather than reading params directly.

---

## Frontend

```
frontend/src/
├── index.tsx                  # AuthProvider → GuestProvider → EditorAccessProvider → App
├── App.tsx                    # routing; also decides whether to show the app shell
│
├── contexts/
│   ├── AuthContext.tsx        # Keycloak session; isAdmin / isAuthor
│   ├── GuestContext.tsx       # assignment-link session (token in sessionStorage)
│   └── EditorAccessContext.tsx# which courses this person may edit
│
├── services/                  # everything that talks to the API
│   ├── curriculumApi.ts       # courses, modules, elements, notes, instructors
│   ├── quizApi.ts             # quizzes, questions, attempts
│   ├── assignmentApi.ts       # author link management + public guest endpoints
│   └── learnerApi.ts          # ⭐ one interface over the JWT and token APIs
│
├── hooks/
│   └── useAutoSave.ts         # debounced save; no save buttons in the editor
│
├── components/
│   ├── ProtectedRoute.tsx     # authenticated / admin / author / canEdit gates
│   ├── Common/
│   │   ├── ElementView.tsx    # ⭐ renders module content + plainPreview() helper
│   │   ├── ElementEditor.tsx  # one auto-saving content row with a live preview
│   │   ├── RichTextEditor.tsx # bold/italic/lists/tables toolbar
│   │   ├── QuizRunner.tsx     # taking a quiz, used everywhere quizzes appear
│   │   ├── AssignPanel.tsx    # issue and manage public links
│   │   ├── ConfirmDialog.tsx
│   │   ├── ToastNotification.tsx
│   │   └── Unauthorized.tsx
│   ├── Navbar/
│   └── ui/                    # shadcn-style primitives + ProgressDonut, ToggleSwitch
│
├── pages/
│   ├── private/
│   │   ├── home/Home.tsx              # dashboard: progress rings, due dates, new content
│   │   ├── learning/
│   │   │   ├── Learning.tsx           # course card grid
│   │   │   ├── CourseLanding.tsx      # course overview
│   │   │   └── CoursePlayer.tsx       # content left, module rail right
│   │   ├── quizzes/
│   │   │   ├── Quizzes.tsx            # course card grid
│   │   │   └── QuizPlayer.tsx         # quiz left, quiz rail right
│   │   ├── admin/
│   │   │   ├── AdminLearning.tsx      # lesson library (published / drafts) + instructors
│   │   │   ├── CourseEditor.tsx       # the editor, reached by clicking a card
│   │   │   ├── CourseEditorList.tsx   # contributors' cut-down lesson list
│   │   │   └── AdminQuizzes.tsx       # lesson cards → per-module quiz editing
│   │   ├── adminPage/AdminPage.tsx    # recycle bin
│   │   └── users/, profile/, contactUs/, table/
│   └── public/
│       ├── AssignmentEntry.tsx        # /a/:token — starts a guest session, redirects
│       ├── Login.tsx, About.tsx, publicPage/
│
└── utils/
    ├── HttpHelper.ts          # fetch wrapper; refreshes the Keycloak token
    ├── getNavbarData.tsx      # sidebar contents per audience
    ├── keycloak.ts
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
| Sees | all published content | drafts too | only what was assigned to their email |
| Sidebar | Home, Profile, Learning, Quizzes, Contact | + authoring / admin items | learner items only |
| API | JWT endpoints | JWT + `/manage` endpoints | `/public/assignments/:token/...` |
| Progress stored against | their User row | — | the User row for that email |

A guest's progress lands on a normal `User` row keyed by email, so if they later
sign in through Keycloak with the same address they inherit their history.

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

**Quiz answers are stripped server-side.** `redactAnswers()` removes `isCorrect`
before a quiz reaches a learner. Correct answers come back only after submission,
and only if the author enabled "show answers".

**Author HTML is sanitised on write**, not on render — `config/richText.ts`. The
learner view uses `dangerouslySetInnerHTML`, which is only safe because of that.

**Media is base64 in Postgres** (cover photos, module images, PDFs) and travels
inline in the course JSON. Convenient, but the payload grows quickly; a dedicated
media endpoint is the obvious next refactor.

**Migrations do not run on container start.** The backend Dockerfile only boots the
server, so `prisma migrate deploy` is a deliberate step in any deployment.

### Known gaps

Kept short here; the full list with reasoning lives in
[security-follow-ups.md](./security-follow-ups.md).
- Quiz *questions* are edited on Create a Quiz, not inside the lesson editor.
- The public-route rate limiter resolves the caller through `config/clientAddress.ts`,
  which needs `TRUST_PROXY` set in the deployment environment to the number of proxy
  hops (Cloudflare -> ingress). If it is unset in production every visitor shares one
  bucket; the app warns about this at startup. It is still per-process, so it also
  needs shared storage before running more than one replica.
- Drag-reordering modules renumbers them `1..n`, flattening any `2.1` / `2.2` nesting.
- Quizzes attached to a soft-deleted module remain visible to learners.
