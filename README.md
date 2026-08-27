# Learning Platform

## Overview
An internal learning and compliance training platform. Admins author courses, assign them to people, and see who has finished what. Learners work through content and take quizzes. Anyone outside the organisation — contractors, new starters, partners — can be sent a private link and complete their training **without an account**.

Built on the TTG full-stack boilerplate: React frontend, Node.js/Express backend (both written in TypeScript), PostgreSQL via Prisma, and Keycloak for authentication, with Docker for local development.

### Three audiences, one application

| Audience | How they get in | What they see |
|---|---|---|
| Learner | Keycloak login | Their dashboard, and the courses and quizzes assigned to them |
| Author / admin | Keycloak login | Everything above, plus authoring and admin tools |
| Guest | A tokenized link sent to their email | Only what was assigned to that address |

### Content model

A **Course** holds **Modules**; a Module holds **Sections**; a Section holds **Elements** (rich text, YouTube video, image, PDF) and **Quizzes**. Module and section numbers are derived from position — section `2.3` is the third section of the second module — so reordering renumbers the course and there is no free-text number to keep in step. Elements and quizzes share one ordering sequence, so a quiz can sit between two pieces of content rather than always at the end.

Quizzes come in three kinds, and the kind decides where one may live and what it may do. A **learning check** sits inside a section, is never timed, never keeps a mark, and must be attempted before the learner may move on. An **exam** is the ordinary graded quiz — standalone or inside a section, optionally timed, reported to the dashboard. A **one-time quiz** is sent as a link, may be answered once, and then disappears from the learner's side entirely; what they answered is kept under their name on the admin dashboard. Every question is multiple choice or multiple answer, and each quiz chooses whether the learner is shown their result at all.

### Versioned publishing

Learners never read the rows an author is editing. They read a **snapshot** taken when someone pressed *Publish*, which is what lets an edit to existing content be held back exactly like a brand new section. Publishing again releases everything at once and archives the version it replaced for 14 days. Content added since a learner started a course is marked **New** until they read it.

See [Code Structure](docs/code_structure.md) for the full domain model and file tree.

## End-to-end ports

- Frontend: 5173
- Keycloak: 4000
- Backend: 5002
- PostgreSQL: 5433 on the host (5432 inside the container), set by `DB_PORT`

## Prerequisites
### Download and install:
1) Docker Desktop
2) Node.js
3) PostgreSQL

## Table of Contents

