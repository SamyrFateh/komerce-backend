# Lot 2 — Convergence pickup_code → secret canonique haché — Clôture

## Résumé
Tous les canaux d'écriture et de lecture de `orders.pickup_code` (en clair)
convergent maintenant vers le secret canonique haché+salé
(`pickup_secret_hash`/`salt`/`last4`) via `services/pickup-secret-service.js`.

## Écrivains convergés (6)
- `routes/orders/create.js` (wallet 100%)
- `services/shared-cart-lifecycle.js` + `routes/shared-cart.js` (Cas A 100% financé)
- `services/order-status-machine.js` (transition → `available`)
- `services/payment-cash-confirm.js`
- `services/cash-operations.js` + `routes/cash.js`
- `services/parcel-auto-create-service.js` + `routes/order-api-v2.js`

## Lecteurs convergés
- `services/scan-operations.js` (`collectParcel` — vérification par hash)
- `routes/tracking.js` (`/verify-pickup`, `pickupReady`)
- `routes/orders/list.js`, `routes/orders/detail.js`
- `services/relay-dashboard-queries.js`, `routes/client-tracking.js`
- `public/relais/index.html` (champ PIN → 8 caractères alphanumériques)

## Nettoyage code mort (cette session)
- `services/order-service.js::generatePickupCode()` — supprimé (orphelin)
- `utils/reference.js::generatePickupCode()` — supprimé (5ᵉ implémentation locale, jamais appelée)
- `scripts/fix-schema.js` — backfill convergé vers `ensureSecretGenerated()`
- `routes/admin/system.js` — seed démo convergé (plus d'écriture `pickup_code`)

## Schéma
- `migrations/119_drop_orders_pickup_code.sql` — retrait de la colonne et de
  ses 2 index (`idx_orders_pickup_code`, `uq_orders_pickup_active`).
  ⚠️ Voir prérequis dans le fichier avant application en prod.

## Hors périmètre (volontairement non touché)
`parcels.pickup_code` — colonne distincte sur la table `parcels`, non concernée.

## Restant à faire
- Tests unitaires/intégration non mis à jour pour ce lot.
- Gates CI (`arch:gate`, `npm test`) non relancés dans cette session
  (environnement sandbox sans DB ni `node_modules`) — à relancer avant merge.
