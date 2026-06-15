# FRESH-003 — Fichiers orphelins routes/routes_orders_*.js

## Statut

**Clôturé — 2026-06-15.**

## Décision appliquée

Les trois fichiers orphelins ont été **supprimés** après vérification.

## Vérification d'imports

Recherche effectuée sur les références `routes_orders_*` : aucun montage actif ni `require()` applicatif ne dépendait de ces fichiers. Les routes actives sont dans `routes/orders/` et sont montées via `routes/orders.js`.

## Comparaison fichier par fichier

| Orphelin supprimé | Actif conservé | Verdict |
|---|---|---|
| `routes/routes_orders_cancel.js` | `routes/orders/cancel.js` | Contenu identique au fichier actif au moment de l'arbitrage. Suppression directe. |
| `routes/routes_orders_status.js` | `routes/orders/status.js` | Contenu identique au fichier actif au moment de l'arbitrage. Suppression directe. |
| `routes/routes_orders_parcels.js` | `routes/orders/parcels.js` | Version inline pré-refacto R4. La logique métier vit dans `services/parcel-operations.js`; l'actif délègue correctement. Suppression directe. |

## Note cancel : colonnes `phone_payer` / `phone_beneficiary`

Le document précédent signalait un `LEFT JOIN recipients` dans l'orphelin cancel comme différence potentielle. Après comparaison, le fichier orphelin et le fichier actif portaient la même logique utile. Les notifications d'annulation doivent rester traitées par `notifyCancellation` / `notification-service.js`, pas par conservation d'un doublon de route.

## Fichiers supprimés

- `routes/routes_orders_cancel.js`
- `routes/routes_orders_parcels.js`
- `routes/routes_orders_status.js`

## Fichiers actifs inchangés

- `routes/orders/cancel.js`
- `routes/orders/parcels.js`
- `routes/orders/status.js`
