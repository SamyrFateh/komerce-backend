# Lots B/C — Refacto gros fichiers backend (I-BACK-2 / I-BACK-6)

> Date : 2026-06-28
> Branche de référence : `main`
> Objet : plan de découpage des fichiers > 800L et des engines logés dans `routes/`, suite à l'audit gates (`npm run backend:arch`)
> Gates concernées : I-BACK-2 (taille fichiers), I-BACK-6 (engines dans routes/)

---

## Constat de départ

`npm run backend:arch` est vert (exit 0, aucune violation bloquante), mais 11 avertissements connus subsistent, dont :

- 3 engines dans `routes/` (I-BACK-6) : `sourcing-engine.js`, `economic-engine.js`, `sourcing-scanner.js` — allowlistés, lots B1/B2 référencés en commentaire dans `scripts/audit-backend-arch.js`.
- 3 fichiers > 800L (I-BACK-2) **non catalogués** dans `ALLOWED_LARGE_FILES` : `routes/shared-cart.js` (990L), `services/dashboard-finance-metrics.js` (1065L), `services/radar-queries.js` (858L). Ils ont franchi le seuil après le snapshot du 2026-05-17 figé dans l'allowlist — le gate passe (warning, pas violation) mais c'est de la dette non documentée, pas de la dette tracée.
- Au-delà des warnings affichés, l'allowlist masque silencieusement une dizaine d'autres fichiers déjà > 800L (`shared-cart-engine.js`, `dashboard-metrics.js`, `collective-workspace-engine.js`, `notification-service.js`, `scan-engine.js`, `cost-allocation.js`, etc.) marqués « OK service » au moment de l'audit initial. Plusieurs ont grossi depuis (ex. `notification-service.js` : 814L → 963L).

Ce document découpe le travail restant en lots exécutables, avec rayon d'impact et niveau de risque réels (vérifiés sur le code, pas estimés).

---

## Lot B1 — sourcing (engines dans routes/) — ⚠️ correction de trajectoire

**Erreur dans la version précédente de ce document** : `docs/chantier/STATUS.md` indique explicitement « Lot B complet — tous les lots clôturés au 2026-06-23 ». `routes/sourcing-engine.js` (B1) et `routes/economic-engine.js` (B2) ont été inspectés à cette date, jugés déjà « façade mince acceptable », et clôturés **sans renommage**. Les commentaires `→ Lot B1 (priorité absolue)` dans `scripts/audit-backend-arch.js` étaient des reliquats non nettoyés après cette clôture — pas un TODO réel.

**Renommer `routes/sourcing-engine.js` → `routes/sourcing.js` aurait été une erreur** : le nom de fichier est repris en dur dans `bootstrap/api-routes.js`, mais aussi dans `docs/contract/openapi.json` (`x-route-file`, ~18 occurrences), `docs/META_GRAPH.json`, `docs/komerce-arch-header-graph.json`, les headers `@depends`/`@used-by` de plusieurs fichiers, `features/economic-engine.feature.js`, et `docs/SOURCING_ENGINE.md`. Ces artefacts sont générés/validés par tout un pipeline de gouvernance (`scripts/contract-generate.js`, `scripts/audit-komerce-arch-headers.js`, `scripts/apply-komerce-arch-headers.js`). Renommer aurait désynchronisé ce pipeline pour zéro gain fonctionnel — la seule chose en jeu est un warning non bloquant. **Décision : ne pas renommer, fait à la place :**

- Commentaires `scripts/audit-backend-arch.js` corrigés (L83-84, L203-211) : ne pointent plus vers un « Lot B1/B2 priorité » inexistant, référencent `STATUS.md §B1/B2`.
- Message du warning I-BACK-6 reformulé : « dette purement nominale », plus « à migrer ».

| Fichier | Lignes | Statut réel | Action faite |
|---|---|---|---|
| `routes/sourcing-engine.js` | 113 | Clôturé 2026-06-23 (STATUS.md), façade mince | Aucune — commentaires nettoyés seulement |
| `routes/sourcing-scanner.js` | 727 → **519** | Logique réelle trouvée et **extraite** : handler `POST /catalogs/import` (220 lignes) | ✅ **Fait** — voir détail ci-dessous |

### `sourcing-scanner.js` — extraction réalisée (2026-06-28)

