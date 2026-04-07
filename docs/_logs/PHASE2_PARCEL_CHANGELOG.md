# Phase 2 — Refonte Parcel-Centric · Double Écriture

> **Date** : 7 avril 2026
> **Commits** : `9ba092e`, `8e10939`
> **Statut** : ✅ Terminé
> **PR rétroactive** : oui (code déjà sur main)

---

## Fichiers créés / modifiés

| Fichier | Action | Description |
|---------|--------|-------------|
| `utils/parcelSync.js` | **CRÉÉ** | Module double écriture scans → parcels |
| `routes/scans.js` | **MODIFIÉ** v8.3 → v8.4 | 4 points d'intégration safeSyncScanToParcels() |
| `db/migrations/011_parcels_dual_write.sql` | **CRÉÉ** | Index optimisés pour la double écriture |

## Points d'intégration (scans.js v8.4)

1. `POST /api/scans` — scan générique
2. `POST /api/scans/collect` — retrait code 6 chiffres
3. `POST /api/scans/verify-qr` — retrait QR code
4. `triggerScan3()` — auto après complétude hub

## Principes

- **NON BLOQUANT** — safeSyncScanToParcels() catch toutes erreurs
- **IDEMPOTENT** — STATUS_WEIGHT empêche les régressions
- **FORWARD ONLY** — un parcel ne recule jamais
- **LEGACY SAFE** — trigger trg_scan_sync_status reste actif

## Mapping STEP_TO_PARCEL

| Scan step | Parcel status | Timestamp |
|-----------|--------------|----------|
| preparation | PREPARATION | prepared_at |
| hub_preparation | PREPARATION | prepared_at |
| shipped | SHIPPED | shipped_at |
| in_transit | IN_TRANSIT | in_transit_at |
| relais_received | AVAILABLE | available_at |
| collected | COLLECTED | collected_at |

## Dépendances

- Phase 1 (PR #111) : tables parcels/parcel_events, computeOrderStatus(), STATUS_WEIGHT, PARCEL_STATUSES
