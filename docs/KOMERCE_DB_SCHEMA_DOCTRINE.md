# Komerce DB Schema Doctrine

Version: 2026-07

This document is mandatory for any agent or developer changing the database schema, migrations, or code that depends on database structure.

## Principle

The database schema is a living contract.

A DB change is incomplete until the migration, canonical schema documentation, architecture headers, and generated graph agree.

## Source Of Truth

Operational order:

1. production DB live schema
2. `docs/SCHEMA.md`
3. applied migrations / startup migrations
4. application code
5. historical SQL files

`docs/SCHEMA.md` must describe either:

- the verified live schema, when it comes from a DB extract/check ;
- the intended schema, when updated in the same PR as a migration that has not yet been applied to production.

If `docs/SCHEMA.md` is updated from an intended migration rather than a live extract, the change must say so explicitly in the PR/STATUS note. Do not present intended schema as verified live schema.

### Canonical dump location (since June 2026)

The single canonical SQL dump is `docs/db/railway-live-schema.sql`.

`db/schema.sql` has been deleted from the repo. Any reference to it in code, scripts, or documentation is stale and must be corrected.

The dump is never generated manually. It is produced exclusively by `node scripts/db-snapshot.js` via the automated pipeline described below.

## Two Allowed Update Modes

### Mode A — Verified live schema

Use when the schema has been extracted or checked against the real DB.

Allowed sources:

- `pg_dump --schema-only`
- direct verification queries against Railway/Postgres
- explicit production migration verification

In this mode, `docs/SCHEMA.md` may say the object exists in live DB.

### Mode B — Intended migration schema

Use when an agent adds or changes a migration before production has been verified.

Allowed only if the same change includes:

- the migration or startup migration path
- `docs/SCHEMA.md` updated as intended schema
- `docs/chantier/STATUS.md` or PR notes stating that live verification remains pending
- impacted architecture headers updated
- graph regenerated if headers changed

In this mode, the agent must not claim the schema is verified live until an extract/check confirms it.

A migration added **after the commit that produced the current live dump** is, by construction, post-snapshot. The PR freshness gate must not require that migration to already exist in the live dump: `ci-migrate.js` applies it on the throwaway CI database. This is not an exemption from verification; it is the transition window explicitly allowed by Mode B.

After deployment, `db-snapshot.js` must refresh the live dump and `check-schema-freshness.js --all` must then prove that every current migration is reflected in Railway. A migration must never remain indefinitely in Mode B.

## Must Read Before DB Change

Read in this order:

1. `AGENTS.md`
2. `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`
3. `docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`
4. `docs/SCHEMA.md`
5. `docs/KOMERCE_ARCH_HEADER_GRAPH.md`
6. `docs/komerce-arch-header-graph.json`
7. the headers of every file that reads or writes the impacted tables
8. the migration runner used by the change

## Mandatory Rules

### New table, column, enum, index, trigger, function, or constraint

The same change must include:

- an idempotent migration or explicit startup migration path
- update to `docs/SCHEMA.md`
- update to every impacted `@db-read`, `@db-write`, and `@db-txn` header
- regenerated architecture graph if headers changed
- impact note in `docs/chantier/STATUS.md` if deployment/order matters
- live verification status: verified now, or pending verification after deploy

### Changed table contract

If a column type, nullability, enum value, constraint, trigger, or FK behavior changes:

- identify every reader/writer from the graph and code search
- update affected services/routes before relying on the new contract
- update `@inputs`, `@outputs`, `@db-read`, `@db-write`, `@db-txn`, `@doctrine`, and `@impact-areas` when relevant
- document migration/backfill order if existing production data is affected
- state whether `docs/SCHEMA.md` reflects verified live schema or intended migration schema

### Deleted or renamed DB object

A deletion or rename is forbidden unless the same change proves:

- no remaining code references the object
- no header references the object
- `docs/SCHEMA.md` removes or renames it
- the graph no longer exposes a stale DB edge
- a compatibility/backfill plan exists if production data is involved
- live verification status is explicit

