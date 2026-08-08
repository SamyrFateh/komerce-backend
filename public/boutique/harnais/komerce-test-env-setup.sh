#!/usr/bin/env bash
# ============================================================
# komerce-test-env-setup.sh
# Recrée l'environnement complet de tests Komerce depuis zéro.
# Testé sur Ubuntu 24.04 / Node 22. Idempotent.
#
# Usage :
#   chmod +x komerce-test-env-setup.sh
#   ./komerce-test-env-setup.sh [--skip-pg] [--skip-playwright]
#
# Variables d'environnement à fournir pour Playwright F22 :
#   export BASE_URL="https://komerce.co/boutique/"
#   export ALLOW_GROUP_FLOW=true
#   export TEST_ACCOUNT_PHONE=3211234   # 7 chiffres locaux +269
#   export TEST_ACCOUNT_OTP=424242
# ============================================================

set -e

SKIP_PG=false
SKIP_PW=false
for arg in "$@"; do
  [[ "$arg" == "--skip-pg" ]] && SKIP_PG=true
  [[ "$arg" == "--skip-playwright" ]] && SKIP_PW=true
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "▶ Repo root : $REPO_ROOT"

# ── 1. Node deps (backend) ───────────────────────────────────────────────────
echo
echo "── 1/6  Dépendances backend ────────────────────────────────────────────"
cd "$REPO_ROOT"
CI=1 npm install --no-audit --no-fund

# ── 2. PostgreSQL ────────────────────────────────────────────────────────────
if [ "$SKIP_PG" = false ]; then
  echo
  echo "── 2/6  PostgreSQL ─────────────────────────────────────────────────────"

  # Installer si absent
  if ! command -v psql &>/dev/null; then
    apt-get update -qq && apt-get install -y postgresql postgresql-contrib
  fi

  # Démarrer
  service postgresql start 2>/dev/null || true
  sleep 3

  # Créer rôle + base si absents
  su postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='komerce'\"" | grep -q 1 \
    || su postgres -c "psql -c \"CREATE USER komerce WITH PASSWORD 'komerce' SUPERUSER;\""

  su postgres -c "psql -lqt | cut -d'|' -f1 | grep -qw komerce_test" \
    || su postgres -c "createdb -O komerce komerce_test"

  export DATABASE_URL="postgres://komerce:komerce@localhost:5432/komerce_test"

  # Charger le schéma canonique
  echo "   Chargement du schéma…"
  PGPASSWORD=komerce psql -h localhost -U komerce -d komerce_test \
    -v ON_ERROR_STOP=1 -q -f "$REPO_ROOT/docs/db/railway-live-schema.sql" \
    2>/dev/null || echo "   (schéma déjà chargé ou partiellement présent)"

  # Appliquer les migrations post-dump
  echo "   Application des migrations 110→129…"
  for f in $(ls "$REPO_ROOT/migrations/1"[0-2][0-9]*.sql 2>/dev/null | sort); do
    name=$(basename "$f")
    PGPASSWORD=komerce psql -h localhost -U komerce -d komerce_test \
      -v ON_ERROR_STOP=1 -q -f "$f" >/tmp/mig.log 2>&1 \
      && echo "   OK  $name" \
      || echo "   --  $name (déjà appliqué ou conflit ignoré)"
  done

  # Baseline migrations dans schema_migrations si table vide
  COUNT=$(PGPASSWORD=komerce psql -h localhost -U komerce -d komerce_test -tAc \
    "SELECT count(*) FROM schema_migrations;" 2>/dev/null || echo "0")
  if [ "$COUNT" -lt 10 ]; then
    echo "   Baseline schema_migrations…"
    node -e "
const db=require('./db.js');
const fs=require('fs'),p=require('path');
const dir=p.join('$REPO_ROOT','migrations');
fs.readdirSync(dir).filter(f=>/^\d+.*\.sql$/.test(f)).forEach(async f=>{
  await db.query('INSERT INTO schema_migrations(filename,checksum) VALUES(\$1,\$2) ON CONFLICT DO NOTHING',
    [f,'baselined-from-dump']);
});
setTimeout(()=>process.exit(0),2000);
" 2>/dev/null || true
  fi

  echo "   PostgreSQL OK — DATABASE_URL=$DATABASE_URL"
