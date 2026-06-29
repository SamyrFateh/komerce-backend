# Plan d'execution — Polissage gouvernance Komerce

> Auteur : Opus (audit du 2026-06-29)
> Executant : Sonnet
> Contexte : La gouvernance est operationnelle. Ce plan corrige 4 dettes residuelles non-bloquantes pour passer de "solide" a "irreprochable".
> Prerequis : le monorepo backend (racine), boutique (public/boutique/), dashboards (public/dashboards/).

---

## Chantier 1 — Rattacher les 66 tests orphelins aux manifests backend

**Status** : FAIT (Opus, 2026-06-29)
**Resultat** : 80 tests rattaches aux 16 manifests. Feature-guard : 224 → 184 warnings.
Les 184 restants sont des VRAIS gaps de couverture (198 services/routes sans test du tout, pas un probleme de mapping).
**Livrable** : `backend-features-with-tests.zip` — 16 manifests a copier dans `features/`.

### Probleme

81 fichiers test existent dans `tests/`. Seuls `shared-cart` (11) et `notifications` (5) les declarent dans `files.tests` de leur manifest. Les 14 autres features ont `files.tests` vide ou absent. Le feature-guard genere un warning par service/route sans test declare.

### Instructions

Pour chaque manifest dans `features/*.feature.js`, ajouter un champ `files.tests` (tableau) listant les fichiers test correspondants. Les chemins sont relatifs a la racine du repo (pas relatifs a features/).

**Methode de validation** : pour chaque test, verifier que le nom du test correspond au service/route qu'il teste. En cas de doute, ouvrir le fichier test et lire la premiere ligne `describe()`.

**Mapping pre-calcule** (a valider par Sonnet en cas de doute) :

```
auth-identity.feature.js → files.tests:
  tests/unit/authkey-client.test.js
  tests/unit/otp-test-mode.test.js
  tests/unit/soft-auth.test.js
  tests/integration/otp-no-guest.test.js
  tests/integration/admin-authz-probe.test.js

catalog.feature.js → files.tests:
  tests/unit/catalog-import-orchestrator.test.js
  tests/unit/scan-engine.test.js
  tests/unit/scan-engine-content-verification.test.js
  tests/unit/scan-engine-extras.test.js
  tests/unit/scan-operations.test.js

customs.feature.js → files.tests:
  tests/unit/customs-shipment-service.test.js

dashboard.feature.js → files.tests:
  tests/unit/dashboard-clients-queries.test.js
  tests/unit/dashboard-finance-metrics.test.js
  tests/unit/dashboard-metrics.test.js
  tests/unit/dashboard-ops-queries.test.js
  tests/unit/radar-queries.test.js
  tests/unit/relay-dashboard-queries.test.js

documents.feature.js → files.tests:
  tests/unit/invoice-service.test.js

economic-engine.feature.js → files.tests:
  tests/unit/economic-engine-queries.test.js
  tests/unit/cost-allocation.test.js
  tests/unit/cost-allocation-allocate.test.js

inventory.feature.js → files.tests:
  tests/unit/parcel-auto-create-service.test.js
  tests/unit/parcel-guards.test.js
  tests/unit/parcel-operations.test.js
  tests/unit/hub-operations.test.js
  tests/unit/pickup-secret-service.test.js
  tests/integration/parcel-auto-create-cash-payment.test.js

logistics.feature.js → files.tests:
  tests/unit/purchasing.test.js
  tests/unit/purchasing-admin-service.test.js
  tests/unit/sourcing-analysis.test.js
  tests/unit/sourcing-mutations.test.js
  tests/integration/sourcing-engine-routes.test.js
  tests/integration/sourcing-flow-g5.test.js

orders.feature.js → files.tests:
  tests/unit/order-status-machine.test.js
  tests/unit/confirm-payment-cycle.test.js
  tests/unit/cash-operations.test.js
  tests/unit/repair-ordered-without-purchase-orders.test.js
  tests/integration/admin-order-refund-payment-service.test.js

payments.feature.js → files.tests:
  tests/unit/payment-cash-confirm.test.js
  tests/unit/payment-paypal.test.js
  tests/unit/payment-service.test.js
  tests/unit/payment-stripe.test.js
  tests/unit/payments-webhook.test.js
  tests/unit/paypal-client.test.js
  tests/unit/paypal-webhook.test.js

platform-ops.feature.js → files.tests:
  tests/unit/validators.test.js
  tests/integration/api.test.js
  tests/integration/security-grid.test.js
  tests/integration/relais-idor-probe.test.js
  tests/integration/isweep-invariants.test.js
  tests/integration/isweep-services.test.js
  tests/integration/isweep-transactional-flows.test.js

refunds.feature.js → files.tests:
  tests/unit/cancel-shared-cart-with-refunds.test.js

wallet-loyalty.feature.js → files.tests:
  tests/unit/wallet-service.test.js
```

**Tests restants a mapper manuellement** (noms ambigus — ouvrir le describe() pour decider) :

