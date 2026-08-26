# LOT 4B — Expéditions & Douane Workspace Canonical

## Status

Contract candidate for the second Canonical Workspace.

The doctrine remains:

> Dashboard observes. Workspace acts. Entity 360 explains.

LOT 4B continues the physical flow after Operations / Hub-Relais without importing `TransitaireView` or `CustomsView`.

## Stable surface

- HTML: `GET /admin/workspaces/shipping-customs`
- build alias: `/admin-next/workspaces/shipping-customs` → `/admin/workspaces/shipping-customs`
- API namespace: `/api/admin/workspaces/shipping-customs`

Legacy remains available during proof:

- `/admin/transitaire` → Legacy 1
- `/admin/customs` → Legacy 1

No destructive cutover is part of LOT 4B.

## Action-context invariant

The Workspace never acts globally.

Every read and mutation route contains `/market/:marketCode`. The browser supplies a market **code as requested action context**, never a market UUID as authority. The server resolves the active `markets` row and checks `operator_market_scopes` or an explicit central global grant.

Even a central administrator must explicitly select one market before an action.

Client `market_id` / `marketId` in query or body is rejected with `400 client_market_id_forbidden`.

## Roles

| Capability | `admin` | `agent_hub` | `agent_transitaire` |
| --- | :---: | :---: | :---: |
| read selected-market Workspace | ✅ | ✅ | ✅ |
| confirm parcel transit | ✅ | ✅ | ✅ |
| create/update customs shipment | ✅ | ❌ | ❌ |
| declare customs payment | ✅ | ❌ | ❌ |
| deactivate/reactivate customs shipment | ✅ | ❌ | ❌ |

The transit role preserves the real historical authority of `/api/transitaire`. Customs mutations stay admin-only because the current customs domain route is admin-only. LOT 4B does not invent a broader customs role.

`/api/admin/dashboard/context` accepts `agent_transitaire` only to resolve its server-side market context. Read-oriented Canonical dashboards remain admin-gated.

## Transit authority

Legacy `TransitaireView` previously called `/api/transitaire/ship` and the legacy route implemented a special transition path.

Canonical does not reuse that route.

`POST /market/:marketCode/parcels/:reference/confirm-transit`:

1. resolves the parcel by business reference;
2. proves `orders.market_id === selected market`;
3. checks relay consistency where a relay exists;
4. requires current parcel status `shipped`;
5. delegates to `scan-engine.processScan` with `event_type=transit_confirmed`.

`scan-engine` is the existing append-only logistics authority and already maps:

`transit_confirmed → parcels.status=in_transit`.

The browser never supplies `parcel_id`.

There is intentionally no browser-side “ship all” loop. Batch/global transit is out of scope until a server-scoped batch authority exists.

## Customs market ownership

Before LOT 4B, `customs_shipments` had no authoritative `market_id`.

Migration `146_customs_shipments_market_id.sql` adds nullable `customs_shipments.market_id` and backfills only shipments whose linked parcels resolve unambiguously to exactly one `orders.market_id`.

The migration deliberately does **not** force `NOT NULL`:

- old shipment with one unambiguous market → backfilled;
- old shipment with no parcel link → remains `NULL`;
- historical mixed-market shipment → remains `NULL`;
- `NULL` shipment → invisible and non-actionable from Canonical.

No market is inferred from island text, transitaire name or supplier.

A future cleanup lot may make the column `NOT NULL` after legacy data has been reconciled.

## Read model

`GET /api/admin/workspaces/shipping-customs/market/:marketCode`

```json
{
  "scope": {},
  "summary": {},
  "transit": {
    "ready": [],
    "in_transit": [],
    "history": []
  },
  "customs": {
    "shipments": [],
    "candidates": []
  }
}
```

### `summary`

Server-classified queue counts:

- `transit_ready`;
- `transit_active`;
- `customs_candidates`;
- `customs_pending`;
- `customs_declared`.

### Customs candidates

Candidates are parcels in the selected market, currently `shipped` or `in_transit`, not already linked to an active customs shipment.

The browser receives business references only.

## Customs mutations

All mutations are POST and market-scoped.

### Create

`POST /market/:marketCode/customs/shipments`

The browser may supply `parcel_refs`. The Workspace resolves them server-side to parcel IDs only after proving every parcel belongs to the selected market.

Business calculation and allocation are delegated to `customs-shipment-service.createShipment`.

The created shipment is immediately tagged with the server-resolved `market_id`. If this ownership tag cannot be persisted, the Workspace compensates by deleting the just-created shipment through the customs domain service and fails the action.

### Update

`POST /market/:marketCode/customs/shipments/:reference/update`

The shipment is first resolved by `(reference, market_id)`. The stable business reference itself is not editable from Canonical.

### Declare customs payment

`POST /market/:marketCode/customs/shipments/:reference/declare`

Delegates to `customs-shipment-service.declareCustomsPayment`, preserving the existing allocation, margin propagation, customs-cleared timestamp, item cost allocation and document side effects.

### Deactivate / reactivate

- `POST /market/:marketCode/customs/shipments/:reference/deactivate`
- `POST /market/:marketCode/customs/shipments/:reference/activate`

Both first resolve the shipment inside the selected market. Reactivation resolves supplied `parcel_refs` inside the same market before delegating.

## Browser invariants

The Canonical module:

- calls only `/api/admin/workspaces/shipping-customs/market/...`;
- never calls `/api/transitaire`;
- never calls `/api/admin/customs-shipments`;
- never imports Legacy `TransitaireView`, `CustomsView` or `ApiClient`;
- never sends `market_id` / `marketId`;
- never sends parcel UUIDs;
- performs no status-machine or customs allocation calculation;
- reloads the selected-market projection after every successful mutation.

## Relationship with existing Canonical surfaces

- `/admin/operations` observes logistics KPIs.
- `/admin/workspaces/operations` acts on Hub / Relais queues.
- `/admin/workspaces/shipping-customs` acts on transit and customs queues.
- `/admin/orders/:reference` explains an individual order.

The intended operational chain is therefore:

`Commerce → Order 360 → Operations Workspace → Expéditions & Douane Workspace → Relais → Client`.

## Deliberately out of scope

LOT 4B does not:

- create a global mutation endpoint;
- remove Legacy Transitaire or Customs views;
- infer market ownership from island text;
- expose internal market / parcel / shipment UUIDs;
- reproduce the legacy client-side “ship all” loop;
- create a new logistics state machine;
- create a new customs allocation engine;
- grant customs mutation rights to transit or hub agents;
- force `customs_shipments.market_id NOT NULL` before legacy reconciliation;
- perform the final Legacy cutover.

## Cutover rule

Only after runtime proof and data reconciliation may `/admin/transitaire` and `/admin/customs` be reconsidered for redirect/cutover.
