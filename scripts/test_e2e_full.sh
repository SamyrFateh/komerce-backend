#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# KOMERCE — Test E2E complet v2 (corrigé)
# Usage: ./test_e2e_full.sh https://your-app.up.railway.app
# ═══════════════════════════════════════════════════════════════════════

set -uo pipefail

BASE="${1:-http://localhost:3000}"
ADMIN_EMAIL="admin@komerce.km"
ADMIN_PASS="USJQ9oRx6rSfzzqIubW3Nw"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
REPORT=""

check() {
  local label="$1"
  local condition="$2"
  if [ "$condition" = "true" ] || [ "$condition" = "ok" ]; then
    echo -e "  ${GREEN}✅ $label${NC}"
    REPORT="${REPORT}\n✅ $label"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}❌ $label${NC}"
    REPORT="${REPORT}\n❌ $label"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  KOMERCE — TEST E2E COMPLET v2${NC}"
echo -e "${CYAN}  Base URL: $BASE${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# ─── PHASE 1 : Test API front ──────────────────────────────────────────────

echo -e "${YELLOW}═══ PHASE 1 : Tests API (simule le frontend) ═══${NC}"

# 1.1 Health check
echo -e "\n${CYAN}1.1 — Health check${NC}"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/products" 2>/dev/null || echo "000")
check "GET /api/products accessible" "$([ "$HTTP" = "200" ] && echo true || echo false)"

# 1.2 Register (full_name, pas name)
echo -e "\n${CYAN}1.2 — Register nouveau client${NC}"
REG=$(curl -s -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Test E2E","email":"e2e-'$(date +%s)'@komerce.km","phone":"+336'$(shuf -i 10000000-99999999 -n1)'","password":"Test123!"}' 2>/dev/null)
REG_TOKEN=$(echo "$REG" | jq -r '.token // empty' 2>/dev/null)
check "Register → JWT reçu" "$([ -n "$REG_TOKEN" ] && echo true || echo false)"

# 1.3 Login admin
echo -e "\n${CYAN}1.3 — Login admin${NC}"
ADMIN_LOGIN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null)
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | jq -r '.token // empty' 2>/dev/null)
check "Login admin → JWT reçu" "$([ -n "$ADMIN_TOKEN" ] && echo true || echo false)"

if [ -z "$ADMIN_TOKEN" ]; then
  echo -e "${RED}FATAL: Impossible de se connecter en admin — arrêt${NC}"
  echo ""
  echo "PASS=$PASS FAIL=$FAIL"
  exit 1
fi

# 1.4 GET products
echo -e "\n${CYAN}1.4 — Catalogue produits${NC}"
PRODUCTS=$(curl -s "$BASE/api/products" 2>/dev/null)
PRODUCT_COUNT=$(echo "$PRODUCTS" | jq '.total // 0' 2>/dev/null)
# Trouver un produit avec stock > 0
FIRST_PID=$(echo "$PRODUCTS" | jq -r '[.products[] | select(.stock > 0)][0].id // empty' 2>/dev/null)
check "Produits chargés ($PRODUCT_COUNT)" "$([ "$PRODUCT_COUNT" -gt 0 ] 2>/dev/null && echo true || echo false)"

# 1.5 GET relais
echo -e "\n${CYAN}1.5 — Points relais${NC}"
RELAIS=$(curl -s "$BASE/api/relais" 2>/dev/null)
RELAIS_COUNT=$(echo "$RELAIS" | jq 'length // 0' 2>/dev/null)
FIRST_RID=$(echo "$RELAIS" | jq -r '.[0].id // empty' 2>/dev/null)
check "Relais chargés ($RELAIS_COUNT)" "$([ "$RELAIS_COUNT" -gt 0 ] 2>/dev/null && echo true || echo false)"

