# Komerce Architecture Headers

`@komerce-arch` is a short, standardized, parseable metadata layer for Komerce files.

It does not replace product doctrine. It tells humans and AI where doctrine lives in code, what a file expects, what it produces, what it depends on, which database surfaces it touches, and what can break if it changes.

## Core Rule

Every source file must be represented in the architecture map.

A file can be represented in one of three ways:

1. Full node: the file has a complete `@komerce-arch` header.
2. Aggregated node: the file is explicitly attached to a parent/header owner.
3. Orphan/debt: the file is not yet understood and must be resolved before structural edits.

No structurally relevant file should remain silent.
If a file has no utility, it should be removed or merged. If it has utility, it should be mapped.

## Official Header

```js
/**
 * @komerce-arch
 * @role          shared-cart-state-machine
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        cart_id, current_status, payment_event, timer_event
 * @outputs       next_status, events_to_emit, notifications
 * @depends       bootstrap/crons.js, routes/shared-cart.js, services/order-payment-confirmation.js
 * @used-by       bootstrap/crons.js, routes/shared-cart.js
 * @db-read       shared_carts, shared_cart_contributions, orders
 * @db-write      shared_carts, shared_cart_events, orders
 * @db-txn        required_for_status_transition, idempotent_payment_events
 * @doctrine      paiement_seul_acte_engageant, panier_ouvert_ferme, fenetre_paiement_48h, choix_createur_72h
 * @impact-areas  checkout, participant-flow, creator-dashboard, notifications, economic-engine
 * @version       2026-06
 */
```

## Lightweight Aggregation Header

Use this for tiny files, pure constants, simple render helpers, narrow adapters, tests that only support a mapped owner, or files that should not become first-class architecture nodes.

```js
/**
 * @komerce-arch-lite
 * @role          product-card-render-helper
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       renders product card HTML for catalog surfaces
 * @impact-areas  product-grid, modal-entry
 * @version       2026-06
 */
```

Rules:

- Use `@komerce-arch` for structural nodes.
- Use `@komerce-arch-lite` for files whose impact is fully owned by another node.
- `@owner` is mandatory for lite headers.
- If no clear owner exists, the file is not lite; give it a full header or mark it as architecture debt.

## Header Placement (Files With A Shebang)