### DB access from code

When code starts reading or writing a table:

- update the file header immediately
- use explicit table names in `@db-read` and `@db-write`
- set `@db-txn` to the real transaction/idempotency requirement
- do not leave `@unknown` if the table is visible in the code being changed

## Required Verification

After DB-impacting changes:

```bash
node scripts/generate-komerce-arch-graph.js
```

Then verify:

- `docs/SCHEMA.md` describes the new live or intended schema and states which mode applies
- impacted headers list the correct DB tables
- graph DB table edges include the new or changed table usage
- `files without headers: 0`
- `lite headers without owner: 0`
- no stale DB object remains in headers or docs

## Deployment Rule

If production DB must be changed separately from code deployment, document the exact order:

1. migration/backfill
2. code deploy
3. verification query
4. rollback or compensation path

Do not bury deployment order in chat or prompt text. Put it in the active repo documentation.

## Delivery Gate

A PR or agent patch that changes the DB schema but does not update `docs/SCHEMA.md`, impacted architecture headers, and the generated graph is incomplete.

A PR or agent patch that updates `docs/SCHEMA.md` without saying whether the change is verified live or intended migration schema is incomplete.

---

## Automated Dump Pipeline (since June 2026)

The Railway dump is never generated by hand. The full pipeline runs via GitHub Actions.

### `check-schema-freshness.js` — two verification contexts

The same checker has two deliberately different contexts:

1. **PR / default mode** — it calculates the git baseline from the last commit that touched `docs/db/railway-live-schema.sql`. Every migration that already existed at that commit must be present in the dump. Migrations added later are reported as `intended_migration_schema`; `ci-migrate.js` must apply them on the throwaway Postgres database.
2. **Fresh snapshot / `--all` mode** — after `db-snapshot.js`, every current migration must be reflected in the newly extracted dump. Any missing column blocks the refresh.

If git cannot resolve the dump baseline, the default checker fails safe by requiring all current migrations. There is no silent bypass.

### schema-refresh.yml — triggered on push to `migrations/` or `workflow_dispatch`

1. `node scripts/db-snapshot.js` — connects to Railway via the `RAILWAY_DATABASE_URL` GitHub secret, runs `pg_dump --schema-only`, strips PG18 artefacts (`\restrict`, `transaction_timeout`), writes atomically to `docs/db/railway-live-schema.sql`.
2. `node scripts/check-schema-freshness.js --all` — verifies that all columns declared in the current `migrations/*.sql` are present in the freshly extracted dump. Blocks if the dump is partial, if the wrong database was queried, or if a migration has not reached Railway.
3. Automatic PR `chore/schema-refresh-auto` created if the dump changed — merge without delay.

### ci.yml — job `integration` — triggered on push to `main`/`master` or pull request

```bash
node scripts/check-schema-freshness.js                    # baseline live + Mode B post-snapshot
psql "$DATABASE_URL" -f docs/db/railway-live-schema.sql   # load full live baseline into throwaway Postgres
node scripts/ci-migrate.js                                 # apply migrations added after last snapshot
```

`ci-migrate.js` uses `git log/ls-tree` to determine which migrations were already included in the dump at its last commit and replays only the new ones. It never re-applies a migration already in the dump.

### What must never be done again

```bash
# ❌ DELETED — do not use
pg_dump "$DATABASE_URL_PROD" > db/schema.sql
scripts/refresh-schema.sh
```

### Manual trigger (emergency only)

```bash
# From GitHub Actions → schema-refresh.yml → Run workflow
# or locally if a publicly reachable Railway database URL is available:
npm run db:snapshot
node scripts/check-schema-freshness.js --all
```

A GitHub-hosted runner cannot resolve `*.railway.internal`. `RAILWAY_DATABASE_URL` used by `schema-refresh.yml` must therefore be a publicly reachable Railway TCP/Postgres URL (stored as a secret, never printed). An internal Railway service URL is valid for the application runtime but not for GitHub Actions.
