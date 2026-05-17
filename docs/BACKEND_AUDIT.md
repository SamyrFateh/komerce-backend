# Komerce Backend — Audit profond
> Date : 2026-05-16 · Cible : 58 458 lignes JS (hors public/), 76 routes, 17 services, 53 migrations
> Méthodologie : analyse statique, mesure quantitative, vérification d'invariants

---

## TL;DR — Score général

| Dimension | Score | Constat |
|---|---|---|
| Architecture modulaire | 🟠 6/10 | Routes/services proprement séparés mais 20 god-objects (>800 lignes) |
| Couverture tests | 🔴 2/10 | 1 286 lignes de test pour 58 458 lignes de code = **2,2 %** |
| Invariants protégés | 🟢 8/10 | `order-status-machine.js` exemplaire, à généraliser |
| Sécurité SQL | 🟢 9/10 | 7 queries non-paramétrées seulement, toutes légitimes |
| Logs / observabilité | 🟠 5/10 | 112 `console.log` traînants, pas de logger structuré centralisé |
| Cohérence DB | 🟡 5/10 | 2 dossiers `migrations/`, collisions `060.sql`/`061.sql`, "schema reconciliation" laisse présager dérive |
| Gouvernance | 🟡 5/10 | Très riche mais incohérente (`.cursorrules` ≠ `AGENTS.md`) et fragile (cf. boutique) |
| Duplication fantômes | 🔴 4/10 | Fichiers dupliqués chargés ou non (`order-api-v2.js` ×2, `parcels.js` ×2) |

**Verdict global** : le code est **fonctionnellement riche et structurellement plus mûr que je ne le craignais**. Il y a un cœur sain (order-status-machine, séparation routes/services pour les modules récents). Mais la dette s'accumule de manière classique : god-objects qui grossissent, modules qui auraient dû être services qui restent dans `routes/`, duplications de fichiers de transition mal nettoyés.

**La bonne nouvelle** : la méthode "audit normatif + LIVE généré + garde-fou exécutable" qu'on a appliquée au CSS se transpose directement. Et tu as déjà la moitié du chemin fait (gouvernance écrite, gardien des statuts).

---

## 1. Photo brute du code

### 1.1 Volumétrie

```
58 458 lignes JS au total (hors public/)
├── routes/        32 377 lignes (55 %)   ← 76 fichiers
├── services/      16 537 lignes (28 %)
├── utils/          2 672 lignes
├── server.js       1 200 lignes
├── tests/          1 286 lignes (2,2 % du code)
├── middleware/       974 lignes
├── validators/       750 lignes
└── core/             117 lignes
```

**Lecture clé** : 55 % du code dans `routes/` est anormal. Une route devrait être un fichier mince qui valide, appelle un service, formate la réponse. Quand routes/ > services/, ça veut dire que **la logique métier est dans les contrôleurs**.

### 1.2 Les 20 god-objects (≥ 800 lignes)

| Fichier | Lignes | Diagnostic |
|---|---:|---|
| `routes/dashboard.js` | 2 614 | 🔴 Le pire — à éclater impérativement |
| `services/pricing-engine.js` | 1 483 | 🟠 Service métier complexe, à découper |
| `routes/pricing.js` | 1 316 | 🟠 Logique métier dans la route |
| `routes/parcel-api-v2.js` | 1 299 | 🟠 v2 = ancienne migration figée |
| `routes/admin.js` | 1 207 | 🟠 |
| `server.js` | 1 200 | 🟠 Bootstrap + 26 routes inline |
| `routes/pickup-secret.js` | 1 122 | 🟠 |
| `services/dashboard-metrics.js` | 1 052 | 🟠 |
| `services/shared-cart-engine.js` | 1 037 | 🟢 Service mais énorme — découper si extension prévue |
| `routes/hub-dashboard.js` | 1 015 | 🟠 |
| `services/collective-workspace-engine.js` | 965 | 🟢 idem |
| `routes/sourcing-engine.js` | 960 | 🔴 **Cible business explicite** — métier dans route |
| `services/collective-payment-orchestrator.js` | 942 | 🟢 idem |
| `services/cost-allocation.js` | 918 | 🟢 idem |
| `routes/admin-radar.js` | 894 | 🟠 |
| `services/scan-engine.js` | 872 | 🟢 |
| `routes/scans.js` | 835 | 🟠 |
| `services/notification-service.js` | 814 | 🟢 |
| `routes/economic-engine.js` | 808 | 🔴 Même problème que sourcing-engine |

