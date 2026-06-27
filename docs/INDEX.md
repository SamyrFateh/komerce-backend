# Index vivant Komerce

> Statut : vivant. Point d'entree obligatoire pour toute intervention.

Ce fichier devient la porte d'entree de la documentation vivante. Une intervention commence ici, puis passe par la carte de feature ou de transversal concernée.

## Protocole court

1. Identifier l'operation : Create, Read, Update, Delete/Archive/Deprecate.
2. Identifier la feature ou le transversal concerne.
3. Ouvrir `features/<feature>.feature.js`.
4. Verifier `service`, `perimeter.in`, `perimeter.out`, `authority`, `contract`, `invariants` et `tests`/`verification`.
5. Modifier uniquement dans le perimetre declare.
6. Si l'intention change, mettre a jour la carte dans la meme PR.
7. Regenerer les sorties derivees pertinentes.
8. Lancer les gates applicables puis `npm run map:check` quand disponible.

## Regle carte-first

- Une intention vit dans une carte.
- Une verite derivable vit dans un generateur.
- Une trace passee vit dans `archive/`.
- Une intervention vit dans une feature ou un transversal declare.
- Une regle de gouvernance vit dans un gate ou dans un checkpoint humain nomme.

## Cartes canoniques

La source canonique reste `docs/doctrine/APP_FEATURE_REGISTRY.md` et les cartes `features/*.feature.js`.

- `features/shared-cart.feature.js`
- `features/orders.feature.js`
- `features/payments.feature.js`
- `features/wallet-loyalty.feature.js`
- `features/logistics.feature.js`
- `features/economic-engine.feature.js`
- `features/catalog.feature.js`
- `features/customs.feature.js`
- `features/notifications.feature.js`
- `features/documents.feature.js`
- `features/recommendations.feature.js`
- `features/inventory.feature.js`
- `features/refunds.feature.js`
- `features/dashboard.feature.js`
- `features/auth-identity.feature.js`
- `features/platform-ops.feature.js`

## Commandes utiles

```bash
npm run feature:registry
npm run feature:check
npm run arch:gate
npm run dashboards:360:check
npm run boutique:360:check
npm run security:360:check
npm run meta:graph:check
```

Commande cible :

```bash
npm run map:check
```
