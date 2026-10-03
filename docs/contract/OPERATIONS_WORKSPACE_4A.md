# LOT 4A — Operations / Hub-Relais Workspace Canonical

## Status

Canonical Workspace with controlled Legacy-entry cutover in LOT 4O.

The doctrine is deliberately different from a dashboard:

> Dashboard observes. Workspace acts. Entity 360 explains.

LOT 4A therefore does **not** replace the Operations dashboard. It adds an action surface beside it.

## Stable surface

- HTML: `GET /admin/workspaces/operations`
- build alias: `/admin-next/workspaces/operations` → `/admin/workspaces/operations`
- API namespace: `/api/admin/workspaces/operations`

Legacy remains available as an explicit rollback:

- `/admin/hub-relais?legacy=1` → Legacy 1
- `/admin/inventory?legacy=1` → Legacy 1

Normal entrypoints redirect to `/admin/workspaces/operations`. The Legacy files remain untouched and recoverable during the rollback window.

## Action-context invariant

A Workspace never acts in a global context.

Even an administrator with explicit global dashboard authority must select one active market before performing an operation.

Consequences:

- there is **no** global Operations Workspace API;
- every read and mutation route contains `/market/:marketCode`;
- the browser market code is only a requested view/action context;
- the server resolves it to the active `markets` row;
- authorization is checked against exact market capabilities; read may also use explicit dashboard global authority, while `agent_relais` is additionally bounded by its server-side `relais.market_id`;
- a client-provided `market_id` / `marketId` is rejected in query and body.

## Role authorization

The real operational roles in the Komerce user model are:

- `admin`;
- `agent_hub`;
- `agent_relais`.

The Workspace never derives Market ID authority from `users.role`. A delegated member may keep any persisted role (including `client`) and still use this surface when the exact capability is present. The execution bridge projects a request-local compatibility role only after capability proof.

| Action | Exact authority | Compatibility role after proof |
| --- | --- | --- |
| read selected-market Workspace | `operations.read` (or explicit dashboard-global read grant; persisted `agent_relais` may use its server relay binding) | none |
| mark order as ordered | `execution.order.mark_ordered` | `agent_hub` |
| run automatic distribution | `execution.distribution.run` | `agent_hub` |
| ship parcel | `execution.parcel.ship` | `agent_hub` |
| assign inventory to parcel | `execution.inventory.assign` | `agent_hub` |
| confirm relay cash | `execution.cash.confirm` | `agent_relais` |
| receive parcel at relay | `execution.parcel.receive` | `agent_relais` |
| hand parcel to client | `execution.parcel.collect` | `agent_relais` |

The compatibility role is not an authority source. It exists only so historical domain services can keep their role-shaped interface after market-delegation has already authorized and audited the action.

`/api/admin/dashboard/context` may resolve presentation context, but it never grants `operations.read` or an `execution.*` capability. Workspace authority is re-proved on every API request.

## Market authorization

Route order:

1. authenticated session;
2. reject client `market_id` authority;
3. resolve active market from `:marketCode`;
4. for reads, require `operations.read`, except an explicit dashboard-global read grant; a persisted `agent_relais` may instead read only the market of its server-side relais;
5. for mutations, require the exact `execution.*` capability on the selected Market ID and audit it;
6. project the request-local Hub or Relais compatibility role, then pass the existing role-shaped domain boundary;
7. if the persisted actor is `agent_relais`, require its `relais.market_id` to equal the selected market;
8. execute the Workspace service.

An explicit central global grant may authorize a drill into the selected market, but it does not create a global mutation mode.

Examples:

- CM operator → CM: allowed;
- CM capability holder → CG: `403 MARKET_CAPABILITY_REQUIRED`;
- central dashboard authority → CG: read allowed **after CG is explicitly selected**, mutation still requires the exact `execution.*` capability;
- `agent_hub` without `execution.cash.confirm` → `403`; with that explicit capability, the request receives the Relais compatibility role;
- `agent_relais` without `execution.order.mark_ordered` → `403`; capability possession, not `users.role`, decides the Hub action;
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

