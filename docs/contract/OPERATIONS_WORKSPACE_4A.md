# LOT 4A — Operations / Hub-Relais Workspace Canonical

## Status

Contract candidate for the first Canonical Workspace.

The doctrine is deliberately different from a dashboard:

> Dashboard observes. Workspace acts. Entity 360 explains.

LOT 4A therefore does **not** replace the Operations dashboard. It adds an action surface beside it.

## Stable surface

- HTML: `GET /admin/workspaces/operations`
- build alias: `/admin-next/workspaces/operations` → `/admin/workspaces/operations`
- API namespace: `/api/admin/workspaces/operations`

Legacy remains available during proof:

- `/admin/hub-relais` → Legacy 1
- `/admin/inventory` → Legacy 1

No destructive cutover is part of LOT 4A.

## Action-context invariant

A Workspace never acts in a global context.

Even an administrator with explicit global dashboard authority must select one active market before performing an operation.

Consequences:

- there is **no** global Operations Workspace API;
- every read and mutation route contains `/market/:marketCode`;
- the browser market code is only a requested view/action context;
- the server resolves it to the active `markets` row;
- authorization is checked against server-side operator scopes or explicit central global authority;
- a client-provided `market_id` / `marketId` is rejected in query and body.

## Market authorization

Route order:

1. authenticated session;
2. admin authorization;
3. reject client `market_id` authority;
4. resolve active market from `:marketCode`;
5. load `operator_market_scopes` server-side;
6. authorize that exact market;
7. execute the Workspace service.

An explicit central global grant may authorize a drill into the selected market, but it does not create a global mutation mode.

Examples:

- CM operator → CM: allowed;
- CM operator → CG: `403 market_scope_denied`;
- central global authority → CG: allowed **after CG is explicitly selected**;
- `?market_id=<CG UUID>`: `400 client_market_id_forbidden`;
- `{ "market_id": "<CG UUID>" }`: `400 client_market_id_forbidden`.

## Read model

`GET /api/admin/workspaces/operations/market/:marketCode`

Top-level response:

```json
{
  "scope": {},
  "summary": {},
  "queues": {},
  "distribution": {},
  "inventory": {},
  "data_quality": {}
}
```

### `scope`

Public market projection only:

```json
{
  "code": "CM",
  "name": "Cameroun",
  "currency": "XAF"
}
```

The market UUID is never exposed.

### `summary`

Operational queue counts calculated server-side:

- `hub_to_order`;
- `hub_unassigned`;
- `hub_to_ship`;
- `relay_cash_pending`;
- `relay_to_receive`;
- `relay_to_collect`;
- `inventory_to_assign`.

These counts are not economic/business recomputation. They are the sizes of already server-classified operational queues.

### `queues.hub`

- `to_order`: confirmed orders ready to be sent to sourcing;
- `to_ship`: parcels in preparation.

### `queues.relay`

- `cash_pending`: relay-cash payments still pending;
- `to_receive`: shipped/in-transit parcels;
- `to_collect`: available parcels ready for client hand-off.

### `distribution`

- open draft/preparation parcels in the selected market;
- ordered/preparation orders not yet assigned to an active parcel.

### `inventory`

- received/proposed/buffered inventory items owned by orders in the selected market;
- open parcel candidates in the selected market.

`inventory_items.id` may be exposed as an opaque action handle because inventory items currently have no stable business reference. It is never accepted as authorization evidence.

## Mutation routes

All mutations are POST and all are market-scoped.

### Send confirmed order to sourcing

`POST /market/:marketCode/orders/:reference/mark-ordered`

The Workspace validates that the order belongs to the selected market, then delegates the status change to `order-status-machine`.

The Workspace does not implement its own order state machine.

### Run parcel distribution

`POST /market/:marketCode/distribution/run`

The Workspace first selects only unassigned orders whose `orders.market_id` equals the server-resolved market.

Before any mutation, a relay consistency guard requires:

`orders.market_id === relais.market_id`

when a relay exists.

