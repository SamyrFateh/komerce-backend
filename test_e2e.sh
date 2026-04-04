#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Komerce E2E Test — Boutique → Dashboard Flow
#  Usage: ./test_e2e.sh https://your-app.up.railway.app
# ═══════════════════════════════════════════════════════════════════
set -e

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

echo "╔══════════════════════════════════════════════╗"
echo "║   Komerce E2E Test — v9.1                    ║"
echo "║   Target: $BASE_URL"
echo "╚══════════════════════════════════════════════╝"
echo ""

check() {
  local label="$1" ok="$2"
  if [ "$ok" = "true" ]; then
    echo "  ✅ $label"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $label"
    FAIL=$((FAIL + 1))
  fi
}

# ── 1. Health check ───────────────────────────────────────────────
echo "── Step 1: Health check"
HEALTH=$(curl -sf "$BASE_URL/api/health" || echo '{}')
check "API reachable" "$(echo $HEALTH | jq -r '.status == "ok"')"
echo ""

# ── 2. Load products ─────────────────────────────────────────────
echo "── Step 2: GET /api/products"
PRODUCTS=$(curl -sf "$BASE_URL/api/products" || echo '[]')
PCOUNT=$(echo $PRODUCTS | jq 'if type=="array" then length else .products // [] | length end')
check "Products loaded ($PCOUNT items)" "$([ "$PCOUNT" -gt 0 ] && echo true || echo false)"
echo ""

# ── 3. Load relais ───────────────────────────────────────────────
echo "── Step 3: GET /api/relais"
RELAIS=$(curl -sf "$BASE_URL/api/relais" || echo '[]')
RCOUNT=$(echo $RELAIS | jq 'if type=="array" then length else .relais // [] | length end')
check "Relais loaded ($RCOUNT points)" "$([ "$RCOUNT" -gt 0 ] && echo true || echo false)"
echo ""

# ── 4. Login as admin ────────────────────────────────────────────
echo "── Step 4: POST /api/auth/login (admin)"
LOGIN=$(curl -sf -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@komerce.km","password":"Komerce2026!"}' || echo '{}')
TOKEN=$(echo $LOGIN | jq -r '.token // empty')
check "Admin login OK" "$([ -n "$TOKEN" ] && echo true || echo false)"
echo ""

if [ -z "$TOKEN" ]; then
  echo "⛔ Cannot continue without token"
  exit 1
fi

# ── 5. Get first product & relais IDs ────────────────────────────
PRODUCT_ID=$(echo $PRODUCTS | jq -r 'if type=="array" then .[0].id else .products[0].id end')
RELAIS_ID=$(echo $RELAIS | jq -r 'if type=="array" then .[0].id else .relais[0].id end')
UNIT_PRICE=$(echo $PRODUCTS | jq -r 'if type=="array" then .[0].price_kmf else .products[0].price_kmf end')

echo "── Step 5: Snapshot dashboards BEFORE order"
DASH_BEFORE=$(curl -sf "$BASE_URL/api/dashboard/ops" \
  -H "Authorization: Bearer $TOKEN" || echo '{}')
BEFORE_ORDERS=$(echo $DASH_BEFORE | jq '.activity.total_orders // 0')
echo "  📊 Orders before: $BEFORE_ORDERS"
echo ""

# ── 6. Create order ──────────────────────────────────────────────
echo "── Step 6: POST /api/orders (create command)"
ORDER_PAYLOAD=$(cat <<EOJSON
{
  "items": [{"product_id": "$PRODUCT_ID", "quantity": 2, "unit_price": $UNIT_PRICE}],
  "relais_id": "$RELAIS_ID",
  "payment_mode": "cash_relais",
  "recipient_name": "Test E2E",
  "recipient_phone": "0321999999",
  "delivery_address": "Moroni centre"
}
EOJSON
)
ORDER=$(curl -sf -X POST "$BASE_URL/api/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$ORDER_PAYLOAD" || echo '{}')
ORDER_REF=$(echo $ORDER | jq -r '.reference // .order.reference // empty')
ORDER_ID=$(echo $ORDER | jq -r '.id // .order.id // empty')
check "Order created (ref: $ORDER_REF)" "$([ -n "$ORDER_REF" ] && echo true || echo false)"
echo ""

# ── 7. Verify dashboard updated ──────────────────────────────────
echo "── Step 7: Snapshot dashboards AFTER order"
sleep 1
DASH_AFTER=$(curl -sf "$BASE_URL/api/dashboard/ops" \
  -H "Authorization: Bearer $TOKEN" || echo '{}')
AFTER_ORDERS=$(echo $DASH_AFTER | jq '.activity.total_orders // 0')
echo "  📊 Orders after: $AFTER_ORDERS"
check "Dashboard updated ($BEFORE_ORDERS → $AFTER_ORDERS)" \
  "$([ "$AFTER_ORDERS" -gt "$BEFORE_ORDERS" ] && echo true || echo false)"
echo ""

# ── 8. Check Pilotage ────────────────────────────────────────────
echo "── Step 8: GET /api/pilotage/overview"
PIL=$(curl -sf "$BASE_URL/api/pilotage/overview" \
  -H "Authorization: Bearer $TOKEN" || echo '{}')
PIL_CA=$(echo $PIL | jq '.ca_total_kmf // .revenue_kmf // "N/A"')
check "Pilotage accessible (CA: $PIL_CA KMF)" \
  "$(echo $PIL | jq 'keys | length > 0')"
echo ""

# ── 9. Admin sales ───────────────────────────────────────────────
echo "── Step 9: GET /api/dashboard/sales"
SALES=$(curl -sf "$BASE_URL/api/dashboard/sales" \
  -H "Authorization: Bearer $TOKEN" || echo '{}')
check "Sales dashboard accessible" "$(echo $SALES | jq 'keys | length > 0')"
echo ""

# ── Summary ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   RESULTS: $PASS passed / $FAIL failed       "
echo "╚══════════════════════════════════════════════╝"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
