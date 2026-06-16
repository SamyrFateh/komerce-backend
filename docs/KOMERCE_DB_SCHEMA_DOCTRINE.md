# Komerce DB Schema Doctrine

Version: 2026-06

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