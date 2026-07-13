# LOT O7.2 — Runtime Cycle Resolution — Livrable

> **O7.2 a remplacé les dépendances bidirectionnelles implicites par des directions de workflow explicites. Les interactions restantes suivent désormais l'ownership réel des décisions métier.**

Analyse complète cycle par cycle : `docs/O7_2_CYCLE_ANALYSIS.md`. Base : `main` post-O7.1 (`ownership-review = 0`, 4 cycles runtime).

---

## 1. Baseline

```
94 -> 93 (O7.1) OBSERVED_UNDECLARED
4 cycles runtime : notifications<->orders, logistics<->payments,
                   logistics<->purchasing, payments<->wallet
ownership-review = 0
```

Vérifiée à l'identique en entrée de ce lot (aucune divergence avec les artefacts O7.1).

---

## 2. Résolution cycle par cycle

Traités dans l'ordre recommandé (§12) : A (notifications↔orders) → C (logistics↔purchasing) → B (logistics↔payments) → D (payments↔wallet). Détail complet des preuves, workflows et rationales : `docs/O7_2_CYCLE_ANALYSIS.md`.

### Cycle A — notifications ↔ orders
`notifications -> orders` supprimée (`REPLACE_WITH_INTERNAL_API`) : `services/invoice-service.js` (orders) construit et envoie désormais lui-même le message "facture prête", via la direction déjà saine `orders -> notifications`. Corrige au passage un bug dormant réel (chemin `require()` cassé, jamais exécuté en production, masqué par un mock virtuel en test).

### Cycle C — logistics ↔ purchasing
Anomalie prioritaire corrigée d'abord : les deux directions traversaient des fichiers ROUTE utilisés comme fausses APIs internes (`routes/purchasing.js`, `routes/scans.js`, simples ré-exports "de compatibilité"). Redirigées vers les vrais services déjà existants (`services/purchasing-trigger-service.js`, `services/scan-operations.js`). Les deux directions sont deux workflows métier distincts et non circulaires (collecte cash → réappro ; réception hub → scan+notif) : `KEEP_AS_COMMAND_DEPENDENCY` ×2, déclarées via `contract.consumes`.

### Cycle B — logistics ↔ payments
Même anomalie prioritaire côté `payments -> logistics` (routes `pickup-secret.js` utilisée en fausse API interne). Découverte : `services/pickup-secret-service.js` (logistics) existait déjà, complet et testé, mais n'était jamais câblé — `routes/pickup-secret.js` gardait 4 fonctions dupliquées en local. Basculé vers le service existant. Les deux directions : `KEEP_AS_COMMAND_DEPENDENCY` ×2, déclarées.

### Cycle D — payments ↔ wallet
Aucun changement de code : les deux boundaries étaient déjà propres (HTTP légitime pour la lecture de solde ; séparation de responsabilités déjà documentée dans le code — commentaire `D-02` — pour la finalisation transactionnelle). `KEEP_AS_COMMAND_DEPENDENCY` ×2, déclarées.

---

## 3. Files rehomed / split

Aucun rehome, aucun split. Une seule extraction de responsabilité (`REHOME_RESPONSIBILITY`, implicite dans la découverte de service déjà existant, Cycle B) :

| Fichier | Changement |
|---|---|
| `routes/pickup-secret.js` | 4 fonctions dupliquées retirées (`generatePickupCode`, `hashCode`, `generateAndStoreSecret`, `cacheCodeForReveal`) — délègue désormais à `services/pickup-secret-service.js` (déjà existant, déjà testé, jamais câblé avant ce lot) |
| `services/authkey-client.js` | Code mort retiré (`extractFirstUrl`, `looksLikeInvoiceMessage`, `toPublicInvoiceUrl`, `notifyInvoiceReady`, `USE_INVOICE_READY_TEMPLATE`) — zéro appelant réel confirmé par grep |
| `services/notifications/order.js` | Bloc facture retiré de `notifyPaymentConfirmed` (redevient une simple notification "paiement confirmé") |
| `services/invoice-service.js` | +1 méthode (`sendInvoiceReadyNotification`) |