```
tests/unit/b-checkout-pure.test.js          → probablement orders ou un manifest boutique
tests/unit/collective-payment-orchestrator.test.js → probablement shared-cart
tests/unit/shared-cart-edit-mode.test.js     → deja dans shared-cart ? verifier
tests/unit/pricing-*.test.js (8 fichiers)   → verifier : economic-engine ou recommendations ?
  pricing-apply, pricing-chain, pricing-dashboard-truth, pricing-flow-contract,
  pricing-guards, pricing-rates, pricing-strategy-service, pricing-surcharge-benchmarks
tests/parcelOptimization.test.js            → probablement inventory
tests/unit/relais-idor-probe.test.js        → deja dans platform-ops ? doublon avec integration/
```

### Verification

```bash
node scripts/feature-guard.js 2>&1 | tail -5
# Attendu : "Avertissements : 0" (ou tres proche de 0)
```

---

## Chantier 2 — Installer la gouvernance dashboards standalone dans le monorepo

**Impact** : les developpeurs dashboards peuvent lancer `npm run check:all` en local.
**Risque** : zero — ajout de fichiers, aucune modification de l'existant.
**Duree estimee** : 15 min.

### Instructions

Le livrable `dashboards-governance-v2.zip` (genere par Opus) contient tout. Installer dans `public/dashboards/` :

```bash
# Depuis la racine du monorepo
cd public/dashboards

# 1. Creer les dossiers
mkdir -p features scripts docs/doctrine

# 2. Copier les manifests (3 fichiers)
# Source : dashboards-governance-v2.zip/features/
cp <source>/features/admin-dashboard.feature.js features/
cp <source>/features/legacy-control-tower.feature.js features/
cp <source>/features/platform.feature.js features/

# 3. Copier les scripts (3 fichiers)
cp <source>/scripts/feature-registry-check.js scripts/
cp <source>/scripts/code-quality-gate.js scripts/
cp <source>/scripts/setup-hooks.sh scripts/
chmod +x scripts/setup-hooks.sh

# 4. Copier la doctrine (2 fichiers)
cp <source>/docs/doctrine/FEATURE_DOCTRINE.md docs/doctrine/
cp <source>/docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md docs/doctrine/

# 5. Creer le package.json
```

**package.json a creer** :

```json
{
  "name": "dashboards",
  "version": "1.0.0",
  "description": "Komerce Dashboards — admin SPA, legacy control-tower, platform utilities",
  "private": true,
  "scripts": {
    "test": "echo \"Utilise npm run check:all\" && exit 1",
    "audit:registry": "node scripts/feature-registry-check.js --strict",
    "quality:gate": "node scripts/code-quality-gate.js --strict",
    "quality:gate:fix": "node scripts/code-quality-gate.js --fix",
    "check:all": "npm run quality:gate && npm run audit:registry",
    "check:fast": "npm run quality:gate && npm run audit:registry",
    "precommit": "npm run check:all"
  }
}
```

### Configuration importante du quality gate

Le `code-quality-gate.js` dashboards a 3 specificites par rapport au backend :

- `SCAN_DIRS = ['dashboards/admin/js', 'dashboards/admin-legacy/js', 'js']` + `ROOT_FILES = ['sw.js']`
- `IGNORE_PATTERNS` inclut `/admin-legacy/` (status: deprecated, dette gelee)
- `RULE_FILE_EXEMPT` exempte `sw.js` (console.log standard SW) et `js/auth-guard.js` + `js/parcel-components.js` (var legacy gele)

### Verification

```bash
cd public/dashboards
npm run check:all
# Attendu :
#   Quality gate : 0 erreurs, ~18 warnings (dead code)
#   Feature registry : 3 features, 82 fichiers, 0 orphelin
```

---

## Chantier 3 — Corriger le contract drift (13 routes dashboards)

**Impact** : le contract-check passe de 13 drifts a 0.
**Risque** : faible — ajout de declarations dans le contrat, pas de logique.
**Duree estimee** : 20 min.

### Probleme

13 routes API appelees par le code dashboards ne sont pas declarees dans le contrat OpenAPI genere par `contract-generate.js`. Le contract-check les signale comme drifts bloquants.

### Routes manquantes

```
/api/dashboard
/api/pricing/apply-price
/api/hub-dash/ship
/api/hub-dash/start-prep
/api/hub/reassign-order
/api/admin/sourcing/products
/api/admin/loyalty
/api/pickup/status
/api/pickup/pay-cash
/api/pickup/receipt
/api/pickup/verify
/api/pickup/collect
/api/pickup/regenerate
```

### Instructions

**Option A** (recommandee) : lancer la regeneration automatique du contrat.

```bash
npm run contract:generate
```

Cela scanne les routes backend et regenere le contrat. Si les routes existent cote backend (ce qui est le cas — elles sont dans `routes/`), elles seront ajoutees automatiquement.

