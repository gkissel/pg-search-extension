# pg-search-extension

A small TypeScript project that uses Prisma + PostgreSQL (via ParadeDB) to power a paginated search extension.

## 🚀 Quick start

### 1) Install dependencies

The project uses **pnpm**. If you don’t have it installed:

```bash
npm install -g pnpm
```

Then install:

```bash
pnpm install
```

### 2) Start the database

This project ships with a `docker-compose.yaml` that starts a local ParadeDB (Postgres-compatible) instance.

```bash
pnpm db:up
```

To stop and remove the container + volume:

```bash
pnpm db:down
```

### 3) Configure your database connection (optional)

By default, the app points at:

```
postgresql://postgres:docker@localhost:5432/app
```

If you need to override it, set the `DATABASE_URL` environment variable (e.g. via a `.env` file):

```env
DATABASE_URL="postgresql://postgres:docker@localhost:5432/app"
```

### 4) Generate Prisma client + push schema

Generate the Prisma client and ensure the database schema is up to date:

```bash
pnpm prisma:generate
pnpm db:push
```

### 5) Run tests

The project uses Vitest for test execution:

```bash
pnpm test
```

For watch mode:

```bash
pnpm test:watch
```

### 6) Lint (optional)

```bash
pnpm lint
```

---

## 🧩 What’s inside

- `src/` — application logic (including a paginated search extension)
- `prisma/` — Prisma schema and migrations
- `docker-compose.yaml` — local database setup
- `test/` — end-to-end tests

---

## Troubleshooting

- If you see connection errors, confirm the database is running (`pnpm db:up`) and that `DATABASE_URL` matches the container settings.
- If you change the Prisma schema, rerun `pnpm prisma:generate` and `pnpm db:push`.