fi

# ── 3. Playwright (boutique) ─────────────────────────────────────────────────
if [ "$SKIP_PW" = false ]; then
  echo
  echo "── 3/6  Playwright + Chromium ──────────────────────────────────────────"
  cd "$REPO_ROOT/public/boutique"
  CI=1 npm install --no-audit --no-fund
  npx playwright install --with-deps chromium
  cd "$REPO_ROOT"
fi

# ── 4. Variables d'environnement de test ─────────────────────────────────────
echo
echo "── 4/6  Variables de test ──────────────────────────────────────────────"
export NODE_ENV=test
export JWT_SECRET="${JWT_SECRET:-ci-test-secret-not-for-prod}"
export QR_SECRET="${QR_SECRET:-ci-test-qr-secret}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-ci-test-admin}"
export STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-sk_test_dummy}"
export STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_dummy}"
export AUTHKEY_API_KEY="${AUTHKEY_API_KEY:-ci-dummy}"
export PAYPAL_CLIENT_ID="${PAYPAL_CLIENT_ID:-ci-dummy}"
export PAYPAL_CLIENT_SECRET="${PAYPAL_CLIENT_SECRET:-ci-dummy}"
export PAYPAL_WEBHOOK_ID="${PAYPAL_WEBHOOK_ID:-ci-dummy}"
export META_WA_APP_SECRET="${META_WA_APP_SECRET:-ci-dummy}"
export DATABASE_URL="${DATABASE_URL:-postgres://komerce:komerce@localhost:5432/komerce_test}"

echo "   NODE_ENV=$NODE_ENV"
echo "   DATABASE_URL=$DATABASE_URL"
echo "   (secrets CI : valeurs fictives sauf si surchargées avant l'appel)"

# ── 5. Vérification gate de classification ───────────────────────────────────
echo
echo "── 5/6  Gate de classification ─────────────────────────────────────────"
node scripts/test-header-check.js --strict && echo "   ✔ aucune erreur" \
  || { echo "   ✖ headers manquants — corriger avant de continuer"; exit 1; }

# ── 6. Résumé des commandes ──────────────────────────────────────────────────
echo
echo "── 6/6  Environnement prêt ─────────────────────────────────────────────"
echo
echo "  Campagnes disponibles :"
echo
echo "  Unit + invariants + contract + notifications (sans PG) :"
echo "    npx jest --config jest.unit.config.js --runInBand --forceExit --ci"
echo
echo "  Intégration (PG requis) :"
echo "    node scripts/run-integration-tests.js"
echo
echo "  Projection fiabilité par feature :"
echo "    npx jest --config jest.unit.config.js --ci --json --outputFile=/tmp/unit.json"
echo "    npx jest --config jest.config.js --ci --json --outputFile=/tmp/rest.json \\"
echo "      tests/invariants tests/contract tests/notifications"
echo "    node scripts/feature-reliability-report.js --results=/tmp/unit.json,/tmp/rest.json"
echo
echo "  F22 Playwright (BASE_URL + compte de test requis) :"
echo "    cd public/boutique"
echo "    BASE_URL=https://komerce.co/boutique/ \\"
echo "    ALLOW_GROUP_FLOW=true \\"
echo "    TEST_ACCOUNT_PHONE=<7 chiffres +269> \\"
echo "    TEST_ACCOUNT_OTP=<code fixe> \\"
echo "    npx playwright test --config playwright.config.js --project=authenticated \\"
echo "      tests/e2e/authenticated/group-shared-list.spec.js"
echo
echo "  Précondition avant migration 129 en préprod :"
echo "    psql \$DATABASE_URL -c \\"
echo "      \"SELECT organizer_user_id, count(*) FROM shared_carts"
echo "        WHERE status='open' GROUP BY 1 HAVING count(*) > 1;\""
echo