- [Quick Setup](#quick-setup)
- [Running the tests](#running-the-tests)
- [Contributing](#contributing)
- [Available Scripts](#available-scripts)
- [Documentation](#documentation)

## Documentation

| Document | What it covers |
|---|---|
| [Code Structure](docs/code_structure.md) | Domain model and file tree |
| [API Reference](docs/api-reference.md) | All 96 routes, access levels and error codes |
| [Testing](docs/testing.md) | Every suite, how to run it, and the merge gate |
| [UX Design](docs/ux-design.md) | Navigation paths per audience, per-page rationale |
| [Security Follow-Ups](docs/security-follow-ups.md) | Known gaps against the standards, and why |
| [Keycloak setup](docs/keycloak.md) | Connecting the app to Keycloak locally |
| [Outbound email](docs/email.md) | SMTP app-password setup, and reading the boot log |
| [Google OAuth](docs/google_oauth.md) | Google sign-in through Keycloak |
| [Role-Based Access Control](docs/CMS.md) | Roles and what each can do |

## Development environment

Windows 10+ or Ubuntu 22.04+ are the supported platforms (TTG Technology
Standards §1.1); Node 24+ and Docker Desktop are required. macOS works and is
in active use, but is a documented deviation rather than a supported target —
if you hit a platform-specific problem, that is why.

## Quick Setup

### [Video of setup instruction](https://drive.google.com/file/d/1EwjmyhzLv-e0AJSXpj9S3ApIh3b_5lcF/view?usp=sharing) (requires TTG account)

### 1) Setup environment variables

Copy each example file and fill in your values. None of these are committed —
`.env` files are gitignored and excluded from every Docker build context.

| Copy from | To | Needed for |
|---|---|---|
| `example.env.docker.dev` | `.env` | Database credentials, used by docker compose |
| `backend/example.env.backend.dev` | `backend/.env` | Running the backend outside Docker |
| `frontend/example.env.frontend.dev` | `frontend/.env` | Frontend feature flags |

**`DB_NAME` in the root `.env` and the database named in `backend/.env`'s
`DATABASE_URL` must match.** They are easy to let drift apart, and the symptom
is a backend that starts cleanly against an empty database.

### 2) [Keycloak setup](docs/keycloak.md)

### 3) Run app
#### Option 1: Everything in Docker (recommended)

```bash
docker compose up -d
```

That is the whole thing — PostgreSQL, Keycloak, backend and frontend
(§1.13). **Migrations are applied automatically** when the backend container
starts, so there is no manual database step.

```bash
# (Optional) Load sample users
docker compose exec backend npm run db:seed

# Rebuild after changing a Dockerfile or dependencies
docker compose up -d --build
```

Access the app at `http://localhost:5173`.

On a first run, configure the Keycloak realm ([docs/keycloak.md](docs/keycloak.md)),
put the realm public key in `PUBLICKEY` in a root `.env`, and
`docker compose up -d backend` — compose substitutes `.env` when it creates a
container, not when it restarts one.

#### Option 2: App locally, PostgreSQL in Docker

```bash
# Install dependencies for the root and both workspaces
npm install && npm install --prefix frontend && npm install --prefix backend

# Start PostgreSQL in Docker and apply migrations
npm run setup

# (Optional) After changing prisma/schema.prisma
npm run db:migrate

# Start both dev servers
npm run dev
```

Access the app at `http://localhost:5173`.

> **A note on `docker-compose-dev.yml`.** It predates the consolidation and is
> kept only so existing local stacks keep working. `docker-compose.yml` is now
> the full stack and the one the documentation refers to; prefer it for anything
> new. The two use different container names and bind the same ports, so run one
> or the other — never both.

## Available Scripts

## Running the tests

From the repo root — these delegate into both workspaces:

```bash
npm test              # 392 tests: backend unit + integration, frontend
npm run test:unit     # unit only, no database needed
npm run test:e2e      # 16 Playwright flows
npm run test:coverage # with coverage, enforcing the thresholds
npm run check         # everything the PR pipeline runs, in the same order
```

Or target one workspace directly with `--prefix backend` / `--prefix frontend`.

Integration tests need `DATABASE_URL` pointing at a **separate** test database —
they truncate every table between files. Without it they skip and say so. Full
detail in [docs/testing.md](docs/testing.md).

## Contributing

**Branches** (§1.9): `main` is the release branch and is always deployable;
`dev` is the integration branch; work happens on `feature/*` and `bugfix/*`
branches merged into `dev` by pull request.

**Commit messages** follow `type: subject`, where type is one of `feat`, `fix`,
`docs`, `refactor`, `test` or `chore` — for example
`fix: correct typo in function name`.

**Every pull request** runs lint, formatting, type checks, unit tests,
end-to-end tests and a build. All of them must pass; warnings fail the build
too. CodeQL, a dependency audit and SBOM generation run alongside.

**Conventions worth knowing before your first change:**

- Files and folders are `kebab-case`; imports are absolute (`@/services/...`).
- Every file opens with a header block naming file, purpose, author and date.
- Anything a learner reads comes from the published snapshot, never the live rows.
- Quiz answers are stripped server-side on every path that returns a quiz.

### Root scripts

Run these from the repository root; each delegates into the workspaces.

| Script | What it does |
|---|---|
| `npm run dev` | Start frontend and backend locally (needs PostgreSQL running) |
| `npm run setup` | Start PostgreSQL in Docker and apply migrations |
| `npm test` | Backend unit + integration, then frontend |
| `npm run test:unit` | Unit suites only — no database needed |
| `npm run test:e2e` | Playwright end-to-end flows |
| `npm run test:coverage` | Tests with coverage, enforcing the thresholds |
| `npm run typecheck` | Type-check both workspaces |
| `npm run build` | Build both workspaces |
| `npm run lint` / `npm run fix` | ESLint (warnings fail) / autofix |
| `npm run format` / `npm run format:check` | Prettier write / verify |
| `npm run check` | Everything the PR pipeline runs, in the same order |
| `npm run db:setup` / `db:seed` / `db:migrate` / `db:studio` | Database tasks |

### Development Scripts
- `npm run start-front` - Start only frontend locally
- `npm run start-back` - Start only backend locally

### Backend Scripts (run from /backend directory)
- `npm run dev` - Start backend in development mode with auto-reload
- `npm run db:setup` - Apply existing migrations and generate the Prisma client
- `npm test` - Run the unit and integration suites
- `npm run test:coverage` - Run with coverage and enforce the thresholds
- `npm run typecheck` - Type-check src, scripts and tests
- `npm run db:migrate` - Create a new database migration (see the caveat below)
- `npm run db:seed` - Load sample users
- `npm run db:studio` - Open Prisma Studio (database GUI)
- `npm run db:reset` - Reset database (delete all data)

### Creating new migrations

Edit `backend/prisma/schema.prisma`, then run `npm run db:migrate` from `/backend`. Prisma
generates the SQL, applies it, and regenerates the client. Commit the new folder under
`backend/prisma/migrations/` along with the schema change.

#### A note on 20260727195114_add_quiz_question_option

That migration is deliberately empty. It was written against the original
Module → Lesson → Element schema, and was applied before
`20260727190000_courses_and_progress` existed. That later migration was given an earlier
timestamp, so it now sorts ahead and drops every table the older one touched.

Replaying the history therefore failed with `relation "Lesson" does not exist`, which
broke `prisma migrate dev` and `prisma migrate reset` (both replay into a shadow database)
and meant a fresh database could not be built from migrations at all. Emptying it is safe
because `20260727190000` supersedes all of it — see the comments in the file.

Databases created before this fix carry the old checksum for that migration. If Prisma
reports it as modified, realign it once:

```sql
UPDATE "_prisma_migrations"
SET checksum = '2e0ed872ef36b87ff66cd6aa6e22024b7e6925c5b3fa83fbaa9207d5d773bf52'
WHERE migration_name = '20260727195114_add_quiz_question_option';
```