**Option B** (si contract:generate ne les prend pas) : ajouter manuellement dans le fichier contrat (`docs/contract/` ou le fichier genere par `contract-generate.js`). Ouvrir chaque route dans `routes/` pour verifier le schema (params, body, response).

**Option C** (si les routes n'existent pas cote backend — peu probable) : ce sont des appels frontend vers des endpoints fantomes. Dans ce cas, documenter dans `docs/contract/DEBT.md` et figer la baseline :

```bash
npm run contract:check -- --save
```

### Verification

```bash
node scripts/contract-check.js 2>&1 | grep "dérive"
# Attendu : "0 dérive(s) bloquantes" ou absence de la ligne
```

---

## Chantier 4 — Nettoyer les 27 warnings dead code backend

**Impact** : le quality gate passe de 27 warnings a 0.
**Risque** : faible — suppression de code mort apres return/throw.
**Duree estimee** : 20 min.

### Probleme

27 occurrences de code apres `return` ou `throw` dans 25 fichiers. Le quality gate les signale en warning (N2-DEAD-CODE, non-bloquant).

### Fichiers concernes

**Backend (15 fichiers, 15 warnings)** :

| Fichier | Ligne | Pattern |
|---------|-------|---------|
| services/invoice-public-token.js | L35 | return process.env... |
| services/invoice-service.js | L312 | return String(str) |
| services/notifications/internals.js | L92 | return order.tracking_phone |
| services/paypal-client.js | L53 | return (process.env... |
| services/shared-cart-v41-transitions.js | L170 | return businessStatusOf... |
| routes/auth.js | L243 | return res.status(400)... |
| routes/shares.js | L60 | return promoActive |
| routes/tracking.js | L67 | return crypto.createHash... |
| middleware/validate.js | L47 | return value |
| utils/documents/customs-invoice-html.js | L38 | return String(s...) |
| utils/documents/pickup-proof-html.js | L36 | return String(s...) |
| utils/documents/refund-receipt-html.js | L41 | return String(s...) |
| utils/documents/wallet-receipt-html.js | L36 | return String(s...) |
| utils/phone.js | L71 | return digits.length... |
| utils/pickup-receipt-html.js | L39 | return String(s...) |

**Dashboards admin (10 fichiers, 12 warnings)** :

| Fichier | Ligne |
|---------|-------|
| public/dashboards/admin/js/app.js | L597 |
| public/dashboards/admin/js/utils.js | L54 |
| public/dashboards/admin/js/views/AccountingView.js | L157 |
| public/dashboards/admin/js/views/ControlTowerView.js | L213 |
| public/dashboards/admin/js/views/EconomicFlowView.js | L80, L451 |
| public/dashboards/admin/js/views/HubRelaisView.js | L109 |
| public/dashboards/admin/js/views/SalesView.js | L344 |
| public/dashboards/admin/js/views/SanteView.js | L344 |
| public/dashboards/admin/js/views/SimulatorView.js | L141 |
| public/dashboards/admin/js/views/SuppliersView.js | L184, L188 |

### Instructions

Pour chaque warning :

1. Ouvrir le fichier a la ligne indiquee
2. Regarder le `return` ou `throw` juste au-dessus
3. Verifier que le code EN DESSOUS est effectivement mort (pas dans un autre scope/branche)
4. Supprimer le code mort

**Attention** : la plupart des patterns `return String(s == null ? '' : s)` dans les fichiers `utils/documents/*.js` sont des helpers d'echappement XSS. Le code "mort" apres le return est souvent un commentaire ou une ligne vide mal interpretee. Verifier avant de supprimer.

**Pattern frequent** :

```javascript
// AVANT (warning)
function safe(s) {
  return String(s == null ? '' : s);
  // echappement additionnel prevu ici ← code mort
}

// APRES (propre)
function safe(s) {
  return String(s == null ? '' : s);
}
```

### Verification

```bash
node scripts/code-quality-gate.js 2>&1 | tail -3
# Attendu : "0 Avertissements" ou "aucun problème détecté"
```

---

## Ordre d'execution recommande

1. **Chantier 1** (tests) — le plus gros impact, zero risque
2. **Chantier 4** (dead code) — rapide, propre
3. **Chantier 2** (dashboards standalone) — copie de fichiers
4. **Chantier 3** (contract drift) — peut necessiter une decision metier

## Verification finale

Apres les 4 chantiers, lancer :

```bash
# Backend
node scripts/feature-registry-check.js --strict    # 0 erreur
node scripts/code-quality-gate.js --strict          # 0 erreur, 0 warning
node scripts/feature-guard.js                       # 0 erreur, ~0 warning
node scripts/contract-check.js                      # 0 drift

# Boutique
cd public/boutique && npm run check:all             # tout vert

# Dashboards
cd public/dashboards && npm run check:all           # tout vert

# Cross-repo
cd <racine>
node scripts/gen-dashboards-360.js --check          # 0 anomalie
node scripts/gen-boutique-360.js --check             # 0 anomalie
node scripts/gen-meta-graph.js --check               # 0 fantome
```

Tout vert = gouvernance irreprochable.
