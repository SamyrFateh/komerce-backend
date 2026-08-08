# Komerce — Architecture de test (référence rapide)

Contexte : session d'audit + refonte `shared-cart` (2026-08).
À coller dans un commentaire de ticket ou en tête d'une future session IA.

---

## Environnement requis

| Composant | Version | Notes |
|---|---|---|
| Node | 22 | `CI=1 npm install` (contourne le hook setup-hooks.sh) |
| PostgreSQL | 16 | base `komerce_test`, user `komerce/komerce` |
| Playwright | 1.56 | installé dans `public/boutique/node_modules` |
| Chromium | via `npx playwright install --with-deps chromium` | seul navigateur nécessaire en CI |

## Schéma DB

```bash
# Charger le dump canonique
psql "$DATABASE_URL" -f docs/db/railway-live-schema.sql

# Appliquer les migrations post-dump (110 → 129)
for f in migrations/1[0-2][0-9]*.sql; do psql "$DATABASE_URL" -f "$f"; done

# Baseline schema_migrations (si pas de .git)
# → voir komerce-test-env-setup.sh section 2
```

**Précondition migration 129 :**
```sql
SELECT organizer_user_id, count(*) FROM shared_carts
 WHERE status='open' GROUP BY 1 HAVING count(*) > 1;
-- 0 rows → appliquer migrations/129_shared_cart_one_open_per_organizer.sql
```

## Variables d'environnement

```bash
# Backend (CI — valeurs fictives suffisantes pour les tests unitaires)
export NODE_ENV=test
export JWT_SECRET=ci-test-secret-not-for-prod
export QR_SECRET=ci-test-qr-secret
export ADMIN_PASSWORD=ci-test-admin
export STRIPE_SECRET_KEY=sk_test_dummy
export STRIPE_WEBHOOK_SECRET=whsec_dummy
export AUTHKEY_API_KEY=ci-dummy
export PAYPAL_CLIENT_ID=ci-dummy
export PAYPAL_CLIENT_SECRET=ci-dummy
export PAYPAL_WEBHOOK_ID=ci-dummy
export META_WA_APP_SECRET=ci-dummy
export DATABASE_URL=postgres://komerce:komerce@localhost:5432/komerce_test

# Playwright F22 (compte dédié staging — NE PAS utiliser en production)
export BASE_URL=https://komerce.co/boutique/
export ALLOW_GROUP_FLOW=true
export TEST_ACCOUNT_PHONE=3211234   # 7 chiffres locaux sans indicatif (+269)
export TEST_ACCOUNT_OTP=424242      # code OTP fixe du compte de test
```

## Campagnes

```bash
# Gate de classification (bloque npm test si headers manquants)
node scripts/test-header-check.js --strict

# Unit + invariants + notifications + contract (sans PostgreSQL)
npx jest --config jest.unit.config.js --runInBand --forceExit --ci
# → 340 suites (~6 000 tests), 0 rouge attendu

# Intégration (PostgreSQL requis)
node scripts/run-integration-tests.js
# → 32/32 suites, runner officiel avec preflight pg

# Projection fiabilité par feature
npx jest --config jest.unit.config.js --ci --json --outputFile=/tmp/unit.json
npx jest --config jest.config.js --ci --json --outputFile=/tmp/rest.json \
  tests/invariants tests/contract tests/notifications
node scripts/feature-reliability-report.js --results=/tmp/unit.json,/tmp/rest.json

# F22 Playwright (depuis public/boutique/)
cd public/boutique
npx playwright test --config playwright.config.js --project=authenticated \
  tests/e2e/authenticated/group-shared-list.spec.js
# → 13 passent, 1 skip (F22-11, nécessite second compte), 0 rouge
```

## Architecture des runners

```
jest.unit.config.js
  roots: tests/unit + tests/invariants + tests/contract + tests/notifications
  testMatch: **/*.test.js + tests/parcelOptimization.test.js
  → exécuté par npm test (via pretest → test-header-check --strict)

scripts/run-integration-tests.js
  → pg-preflight (6 étapes) → 1 process Jest par suite tests/integration/
  → guard anti-production via e2eDbKit.assertTestDatabase

scripts/run-e2e-feature-tests.js
  → tests/e2e-api/ (10 suites)

public/boutique/playwright.config.js
  → mode LOCAL (statique, sans backend) si BASE_URL absent
  → mode DISTANT si BASE_URL fourni
  → guard PROD_GUARD_HOSTS=['komerce.co'] bloque specs mutantes en prod
  → project 'setup' génère playwright/.auth/user.json (storageState)
  → project 'authenticated' consomme le storageState

scripts/feature-reliability-report.js  [ajout 2026-08]
  → joint features/*.feature.js × rapports --json Jest
  → verdict PROVEN / PARTIAL / AT_RISK / UNPROVEN / DEPRECATED_TOMBSTONE
```

## Fichiers clés du chantier 2026-08

```
migrations/129_shared_cart_one_open_per_organizer.sql  ← NEW
services/shared-cart-creation.js    ← V1 guard + open_list_exists
services/shared-cart-reads.js       ← normalizeImageUrl()
routes/shared-cart.js               ← 409 + existing_token
routes/shares.js                    ← export genToken (TOK-02)
public/boutique/js/b-share-cart.js  ← É2/É5/É7/É8, source unique
public/boutique/js/group/group-side-cart.js  ← É3/É4/É9, tabs
public/boutique/js/b-tracking.js    ← É6, Fermer retiré
public/boutique/css/shared-list-side-cart.css  ← .k-cart-tabs
public/boutique/tests/e2e/authenticated/group-shared-list.spec.js  ← F22
jest.unit.config.js                 ← roots étendus (invariants inclus)
scripts/feature-reliability-report.js  ← projection feature par feature
```

## Gotchas

- **Sans `.git`** : `scripts/ci-migrate.js` baseline à vide → rejoue tout.
  Contournement : baseline manuelle via `INSERT INTO schema_migrations`.
- **`ignoreHTTPSErrors`** dans playwright.config.js : NE PAS committer.
  Nécessaire seulement dans les containers sandboxés sans CA store complet.
- **`CI=1`** sur `npm install` : contourne `scripts/setup-hooks.sh`.
- **F22-11** (participant sauvegarde) : skip structurel, nécessite
  `TEST_ACCOUNT_PHONE_2` + `TEST_ACCOUNT_OTP_2` (second compte dédié).
- **Playwright authentifié** : `BASE_URL` doit contenir `/boutique/` en suffixe.
