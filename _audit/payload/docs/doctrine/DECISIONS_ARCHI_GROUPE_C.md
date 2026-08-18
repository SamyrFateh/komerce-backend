# Décisions architecturales — Groupe C (les 12 cas durs)

> **Auteur** : Claude Opus (archi multi-stack)
> **Méthode** : lecture complète de chaque fichier (pas le header seul — le code, les
> imports, les tables touchées, les commentaires, le `@used-by`)
> **Date** : 2026-06-26

---

## Résultat : 9 rattachements + 3 transversaux

| # | Fichier | Décision | Feature / Transversal | Raisonnement |
|---|---------|----------|----------------------|--------------|
| 1 | `services/order-payment-confirmation.js` | **→ orders** | `orders.feature.js` | Le service est le point d'entrée UNIQUE du cycle paiement→stock. Il opère la machine d'état `pending → confirmed → ordered` et décremente le stock. Payments le *déclenche*, mais la machine d'état qu'il opère appartient à orders. Le `@role` dit `payment-to-stock-single-entry` — c'est un pont, et le pont vit du côté de la berge qui possède l'état. Header à corriger : `@domain orders`. |
| 2 | `routes/auto-distribute-api.js` | **→ logistics** | `logistics.feature.js` | Routes `/api/hub/auto-distribute` : distribue les commandes dans les colis, nettoie les colis fantômes. C'est de l'opérationnel hub. Dépend de `services/auto-parcel`. Header : `@domain logistics`. |
| 3 | `routes/categories.js` | **→ catalog** | `catalog.feature.js` | GET `/api/categories` public, lit `boutique_categories` + `boutique_subcategories`. Sert l'arbre catégories à la boutique. Consomme `utils/categories-cache.js` (même feature). Header : `@domain catalog`. |
| 4 | `routes/shares.js` | **→ shared-cart** | `shared-cart.feature.js` | Crée des liens de partage de panier (`cart_shares`), gère les contributions (`cart_contributions`). Tables dans le périmètre shared-cart (migration 075). Le nom `shares` prête à confusion mais le code est 100% panier partagé. Header : `@domain shared-cart`. |
| 5 | `routes/unsold.js` | **→ inventory** | `inventory.feature.js` | Gestion du cycle de vie des invendus : scan, listing, résolution, broadcast WhatsApp revendeurs. Tables `unsold_items`, `v_unsold_pipeline`. Ce n'est ni orders (les commandes sont terminées) ni economic-engine (pas du pricing). C'est du stock résiduel — inventory possède le cycle de vie d'un produit après la vente échouée. Header : `@domain inventory`. |
| 6 | `utils/categories-cache.js` | **→ catalog** | `catalog.feature.js` | Cache d'invalidation du schéma catégories. Consommé par `routes/categories.js` et `routes/admin-boutique-categories.js`. Même feature que categories.js — les rattacher ensemble. Header : `@domain catalog`. |
| 7 | `utils/eco-bridge.js` | **→ economic-engine** | `economic-engine.feature.js` | Source unique de lecture des paramètres économiques (`economic_variables`). Consommé par pricing, dashboard, economic-engine routes. Le code le dit lui-même : « Economic Bridge ». Header : `@domain economic-engine`. |
| 8 | `utils/email.js` | **→ notifications** | `notifications.feature.js` | Canal de livraison email (Brevo API) pour les emails transactionnels de commande. Parallèle au canal WhatsApp déjà dans notifications. Les templates couvrent : confirmed, ordered, shipped, delivered, cancelled, refunded. Header : `@domain notifications`. |
| 9 | `utils/refunds.js` | **→ refunds** | `refunds.feature.js` | Moteur de remboursement centralisé : Stripe refund + crédit boutique via wallet-service. Le manifest `refunds.feature.js` existe déjà — ce fichier y manque juste. Header : `@domain refunds`. |
| 10 | `utils/reference.js` | **TRANSVERSAL** | `ORPHAN_IGNORE` | Génère des références uniques pour **plusieurs features** : `generateOrderRef` (orders), `generateBasketCode` (shared-cart), `generateParcelRef` (logistics), `generateCashCode` / `generatePickupCode` (payments/logistics). Le rattacher à une seule feature serait mentir — il sert de fondation à toutes. Ajouter à `ORPHAN_IGNORE` avec commentaire. |
| 11 | `utils/rules.js` | **TRANSVERSAL** | `ORPHAN_IGNORE` | Moteur de règles métier centralisé (`business_rules` table). Fournit `getRule(key, fallback)` consommé par pricing, orders, catalog, et potentiellement tout. Même logique que `utils/reference.js` — c'est une infrastructure, pas une feature. |
| 12 | `validators/index.js` | **TRANSVERSAL** | `ORPHAN_IGNORE` | Barrel de schémas Joi pour **toutes** les routes. `@domain validation` est correct — ce n'est pas une feature métier, c'est de l'infrastructure de validation. Le rattacher à une feature cacherait sa nature transversale. |

