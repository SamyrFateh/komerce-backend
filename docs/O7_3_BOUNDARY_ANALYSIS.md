# O7.3 — Boundary Analysis

> Rédigé provider par provider, dans l'ordre recommandé (§18). Baseline vérifiée à l'entrée : 13 exceptions `internal-api-required`, `CROSS_FEATURE_DIRECT_IMPORT = 13`. Écarts à la liste citée dans le prompt documentés à chaque provider où ils sont apparus.

---

## Provider 1 — loyalty

**Consumers** : economic-engine, logistics, orders, payments, shared-cart (5 paires).

**Old direct imports** : 14 preuves O5, 2 fichiers cibles (`services/loyalty-service.js`, `routes/loyalty.js`).

**Services réellement demandés** (4 capacités distinctes, aucune de plus) :
- `handleOrderConfirmed({orderId})` — déjà dans le service, correct (5 callers).
- `invalidateConfigCache()` — déjà dans le service, correct (1 caller).
- `getLoyaltyDiscount(db, userId)` — vivait dans `routes/loyalty.js` (route).
- `recalculateLoyalty(db, userId)` — vivait dans `routes/loyalty.js` (route).

**Existing boundary candidates** : `services/loyalty-service.js` existait déjà et portait déjà 2 des 4 fonctions — candidat naturel pour les 2 autres.

**Boundary choisie** : extraction des 2 fonctions route→service, comportement et signature `(db, userId)` repris à l'identique (les appelants passent parfois un client de transaction).

**internalApi exposée** : `handleOrderConfirmed`, `getUserLoyaltyStatus`, `getFinanceConfig`, `invalidateConfigCache`, `getLoyaltyDiscount`, `recalculateLoyalty` (export nommé existant du service, pas de nouveau champ `contract.internalApi` formel ajouté sur ce provider — la convention de ce manifest utilise déjà `module.exports` nommé comme documentation vivante).

**Consumer imports after** : tous les 6 callers historiques (`scan-operations.js`, `verify-qr-collection.js`, `routes/orders/status.js`, `routes/orders/create.js` ×2, `routes/admin-finance-config.js`) pointent sur `services/loyalty-service.js`. Zéro import vers `routes/loyalty.js` depuis une autre feature.

**contract.consumes added** : `economic-engine`, `logistics`, `orders`, `payments`, `shared-cart` → `loyalty` (5 entrées).

**Pairs before/after** : 5 `OBSERVED_UNDECLARED` → 5 `DECLARED_AND_OBSERVED`.

---

## Provider 2 — purchasing

**Consumers** : dashboard, payments (2 paires).

**Old direct imports** : `routes/admin/system.js -> services/repair-ordered-without-purchase-orders.js` ; `routes/cash.js` + `routes/payments.js -> services/purchasing-trigger-service.js`.

**Découverte** : les deux étaient déjà propres — anti-pattern route déjà corrigé en O7.2 (Cycle C). Aucun code à changer.

**Boundary choisie** : formalisation pure.

**internalApi exposée** : `{ fn: 'triggerPurchasing', file: 'services/purchasing-trigger-service.js' }`, `{ fn: 'repairOrderedWithoutPurchaseOrders', file: 'services/repair-ordered-without-purchase-orders.js' }`.

**Consumer imports after** : inchangés (déjà corrects).

**contract.consumes added** : `dashboard`, `payments` → `purchasing`.

**Pairs before/after** : 2 `OBSERVED_UNDECLARED` → 2 `DECLARED_AND_OBSERVED`.

---

## Provider 3 — catalog

**Consumers** : dashboard (1 paire).

**Old direct import** : `routes/admin/index.js -> routes/admin/catalog-approval.js`.

**Découverte structurelle** : ce n'était PAS un appel de service — `router.use('/', require('./catalog-approval'))` est un MONTAGE de router Express, un composition-root imbriqué (même nature que `bootstrap/api-routes.js`), pas une consommation métier de `dashboard` vers `catalog`.

**Existing boundary candidates** : aucun pertinent — ni internal API ni contract.consumes n'a de sens pour un montage de routeur.

