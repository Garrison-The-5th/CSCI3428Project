# API

Requires Node.js `^20.19.0` or `>=22.12.0`.

To install dependencies (run from the repository root):

```bash
npm install
```

To configure the environment:

```bash
cp .env.example .env
```

To setup your database (creates the SQLite database, applies migrations and seeds the default data):

```bash
npm run setup-prisma
```

> Seeding resets the `User` and `Word` tables, so only run this on a fresh setup.

To run the API in development (restarts on file changes):

```bash
npm run dev
```

To run the API without file watching (applies pending migrations first):

```bash
npm start
```
