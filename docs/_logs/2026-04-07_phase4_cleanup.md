# Phase 4 — Nettoyage Legacy (Parcel-Centric)

**Date** : 2026-04-07
**Auteur** : Agent Tasklet
**PR** : feat/parcel-centric-phase4-cleanup

## Changements

### Migration 013 (`db/migrations/013_legacy_cleanup.sql`)
| Action | Cible | Raison |
|--------|-------|--------|
| ADD COLUMN | `parcels.cancel_reason` | Manquant depuis sub_orders |
| ADD COLUMN | `parcels.estimated_date` | Manquant depuis sub_orders |
| ADD COLUMN | `parcels.backorder_reminder_sent` | Manquant depuis sub_orders |
| DROP COLUMN | `orders.computed_status` | Deprecated Phase 3 (migration 012) |
| DROP TRIGGER | `trg_scan_sync_status` | Désactivé Phase 3, remplacé par parcelSync.js |
| DROP FUNCTION | `sync_order_status_from_scan()` | Plus aucun appelant |
| DROP TABLE | `sub_order_items` | Data migrée vers parcel_items (Phase 1) |
| DROP TABLE | `sub_orders` | Data migrée vers parcels (Phase 1) |
| DROP INDEX | `idx_sub_orders_*` (×4) | Tables supprimées |

### Routes Section 7 (`routes/orders.js`)
- Remplacé ancien bloc "Phase 4 — Expédition Partielle (Hub Dubai)" par Section 7 complète
- 5 nouvelles routes : mark-availability, partial-ship, parcels, parcel/status, cancel-backorder
- Machine à états complète : draft → preparation → shipped → in_transit → arrived → available → collected
- SMS automatiques sur shipped/available/collected
- Backward compat : GET /sub-orders → redirect /parcels

### Validators (`validators/index.js`)
- `subOrderStatus` → `parcelStatus` (ajout draft, arrived)
- `subId` → `parcelId`
- `cancelBackorder` : parcel_id + sub_order_id backward compat avec .or()

### Server (`server.js`)
- Supprimé blocs seed CREATE TABLE sub_orders + sub_order_items

## Vérification
- [x] Import generateParcelRef ajouté
- [x] Ancien marqueur Phase 4 supprimé
- [x] computed_status absent du code
- [x] sub_orders absent de server.js
- [x] Backward compat préservé