Le handler `POST /catalogs/import` portait une vraie orchestration métier (upsert idempotent DSC-E1, verrou champs manuels DSC-E2, archivage full-snapshot DSC-E3) — ce n'était pas du simple dispatch, contrairement à ce que suggérait l'en-tête du fichier. Extraction iso-comportement vers `services/suppliers/catalog-import-orchestrator.js`, pattern `{ status, body }` (même convention que `sourcing-mutations.js`).

**Zéro test n'existait sur cette logique avant extraction.** 10 tests unitaires ajoutés (`tests/unit/catalog-import-orchestrator.test.js`), mocks `db`/`scanner`/`pricingEngine` façon `sourcing-analysis.test.js` : validation, erreur connecteur, création vs mise à jour idempotente, verrou champs manuels + journalisation événement, résilience par-produit (une erreur n'interrompt pas le batch), archivage full-snapshot (présent/absent).

Vérifié après coup :
- `node scripts/audit-backend-arch.js` → toujours 11 warnings, 0 violation, exit 0 (pas de régression).
- `npx jest tests/unit` → 919 passed, 0 failed (suite complète, pas seulement le nouveau fichier).

`routes/sourcing-scanner.js` reste nommé `*-scanner.js` (donc toujours listé en I-BACK-6) — par choix, pas par dette : la façade est maintenant fine, seul le nom trippe le gate, et renommer pose le même problème de blast radius que B1/B2 ci-dessus.

---

## Lot B2 — economic-engine — clôturé 2026-06-23, voir correction ci-dessus

Aucune action — `routes/economic-engine.js` (173L) est une façade mince acceptée depuis le 2026-06-23. Commentaires `audit-backend-arch.js` nettoyés en même temps que B1.



---

## Lot B7 — dette I-BACK-2 non cataloguée

| Fichier | Lignes | Lié à | Action |
|---|---|---|---|
| `services/radar-queries.js` | 858 | Standalone, seul appelant `routes/admin-radar.js` | À trier : soit allowlister avec un lot assigné, soit découper si croissance prévue |
| `routes/shared-cart.js` | 990 | C1 (voir Lot C) | Traité avec C1 |
| `services/dashboard-finance-metrics.js` | 1065 | C3 (voir Lot C) | Traité avec C3 — **vérifier le recoupement avant de spliter** |

---

## Lot C — services > 800L, par risque croissant

| # | Fichier | Lignes | Tests | Appelants | Risque |
|---|---|---|---|---|---|
| C1 | `shared-cart-engine.js` | 1278 | 7 | `routes/shared-cart.js`, `routes/shared-cart-from-order.js` | Faible |
| C2 | `notification-service.js` | 963 | 8 | 18 fichiers (routes + services) | Élevé — rayon d'impact |
| C3 | `dashboard-metrics.js` | 1081 | 0 | `routes/admin-dashboard.js` | Moyen — mécanique mais aveugle |
| C4 | `collective-workspace-engine.js` | 983 | 0 | `services/collective-stock-reservation-service.js` | Moyen |
| C5 | `cost-allocation.js` | 914 | 0 | `routes/admin-costing.js`, `services/customs-shipment-service.js` | Élevé — calcul financier sans test |
| C6 | `scan-engine.js` | 959 | 1 | `routes/parcel-api-v2/scans.js` | Élevé — état physique colis |

### C1 — `shared-cart-engine.js` (à traiter en premier, sert de gabarit)

Découpage naturel visible dans le code :
- création : `createSharedCartFromBasket`, `createSharedCartFromCartItems`, `clearCreatorBasketInTx`
- lecture : `getSharedCartForPublic`, `getSharedCartForOwner`, `listMySharedCarts`, `incrementViewCount`
- contributions : `startContribution`, `attachStripeSession`, `markContributionFailed`
- conversion / cycle de vie : `convertSharedCartToOrder` (**275 lignes à elle seule**, L790-1065), `closeCart`, `cancelSharedCart`, `runSharedCartStateMachineTick`, `expireOldCarts`

`routes/shared-cart.js` (990L, Lot B7) étant le seul appelant significatif, **traiter les deux fichiers dans le même lot**. Décomposer `convertSharedCartToOrder` en interne avant de déplacer quoi que ce soit entre fichiers.

### C2 — `notification-service.js` (rayon d'impact le plus large)

