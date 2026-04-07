# 🔄 Phase 2 — Refonte Parcel-Centric : Double Écriture

**Date** : 2026-04-07
**Commits** : `9ba092e`, `8e10939`
**Impact** : NON BLOQUANT — le legacy continue de fonctionner

## Fichiers modifiés/créés

| Fichier | Action | Description |
|---------|--------|-------------|
| `db/migrations/011_parcels_dual_write.sql` | **AJOUT** | Index composite `parcel_items(order_item_id, parcel_id)` + index partiel `parcels(order_id) WHERE status != cancelled` |
| `utils/parcelSync.js` | **AJOUT** | `syncScanToParcels()` + `safeSyncScanToParcels()` — double écriture non bloquante |
| `routes/scans.js` | **MODIFIÉ** | v8.3 → v8.4 — intégration `safeSyncScanToParcels()` dans les 4 points de scan |
| `docs/_work/2026-04-07_phase2_parcels_analysis.md` | **AJOUT** | Analyse d'impact complète |

## Points d'intégration (4 endpoints)

| Endpoint | Step | Commentaire |
|----------|------|-------------|
| `POST /api/scans` | `preparation`, `shipped`, `in_transit`, `relais_received` | Scan générique — supporte scan article (order_item_id) |
| `POST /api/scans/collect` | `collected` | Retrait par pickup_code |
| `POST /api/scans/verify-qr` | `collected` | Retrait par QR token — appel APRES commit transaction |
| `triggerScan3()` | `preparation` | Auto-déclenché par purchasing.js |

## Décisions architecturales

1. **Non bloquant** : `safeSyncScanToParcels()` wrappé dans try/catch. Erreur parcel = log, pas de 500.
2. **Forward only** : Un parcel ne recule jamais. Vérification via `STATUS_WEIGHT`.
3. **Hors transaction** : Pour `/verify-qr`, l'appel parcel est APRÈS le COMMIT pour éviter deadlocks.
4. **Idempotent** : Double appel avec même step = no-op.
5. **Legacy safe** : Pas de parcels trouvés = skip silencieux. Commandes legacy non impactées.

## Mapping step → parcel_status

| Scan step | Parcel status | Timestamp |
|-----------|--------------|----------|
| preparation | preparation | prepared_at |
| hub_preparation | preparation | prepared_at |
| shipped | shipped | shipped_at |
| in_transit | in_transit | in_transit_at |
| relais_received | available | available_at |
| collected | collected | collected_at |

## Prochaine étape

**Phase 3 — Migration du trigger** : Remplacer `trg_scan_sync_status` par `computeOrderStatus()`. Le trigger sera désactivé, `orders.computed_status` deviendra `orders.status`.
