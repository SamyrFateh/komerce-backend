# FRESH-003 — Fichiers orphelins routes/routes_orders_*.js

## Statut
**Arbitrage requis avant suppression.**

## Fichiers concernés
- `routes/routes_orders_cancel.js` (243 lignes)
- `routes/routes_orders_parcels.js` (748 lignes)
- `routes/routes_orders_status.js` (167 lignes)

Ces trois fichiers ont été déposés le 2026-06-06 et ne sont **jamais référencés**
(ni `require()`, ni route montée). Les versions actives sont dans `routes/orders/`
montées via `routes/orders.js`.

## Différence principale identifiée (cancel)

La version orpheline (`routes_orders_cancel.js`) fait un `LEFT JOIN recipients`
et récupère `phone_payer`, `phone_beneficiary`, `recipient_phone`, `recipient_name`
— colonnes présentes en DB mais **non exploitées** par la version active.

## Options

| Option | Action | Risque |
|--------|--------|--------|
| A — Supprimer | `git rm routes/routes_orders_*.js` | Perd la logique JOIN recipients (peut être voulu) |
| B — Swap | Remplacer les actifs par les orphelins + tests | Plus de colonnes disponibles à l'annulation |
| C — Conserver pour référence | Garder tel quel + note dans STATUS.md | Confusion persistante |

## Recommandation
Option A si le JOIN recipients n'est pas nécessaire pour le flow d'annulation actuel.
Confirmer que `phone_payer`/`phone_beneficiary` ne sont pas utilisés dans les notifs SMS d'annulation.

**Action** : supprimer les 3 fichiers via `git rm routes/routes_orders_*.js` après validation.
