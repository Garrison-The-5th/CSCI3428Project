# Testing

How to run each suite, what each one covers, and what the gate is before a merge.

Satisfies TTG Technology Standards §1.1.3, §5.1 (core testing strategy), §5.2
(frontend suite), §5.3.1 (backend suite) and §5.5 (database testing).

---

## The pyramid

```
Unit → Integration → E2E → Security → Performance
```

| Layer                   | Tool                                                | Where                                      | Count          | Needs a database?                                 |
| ----------------------- | --------------------------------------------------- | ------------------------------------------ | -------------- | ------------------------------------------------- |
| Backend unit            | Jest + ts-jest                                      | `backend/tests/unit/`                      | 796            | No — a unit test that touches Prisma fails loudly |
| Backend integration     | Jest + Supertest                                    | `backend/tests/integration/`               | 115            | Yes                                               |
| Database                | Jest + Prisma                                       | `backend/tests/integration/schema.test.ts` | included above | Yes                                               |
| Frontend unit/component | Jest + React Testing Library                        | `frontend/tests/`                          | 304            | No                                                |
| E2E                     | Playwright                                          | `frontend/e2e/`                            | 17             | Yes, plus both servers                            |
| Security                | CodeQL + `npm audit`                                | CI only                                    | —              | No                                                |
| Performance             | not implemented (§5.4 recommends, does not require) | —                                          | —              | —                                                 |

---

## Running them

### Everything, quickest first

```bash
# Backend — unit only, no database needed
npm run test:unit --prefix backend

# Backend — everything, integration included
docker compose up -d postgres
export DATABASE_URL="postgresql://<user>:<pass>@localhost:5433/learning_test?schema=public"
npm run db:setup --prefix backend
npm test --prefix backend

# Frontend
npm test --prefix frontend

# End to end (starts both servers itself)
npm run test:e2e --prefix frontend
```

### Coverage

```bash
npm run test:coverage --prefix backend
npm run test:coverage --prefix frontend
```

### Watch mode, while working

```bash
npm run test:watch --prefix backend
npm run test:watch --prefix frontend
npm run test:e2e:ui --prefix frontend   # Playwright's interactive runner
```

---

## Use a separate test database

**Integration tests truncate every table between files.** Point `DATABASE_URL`
at a dedicated database — never at the one your dev instance uses.

```bash
docker exec dev-postgres psql -U <user> -d postgres -c "CREATE DATABASE learning_test"
```

Without `DATABASE_URL` the integration suite **skips** rather than fails, and
prints why. That keeps `npm test` useful on a machine with no Docker running,
while CI always sets the variable so the suite is never silently skipped there.

---

## What each layer is for

**Unit.** Business rules in isolation, with every gateway mocked (§5.1.1). The
setup file replaces the Prisma client with a proxy that throws on any access, so
a test that reaches for the database fails with a message telling you to move it
to `tests/integration` rather than quietly opening a connection pool.

**Integration.** The real Express stack through Supertest, and the real database
through Prisma. These check that middleware is _wired in_ and in the right
order — the failure mode unit tests cannot see. Also the §5.5 database tests:
migration state and ordering, schema and uniqueness validation, and foreign-key
and cascade integrity.

One integration test is unlike the rest: `two-layer-migration.test.ts` rebuilds
the *old* three-layer schema in a schema of its own (by replaying every earlier
migration there), inserts a fixture, and runs the real
`20261113120000_two_layer_model` SQL against it — so the data migration is
tested as the SQL that `migrate deploy` will run, and is checked against the
legacy snapshot reader. It leaves `public` alone and drops its schema afterwards.

**E2E.** Real user flows in a real browser against the production build, not the
dev server. Covers the four areas §5.1.1 names: authentication flows, critical
workflows, data submission paths and failure states.

The signed-in journeys are written but **skipped** unless `E2E_TEST_USER` and
`E2E_TEST_PASSWORD` are set, because they need a Keycloak realm with a known
test account. They are skipped rather than omitted so the gap shows in the run
report.

---

## The merge gate

`.github/workflows/pr-checks.yml` runs on every pull request and on every push
to `main` or `dev`. Nothing merges without all of it passing:

| Job                | What fails it                                             |
| ------------------ | --------------------------------------------------------- |
| Lint and format    | Any ESLint error **or warning**; any Prettier difference  |
| Type check         | Any type error in backend src, scripts, tests or frontend |
| Backend tests      | Any failing test, or coverage below threshold             |
| Frontend tests     | Any failing test, or coverage below threshold             |
| Build verification | A failed build, or a missing artifact                     |
| E2E                | Any failing flow (runs after the cheap jobs pass)         |

`.github/workflows/security.yml` adds CodeQL, `npm audit` at high severity, and
SBOM generation, on the same triggers plus weekly.

---

## Coverage thresholds

Set in `backend/jest.config.ts` and `frontend/jest.config.ts`.

§5.1.1 sets ≥80% on core logic as the target. Five backend areas are there and
are pinned so they cannot regress: `config/`, `enrolment-service`,
`insights-service`, `publication-service` and `notification-service`.

The aggregate floors are deliberately set just under what the suite currently
achieves, so they act as a **ratchet** — coverage can only go up, and each
service is pinned at 80% as it arrives there. Setting them to 80% today would
fail every build, which teaches people to bypass the gate rather than to write
tests. The services still short are listed in
[security-follow-ups.md](./security-follow-ups.md#6-test-coverage-is-below-the-511-target).

**Raising a threshold is part of the work.** If you take a service past its
floor, move the floor.

---

## Writing a new test

- **Name the behaviour, not the function.** `it('refuses a quiz that is not
assigned to them')` reads as a specification; `it('tests submitAttempt')` does
  not.
- **Comment the ones whose reason is not obvious.** Several tests here exist
  because of a specific bug or a specific standards clause. Say which — the next
  person needs to know whether an assertion can be relaxed.
- **A unit test must not touch the database.** If it needs one, it is an
  integration test.
- **Mock at the gateway boundary**, not deeper. Mocking Prisma itself mostly
  tests Prisma.

## The legacy smoke scripts

`backend/scripts/*.ts` predate this suite and still run via
`npm run test:smoke`. They exercise real end-to-end scenarios against a live
database. They do assert — each counts its failures and exits non-zero — and
`npm run check --prefix backend` runs them after the Jest suites, so they gate
that command even though CI does not run them.

**Point them at a throwaway database.** They have no equivalent of
`setup-test-db.ts`'s guard: they use `DATABASE_URL` as they find it, and they
create and delete rows in whatever that names. They tidy up after themselves, so
this is less drastic than the integration suite's truncation, but a crashed run
leaves its fixtures behind and the next run then fails on them.

```bash
docker compose exec postgres createdb -U <user> learning_test
DATABASE_URL="postgresql://…/learning_test" npm run test:smoke --prefix backend
```

`scripts/verify-two-layer.ts` is not part of that run. It is a one-off,
read-only check of a database after the two-layer migration — numbering, quiz
sections, published versions and the default tutorial — and is safe to point at
production:

```bash
DATABASE_URL="postgresql://…" npx ts-node -r tsconfig-paths/register scripts/verify-two-layer.ts
```

They are kept because they still catch things — three of them were red for a
while, each because the behaviour they described had deliberately changed under
them, and `previewcheck.ts` exists because the authoring preview and the real
learner path can disagree in ways neither one looks wrong on its own. They are
not a substitute for the Jest suites. Converting each into
real integration tests is worthwhile, and would retire the script directory.