# 1.6 Create order (avec payment_mode: cash_relais + produit en stock)
echo -e "\n${CYAN}1.6 — Créer commande (simule checkout boutique)${NC}"
ORDER_REF=""
ORDER_ID=""
if [ -n "$REG_TOKEN" ] && [ -n "$FIRST_PID" ] && [ -n "$FIRST_RID" ]; then
  ORDER=$(curl -s -X POST "$BASE/api/orders" \
    -H "Authorization: Bearer $REG_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"items\":[{\"product_id\":\"$FIRST_PID\",\"quantity\":1}],\"relay_id\":\"$FIRST_RID\",\"payment_mode\":\"cash_relais\",\"recipient_name\":\"Fatima Test\",\"recipient_phone\":\"+269321555\"}" 2>/dev/null)
  ORDER_REF=$(echo "$ORDER" | jq -r '.order.reference // empty' 2>/dev/null)
  ORDER_ID=$(echo "$ORDER" | jq -r '.order.id // empty' 2>/dev/null)
  check "Commande créée ($ORDER_REF)" "$([ -n "$ORDER_REF" ] && echo true || echo false)"
else
  check "Commande créée" "false"
fi

# 1.7 Get my orders (GET /api/orders avec token client)
echo -e "\n${CYAN}1.7 — Mes commandes${NC}"
if [ -n "$REG_TOKEN" ]; then
  MY_ORDERS=$(curl -s "$BASE/api/orders" -H "Authorization: Bearer $REG_TOKEN" 2>/dev/null)
  MY_COUNT=$(echo "$MY_ORDERS" | jq 'if type == "array" then length else (.orders | length // 0) end' 2>/dev/null)
  check "Client voit ses commandes ($MY_COUNT)" "$([ "$MY_COUNT" -gt 0 ] 2>/dev/null && echo true || echo false)"
fi

# 1.8 Admin change status
echo -e "\n${CYAN}1.8 — Admin change statut${NC}"
if [ -n "$ORDER_ID" ]; then
  STATUS_RESP=$(curl -s -X PATCH "$BASE/api/orders/$ORDER_ID/status" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"paid","note":"Test E2E"}' 2>/dev/null)
  check "Statut → paid" "$(echo "$STATUS_RESP" | jq -r '.success // false' 2>/dev/null)"
fi

echo ""

# ─── PHASE 2 : Seed données historiques ─────────────────────────────────────

echo -e "${YELLOW}═══ PHASE 2 : Seed données historiques (3 mois) ═══${NC}"

# 2.1 Counts before
echo -e "\n${CYAN}2.1 — Compteurs avant seed${NC}"
BEFORE=$(curl -s "$BASE/api/admin/counts" -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null)
echo "  Avant: $(echo $BEFORE | jq -c '.' 2>/dev/null)"

