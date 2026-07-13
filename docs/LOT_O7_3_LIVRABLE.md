# LOT O7.3 — Final Cross-Feature Boundary Remediation — Livrable

> **O7.3 a remplacé les imports cross-feature directs par des boundaries possédées par les features providers. Les dépendances métier restantes sont désormais explicites, déclarées et observables depuis la Feature Card jusqu'au code réel.**

Analyse complète par provider : `docs/O7_3_BOUNDARY_ANALYSIS.md`. Base : `main` post-O7.2 (13 exceptions `internal-api-required`, `CROSS_FEATURE_DIRECT_IMPORT = 13`).

---

## Métriques avant / après

| Métrique | Avant (O7.2) | Après (O7.3) |
|---|---|---|
| `OBSERVED_UNDECLARED` | 85 | **71** |
| `DECLARED_AND_OBSERVED` | 66 | **79** |
| `CROSS_FEATURE_DIRECT_IMPORT` | 13 | **0** |
| `BUSINESS_TRANSVERSAL_SERVICE` | 10 | 10 |
| `BUSINESS_FEATURE_INTERFACE` | 1 | 1 |
| exceptions ledger | 13 | **0** |
| runtime cycles | 0 | 0 |
| ownership-review | 0 | 0 |
| UNCLASSIFIED | 0 | 0 |
| STALE | 0 | 0 |
| MISSING | 0 | 0 |
| REVIEW | 0 | 0 |
| UNCOVERED_LOCAL_MANIFEST_GAP | 0 | 0 |

`DECLARED_NOT_OBSERVED = 0` — aucune déclaration prématurée ou fausse.

### Internal APIs added (exact)
- `economic-engine` : `{ fn: 'recommend', file: 'services/pricing-engine.js' }`
- `logistics` : `{ fn: 'transitionParcelStatus', file: 'services/parcel-operations.js' }`
- `orders` : `{ fn: 'transitionOrderStatus', file: 'services/order-status-machine.js' }`
- `purchasing` : `{ fn: 'triggerPurchasing', file: 'services/purchasing-trigger-service.js' }`, `{ fn: 'repairOrderedWithoutPurchaseOrders', file: 'services/repair-ordered-without-purchase-orders.js' }`
- `payments` : `{ fn: 'markPaid', file: 'services/payment-service.js' }`, `{ fn: 'markRefunded', file: 'services/payment-service.js' }`, `{ fn: 'makeInput', file: 'public/boutique/js/b-checkout.js' }`
- `auth-identity` : `{ fn: 'makeIntlPhoneInput', file: 'public/boutique/js/b-phone.js' }`
- `loyalty` : 6 fonctions déjà nommées dans `module.exports` (`handleOrderConfirmed`, `getUserLoyaltyStatus`, `getFinanceConfig`, `invalidateConfigCache`, `getLoyaltyDiscount`, `recalculateLoyalty`)