**Patron récurrent** : tout fichier `routes/X-engine.js` est un **service déguisé en route**. Les "engines" devraient vivre dans `services/`, la route ne fait qu'exposer.

### 1.3 Architecture par couches

Ce qui est fait correctement :
- `services/order-status-machine.js` = gardien unique des statuts ✅
- `routes/orders.js` (42 lignes) = agrégateur mince qui éclate en `routes/orders/{create,list,detail,cancel,parcels,qr,status}.js` ✅
- `services/suppliers/` avec base + 3 connecteurs (CSV, manual, noon) ✅
- `middleware/` propre (auth, validate, rate-limit, error-handler) ✅
- 45 routes utilisent `validate()` middleware ✅

Ce qui ne suit pas le pattern :
- Le pattern "routes/X.js → routes/X/" n'a été appliqué que sur `orders/`. Tous les autres god-objects (`dashboard.js`, `admin.js`, `pricing.js`...) sont restés monolithiques.
- `routes/sourcing-engine.js`, `routes/economic-engine.js`, `routes/sourcing-scanner.js` portent leur logique métier dans la route, avec 31 requêtes DB inline pour sourcing-engine seul.

---

## 2. Points critiques — à traiter en priorité

### 2.1 🔴 CRITIQUE — Doublons de fichiers actifs vs fantômes

```
routes/order-api-v2.js          (28 153 octets, monté dans server.js)
routes/orders/order-api-v2.js   (23 644 octets, NON monté — fantôme)
                                Diff : encodage BOM/latin-1 vs UTF-8

routes/parcels.js               (21 853 octets)
routes/orders/parcels.js        (28 291 octets — plus gros, plus récent)
                                Diff : à vérifier lequel est chargé
```

**Risque** : une PR modifie l'un, le runtime utilise l'autre, le bug se déplace.
**Action** : identifier le fichier de référence, supprimer l'autre, mettre un test
qui empêche la régénération de doublons (audit-arch côté backend).

### 2.2 🔴 CRITIQUE — `migrations/` × 2

```
db/migrations/   : 10 fichiers, numérotés 004 → 013
migrations/      : 53 fichiers, numérotés 014 → 065
+ collision : 060.sql ET 060_add_pending_at_confirmed_at.sql
+ collision : 061.sql ET 061_boutique_categories.sql
```

**Risque** : si le runner de migration tape sur les deux dossiers (ou un seul mais pas le bon), des migrations sont sautées ou rejouées. La migration `018_schema_reconciliation.sql` suggère que c'est déjà arrivé.

**Action** :
1. Identifier quel dossier est lu par le runner (probablement `db.js` ou `scripts/`)
2. Fusionner les deux ou archiver le mort
3. Renommer les collisions 060/061 pour les rendre uniques
4. Ajouter un audit qui plante si collision détectée

### 2.3 🟠 Routes anormalement longues : 6 fichiers à découper

Tous suivent le même anti-pattern : monolithe avec helpers + handlers + requêtes DB.
Cible : ramener chacun à ~300 lignes max via découpage en services.

| Fichier | Cible refacto |
|---|---|
| `routes/dashboard.js` 2614 | → services/dashboard-{metrics,pilotage,stats}.js |
| `routes/sourcing-engine.js` 960 | → services/sourcing/{analyzer,reader,enricher}.js |
| `routes/economic-engine.js` 808 | → services/economic-engine.js |
| `routes/pricing.js` 1316 | → s'appuie sur pricing-engine, éclater par cas d'usage |
| `routes/admin.js` 1207 | → routes/admin/{rules,products,users,reset,...} |
| `routes/pickup-secret.js` 1122 | → services/pickup-secret-service.js |

### 2.4 🔴 Tests : 2,2 % de couverture

