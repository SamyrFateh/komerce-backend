# LOT O7.1 — Ownership Resolution Before Boundary Remediation — Livrable

> **O7.1 a supprimé l'ambiguïté d'ownership avant toute industrialisation des internal APIs. Les frontières restantes représentent désormais des dépendances réelles entre features correctement identifiées.**

Analyse complète dans `docs/O7_1_OWNERSHIP_ANALYSIS.md`, rédigée et committée **avant** toute modification de code (commit `e4872b2`), conformément à la règle §6 du prompt.

---

## 1. Baseline O6

Point de départ : `main` post-merge O6 (commit `b7cf561a`), extraction fraîche du repo.

```
94 OBSERVED_UNDECLARED
UNCLASSIFIED = 0
STALE = 0
REVIEW = 0
UNEXPLAINED_RUNTIME_CYCLE = 0
UNCOVERED_LOCAL_MANIFEST_GAP = 0
4 ownership-review : auth-identity->orders, platform-ops->economic-engine,
                      platform-ops->logistics, platform-ops->orders
```

Vérifié à l'identique avant toute action (`familySummary` 9/9/9/33/11/18/3/2, 22 exceptions, 4 cycles).

---

## 2. auth-identity -> orders

**Preuves** : `services/authkey-client.js -> services/invoice-public-token.js`. « AuthKey » est le nom du fournisseur tiers d'API WhatsApp (authkey.io) — collision de vocabulaire avec « auth » (authentification), pas une relation de domaine. Le fichier ne contient aucune ligne d'authentification : WID de templates order/payment/invoice/OTP, whitelist de staging, parsing de numéros internationaux, appels HTTP sortants vers authkey.io. 100 % de ses callers réels vivent dans `services/notifications/*`. Le manifest `auth-identity` déclare lui-même dans `perimeter.out` : *« auth-identity ne sait rien des commandes, paniers ou paiements »* — contredit directement par le contenu du fichier.

**Verdict** : `REHOME_CONSUMER`

**Remédiation** : Ownership de `services/authkey-client.js` + `tests/unit/authkey-client.test.js` déplacé de `auth-identity` vers `notifications` (Feature Cards uniquement, aucun déplacement physique du fichier — cohérent avec le précédent `services/whatsapp-meta.js`, déjà flat dans `services/` et possédé par `notifications`). Header `@komerce-arch` corrigé : `@domain auth-identity` → `@domain notification`, `@layer service` → `external-adapter`, `@impact-areas auth` → `whatsapp, otp, notifications, orders, invoices`.