**Boundary choisie** : le montage déplacé vers `bootstrap/api-routes.js` (le vrai composition root), même chemin HTTP final (`/api/admin` + `/catalog/approval-queue*`, inchangé).

**internalApi exposée** : aucune — pas applicable.

**Consumer imports after** : `routes/admin/index.js` ne touche plus aucun fichier catalog. Objectif « 0 cross-feature import de routes/admin/catalog-approval.js » atteint.

**contract.consumes added** : aucun — la paire a disparu, ce n'était jamais une vraie dépendance métier. La nouvelle evidence (`bootstrap/api-routes.js -> routes/admin/catalog-approval.js`) rejoint une paire `infrastructure -> catalog` déjà `DECLARED_AND_OBSERVED` préexistante.

**Pairs before/after** : 1 `OBSERVED_UNDECLARED` → 0 (disparue).

---

## Provider 4 — economic-engine

**Consumers** : platform-ops (1 paire).

**Old direct import** : `routes/modules.js -> services/pricing-engine.js` (module entier).

**Découverte** : ownership déjà confirmé O7.1 (`OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED`), non réouverte. `pricing-engine.js` exporte 11 fonctions ; `routes/modules.js` n'en utilise qu'une, `recommend()`.

**Boundary choisie** : import nommé minimal `{ recommend }` au lieu du module entier.

**internalApi exposée** : `{ fn: 'recommend', file: 'services/pricing-engine.js' }` — les 10 autres fonctions (computeCDR, computePrices, buildAlerts...) restent internes.

**Consumer imports after** : `routes/modules.js` importe `{ recommend }` uniquement.

**contract.consumes added** : `platform-ops` → `economic-engine`.

**Pairs before/after** : 1 `OBSERVED_UNDECLARED` → 1 `DECLARED_AND_OBSERVED`.

---

## Provider 5 — logistics

**Consumers** : platform-ops (1 paire).

**Écart documenté avant modification** : la génération fraîche montre 4 preuves, pas 1 — 3 sont des tests `platform-ops` (`relais-idor-probe`, `security-grid`) important `tests/integration/test-harness/seed-helpers.js` (harness de seed, ownership logistics). Évidence bénigne, sans rapport avec le fix runtime, automatiquement couverte par la déclaration de paire (pair-level, pas evidence-level).

**Old direct import (runtime réel)** : `services/simulator/state-advancer.js -> services/parcel-operations.js`.

**Découverte** : ownership déjà confirmé O7.1 (WRITER != LIFECYCLE OWNER). Import déjà minimal et nommé (`{ transitionParcelStatus }`), `skipValidation` déjà un paramètre explicite de l'appelant.

**Boundary choisie** : formalisation pure, aucun code changé.

**internalApi exposée** : `{ fn: 'transitionParcelStatus', file: 'services/parcel-operations.js' }` — `markAvailability`, `partialShip`, `updateParcelStatus`, `cancelBackorder` restent internes.

**Consumer imports after** : inchangés (déjà minimaux).

**contract.consumes added** : `platform-ops` → `logistics`.

**Pairs before/after** : 1 `OBSERVED_UNDECLARED` → 1 `DECLARED_AND_OBSERVED`.

---

## Provider 6 — orders

**Consumers** : platform-ops (1 paire).

**Old direct import** : `services/simulator/state-advancer.js -> services/order-status-machine.js`.

**Découverte** : même doctrine que logistics. Import déjà minimal et nommé (`{ transitionOrderStatus }`).

**Boundary choisie** : formalisation pure, aucun code changé.

**internalApi exposée** : `{ fn: 'transitionOrderStatus', file: 'services/order-status-machine.js' }` — `ORDER_STATUSES`, `VALID_TRANSITIONS`, `TRANSITION_ROLES`, `STATUS_RANK`, `STATUS_TIMESTAMP`, `isForwardTransition`, `appendOrderHistoryNote` restent internes.

**Consumer imports after** : inchangés.

**contract.consumes added** : `platform-ops` → `orders`.

**Pairs before/after** : 1 `OBSERVED_UNDECLARED` → 1 `DECLARED_AND_OBSERVED`.

---

## Provider 7 — payments / shared-cart

