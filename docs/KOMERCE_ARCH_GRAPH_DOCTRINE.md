# Komerce Architecture Graph Doctrine

Version: 2026-06

This document is mandatory for any agent or developer changing functional behavior.

## Principle

The `@komerce-arch` headers and the generated graph are not optional documentation.
They are the intervention contract of the codebase.

A functional change is incomplete until the impacted headers and generated graph are updated.

## Must Read Before Functional Change

Read in this order:

1. `AGENTS.md`
2. `docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`
3. `docs/KOMERCE_ARCH_HEADER_GRAPH.md`
4. `docs/komerce-arch-header-graph.json`
5. the `@komerce-arch` or `@komerce-arch-lite` headers of every touched file
6. `interventionIndex["<file>"]` for every touched file

## Mandatory Rules

### New file

Every new source file must start with one of:

- `@komerce-arch` when it has autonomous responsibility
- `@komerce-arch-lite` when it is owned by another mapped file

No silent source file is allowed.

### Modified file

If a functional contract changes, update the header fields that changed:

- `@inputs`
- `@outputs`
- `@depends`
- `@used-by`
- `@db-read`
- `@db-write`
- `@db-txn`
- `@doctrine`
- `@impact-areas`

If a DB read/write changes, the DB fields must be updated in the same change.

### Deleted or merged file

When deleting or merging a file:

- remove dead `@depends` references
- remove dead `@used-by` references
- transfer or remove `@owner` links
- verify the generated graph has no dead edge for the deleted responsibility

### Unknown fields

Do not invent precision.

If a field cannot be safely resolved, keep it explicit:

- `@unknown`
- `resolve_before_behavior_change`

Before changing behavior in a file, resolve any `@unknown` directly related to the behavior being changed.

## Required Verification

After header-impacting changes, run:

```bash
node scripts/generate-komerce-arch-graph.js
```

Then verify:

- `files without headers: 0`
- `lite headers without owner: 0`
- new code edges are intentional
- new DB table edges are intentional
- no deleted file remains as a graph dependency

## Boutique Rule

Any change under `public/boutique/**` must also follow this doctrine.

Boutique files are not exempt because they are frontend files. A new JS module, CSS owner, renderer, controller, state helper, or API client must be mapped or owned.

## Delivery Gate

A PR or agent patch that changes functional behavior but does not update the relevant architecture headers and graph is incomplete.

This rule applies to additions, modifications, deletions, refactors, moves, and feature removals.