**État O5/O6 après** : la paire `auth-identity -> orders` a disparu. Une nouvelle paire `notifications -> orders` (même evidence, `CROSS_FEATURE_DIRECT_IMPORT`) est apparue à sa place, ainsi qu'une paire miroir `orders -> notifications` (préexistante, `BUSINESS_TRANSVERSAL_SERVICE`) — les deux forment désormais un cycle runtime `notifications <-> orders`, qui **remplace** l'ancien cycle `auth-identity <-> notifications` (celui-ci a disparu : la direction `notifications -> auth-identity`, portée uniquement par `authkey-client.js`, n'existe plus ; `auth-identity -> notifications` — direction indépendante, via `routes/client-auth.js` — subsiste seule, hors cycle). Net O5 : 94 → 93 paires `OBSERVED_UNDECLARED` (−2 disparues : `auth-identity->orders`, `notifications->auth-identity` ; +1 apparue : `notifications->orders`).

---

## 3. platform-ops -> economic-engine

**Preuves** : `routes/modules.js -> services/pricing-engine.js`. `routes/modules.js` porte une ligne de produits sur-mesure distincte du catalogue (couture, lunettes, construction, cosmétiques) : CRUD actif `fabrics`/`garment_models`, registre de modules, calcul de prix propre pour la plupart des sous-cas. Il ne délègue à `pricingEngine.recommend()` que pour **un seul sous-cas** (`couture` / `custom_from_fabric`).

Découverte annexe : `platform-ops.feature.js` documente déjà, depuis le Lot O2 (`debt.knownGaps`), une ambiguïté **distincte et délibérément non tranchée** entre `platform-ops` et **`catalog`** sur ce même fichier — hors du périmètre de la question O7.1 posée ici (qui porte sur `economic-engine`).

**Verdict** : `OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED`

**Remédiation** : aucune modification de code. La dépendance vers `economic-engine` est réelle et légitime — `routes/modules.js` n'est pas un fichier `economic-engine` mal étiqueté. La dette `platform-ops` vs `catalog`, elle, reste explicitement hors scope (déjà trackée, déjà différée par une décision antérieure).

**État O5/O6 après** : paire inchangée, toujours `CROSS_FEATURE_DIRECT_IMPORT`. Ledger : décision `ownership-review` → `internal-api-required`.

---

## 4. platform-ops -> logistics

**Preuves** : `services/simulator/state-advancer.js -> services/parcel-operations.js`. Vérifié ligne par ligne : **aucune** écriture directe `UPDATE parcels SET status`. Toute transition de statut colis passe exclusivement par `require('../parcel-operations').transitionParcelStatus(db, parcel.id, targetStep, { skipValidation: true })`. Le fichier est exposé uniquement via une surface admin dédiée (`/api/simulator/*`), déjà documentée et acceptée comme invariant dans `platform-ops.feature.js` : *« le simulator écrit dans les tables d'autres features par design de simulation »*.

**Verdict** : `OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED`

**Remédiation** : aucune. Doctrine « WRITER != LIFECYCLE OWNER » strictement respectée — le simulateur déclenche mais ne possède jamais le lifecycle colis.

**État O5/O6 après** : paire inchangée, toujours `CROSS_FEATURE_DIRECT_IMPORT`. Ledger : `ownership-review` → `internal-api-required`.

---

## 5. platform-ops -> orders

**Preuves** : `services/simulator/state-advancer.js -> services/order-status-machine.js`. Même fichier consumer que le cas précédent, analysé séparément. **Aucune** écriture directe sur `orders.status` — toujours via `transitionOrderStatus()`. Deux écritures directes de `orders.payment_status` identifiées (action chaos `desync_payment`, intentionnellement conçue pour tester la résilience à un état désynchronisé ; et `confirmPayment`, avant délégation à `transitionOrderStatus`) — colonne déjà écrite directement par de nombreux autres services cross-feature dans le code existant (`admin-order-refund.js`, `cash-operations.js`, `create-stripe-order-intent.js`…), donc pas un lifecycle SSOT à propriétaire unique comme `status`.

**Verdict** : `OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED`

**Remédiation** : aucune.

**État O5/O6 après** : paire inchangée, toujours `CROSS_FEATURE_DIRECT_IMPORT`. Ledger : `ownership-review` → `internal-api-required`.

---

## 6. Files rehomed / split

| Fichier | Avant | Après | Type |
|---|---|---|---|
| `services/authkey-client.js` | `auth-identity` | `notifications` | rehome ownership (Feature Card uniquement, pas de déplacement physique) |
| `tests/unit/authkey-client.test.js` | `auth-identity` | `notifications` | rehome ownership (suit le fichier testé) |

Aucun split. Aucun fichier physiquement déplacé (le path `services/authkey-client.js` reste flat dans `services/`, cohérent avec `services/whatsapp-meta.js` déjà possédé par `notifications` au même niveau).

---

## 7. Ownership bridge changes

- `features/auth-identity.feature.js` : retrait de `services/authkey-client.js` (`files.services`) et `tests/unit/authkey-client.test.js` (`files.tests`), avec commentaire de traçabilité renvoyant vers `docs/O7_1_OWNERSHIP_ANALYSIS.md`.
- `features/notifications.feature.js` : ajout des deux mêmes entrées dans `files.services` / `files.tests`.
- `services/authkey-client.js` : header `@komerce-arch` corrigé (`@domain`, `@layer`, `@impact-areas`, `@version`), ajout d'un champ `@rehomed` documentant la décision O7.1.
- `docs/doctrine/APP_FEATURE_REGISTRY.md` : **non modifié** — la seule mention de `authkey-client.js` y est une note historique en prose (correction de domaine 2026-07-06, antérieure à O7.1), gelée par la doctrine anti-réécriture de l'historique déjà en vigueur dans ce repo (cf. Gate 5 `docs-history-lint`). La nouvelle décision est tracée par ce rapport, pas par une réécriture de l'historique.
- `docs/komerce-arch-header-graph.json` + `docs/KOMERCE_ARCH_HEADER_GRAPH.md` : régénérés par `arch:gate`, reflètent le changement de domaine du header (`notification` +1, `auth-identity` −1, edges +4). Changement légitime, gardé dans le commit.
- `docs/SECURITY_360.json` / `.md` : régénérés par un side-effect d'`arch:gate` (uniquement `generatedAt` change) — **exclus du commit**, hors scope, même traitement qu'en O6.

---

## 8. Runtime behavior preservation

Aucune ligne de logique métier modifiée dans `services/authkey-client.js`, `services/parcel-operations.js`, `services/order-status-machine.js`, `services/simulator/state-advancer.js`, `services/invoice-public-token.js`, `routes/modules.js`, `services/pricing-engine.js`. Seuls touchés : deux manifests (`files.*`) et un bloc de commentaire header.

Tests ciblés exécutés :

```
tests/unit/authkey-client.test.js              — 61 tests
tests/unit/notification-service.test.js
tests/unit/notification-internals.test.js
tests/notifications/*.test.js (5 fichiers)
                                                  → 114 passed, 0 failed (suite complète notifications)

tests/unit/state-advancer.test.js
tests/unit/simulator-engine.test.js
tests/unit/simulator-platform-ops.test.js
tests/unit/simulator-route.test.js
tests/unit/invoice-public-token.test.js
                                                  → 110 passed, 0 failed

tests/unit/client-auth.test.js                 → 19 passed, 0 failed
```

Total ciblé : **243 passed, 0 failed**. Suite complète (`npm test`) : **5945 passed / 5971 total** (13 skipped, 11 todo, 0 failed) — aucune régression.

---

## 9. O5/O6 before / after

| Métrique | Avant O7.1 | Après O7.1 |
|---|---|---|
| `OBSERVED_UNDECLARED` | 94 | **93** |
| `CROSS_FEATURE_DIRECT_IMPORT` | 18 | 18 (composition inchangée en nombre ; `auth-identity->orders` sorti, `notifications->orders` entré) |
| `ownership-review` | 4 | **0** |
| exceptions ledger | 22 | **21** |
| cycles runtime | 4 (`auth-identity<->notifications`, `logistics<->payments`, `logistics<->purchasing`, `payments<->wallet`) | 4 (`notifications<->orders` remplace `auth-identity<->notifications` ; les 3 autres inchangés) |
| `UNCLASSIFIED` | 0 | 0 |
| `STALE` | 0 | 0 |
| decisions ledger | `internal-api-required`×10, `boundary-to-break`×8, `ownership-review`×4 | `internal-api-required`×13, `boundary-to-break`×8, `ownership-review`×0 |

Aucune paire n'a été maintenue artificiellement pour préserver un chiffre — le ledger a suivi la réalité observée après régénération, exactement comme l'exige §9 du prompt.

---

## 10. Gate results

| Gate | Résultat |
|---|---|
| `npm run arch:gate` | ✔ vert |
| `npm run business-graph:gen` | ✔ 0 error, 154 warn (28 features) |
| `npm run business-graph:check` | ✔ reconstructible et à jour |
| `npm run business-graph:ratchet-check` | ✔ stable (réduction 94→93 même signalée explicitement par le ratchet comme resserrable) |
| `npm run business-graph:disposition-check` | ✔ `93 paires classées — UNCLASSIFIED=0, STALE=0, MISSING=0, ILLEGITIMATE=0, UNEXPLAINED_CYCLE=0, UNCOVERED_GAP=0, REVIEW=0` |
| `npm run meta:graph:check` | ✔ 0 nouvelle couture fantôme |
| `node scripts/business-graph-o5-negative-tests.js` | ✔ 11 passed |
| `node scripts/business-graph-o6-negative-tests.js` | ✔ 12 passed |
| `npm run map:check` (entrée O6 isolée) | ✔ gate O6 vert en position 9/17 |
| `npm test` | ✔ 5945/5971 (13 skipped, 0 failed) |

Déterminisme : génération x2, `docs/BUSINESS_FEATURE_GRAPH.json` / `.md` / `docs/O6_INVENTORY.md` identiques byte-for-byte.

---

## 11. Remaining boundary debt

`ownership-review = 0` — objectif de fin atteint. Ce qui reste ouvert (attendu, hors scope O7.1) :

- **18 `CROSS_FEATURE_DIRECT_IMPORT`** (dont `notifications -> orders`, nouveau) à découpler via internal API — traitement O7.2+.
- **4 cycles runtime** (`notifications<->orders`, `logistics<->payments`, `logistics<->purchasing`, `payments<->wallet`) à trancher définitivement (accepter / casser / rehome) — décisions de principe déjà posées dans le ledger (`boundary-to-break`), pas encore de remédiation de code.
- **3 dépendances `platform-ops -> {economic-engine, logistics, orders}`** : ownership confirmé, internal API encore à construire.
- **Dette `platform-ops` vs `catalog`** sur `routes/modules.js` : ambiguïté distincte, déjà documentée depuis le Lot O2, délibérément non rouverte par O7.1 (hors scope de la question posée).
- 0 remédiation de couplage effectuée — seul l'ownership a été corrigé pour 1 fichier sur 4 cas ; les 3 autres n'avaient pas besoin de correction.

---

## 12. Diffstat

Commit de départ (baseline O6 dans ce workspace) : `25eb213`. Diff strictement dans le scope O7.1 :

```
 docs/BUSINESS_FEATURE_GRAPH.json              | 255 ++++++++++----------------
 docs/BUSINESS_FEATURE_GRAPH.md                |  51 +++---
 docs/KOMERCE_ARCH_HEADER_GRAPH.md             |  12 +-
 docs/O6_INVENTORY.md                          |  26 ++-
 docs/O7_1_OWNERSHIP_ANALYSIS.md               | (nouveau, commité avant tout code)
 docs/komerce-arch-header-graph.json           |  78 +++++---
 features/auth-identity.feature.js             |   9 +-
 features/notifications.feature.js             |   7 +
 governance/feature-dependency-exceptions.json |  45 ++---
 services/authkey-client.js                    |  14 +-
 9 files changed, 240 insertions(+), 257 deletions(-)  (hors O7_1_OWNERSHIP_ANALYSIS.md, hors LOT_O7_1_LIVRABLE.md)
```

`docs/SECURITY_360.json` / `.md` explicitement exclus (side-effect de timestamp, hors scope).
