#!/usr/bin/env bash
# One-shot bootstrap. Only on a NEW, private Railway PostgreSQL instance.
set -Eeuo pipefail

[ "${KOMERCE_RECETTE_ISOLATED:-}" = "true" ] || { echo "BLOCKED: not isolated recette"; exit 30; }
[ "${KOMERCE_ENV:-}" = "staging" ] || { echo "BLOCKED: not staging business env"; exit 31; }
[ -n "${DATABASE_URL:-}" ] || { echo "BLOCKED: no database reference"; exit 32; }
case "$DATABASE_URL" in
  *".railway.internal:"*) ;;
  *) echo "BLOCKED: only private railway.internal database is allowed"; exit 33 ;;
esac

# Never import over an existing database; don't even attempt a repair by default.
count="$(psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -Atqc "SELECT COUNT(*) FROM pg_class WHERE relname IN ('products','users','orders') AND relnamespace='public'::regnamespace")"
[ "$count" = "0" ] || { echo "BLOCKED: target is not empty. No schema changes applied."; exit 34; }
echo "RECETTE_BOOTSTRAP: empty private DB verified, importing schema-only"
psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f /recette/schema.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f /recette/migration-351.sql >/dev/null

check="$(psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -Atqc "SELECT CASE WHEN to_regclass('public.wallets') IS NOT NULL AND to_regclass('public.products') IS NOT NULL AND to_regclass('public.catalog_media') IS NOT NULL AND to_regclass('public.catalog_media_recovery_audit') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END")"
[ "$check" = "PASS" ] || { echo "BLOCKED: missing canonical tables"; exit 35; }
echo "RECETTE_BOOTSTRAP_PASS: schema-only + 351; no user or product data cloned"