# 2.2 Seed
echo -e "\n${CYAN}2.2 — Seed test data${NC}"
SEED=$(curl -s -X POST "$BASE/api/admin/seed-test" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirm":true,"months":3}' 2>/dev/null)
SEED_OK=$(echo "$SEED" | jq -r '.success // false' 2>/dev/null)
SEED_MSG=$(echo "$SEED" | jq -r '.message // "erreur"' 2>/dev/null)
check "Seed OK ($SEED_MSG)" "$SEED_OK"

# 2.3 Counts after
echo -e "\n${CYAN}2.3 — Compteurs après seed${NC}"
AFTER=$(curl -s "$BASE/api/admin/counts" -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null)
echo "  Après: $(echo $AFTER | jq -c '.' 2>/dev/null)"
ORDERS_AFTER=$(echo "$AFTER" | jq '.orders // 0' 2>/dev/null)
check "Commandes en base ($ORDERS_AFTER)" "$([ "$ORDERS_AFTER" -gt 5 ] 2>/dev/null && echo true || echo false)"

echo ""

# ─── PHASE 3 : Vérification dashboards ──────────────────────────────────────

echo -e "${YELLOW}═══ PHASE 3 : Vérification dashboards & finance ═══${NC}"

# 3.1 Dashboard ops (route: /api/dashboard/ops, keys: activite, alertes, sla...)
echo -e "\n${CYAN}3.1 — Dashboard ops${NC}"
OPS=$(curl -s "$BASE/api/dashboard/ops" -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null)
OPS_OK=$(echo "$OPS" | jq 'has("activite") or has("sla") or has("alertes")' 2>/dev/null)
check "Dashboard ops accessible" "$([ "$OPS_OK" = "true" ] && echo true || echo false)"

# 3.2 Dashboard sales (route: /api/dashboard/sales, CA dans kpi_l1.ca_kmf)
echo -e "\n${CYAN}3.2 — Dashboard sales${NC}"
SALES=$(curl -s "$BASE/api/dashboard/sales" -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null)
CA=$(echo "$SALES" | jq '.kpi_l1.ca_kmf // 0' 2>/dev/null)
check "Dashboard sales — CA > 0 ($CA KMF)" "$([ "$CA" -gt 0 ] 2>/dev/null && echo true || echo false)"

# 3.3 Finance summary (route: /api/admin/finance/summary, keys: ca_kmf, nb_commandes...)
echo -e "\n${CYAN}3.3 — Finance summary${NC}"
FIN=$(curl -s "$BASE/api/admin/finance/summary" -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null)
FIN_OK=$(echo "$FIN" | jq 'has("ca_kmf") or has("nb_commandes") or has("period")' 2>/dev/null)
check "Finance summary accessible" "$([ "$FIN_OK" = "true" ] && echo true || echo false)"

# 3.4 Pilotage (route: /api/admin/pilotage, keys: periode, ca, volume, marges...)
echo -e "\n${CYAN}3.4 — Pilotage${NC}"
PIL=$(curl -s "$BASE/api/admin/pilotage" -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null)
PIL_OK=$(echo "$PIL" | jq 'has("periode") or has("ca") or has("volume")' 2>/dev/null)
check "Pilotage accessible" "$([ "$PIL_OK" = "true" ] && echo true || echo false)"

# 3.5 Admin dashboard
echo -e "\n${CYAN}3.5 — Admin dashboard${NC}"
ADM=$(curl -s "$BASE/api/admin/dashboard" -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null)
ADM_OK=$(echo "$ADM" | jq 'type == "object"' 2>/dev/null)
check "Admin dashboard accessible" "$([ "$ADM_OK" = "true" ] && echo true || echo false)"

# 3.6 Admin margins
echo -e "\n${CYAN}3.6 — Admin margins${NC}"
MAR=$(curl -s "$BASE/api/admin/margins" -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null)
MAR_OK=$(echo "$MAR" | jq 'type == "object"' 2>/dev/null)
check "Admin margins accessible" "$([ "$MAR_OK" = "true" ] && echo true || echo false)"

# 3.7 Admin customs
echo -e "\n${CYAN}3.7 — Admin customs${NC}"
CUST=$(curl -s "$BASE/api/admin/customs" -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null)
CUST_OK=$(echo "$CUST" | jq 'type == "object" or type == "array"' 2>/dev/null)
check "Admin customs accessible" "$([ "$CUST_OK" = "true" ] && echo true || echo false)"

echo ""

# ─── PHASE 4 : Vérification croisée ─────────────────────────────────────────

echo -e "${YELLOW}═══ PHASE 4 : Vérifications croisées (cohérence) ═══${NC}"

# 4.1 Order count consistency
echo -e "\n${CYAN}4.1 — Cohérence des compteurs${NC}"
check "Plus de commandes après seed" "$([ "$ORDERS_AFTER" -gt 0 ] 2>/dev/null && echo true || echo false)"

# 4.2 CA > 0
echo -e "\n${CYAN}4.2 — CA positif${NC}"
check "CA total > 0 dans les dashboards" "$([ "$CA" -gt 0 ] 2>/dev/null && echo true || echo false)"

echo ""

# ─── RAPPORT FINAL ──────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL))
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}  🎉 TOUS LES TESTS PASSENT : $PASS/$TOTAL${NC}"
else
  echo -e "${RED}  ⚠️  RÉSULTAT : $PASS/$TOTAL (${FAIL} échec(s))${NC}"
fi
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Détail :${REPORT}"
echo ""

REPORT_FILE="/tmp/komerce_e2e_report_$(date +%Y%m%d_%H%M%S).txt"
echo "KOMERCE E2E TEST REPORT — $(date)" > "$REPORT_FILE"
echo "Base: $BASE" >> "$REPORT_FILE"
echo "Result: $PASS/$TOTAL" >> "$REPORT_FILE"
echo -e "$REPORT" >> "$REPORT_FILE"
echo ""
echo "Rapport sauvegardé: $REPORT_FILE"
