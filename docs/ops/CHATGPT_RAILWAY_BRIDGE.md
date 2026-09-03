# ChatGPT → GitHub → Railway staging bridge

## Persistent operator fact

Komerce has a tested, bounded operator bridge from ChatGPT through the connected GitHub repository into Railway staging.

Chain:

`ChatGPT → GitHub issue/workflow → GitHub Actions → Railway GraphQL API / Railway PostgreSQL`

Canonical workflow: `.github/workflows/staging-discovery-ops.yml`.

Authorized owner-issued commands currently include:

- `[staging-op] railway-check` — authenticate the scoped Railway project token only.
- `[staging-op] discovery-check` — read/check the staging Discovery data through `RAILWAY_DATABASE_URL`.
- `[staging-op] discovery-seed` — seed the base staging Discovery dataset, verify it, then synchronize the bounded runtime variables through Railway GraphQL.
- `[staging-op] discovery-modal-v2-seed` — seed the contextual request/callback examples used to visualize the unified Discovery modal, verify them, and synchronize the Discovery candidate list.

The bridge is intentionally bounded. It is not a general remote shell and must not dump Railway secrets or arbitrary environment variables.

The bridge was revalidated from ChatGPT on 2026-09-03 via issue #1107: `railway-check` completed successfully with `Railway access: ok`.

## Session continuity

When a future ChatGPT session needs to inspect or operate Komerce staging, do not conclude that Railway is inaccessible merely because there is no native Railway connector. First inspect this document and `.github/workflows/staging-discovery-ops.yml`; use the authorized GitHub issue commands when they cover the requested operation.