Only after this preselection does the Workspace call `auto-parcel.distributeOrder(orderId)` one order at a time.

The historical global `distributeAll()` is **not** called by Canonical.

### Ship parcel

`POST /market/:marketCode/parcels/:reference/ship`

Delegates to `scan-engine.processScan` with event `shipped`.

### Confirm relay cash

`POST /market/:marketCode/orders/:reference/confirm-cash`

The Workspace validates market ownership before delegating to `confirmCashAndCreateParcel`.

That existing authority remains responsible for:

- payment transition to paid;
- order transition;
- automatic parcel creation;
- pickup secret generation.

Notifications and invoice issuance remain post-commit, non-blocking side effects as in the existing V2 route.

### Receive parcel at relay

`POST /market/:marketCode/parcels/:reference/receive`

Delegates to `scan-engine.processScan` with event `relais_received`.

### Hand parcel to client

`POST /market/:marketCode/parcels/:reference/collect`

Delegates to `scan-engine.processScan` with event `customer_collected`.

The scan engine remains responsible for append-only history, sequence validation, smart catch-up, incidents and order synchronization.

### Assign inventory item

`POST /market/:marketCode/inventory/items/:itemId/assign`

Body:

```json
{
  "parcel_ref": "PCL-2026-0001"
}
```

Before `inventory-service.scanIntoParcel` is called, the Workspace validates:

1. the inventory item belongs to an order in the selected market;
2. the target parcel belongs to an order/relais in the same selected market;
3. the target parcel is still open (`draft` or `preparation`).

The browser never supplies a target market UUID.

## Reused domain authorities

LOT 4A is orchestration, not reimplementation.

| Action | Existing authority reused |
| --- | --- |
| order → ordered | `order-status-machine.transitionOrderStatus` |
| automatic grouping | `auto-parcel.distributeOrder` |
| ship / receive / collect | `scan-engine.processScan` |
| cash payment + parcel | `parcel-auto-create-service.confirmCashAndCreateParcel` |
| inventory assignment | `inventory-service.scanIntoParcel` |

## Relay market invariant

`relais.market_id` is NOT NULL by migration 137.

A relay is a physical location owned by one market. LOT 4A uses that invariant as a second consistency check around order/parcel actions.

The selected market is never inferred from island text.

## Browser invariants

The Canonical module:

- calls only `/api/admin/workspaces/operations/market/...`;
- does not call Legacy `/api/hub`, `/api/hub/inventory`, `/api/v2/orders` or `/api/v2/parcels` directly;
- never emits `market_id` or `marketId`;
- does not recalculate order, parcel, payment or inventory business state;
- uses business references for order and parcel navigation;
- drills orders to `/admin/orders/:reference`.

## Dashboard vs Workspace

`/admin/operations` remains the read-oriented Operations dashboard and can stay global for central users.

`/admin/workspaces/operations` is action-oriented and always mono-market.

The two surfaces are intentionally separate in the Canonical runtime.

## UI sections

The first Workspace exposes the operational sequence directly:

1. Hub · Commander
2. Hub · Répartition
3. Hub · Expédier
4. Relais · Encaisser
5. Relais · Réceptionner
6. Relais · Distribuer
7. Inventaire Hub · Affecter

After each successful mutation, the selected-market work queue is reloaded from the server.

## Deliberately out of scope

LOT 4A does not:

- create a global mutation endpoint;
- replace the Operations dashboard;
- remove Legacy Hub/Relais or Inventory views;
- import Legacy JS/CSS;
- create a new logistics state machine;
- create a new payment state machine;
- call global `autoParcel.distributeAll()`;
- call global inventory `proposeAll()`;
- make `destination_island` an authorization boundary;
- add economic KPIs or margin calculation;
- implement Expéditions & Douane (next Workspace family).

## Cutover rule

Only after runtime proof may `/admin/hub-relais` and `/admin/inventory` be reconsidered for redirect/cutover.

Until then, LOT 4A is additive and rollback-safe.
