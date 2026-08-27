# Debt Zero — warnings Feature Guard et ownership Canonical

## Objet

Fermer deux dettes de gouvernance observées sur `main` après LOT 4G, sans modifier le runtime métier :

1. les **4 warnings Feature Guard** liés à des services sans témoin direct déclaré ;
2. les **16 `TECHNICAL-NODE-WITHOUT-BUSINESS-OWNERSHIP`** issus des composants de composition Canonical.

## Feature Guard — 4 → 0

Quatre témoins unitaires directs sont ajoutés :

- `tests/unit/sourcing-import-dispatch.test.js`
- `tests/unit/boutique-taxonomy-admin.test.js`
- `tests/unit/partner-admin-service.test.js`
- `tests/unit/sourcing-candidate-actions.test.js`

Ils couvrent 16 assertions métier, notamment :

- dispatch fournisseur sans réinterprétation du payload ;
- refus d'un connecteur API inactif ;
- invariants de création/mutation taxonomy et invalidation cache ;
- paramétrisation SQL des filtres partenaire ;
- dissociation contrôlée des liens lors de la suppression partenaire ;
- validation devise et transitions `watchlist` / `rejected` des candidats sourcing.

Preuve one-shot : **4 suites / 16 tests verts** et `feature-guard --strict` à **0 erreur / 0 warning**.

## Business Feature Graph — 16 → 0 debt/drift

Les composants Canonical suivants sont revendiqués par `dashboard`, qui reste leur autorité de composition/projection. Les features métier conservent l'autorité sur les mutations qu'ils orchestrent.

### Routes

- `routes/admin-client-360.js`
- `routes/admin-dashboard-market.js`
- `routes/admin-operations-workspace.js`
- `routes/admin-order-360.js`
- `routes/admin-product-360.js`
- `routes/admin-shipping-customs-workspace.js`

### Services

- `services/client-360.js`
- `services/dashboard-admin-context.js`
- `services/dashboard-commerce.js`
- `services/dashboard-finance-canonical.js`
- `services/dashboard-operations.js`
- `services/dashboard-pilotage-market.js`
- `services/operations-workspace.js`
- `services/order-360.js`
- `services/product-360.js`
- `services/shipping-customs-workspace.js`

Chaque composant dispose déjà d'un témoin direct existant ; ces témoins sont désormais déclarés dans `dashboard.feature.js`.

Preuve one-shot : **31 features / 0 erreur / 0 debt-drift**, avec 32 topologies attendues et 8 limites outil inchangées.

## Feature 360

La projection est régénérée depuis les sources de vérité mises à jour. Elle reste à **0 feature bloquée**.

## Hors scope — dette GATE_FINDINGS découverte pendant la preuve

Un rafraîchissement global de `GATE_FINDINGS` a révélé une poche de dette distincte, volontairement non mélangée à ce lot :

- `middleware/require-dashboard-global-authority.js` apparaît orphelin dans le registre de projection ;
- plusieurs CSS Boutique récents sont `UNPROJECTABLE` pour plusieurs gates ;
- le générateur signale actuellement seulement 4/18 sources de gate complètement attribuables.

Cette dette mérite un lot de gouvernance dédié : elle ne remet pas en cause la clôture des 4 warnings Feature Guard ni des 16 nœuds Canonical sans ownership traités ici.

## Invariants de ce lot

- aucune route HTTP ajoutée ou modifiée ;
- aucune requête métier de production modifiée ;
- aucune autorité de mutation déplacée ;
- Business Graph et Feature 360 sont régénérés, jamais édités manuellement ;
- Security 360 reste frais et inchangé fonctionnellement.