---

## 4. Ownership bridge changes (contract.consumes)

8 déclarations ajoutées, dans 4 manifests, toutes vérifiées `resolved: true` après génération :

| Manifest | Entrée ajoutée |
|---|---|
| `features/purchasing.feature.js` | `logistics (déclenche scan préparation + notif client après réception hub complète)` |
| `features/logistics.feature.js` | `purchasing (déclenche vérification/réappro après collecte cash relais)` |
| `features/logistics.feature.js` | `payments (marque commande payée ; confirme paiement cash pickup)` — + correction bug `payment`→`payments`, `notification`→`notifications` (singulier jamais résolu, pré-existant) |
| `features/payments.feature.js` | `logistics (génération code retrait pickup ; lecture statut agrégé colis)` |
| `features/payments.feature.js` | `wallet (checkout consulte le solde via /api/wallet)` |
| `features/wallet.feature.js` | `payments (finalise le paiement, transactionnel, D-02)` |

---

## 5. Ownership bridge — imports corrigés (route → vrai service)

| Fichier | Avant | Après |
|---|---|---|
| `routes/pickup-secret.js` | définitions locales dupliquées | `require('../services/pickup-secret-service')` |
| `routes/pickup-pay-cash.js` | `require('./pickup-secret')` | `require('../services/pickup-secret-service')` |
| `services/payment-paypal.js` | `require('../routes/pickup-secret')` | `require('./pickup-secret-service')` |
| `services/payment-stripe.js` | `require('../routes/pickup-secret')` | `require('./pickup-secret-service')` |
| `routes/pickup-secret.js` | `require('./purchasing').triggerPurchasing` | `require('../services/purchasing-trigger-service')` |
| `routes/payments.js` | `require('./purchasing').triggerPurchasing` | `require('../services/purchasing-trigger-service')` |
| `services/purchasing-receive-service.js` | `require('../routes/scans').triggerScan3` | `require('./scan-operations')` |

---

## 6. Runtime behavior preservation

Aucune assertion modifiée pour faire passer un refactor. Tests ciblés exécutés à chaque étape (voir commits individuels) :

```
Cycle A : 48 (authkey-client) + 24 (order-notification) + 16 (invoice-service, 5 nouveaux)
        + 112 (4 call sites payment-cash-confirm/payment-stripe/cash-route/order-api-v2)
Cycle C : 74 (purchasing-route, scans, payments-webhook, repair-ordered-without-purchase-orders)
        + 7 (purchasing-receive-service, mock corrigé)
Cycle B : 170 (payment-paypal, payment-stripe, payments-webhook, pickup-secret,
        pickup-pay-cash, pickup-secret-service)
Cycle D : 0 fichier de test touché (aucun changement de code)
```

Suite complète (`npm test`) exécutée après chaque cycle — verte à chaque étape. HTTP contracts, status codes, effets DB, idempotence, transactions et notifications émises strictement préservés (aucune fonction métier réécrite — uniquement des chemins d'import corrigés et une responsabilité déplacée avec le code repris à l'identique).

---

## 7. O5/O6 before / after

| Métrique | O7.1 (avant) | O7.2 (après) |
|---|---|---|
| `OBSERVED_UNDECLARED` | 93 | **85** |
| `CROSS_FEATURE_DIRECT_IMPORT` | 18 | **13** |
| `BUSINESS_TRANSVERSAL_SERVICE` | 11 | **10** |
| `BUSINESS_FEATURE_INTERFACE` | 3 | **1** |
| exceptions ledger | 21 | **13** |
| runtime cycles | 4 | **0** |

`contract.consumes` ajoutés (exact, 8) : voir §4. Internal APIs ajoutées : aucune nouvelle interface formelle créée — les boundaries existaient déjà ou ont été redirigées vers des services déjà existants (§5). Domain events ajoutés : aucun (pas de mécanisme événementiel autoritaire préexistant à réutiliser ; le fire-and-forget direct reste le pattern en vigueur, cohérent avec le reste du code).

---

