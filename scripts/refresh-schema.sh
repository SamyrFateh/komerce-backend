#!/usr/bin/env bash
# =============================================================================
# KOMERCE — Refresh db/schema.sql depuis Railway prod
# =============================================================================
# Exécuter après chaque migration appliquée en prod pour maintenir schema.sql
# en tant que dump complet et exact de la base Railway.
#
# Usage :
#   DATABASE_URL="postgresql://..." bash scripts/refresh-schema.sh
#   # ou si .env est chargé :
#   bash scripts/refresh-schema.sh
#
# Railway CLI :
#   railway run bash scripts/refresh-schema.sh
#
# Ce que ça fait :
#   1. pg_dump --schema-only sur la base prod
#   2. Écrase db/schema.sql avec le résultat
#   3. Affiche un diff résumé pour vérification avant commit
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA_FILE="$ROOT/db/schema.sql"

# Charger .env si DATABASE_URL absent
if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f "$ROOT/.env" ]]; then
    set -o allexport
    # shellcheck disable=SC1091
    source "$ROOT/.env"
    set +o allexport
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ DATABASE_URL non défini. Passer via env ou .env" >&2
  echo "   Ex : DATABASE_URL=\"postgresql://...\" bash scripts/refresh-schema.sh" >&2
  exit 1
fi

echo "🔄 Dump du schéma prod → db/schema.sql"
echo "   Source : ${DATABASE_URL//:*@/://<credentials>@}"

# Dump : schéma uniquement, sans owner/ACL pour portabilité CI
pg_dump \
  --schema-only \
  --no-owner \
  --no-acl \
  --no-privileges \
  --encoding=UTF8 \
  "$DATABASE_URL" \
  > "$SCHEMA_FILE"

echo "✅ db/schema.sql mis à jour ($(wc -l < "$SCHEMA_FILE") lignes)"
echo ""

# Vérification de fraîcheur intégrée
echo "🔍 Vérification colonnes post-migrations…"
node "$ROOT/scripts/check-schema-freshness.js" && echo "✅ Toutes les colonnes présentes" || true

echo ""
echo "📋 Prochaine étape :"
echo "   git add db/schema.sql"
echo "   git commit -m 'chore(schema): refresh depuis Railway prod (post-migration NNN)'"
echo "   git push"