---

## Actions exactes à exécuter

### A. Headers `@domain` à corriger (9 fichiers)

```
services/order-payment-confirmation.js   @domain order-payment  →  @domain orders
routes/auto-distribute-api.js            @domain unknown        →  @domain logistics
routes/categories.js                     @domain unknown        →  @domain catalog
routes/shares.js                         @domain unknown        →  @domain shared-cart
routes/unsold.js                         @domain unknown        →  @domain inventory
utils/categories-cache.js                @domain unknown        →  @domain catalog
utils/eco-bridge.js                      @domain unknown        →  @domain economic-engine
utils/email.js                           @domain unknown        →  @domain notifications
utils/refunds.js                         @domain unknown        →  @domain refunds
```

### B. Manifests à enrichir (ajouter au `files.<catégorie>`)

```
features/orders.feature.js           files.services += ['services/order-payment-confirmation.js']
features/logistics.feature.js        files.routes   += ['routes/auto-distribute-api.js']
features/catalog.feature.js          files.routes   += ['routes/categories.js']
                                     files.utils    += ['utils/categories-cache.js']
features/shared-cart.feature.js      files.routes   += ['routes/shares.js']
features/inventory.feature.js        files.routes   += ['routes/unsold.js']
features/economic-engine.feature.js  files.utils    += ['utils/eco-bridge.js']
features/notifications.feature.js    files.utils    += ['utils/email.js']
features/refunds.feature.js          files.utils    += ['utils/refunds.js']
```

### C. Transversaux à assumer dans le script (3 fichiers)

Ajouter à `ORPHAN_IGNORE` dans `scripts/feature-registry-check.js` :

```js
// Transversaux reconnus — infrastructures multi-features, pas rattachables à une seule
'utils/reference.js',       // génération de références (orders, shared-cart, logistics)
'utils/rules.js',           // moteur de règles métier centralisé (pricing, orders, catalog)
'validators/index.js',      // barrel de validation Joi (toutes les routes)
```

### D. Registre à mettre à jour

Dans `APP_FEATURE_REGISTRY.md`, section « dette connue », **retirer ces 12 fichiers**
de la liste des orphelins. Les 9 rattachés ne sont plus orphelins (ils ont un manifest).
Les 3 transversaux sont assumés (ajoutés à la section « domaines techniques transversaux »
avec une ligne chacun).

---

## Point de vigilance sur la décision #1 (order-payment-confirmation)

C'est la décision la plus structurante. Ce service est le **nœud de couplage le plus
critique du backend** : payments le déclenche, orders possède la machine d'état, stock
(inventory) est décrémenté, shared-cart et wallet en dépendent.

Je le rattache à **orders** parce que :
- Son `@role` est `payment-to-stock-single-entry` — le stock est une conséquence de la
  commande, pas du paiement.
- Il opère `transitionOrderStatus()` de `order-status-machine.js` — c'est la machine
  d'état d'**orders** qu'il manipule.
- Son contrat dit « ce service opère DANS une transaction existante, l'appelant décide
  ROLLBACK ou COMMIT » — il est esclave du contexte transactionnel de l'appelant (payments
  ou shared-cart). C'est un outil d'orders prêté à payments, pas l'inverse.

Si un jour `order-payment-confirmation` grossit au point de devenir un pont à part entière
(un « settlement » feature), le registre permettra de le scinder proprement. Pour l'instant,
il reste dans orders parce que c'est là que vit la machine d'état qu'il opère.

---

## Point de vigilance sur la décision #5 (unsold)

`routes/unsold.js` est rattaché à **inventory**, mais le manifest `inventory.feature.js`
est aujourd'hui léger. Si le processus « invendus → liquidation → revendeurs » grossit, il
pourrait mériter sa propre feature. Le signal d'alerte : quand le manifest inventory a plus
de lignes pour le cycle invendus que pour le cycle stock normal. À ce moment, scinder.

---

## Après ces 12 décisions

Les 50 orphelins se répartissent ainsi :

| Catégorie | Avant | Après | Reste |
|---|---|---|---|
| Groupe A (désaccord header↔manifest) | 16 | 0 | rattachés aux manifests |
| Groupe B (unknown mappable) | 22 | 0 | headers posés + manifests |
| Groupe C (décision humaine) | 12 | 0 | 9 rattachés + 3 transversaux |
| **Total orphelins** | **50** | **0** | — |

`node scripts/feature-registry-check.js --orphans` doit retourner : **0 orphelin**.