The parser only strips a shebang (`#!/usr/bin/env node`) when it is the **absolute first line of the file** (Node's own requirement). Anything before it — including `'use strict';`, a BOM, or any code — breaks shebang stripping, which then also breaks header detection, even if the `@komerce-arch` block itself is syntactically correct.

Required order for any file that needs a shebang:

```js
#!/usr/bin/env node

/**
 * @komerce-arch
 * ...
 */

'use strict';

// rest of the file
```

`'use strict'` must come **after** the header, never before. A misplaced shebang/header is reported by `npm run arch:gen` as a distinct `misplaced` finding (not `filesWithoutHeaders`) — if you see "Header mal placé" in the gate output, reorder the lines above; do not write a new header.

## Database Fields

Database fields are optional, but mandatory for high/critical backend files that touch persistent state.

- `@db-read` lists the main tables read by the file.
- `@db-write` lists the main tables inserted, updated or deleted by the file.
- `@db-txn` lists transaction, lock, idempotency or consistency constraints.

Rules:

- Keep DB fields at table/contract level, not query level.
- Do not list every incidental lookup if it creates noise.
- Always list financial, order, stock, wallet, OTP and shared-cart writes.
- Use `none` for high/critical files that deliberately avoid database access.
- If unknown, use `@db-read @unknown` or `@db-write @unknown` and resolve before behavior changes.

## Rules

- Full headers stay short: 10 to 17 lines when DB fields are needed.
- Lite headers stay very short: 6 to 8 lines.
- Describe contracts, role, doctrine and impact, not implementation details.
- `@depends` lists verified technical or business dependencies.
- `@used-by` lists significant consumers. Use `@unknown` if not verified.
- `@doctrine` lists invariants that must not be broken.
- `@impact-areas` lists flows to verify before editing.
- `@criticality` is one of `low`, `medium`, `high`, `critical`.
- Tests, config files and migrations can be aggregated, but should not be invisible when they encode architecture or doctrine.

## Mandatory AI Workflow

Before modifying Komerce code:

1. Read `docs/komerce-arch-header-graph.json`.
2. Identify target files.
3. Locate the target in `interventionIndex` or through its lite `@owner`.
4. List related files through `depends`, `used-by`, `owner`, `db-read`, `db-write` and `impact-areas`.
5. List relevant DB reads, DB writes and transaction constraints.
6. List relevant doctrines.
7. Announce the intervention map.
8. Edit only after that.

## Initial Domains

`bootstrap`, `shared-cart`, `checkout`, `payment`, `auth`, `notification`, `economic-engine`, `catalog`, `boutique`, `order`, `inventory`, `dashboard`, `admin-dashboard`, `pricing`, `sourcing`, `wallet`, `tracking`, `recommendations`, `test`, `config`, `migration`.

`admin-dashboard` is the dedicated domain for `dashboards/admin/js/**` (the admin SPA: CT/BO shells, views, API client, filters store). Use `dashboard` for backend dashboard routes/services (`routes/dashboard*.js`, `services/dashboard-*.js`); use `admin-dashboard` for the frontend that consumes them. Kept distinct because the coupling mechanism differs end to end — see `docs/DASHBOARDS_360.md`.

## Initial Layers

`entrypoint`, `route`, `service`, `machine`, `policy`, `cron`, `data-service`, `external-adapter`, `api-client`, `ui-page`, `ui-component`, `ui-state`, `ui-layout`, `ui-renderer`, `view-model`, `state-store`, `schema`, `catalog-data`, `ux-policy`, `script`, `test`, `config`, `migration`.

`state-store` is for observable state containers with subscribe/notify (e.g. `filters-store.js`). Distinct from `ui-state`, which stays for transient render-local state owned by a single component.

## Dashboards Coupling Rule

`dashboards/admin/js/**` does not couple through imports (like the backend) or through an event bus (like the boutique — see `docs/BOUTIQUE_360.md`). It couples through a three-link chain: SPA router (`app.js` → `ROUTES`) → view (`views/*.js`) → `KmcApi.method()` → `api-client.js` → backend endpoint → contract proof status (`docs/contract/openapi.json`).

Any change to this chain (adding a route, a view, a `KmcApi` method, or a backend endpoint it depends on) must keep `docs/DASHBOARDS_360.md` consistent. Run:

```bash
node scripts/gen-dashboards-360.js
```

Then verify:

- no new orphan route (`view` declared without a matching file)
- no new missing API method (called by a view, not exported by `KmcApi` — guaranteed crash)
- no new dead API method left unaddressed (exported, never called — usually dead code or a forgotten wire-up)
- no new `kmc_api_only` doctrine violation (raw `fetch()` in a file that declares the doctrine)
- review new `UNKNOWN`-contract calls in §4 of the report — not blocking, but each one is an unverified response shape, exactly the failure mode that caused the Hub & Relais `.orders` incident.

## Boutique Coupling Rule

`public/boutique/js/**` couples through an **event bus** (`b-bus.js`), not imports or a SPA chain. Modules `emit`/`on` named events; the bus registry in `b-bus.js` is the source of truth. The boutique's backend seam is its set of `/api/*` calls, resolved against `docs/contract/openapi.json`. Keep `docs/BOUTIQUE_360.md` consistent on any change:

```bash
node scripts/gen-boutique-360.js
```

Blocking regressions (cliquet on `.boutique-360-baseline.json`): new orphan emit (emitted, no listener), new orphan listener (listened, no emitter), new undeclared event (used but absent from the `b-bus.js` registry), new `NOT_FOUND` endpoint (boutique calls a path absent from the contract — same failure class as the dashboards `.orders` / `getCosting` incidents).

## Meta-Graph — Seams Between the Three Territories

The three territory maps (`komerce-arch-header-graph.json`, `BOUTIQUE_360.json`, `DASHBOARDS_360.json`) are stitched by `gen-meta-graph.js` around the keystone: the OpenAPI contract. Every consumed endpoint is traced via `x-route-file` down to its backend route → services → tables, giving the real blast radius: *touch this table / route / endpoint, and here is who breaks across backend, boutique, and dashboards.*

```bash
node scripts/gen-meta-graph.js          # regenerate docs/META_GRAPH.md
node scripts/gen-meta-graph.js --check  # cliquet (pre-commit)
```

It reports: **shared endpoints** (called by both fronts — amplified change-risk), **shared tables** (read/written for both fronts), and **phantom seams** (a front calling an endpoint absent from the contract). The cliquet (`.meta-graph-baseline.json`) blocks only *new* phantom seams; shared endpoints and `UNKNOWN` contracts are informational. This is the layer that guarantees no added or removed feature escapes notice: it makes the full cross-territory dependency explicit and gated.
