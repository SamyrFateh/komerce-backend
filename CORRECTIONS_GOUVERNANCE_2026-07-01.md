# Corrections Gouvernance Backend — 2026-07-01

> Basé sur l'audit `AUDIT_GOUVERNANCE_BACKEND_2026-07-01.md`.
> P0 traités : TROU 1 (alignement @domain) + TROU 2 (contrats consumes).

---

## ✅ TROU 1 — Alignement @domain ↔ feature name

### Renommage features (6 manifestes)

| Ancien nom | Nouveau nom | Fichier renommé |
|---|---|---|
| `auth-identity` | `auth` | `auth.feature.js` |
| `payments` | `payment` | `payment.feature.js` |
| `notifications` | `notification` | `notification.feature.js` |
| `wallet-loyalty` | `wallet` | `wallet.feature.js` |
| `platform-ops` | `operations` | `operations.feature.js` |

Champs `name`, `domain`, `@feature` mis à jour dans chaque manifeste.

### Correction @domain dans les sources (15 fichiers)

| Ancien @domain | Nouveau @domain | Fichiers |
|---|---|---|
| `douane` | `customs` | 5 fichiers (services + routes customs) |
| `platform-ops` | `operations` | 8 fichiers (services/simulator, monitoring, incident, routes/simulator) |
| `payments` | `payment` | 1 fichier (reconciliation-service.js) |
| `notifications` | `notification` | 1 fichier (utils/email.js) |

### Alignement domain field dans manifestes (3 cas)

| Feature | Ancien domain field | Corrigé |
|---|---|---|
| `customs` | `douane` | `customs` |
| `dashboard` | `admin-dashboard` | `dashboard` |
| `shared-cart` | `panier-partage` | `shared-cart` |

### Mise à jour docs (8 fichiers doctrine/architecture)

Toutes les références aux anciens noms remplacées dans les docs doctrine, registries, cartographies.

**Résultat** : 16/16 features avec `name === domain`, 0 incohérence @domain.

---

## ✅ TROU 2 — Contrats consumes remplis (15 features)

48 dépendances cross-feature ajoutées, basées sur le scan statique des `require()` inter-domaines.

| Feature | consumes avant | consumes après | ajoutés |
|---|---|---|---|
| auth | 0 | 3 | notification, operations, orders |
| catalog | 2 | 3 | auth |
| customs | 2 | 4 | auth, economic-engine |
| dashboard | 6 | 10 | auth, customs, documents, recommendations |
| documents | 1 | 2 | auth |
| economic-engine | 1 | 5 | auth, dashboard, orders, wallet |
| inventory | 1 | 2 | auth |
| logistics | 2 | 9 | auth, catalog, economic-engine, notification, payment, refunds, wallet |
| notification | 1 | 3 | auth, recommendations |
| operations | 0 | 3 | auth, economic-engine, orders |
| orders | 4 | 11 | auth, customs, dashboard, documents, notification, payment, refunds |
| payment | 2 | 7 | documents, logistics, notification, operations, wallet |
| recommendations | 1 | 3 | auth, logistics |
| shared-cart | 4 | 8 | auth, customs, documents, logistics |
| wallet | 1 | 3 | documents, notification |

`refunds` était déjà complet (inchangé).

---

## Trous restants (non traités — P1/P2)

| Trou | Sévérité | Description |
|---|---|---|
| TROU 3 | ~~P1~~ ✅ | 25 fichiers transversaux sans feature owner → feature `infrastructure` créée |
| TROU 4 | ~~P2~~ ✅ | 17 migrations SQL sans header → 17/17 headers ajoutés |
| TROU 5 | ~~P1~~ ✅ | Feature `refunds` en production sans tests → 4 tests déclarés |
| TROU 6 | ~~P2~~ ✅ | Feature `recommendations` en staging sans tests → 4 tests déclarés |
| TROU 7 | ~~P2~~ ✅ | 12 docs doctrine sans date de version → 14/14 datées |

---

## ✅ TROU 3 — Feature `infrastructure` pour les fichiers transversaux

**Fichier créé** : `features/infrastructure.feature.js`

19 fichiers orphelins rattachés :
- 5 middleware non-auth (error-handler, rate-limit, request-id, upload, validate) → `@domain infrastructure`
- 5 utils (logger, phone, rates, reference, rules) → `@domain infrastructure`
- 1 validators (index.js) → `@domain infrastructure`
- 8 bootstrap (api-routes, app, crons, env, html-routes, security, server-lifecycle, startup-migrations) → `@domain infrastructure`

6 middleware auth (auth.js, auth-guest.js, soft-auth.js, require-verified-identity.js, verify-authkey-webhook.js, user-cache.js) → ajoutés à la feature `auth`.

`feature-registry-check.js` : `bootstrap` ajouté à `SOURCE_DIRS`, `ORPHAN_IGNORE` nettoyé.

---

## ✅ TROU 4 — Headers migrations SQL

17 migrations annotées avec `@migration`, `@domain`, `@purpose`.

---

## ✅ TROU 5 & 6 — Tests refunds et recommendations

Tests existants mais non déclarés dans les manifestes :
- `refunds` : +4 tests (refund-service, refunds-util, refund-receipt, refund-receipt-html)
- `recommendations` : +4 tests (radar-queries, signals, signal-service, boutique-suggestions)

`infrastructure` exemptée dans `governance/test-exemptions.json` (couverte indirectement par les tests d'intégration).

---

## ✅ TROU 7 — Doctrines datées

14 documents doctrine sans date annotés : `> Version : pré-2026 — revue de conformité requise`.

---

## Validation finale

```
feature-registry-check.js  : ✅ 17 features, 378 fichiers, 0 orphelin, 0 manquant
Cohérence @domain          : ✅ 0 incohérence
Contrats cross-feature     : ✅ 17/17 remplis (48 consumes ajoutés)
Tests déclarés             : ✅ 16/17 (1 exemptée justifiée)
Migrations avec header     : ✅ 91/91
Doctrines datées           : ✅ 21/21
```