Découpage par canal déjà lisible : commande (`notifyOrderCreated/PaymentConfirmed/StatusChange/Cancellation`), colis (`notifyParcelScan/Created`), auth/OTP (`sendOtpMessage`, `sendMagicLink`), fidélité (`notifyLoyaltyEarned`).

Avec 18 appelants, garder `services/notification-service.js` comme **barrel** :
```js
module.exports = {
  ...require('./notifications/order'),
  ...require('./notifications/parcel'),
  ...require('./notifications/otp-auth'),
  ...require('./notifications/loyalty'),
};
```
C'est la seule façon de découper sans PR géant touchant les 18 fichiers appelants.

### C3 — `dashboard-metrics.js`

~35 getters quasi indépendants, groupables : CA/commandes, marge/coûts, logistique/scans, workspace collectif.

**Avant tout split** : vérifier le recoupement avec `services/dashboard-finance-metrics.js` (même domaine marge/coûts, Lot B7) — risque de logique dupliquée entre les deux fichiers. Zéro test → écrire des tests de caractérisation (snapshot par KPI) avant extraction.

### C4 — `collective-workspace-engine.js`

Même forme que C1 (cousin « collectif » du panier partagé) : tokens, CRUD workspace, items, contributions, finalisation (`finalizeWorkspace` = 218 lignes, à décomposer en interne aussi). À traiter après C1 pour réutiliser le découpage validé.

### C5 — `cost-allocation.js` (le plus sensible)

Verrouillage (`lockEstimatedCostsForOrder`), allocation réelle (`allocateShipmentRealCosts` = 194 lignes, `allocateParcelRealCosts`, `allocateMonthlyFixedCosts`, `allocateProductPurchaseCosts`), variance (`computeOrderCostVariance/ProductCostVariance`, `getOrderCostTruth`).

**Ne pas toucher sans tests de caractérisation d'abord** — calcul financier, 0 test, régression silencieuse coûteuse.

### C6 — `scan-engine.js`

Déjà bien structuré en interne (`processScan` orchestre 4 helpers privés : `_loadScanContext`, `_validateAndCatchup`, `_applyEvent`, `_finalizeAndLog`). Le sujet n'est pas la taille mais la couverture : 1 seul test pour un fichier qui gère l'état physique des colis.

**Priorité = ajouter des tests, pas découper.** Spliter sans filet ici serait le pire ROI du lot.

---

## Séquencement recommandé

1. B1 (renommage `sourcing-engine.js`) + B2 (renommage `economic-engine.js`) — gratuit, indépendant du reste.
2. C1 (`shared-cart-engine.js` + `routes/shared-cart.js`) — meilleure couverture, sert de gabarit de découpage.
3. B1 réel (extraction `catalogs/import` de `sourcing-scanner.js`).
4. C2 (`notification-service.js`, pattern barrel) — mécanique mais impact large, à isoler dans son propre PR.
5. Tests de caractérisation sur C3, C5, C6 avant toute extraction.
6. C4, puis split C3/C5 une fois les tests posés.
7. C6 reste en l'état (pas de split) jusqu'à couverture de tests suffisante.
8. B7 (`radar-queries.js`) à trier indépendamment — pas de dépendance avec le reste.

---

## Backlog non bloquant

| Lot | Nature |
|---|---|
| B (générique) | `parcel-api-v2.js`, `hub-dashboard.js`, `admin-radar.js`, `scans.js`, `admin-dashboard.js`, `purchasing.js` — allowlistés, pas de lot numéroté dédié |
| B3 | `routes/pricing.js` + `services/pricing-engine.js` |
| B4 | `routes/dashboard.js` (2614L) + `services/dashboard-metrics.js` (voir C3) |
| B5 | `routes/admin.js` (1207L) |
| B6 | `routes/pickup-secret.js` (1122L) |

---

## Recommandation de reprise

Avant de lancer C2 ou C5 :

1. exécuter `npm run backend:arch` pour confirmer l'état de référence ;
2. exécuter la suite Jest complète, noter le score de couverture actuel des 6 fichiers du Lot C ;
3. pour C3/C5/C6 : poser les tests de caractérisation **avant** tout déplacement de code, pas en parallèle.

Ce document n'est pas un engagement de delai — c'est un découpage du travail pour pouvoir l'attaquer par petits PR réversibles plutôt qu'en un seul gros chantier.