**Consumers** : orders, shared-cart (2 paires, traitées séparément — mission §9 explicite).

### orders -> payments
**Old direct import** : `services/admin-order-refund.js -> services/payment-service.js` (déjà `{ markRefunded }`, déjà minimal).

**Boundary choisie** : formalisation pure. Surface `payments` REGROUPÉE pour tous ses consumers (mission §7) : `markPaid` (déjà consommé par `logistics`/`wallet` depuis O7.2 Cycle B/D) + `markRefunded` (orders, nouveau) — une seule internalApi, pas une par consumer.

**internalApi exposée** : `{ fn: 'markPaid', file: 'services/payment-service.js' }`, `{ fn: 'markRefunded', file: 'services/payment-service.js' }`, `{ fn: 'makeInput', file: 'public/boutique/js/b-checkout.js' }` (voir ci-dessous). `markFailed` reste interne (aucun consumer cross-feature actuel).

**contract.consumes added** : `orders` → `payments`.

**Pairs before/after** : 1 `OBSERVED_UNDECLARED` → 1 `DECLARED_AND_OBSERVED`.

### shared-cart -> payments
**Old direct import** : `public/boutique/js/b-share-cart.js -> public/boutique/js/b-checkout.js` (`makeInput`, `makeIntlPhoneInput`).

**Attention scope réel (mission §9)** : cette relation traverse le scope Boutique/frontend — pas de solution backend forcée.

**Découverte** : deux fonctions, deux origines réelles différentes :
- `makeInput` : réellement `payments` (déléguée à `b-checkout-render.js`), déjà exposée proprement en export ES nommé (pas un barrel). Dépendance légitime.
- `makeIntlPhoneInput` : PAS réellement `payments`. Le commentaire du code lui-même documente qu'elle a déjà été déplacée vers `b-phone.js` (auth-identity) pour casser un cycle antérieur (`b-checkout<->b-identity`), et n'était ré-exportée par `b-checkout.js` que « pour compatibilité ». `b-identity.js` (le vrai propriétaire) importe déjà directement depuis `b-phone.js` — précédent suivi.

**Boundary choisie** : `makeInput` reste `shared-cart -> payments` (légitime, inchangé). `makeIntlPhoneInput` : import corrigé dans `b-share-cart.js` pour venir directement de `b-phone.js` — nouvelle paire légitime `shared-cart -> auth-identity`, plus `shared-cart -> payments` pour cette fonction.

**internalApi exposée** : `payments` : `makeInput` (voir ci-dessus). `auth-identity` : `{ fn: 'makeIntlPhoneInput', file: 'public/boutique/js/b-phone.js' }` (nouveau, provider auth-identity n'avait pas encore de `contract.internalApi`).

**contract.consumes added** : `shared-cart` → `payments`, `shared-cart` → `auth-identity`.

**Pairs before/after** : 1 `OBSERVED_UNDECLARED` (`shared-cart -> payments`) → 1 `DECLARED_AND_OBSERVED` (`shared-cart -> payments`, pour makeInput) + 1 `DECLARED_AND_OBSERVED` nouvelle (`shared-cart -> auth-identity`, pour makeIntlPhoneInput).

---

## Synthèse

| Provider | Paires | Code changé ? | Résultat |
|---|---|---|---|
| loyalty | 5 | Oui — 2 fonctions extraites route→service | 5 déclarées |
| purchasing | 2 | Non — déjà propre | 2 déclarées |
| catalog | 1 | Oui — montage de router déplacé vers le composition root | **1 disparue** |
| economic-engine | 1 | Oui — import restreint à la fonction consommée | 1 déclarée |
| logistics | 1 | Non — déjà minimal | 1 déclarée |
| orders | 1 | Non — déjà minimal | 1 déclarée |
| payments/shared-cart | 2 | Oui — import `makeIntlPhoneInput` corrigé vers son vrai propriétaire | 2 déclarées (+1 nouvelle paire légitime shared-cart→auth-identity) |

**13 paires traitées, 0 restante.** `CROSS_FEATURE_DIRECT_IMPORT = 0`, `exceptions ledger = 0`.