Pour un backend qui gère paiement Stripe + cash + collectif + stock, c'est très bas.

État actuel (5 fichiers, 1 286 lignes) :
- `tests/unit/order-status-machine.test.js` (306 l) ✅ exemplaire
- `tests/unit/validators.test.js` (254 l) ✅
- `tests/unit/wallet-service.test.js` (206 l) ✅
- `tests/parcelOptimization.test.js` (309 l)
- `tests/integration/api.test.js` (211 l) — 6 endpoints couverts
- `test_groupe_paiement.js` à la racine (10 KB) — **orphelin hors structure tests/**

**Manquent** :
- Tests pricing-engine (1 483 lignes de logique métier non couvertes)
- Tests shared-cart-engine (1 037 lignes)
- Tests collective-workspace-engine + collective-payment-orchestrator (1 907 lignes)
- Tests cost-allocation (918 lignes)
- Tests sourcing-engine
- Tests Stripe webhooks (route critique)

### 2.5 🟠 Gouvernance IA — incohérences

Tu as **deux fichiers de gouvernance IA** qui se réfèrent à des sources de vérité différentes :

- `.cursorrules` → pointe vers `docs/AGENT_CONFIG.md`, `docs/ROADMAP_KOMERCE.md`, `docs/CARTOGRAPHY_360.md`, `docs/AUDIT_REPORT.md`
- `AGENTS.md` → pointe vers `docs/README.md`, `docs/ZONE_IMPACT.md`, `docs/BOUTIQUE_ARCHITECTURE.md`

Aucune des deux ne référence l'autre. Si un agent tombe sur l'un, il ignore l'autre.

**Risque** : exactement ce qu'on a vécu avec `BOUTIQUE_COMPONENT_OWNERSHIP.md` — la doc parle mais le code ne s'aligne pas (et personne ne sait quelle version est la vérité).

### 2.6 🟠 112 `console.log` en prod

Pas de logger structuré utilisé partout. `utils/logger.js` existe (130 lignes, basé sur `pino` d'après le package.json) mais 112 `console.log/debug` traînent dans `routes/`, `services/`, etc.

**Risque** : bruit logs, perte d'info structurée, potentielle fuite de données sensibles (montant Stripe, email user...).

### 2.7 🟡 435 handlers `async` dans routes/

Tu as 435 `async (req, res) => {` dans `routes/`. Beaucoup wrappent en try/catch, mais une route comme `routes/orders.js` montre **0 try/catch** (faux positif : c'est un agrégateur, les handlers sont dans les sous-routes). Pas de problème majeur global, mais à vérifier au cas par cas que **toute Promise non gérée** est attrapée par le middleware `error-handler`.

---

## 3. Focus sourcing & offre — cible business explicite

### 3.1 Architecture sourcing actuelle

```
routes/sourcing-engine.js    (960 l) ← MOTEUR MÉTIER DANS UNE ROUTE
routes/sourcing-scanner.js   (593 l) ← idem
services/supplier-catalog-scanner.js  (295 l)
services/suppliers/
  ├── normalized-product.js (89 l)
  └── connectors/
      ├── api-connector.base.js  (157 l)
      ├── manual-connector.js     (95 l)
      ├── csv-connector.js       (172 l)
      └── noon-connector.js       (81 l)
```

### 3.2 Anti-pattern observé

`routes/sourcing-engine.js` se proclame "moteur" dans son en-tête mais vit dans `routes/`. Il contient :
- 8 routes (lignes 459-791)
- **7 fonctions métier inline** (`analyzeProduct`, `loadSourcingConfig`, `getSales30d`, etc.)
- **31 requêtes DB**
- Helpers de normalisation (cost_kmf/cost_price_kmf, weight_kg/weight_g)
- Connexion à `finance_config` (seuils variabilisés)

Le moteur est **invisible côté tests** (0 test sur sourcing), et **invisible côté réutilisation** (impossible de l'invoquer hors HTTP).

### 3.3 Refacto cible sourcing (proposition)

```
services/sourcing/
  ├── analyzer.js         (analyzeProduct + getSales30d)
  ├── reader.js           (loadSourcingConfig + lecture portefeuille)
  ├── enricher.js         (PUT metadata, bulk-rail)
  ├── variants.js         (Vague 3)
  └── normalizer.js       (helpers cost/weight)

routes/admin/sourcing.js  (mince — 8 handlers de ~30 lignes chacun)
                          → appelle services/sourcing/*

tests/unit/sourcing/
  ├── analyzer.test.js    (15-20 tests)
  ├── reader.test.js
  └── enricher.test.js
```

**Bénéfices** :
- Testabilité (on peut tester `analyzeProduct` sans mocker HTTP)
- Réutilisation (un job batch peut appeler `analyzer.analyze()` directement)
- Lisibilité (routes/admin/sourcing.js à ~200 lignes au lieu de 960)
- Découplage (la "philosophie" du moteur — finance_config, seuils — est isolée du transport HTTP)

### 3.4 Offre propre — état actuel

Ton offre repose sur :
- `services/pricing-engine.js` (1 483 lignes) — moteur de pricing
- `services/cost-allocation.js` (918 lignes) — allocation des coûts réels
- `routes/economic-engine.js` (808 lignes) — encore un "engine" dans route
- `migrations/036_finance_config_unification.sql` — config unifiée
- `migrations/043_cost_components.sql` + 050/051 — imputations et allocations

C'est cohérent comme stack — clairement réfléchi. Mais **economic-engine devrait être dans services/**, comme sourcing-engine. Et `pricing-engine.js` à 1 483 lignes mérite d'être éclaté par responsabilités (rules vs computation vs benchmarks vs history).

---

## 4. Recommandations stratégiques

### 4.1 Plan de refacto en 6 lots (ordre suggéré)

**Lot 1 — Nettoyage des fantômes (1-2 jours, zéro risque)**
- Supprimer `routes/orders/order-api-v2.js` (le fantôme non chargé)
- Identifier et supprimer le doublon de `parcels.js`
- Déplacer `test_groupe_paiement.js` → `tests/integration/groupe-paiement.test.js`
- Nettoyer les 14 TODO en les transformant en issues GitHub
- **Livrable** : zéro fichier mort, `git status` propre conceptuellement

**Lot 2 — DB migrations (2-3 jours)**
- Identifier le runner de migrations
- Fusionner ou archiver `db/migrations/`
- Renommer les collisions `060.sql` et `061.sql`
- Ajouter un test qui plante si collision
- **Livrable** : un seul dossier `migrations/`, numérotation propre

**Lot 3 — Extraction des moteurs hors routes (5-7 jours, plus gros bénéfice)**
- `routes/sourcing-engine.js` → `services/sourcing/` (cible business !)
- `routes/economic-engine.js` → `services/economic-engine.js`
- `routes/dashboard.js` → `services/dashboard/`
- **Livrable** : routes/ devient mince, services/ devient le cœur testable

**Lot 4 — Tests des moteurs extraits (4-5 jours)**
- Couverture minimale 60 % sur sourcing, economic, pricing, cost-allocation
- Tests Stripe webhook (mocks)
- Tests collective-payment-orchestrator
- **Livrable** : couverture passe de 2,2 % à ~15 %

**Lot 5 — Logger structuré (1-2 jours)**
- Remplacer les 112 `console.log` par `logger.info/warn/error` (utils/logger.js)
- Audit qui plante si nouveau `console.log` introduit
- **Livrable** : logs structurés, plus de fuite potentielle

**Lot 6 — Gouvernance unifiée (1 jour)**
- Réconcilier `.cursorrules` et `AGENTS.md` sur une source unique
- Mettre à jour `CARTOGRAPHY_360.md` à partir du code réel (script auto-généré, comme `BOUTIQUE_ARCHITECTURE_LIVE.md`)
- **Livrable** : un seul protocole agent, doc qui suit le code

**Lots optionnels post-MVP** :
- Découper `pricing-engine.js` par responsabilités
- Découper `shared-cart-engine.js` si extensions prévues
- Mettre `routes/admin.js` en sous-dossier comme `routes/orders/`

### 4.2 Quick wins (à faire avant les gros lots)

| Action | Charge | Bénéfice |
|---|---|---|
| Supprimer `routes/orders/order-api-v2.js` | 5 min | Élimine un piège |
| Déplacer `test_groupe_paiement.js` dans tests/ | 5 min | Cohérence structure |
| Mettre `console.log` en deprecation warning | 15 min | Plus on ajoute, plus on alerte |
| Numéroter les 2 collisions de migrations | 10 min | Évite un sinistre futur |

---

## 5. Garde-fous exécutables (comme `audit-boutique-arch.js`)

Voici les invariants backend à protéger par audit automatique :

### Invariants structurels (analyse statique)

```js
// I-BACK-1 : Aucun fichier doublon dans routes/ et routes/orders/
// I-BACK-2 : Aucun fichier .js > 1500 lignes (warning à 800, erreur à 1500)
// I-BACK-3 : Aucun UPDATE orders SET status = ... hors order-status-machine.js
// I-BACK-4 : Aucun UPDATE orders SET payment_status = ... hors payment-service.js (à créer)
// I-BACK-5 : Aucune route /admin/* sans middleware authenticate + requireAdmin
// I-BACK-6 : Aucun routes/X-engine.js (les engines doivent vivre dans services/)
// I-BACK-7 : Aucun console.log/console.debug dans routes/ ou services/
// I-BACK-8 : Aucune query SQL avec template string et ${variable} (sauf savepoints listés)
// I-BACK-9 : Aucun fichier test à la racine (tests/ uniquement)
// I-BACK-10 : Aucune collision dans migrations/ (deux fichiers même numéro)
```

### Invariants DB (script SQL sur staging avant deploy)

```sql
-- I-DB-1 : Aucune commande dans un statut impossible
-- I-DB-2 : Aucun panier collectif avec sum(contributions) > total
-- I-DB-3 : Aucun item avec stock négatif
-- I-DB-4 : Aucun user avec email en double
-- I-DB-5 : Aucun order_status_history sans la transition correspondante
-- I-DB-6 : Aucune parcel sans order (FK orpheline)
-- I-DB-7 : Aucun payment_status incohérent avec status
```

### Invariants tests (analyse statique des tests)

```js
// I-TEST-1 : Chaque service > 300 lignes a un test
// I-TEST-2 : Chaque route /api/payments/* a un test d'intégration
// I-TEST-3 : Coverage globale > N % (à fixer après Lot 4)
```

### Trio garde-fou (comme pour boutique)

1. **`docs/BACKEND_ARCHITECTURE.md`** (normatif, court, édité main)
   - Les invariants ci-dessus avec leur justification
   - La table d'ownership (qui possède quoi)
   - Les patterns à suivre / à éviter

2. **`docs/BACKEND_ARCHITECTURE_LIVE.md`** (généré)
   - Inventaire actuel : fichiers, lignes, complexité
   - Violations détectées
   - Score global

3. **`scripts/audit-backend-arch.js`** (CI / pre-push)
   - Plante si une violation est introduite
   - Exclusions justifiées dans une allowlist explicite

---

## 6. Ce que je n'ai pas pu auditer (limites)

- **La base de données réelle** : je n'ai vu que les migrations, pas le schéma actuel ni les données. Les invariants DB doivent être validés sur staging.
- **Le comportement réel** : 0 exécution, juste analyse statique. Les bugs runtime (race conditions, deadlocks) ne se détectent que par tests + observabilité.
- **Les performances** : aucune mesure (latence, mémoire, requêtes N+1).
- **Les intégrations externes** : Stripe, WhatsApp/Meta, SMTP — non testées.

---

## 7. Question pour la suite

Le plan en 6 lots est dimensionné pour **~3 semaines de travail focus**. Mais l'ordre des Lots 1 et 2 est court (3-5 jours) et **élimine le risque sans changer le comportement**.

Mon conseil : **commencer par Lot 1 (nettoyage fantômes) immédiatement après event-cleanup**. Aucun changement métier, énormément de tranquillité d'esprit.

Si tu valides, je peux livrer le **Lot 1 backend** prêt à appliquer dans la même forme que les Lots boutique : zip + PR_GUIDE + commands exactes.
