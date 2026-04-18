#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# KOMERCE — Tests API Paramètres V1
# ═══════════════════════════════════════════════════════════════════════════
# Lance ces commandes après déploiement pour vérifier que tout fonctionne.
# Nécessite : curl + jq + un JWT admin valide
# ═══════════════════════════════════════════════════════════════════════════

# ── Configuration ──────────────────────────────────────────────────────────
API_URL="${API_URL:-https://komerce-backend-production.up.railway.app}"
TOKEN="${TOKEN:?Erreur: export TOKEN=<ton_jwt_admin>}"

echo "═══ Tests API Paramètres ═══"
echo "API : $API_URL"
echo ""

# ── Test 1 : Lister toutes les règles ──────────────────────────────────────
echo "── Test 1 : GET /api/admin/rules ──"
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/admin/rules" | jq '.categories | keys'
echo ""
# Attendu : ["alerting", "compensation", "loyalty", "orders", "parcel", "pricing",
#           "shipping", "sla", "system", "wallet"]

# ── Test 2 : Compter le nombre total de règles ─────────────────────────────
echo "── Test 2 : Compter règles (attendu: 67) ──"
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/admin/rules" | \
  jq '[.categories | to_entries[] | .value.rules | length] | add'
echo ""

# ── Test 3 : Détail d'une règle spécifique ─────────────────────────────────
echo "── Test 3 : GET /api/admin/rules/SLA_WARNING_DAYS ──"
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/admin/rules/SLA_WARNING_DAYS" | \
  jq '{key: .rule.key, value: .rule.value.value, history_count: (.history | length)}'
echo ""
# Attendu : {"key": "SLA_WARNING_DAYS", "value": 35, "history_count": 0+}

# ── Test 4 : Modifier une règle (sans raison = KO attendu) ─────────────────
echo "── Test 4 : PATCH sans justification (attendu 400) ──"
curl -sS -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": 40}' \
  "$API_URL/api/admin/rules/SLA_WARNING_DAYS" | jq
echo ""
# Attendu : {"error": "La justification est obligatoire..."}

# ── Test 5 : Modifier une règle correctement ───────────────────────────────
echo "── Test 5 : PATCH avec justification (attendu 200) ──"
curl -sS -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": 40, "reason": "Test API — ajustement test"}' \
  "$API_URL/api/admin/rules/SLA_WARNING_DAYS" | \
  jq '{success: .success, new_value: .rule.value.value}'
echo ""
# Attendu : {"success": true, "new_value": 40}

# ── Test 6 : Vérifier l'historique ─────────────────────────────────────────
echo "── Test 6 : Vérifier historique après modif ──"
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/admin/rules/SLA_WARNING_DAYS" | \
  jq '.history[0] | {old: .old_value.value, new: .new_value.value, reason: .change_reason}'
echo ""
# Attendu : {"old": 35, "new": 40, "reason": "Test API — ajustement test"}

# ── Test 7 : Reset de la règle ─────────────────────────────────────────────
echo "── Test 7 : POST reset (retour à 35) ──"
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/admin/rules/SLA_WARNING_DAYS/reset" | \
  jq '{success: .success, value: .rule.value.value}'
echo ""
# Attendu : {"success": true, "value": 35}

# ── Test 8 : Validation bornes min/max ─────────────────────────────────────
echo "── Test 8 : PATCH hors bornes (attendu 400) ──"
curl -sS -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": 999, "reason": "Test validation bornes max"}' \
  "$API_URL/api/admin/rules/SLA_WARNING_DAYS" | jq
echo ""
# Attendu : {"error": "Valeur maximum: 120"}

# ── Test 9 : GET matrices taxes ────────────────────────────────────────────
echo "── Test 9 : GET /api/admin/pricing-matrices/taxes ──"
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/admin/pricing-matrices/taxes" | \
  jq '.taxes[] | {cat: .category, douane: .douane_pct, tva: .tva_pct}'
echo ""
# Attendu : 5 catégories avec leurs taux

# ── Test 10 : GET audit global ─────────────────────────────────────────────
echo "── Test 10 : GET /api/admin/rules/audit ──"
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/admin/rules/audit" | \
  jq '.history | length'
echo ""
# Attendu : >= 2 (les 2 modifs faites dans les tests 5 et 7)

echo "═══ Tests terminés ═══"
echo ""
echo "Si tous les tests passent, le backend est OK."
echo "Prochaine étape : déployer le frontend (ct-views-settings.js)."
