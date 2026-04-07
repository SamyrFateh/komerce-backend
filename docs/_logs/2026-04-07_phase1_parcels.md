# 📦 Phase 1 — Refonte Parcel-Centric : Fondations

**Date** : 2026-04-07
**PR** : feat/parcels-phase1
**Impact** : ZÉRO sur le code existant

## Fichiers modifiés

| Fichier | Action | Description |
|---------|--------|-------------|
| `db/migrations/010_parcels_foundation.sql` | **AJOUT** | Tables `parcels` + `parcel_items`, ENUM `parcel_status`, colonnes `scans.parcel_id` + `orders.computed_status`, séquence `parcel_ref_seq`, index, règles métier, migration sub_orders→parcels |
| `utils/parcels.js` | **AJOUT** | `computeOrderStatus()`, `splitOrderIntoParcels()`, registre de stratégies extensible |
| `utils/reference.js` | **MODIFIÉ** | Ajout `generateParcelRef()` (KOM-P-YYYY-NNNNNN) |

## Décisions architecturales

1. **Stratégie de split extensible** : Le registre `STRATEGIES` dans `parcels.js` permet d'ajouter de nouvelles stratégies (attente courte, regroupement fournisseur, seuil minimum…) sans migration ni redéploiement — il suffit d'enregistrer la fonction et de changer la valeur `PARCEL_DEFAULT_SPLIT_STRATEGY` dans `business_rules`.

2. **computeOrderStatus()** : Fonction pure (pas d'accès DB) qui calcule le statut agrégé à partir d'un tableau de colis. Règle = le colis le MOINS avancé donne le statut de la commande (pire cas visible par le client).

3. **Migration données** : Les `sub_orders` existantes sont migrées vers `parcels` en conservant les mêmes UUID (rollback facile). Le `product_id` est récupéré via JOIN sur `order_items` pour robustesse.

4. **Zéro impact** : Le trigger `trg_scan_sync_status`, `orders.status`, et tous les endpoints existants continuent de fonctionner normalement. Les nouvelles colonnes (`scans.parcel_id`, `orders.computed_status`) sont nullable.

## Prochaine étape

**Phase 2 — Double écriture** : Les scans écriront dans `parcels` EN PLUS de `orders.status`. Le trigger legacy reste actif.