### contract.consumes added (exact, 15 entrées)
`economic-engine→loyalty`, `logistics→loyalty`, `orders→loyalty`, `payments→loyalty`, `shared-cart→loyalty`, `dashboard→purchasing`, `payments→purchasing`, `platform-ops→economic-engine`, `platform-ops→logistics`, `platform-ops→orders`, `orders→payments`, `shared-cart→payments`, `shared-cart→auth-identity`, `dashboard→purchasing` (formalisation), `payments→purchasing` (formalisation). (`dashboard→catalog` volontairement **absent** — la paire a disparu, ce n'était pas une vraie dépendance métier.)

### Direct imports removed (exact)
- `routes/loyalty.js` : plus aucun import cross-feature (2 fonctions extraites vers `services/loyalty-service.js`)
- `routes/purchasing.js`, `routes/scans.js` : déjà à 0 depuis O7.2
- `routes/admin/catalog-approval.js` : 0 import cross-feature (montage déplacé vers `bootstrap/api-routes.js`)
- `services/pricing-engine.js` : import restreint de whole-module à `{ recommend }`
- `public/boutique/js/b-checkout.js` : import restreint de `{ makeInput, makeIntlPhoneInput }` à `{ makeInput }` (makeIntlPhoneInput redirigée vers son vrai propriétaire)

### Providers treated (exact, 7)
loyalty, purchasing, catalog, economic-engine, logistics, orders, payments (incluant shared-cart comme second consumer traité séparément)

---

## Files rehomed / split

Aucun rehome de fichier, aucun split. Deux extractions de responsabilité (fonction, pas fichier) :

| Fichier | Changement |
|---|---|
| `routes/loyalty.js` | `getLoyaltyDiscount`, `recalculateLoyalty` retirées → `services/loyalty-service.js` |
| `routes/admin/index.js` | montage `catalog-approval` retiré → `bootstrap/api-routes.js` (composition root) |

---

## Runtime behavior preservation

Aucune assertion métier modifiée pour faire passer un refactor.

```
Provider loyalty  : 37 tests migrés/adaptés (loyalty-route.test.js -> loyalty-service.test.js)
                     + 98 tests de callers (mocks route -> service)
Provider purchasing/economic-engine/logistics/orders : 0 test touché (formalisation pure)
Provider catalog  : tests/unit/bootstrap-api-routes.test.js (nouveau mount asserté),
                     tests/unit/admin-facades-route.test.js vérifié inchangé (8/8)
Provider payments : tests/unit/b-share-cart-active-flows.test.js (mock makeIntlPhoneInput
                     déplacé vers le bloc b-phone.js)
```

Suite backend complète : **5961/5987** (13 skipped, 11 todo, 0 échec).
Suite boutique complète (jsdom, config séparée) : **1650/1650** (0 échec).

---

## Gate results

| Gate | Résultat |
|---|---|
| `npm run arch:gate` | ✔ vert |
| `npm run business-graph:gen` | ✔ 0 error, 130 warn (28 features) |
| `npm run business-graph:check` | ✔ reconstructible et à jour |
| `npm run business-graph:ratchet-check` | ✔ EXPECTED_TOPOLOGY 5/5, KNOWN_DEBT 30/30 stables |
| `npm run business-graph:disposition-check` | ✔ `71 paires — CROSS=0, UNCLASSIFIED=0, STALE=0, MISSING=0, ILLEGITIMATE=0, UNEXPLAINED_CYCLE=0, UNCOVERED_GAP=0, REVIEW=0` |
| `npm run meta:graph:check` | ✔ 0 nouvelle couture fantôme |
| `node scripts/business-graph-o5-negative-tests.js` | ✔ 11 passed |
| `node scripts/business-graph-o6-negative-tests.js` | ✔ 12 passed |
| `npm run map:check` (entrée O6 isolée) | ✔ gate O6 vert en position 9/17 |
| `npm test` (backend) | ✔ 5961/5987 |
| `npm test` (boutique, config séparée) | ✔ 1650/1650 |

Déterminisme : génération x2, `docs/BUSINESS_FEATURE_GRAPH.json` / `.md` / `docs/O6_INVENTORY.md` identiques byte-for-byte.

---

## Remaining architectural debt

Aucune — les 13 paires `internal-api-required` héritées d'O6/O7.1/O7.2 sont toutes traitées :
- 12 déclarées via `contract.consumes` avec une boundary provider propre (`internalApi` formalisée ou déjà minimale)
- 1 disparue entièrement (`dashboard→catalog`, n'était jamais une vraie dépendance métier)

`tracking` reste, comme prévu (§20), un flux `localManifestGap` séparé, couvert par le registre ontologique — non traité ici, non transformé en feature.

Aucune Feature 360 construite (§21, hors scope, prochain lot).

---

## Diffstat

Commit de départ (baseline O7.2 dans ce workspace) : `3312f31`. 7 commits (un par provider) + le rapport final. Diff cumulé, strictement dans le scope O7.3, `docs/SECURITY_360.*` et `public/boutique/package-lock.json` explicitement exclus (side-effects hors scope) :

```
32 files changed, 649 insertions(+), 792 deletions(-)

features/*.feature.js (7)                          — contract.internalApi + consumes
governance/feature-dependency-exceptions.json       — 13 -> 0 entrées
routes/loyalty.js                                   — 2 fonctions retirées
services/loyalty-service.js                         — 2 fonctions ajoutées
routes/orders/{create,status}.js                    — imports redirigés
services/{scan-operations,verify-qr-collection}.js  — imports redirigés
routes/modules.js                                   — import restreint (recommend)
bootstrap/api-routes.js                             — mount catalog-approval ajouté
routes/admin/index.js                               — mount catalog-approval retiré
public/boutique/js/b-share-cart.js                  — import makeIntlPhoneInput corrigé
tests/unit/*.test.js (9 fichiers)                    — mocks mis à jour, coverage migrée
public/boutique/tests/unit/b-share-cart-active-flows.test.js — mock déplacé
docs/O7_3_BOUNDARY_ANALYSIS.md, docs/LOT_O7_3_LIVRABLE.md    — (nouveaux)
docs/BUSINESS_FEATURE_GRAPH.json/.md, docs/O6_INVENTORY.md   — régénérés
```