Exact authority: `execution.order.mark_ordered` on the selected market. After proof, the request uses compatibility role `agent_hub`.

The Workspace validates that the order belongs to the selected market, then delegates the status change to `order-status-machine`.

The Workspace does not implement its own order state machine.

### Run parcel distribution

`POST /market/:marketCode/distribution/run`

Exact authority: `execution.distribution.run` on the selected market. After proof, the request uses compatibility role `agent_hub`.

The Workspace first selects only unassigned orders whose `orders.market_id` equals the server-resolved market.

Before any mutation, a relay consistency guard requires:

`orders.market_id === relais.market_id`

when a relay exists.

Only after this preselection does the Workspace call `auto-parcel.distributeOrder(orderId)` one order at a time.

The historical global `distributeAll()` is **not** called by Canonical.

### Ship parcel

`POST /market/:marketCode/parcels/:reference/ship`

Exact authority: `execution.parcel.ship` on the selected market. After proof, the request uses compatibility role `agent_hub`.

Delegates to `scan-engine.processScan` with event `shipped`.

### Confirm relay cash

`POST /market/:marketCode/orders/:reference/confirm-cash`

Exact authority: `execution.cash.confirm` on the selected market. After proof, the request uses compatibility role `agent_relais`. A persisted `agent_relais` must additionally belong to a relais of that market.

The Workspace validates market ownership before delegating to `confirmCashAndCreateParcel`.

That existing authority remains responsible for:

- payment transition to paid;
- order transition;
- automatic parcel creation;
- pickup secret generation.

Notifications and invoice issuance remain post-commit, non-blocking side effects as in the existing V2 route.

### Receive parcel at relay

`POST /market/:marketCode/parcels/:reference/receive`

Exact authority: `execution.parcel.receive` on the selected market. After proof, the request uses compatibility role `agent_relais`. A persisted `agent_relais` must additionally belong to a relais of that market.

Delegates to `scan-engine.processScan` with event `relais_received`.

### Hand parcel to client

`POST /market/:marketCode/parcels/:reference/collect`

Exact authority: `execution.parcel.collect` on the selected market. After proof, the request uses compatibility role `agent_relais`. A persisted `agent_relais` must additionally belong to a relais of that market.

Delegates to `scan-engine.processScan` with event `customer_collected`.

The scan engine remains responsible for append-only history, sequence validation, smart catch-up, incidents and order synchronization.

### Assign inventory item

`POST /market/:marketCode/inventory/items/:itemId/assign`

Exact authority: `execution.inventory.assign` on the selected market. After proof, the request uses compatibility role `agent_hub`.

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

The browser may use the authenticated role to present the appropriate controls, but that presentation is never an authorization boundary; every mutation is re-authorized by the server.

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
- delete Legacy Hub/Relais or Inventory files during the rollback window;
- import Legacy JS/CSS;
- create a new logistics state machine;
- create a new payment state machine;
- call global `autoParcel.distributeAll()`;
- call global inventory `proposeAll()`;
- make `destination_island` an authorization boundary;
- add economic KPIs or margin calculation;
- implement Expéditions & Douane (next Workspace family).

## Cutover rule

LOT 4O proves the legitimate historical needs against the Canonical split:

- observation from `OrdersLogisticsView` → `/admin/operations`;
- six Hub/Relais mutations → the corresponding market-scoped Workspace actions;
- inventory queues/open parcels and explicit assignment → the Workspace inventory section;
- global `hubInventoryProposeAll` → deliberately retired because it cannot prove a single server-authorized market before mutation.

`/admin/hub-relais` and `/admin/inventory` therefore redirect to the Workspace. `?legacy=1` remains the immediate rollback until the Legacy purge is separately approved.
