#!/bin/bash
# ============================================
# Komerce DB Reset Script
# Usage: ./komerce-db-reset.sh [orders|users|factory]
# ============================================

BASE="https://komerce-backend-production.up.railway.app"
MODE="${1:-orders}"
EMAIL="admin@komerce.km"
PASSWORD="Komerce2025!"
RESET_KEY="komerce-dev-2026"

echo "🔑 Reset admin password..."
curl -s "$BASE/api/auth/admin-reset" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$RESET_KEY\",\"new_password\":\"$PASSWORD\"}" | python3 -m json.tool

echo ""
echo "🔐 Login..."
curl -s -c /tmp/komerce-jar.txt "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" > /tmp/komerce-login.json
python3 -c "import json; d=json.load(open('/tmp/komerce-login.json')); print('Login:', 'OK ✅' if d.get('user') else 'FAIL ❌', d.get('error',''))"

echo ""
echo "📊 Counts AVANT reset:"
curl -s -b /tmp/komerce-jar.txt "$BASE/api/admin/counts" | python3 -m json.tool

echo ""
echo "🧹 Reset mode=$MODE..."
curl -s -b /tmp/komerce-jar.txt "$BASE/api/admin/reset" \
  -H "Content-Type: application/json" \
  -d "{\"mode\":\"$MODE\"}" | python3 -m json.tool

echo ""
echo "📊 Counts APRÈS reset:"
curl -s -b /tmp/komerce-jar.txt "$BASE/api/admin/counts" | python3 -m json.tool

# If mode was orders or factory, optionally re-seed
if [ "$MODE" = "orders" ] || [ "$MODE" = "factory" ]; then
  echo ""
  read -p "🌱 Injecter données test ? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    curl -s -b /tmp/komerce-jar.txt "$BASE/api/admin/seed-test" \
      -H "Content-Type: application/json" \
      -d '{"confirm":true}' | python3 -m json.tool
  fi
fi

echo ""
echo "✅ Terminé !"