## 8. Gate results

| Gate | Résultat |
|---|---|
| `npm run arch:gate` | ✔ vert |
| `npm run business-graph:gen` | ✔ 0 error, 144 warn (28 features) |
| `npm run business-graph:check` | ✔ reconstructible et à jour |
| `npm run business-graph:ratchet-check` | ✔ EXPECTED_TOPOLOGY 5/5, KNOWN_DEBT 30/30 stables |
| `npm run business-graph:disposition-check` | ✔ `85 paires — UNCLASSIFIED=0, STALE=0, MISSING=0, ILLEGITIMATE=0, UNEXPLAINED_CYCLE=0, UNCOVERED_GAP=0, REVIEW=0` |
| `npm run meta:graph:check` | ✔ 0 nouvelle couture fantôme |
| `node scripts/business-graph-o5-negative-tests.js` | ✔ 11 passed |
| `node scripts/business-graph-o6-negative-tests.js` | ✔ 12 passed |
| `npm run map:check` (entrée O6 isolée) | ✔ gate O6 vert en position 9/17 |
| `npm test` | ✔ 5941/5967 (13 skipped, 11 todo, 0 failed) |

Déterminisme : génération x2, `docs/BUSINESS_FEATURE_GRAPH.json` / `.md` / `docs/O6_INVENTORY.md` identiques byte-for-byte.

---

## 9. Remaining boundary debt

- **13 `CROSS_FEATURE_DIRECT_IMPORT`** restants (réduits de 18) — imports directs cross-feature encore à découpler via internal API, hors scope O7.2 (traitement O7.3+).
- **0 cycle runtime** — objectif de fin atteint sans aucun cycle accepté par doctrine.
- Les 8 nouvelles déclarations `contract.consumes` sont des consommations réelles déjà en production ; elles ne créent aucune nouvelle dette, elles gouvernent une dette déjà existante et invisible.
- `services/pickup-secret-service.js` a désormais des consommateurs réels en dehors de `logistics` (payments) — sa surface publique (`generateAndStoreSecret`, `cacheCodeForReveal`) est de fait devenue une internal API multi-feature ; formaliser cette reconnaissance dans `contract.internalApi` du manifest `logistics` reste à faire (non bloquant, non fait ici pour rester dans le scope strict de la mission).
- Aucune remédiation supplémentaire des 13 imports directs restants n'a été tentée — hors mandat de ce lot.

---

## 10. Diffstat

Commit de départ (baseline O7.1 dans ce workspace) : `56324a3`. 4 commits intermédiaires (un par cycle) + le rapport final. Diff cumulé, strictement dans le scope O7.2 :

```
 features/logistics.feature.js                 |   5 +-
 features/payments.feature.js                  |   2 +
 features/purchasing.feature.js                |   1 +
 features/wallet.feature.js                    |   1 +
 governance/feature-dependency-exceptions.json  |  77 ------
 routes/cash.js                                 |   3 +
 routes/order-api-v2.js                         |   3 +
 routes/payments.js                             |   6 +-
 routes/pickup-pay-cash.js                      |   4 +-
 routes/pickup-secret.js                        | 161 +------
 services/authkey-client.js                     |  81 ++---
 services/invoice-service.js                    |  52 +++
 services/notifications/order.js                |  41 +--
 services/payment-cash-confirm.js               |   4 +
 services/payment-paypal.js                     |   4 +-
 services/payment-stripe.js                     |   7 +-
 services/purchasing-receive-service.js         |  10 +-
 tests/unit/*.test.js (14 fichiers)              | ~330 +/-
 docs/O7_2_CYCLE_ANALYSIS.md                    | (nouveau)
 docs/LOT_O7_2_LIVRABLE.md                      | (nouveau)
 docs/BUSINESS_FEATURE_GRAPH.json/.md,
 docs/O6_INVENTORY.md,
 docs/komerce-arch-header-graph.json/.md         | régénérés
```

`docs/SECURITY_360.json` / `.md` explicitement exclus (side-effect de timestamp, hors scope, même traitement qu'O6/O7.1).
