# Parcel reference runtime drift — 2026-09-04

## Incident

`GET /api/admin/dashboard/operations` returned HTTP 500 in production because runtime SQL queried `parcels.tracking_number`, while the canonical `parcels` schema owns `reference` as the parcel business identifier.

PostgreSQL error observed on Railway: `42703 column p.tracking_number does not exist`.

## Fix

Runtime readers now select `p.reference AS tracking_number` where a compatibility response field named `tracking_number` already exists. No database column is added and no API consumer contract is broken.

Covered runtime readers:
- `services/dashboard-operations.js`
- `services/order-360.js`
- `services/action-center-workspace.js`

A unit contract test prevents these readers from querying `p.tracking_number` again and asserts that the parcel foundation schema owns `reference` and not `tracking_number`.

## Follow-up

`services/signal-service.js` still contains a historical `p.tracking_number` lookup inside the non-fatal `parcel_blocked` signal generator. It does not cause the Operations dashboard 500 because that generator catches its own query failure, but it should be aligned in a dedicated signal-service cleanup to remove the remaining degraded path.
