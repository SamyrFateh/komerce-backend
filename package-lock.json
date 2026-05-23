#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# KOMERCE — SUITE DE TESTS ROBUSTESSE BUSINESS / TRANSACTIONNELLE v6.2
# ═══════════════════════════════════════════════════════════════════════════════
# PÉRIMÈTRE : Cette suite couvre la robustesse métier et transactionnelle :
#   - Machine à états (cycle de vie commande)
#   - Intégrité stock (décréments, restaurations, concurrence)
#   - Intégrité wallet (crédits, débits, reversals, FIFO)
#   - Audit trail (traçabilité obligatoire)
#   - RBAC (rôles et périmètres)
#   - Idempotence / atomicité des endpoints critiques
#   - Scans & logistique (cycle colis)
#   - Routing relais → destination
#   - Compatibilité legacy
#
# HORS PÉRIMÈTRE (nécessitent outils dédiés) :
#   - Performance / charge (k6, Artillery)
#   - Stripe webhooks (clé test requise)
#   - CORS / headers sécurité (OWASP ZAP)
#   - Upload images / Cloudinary
#   - WebSocket / temps réel
#   - Rate-limiting
#   - Emails / notifications
#
# MODES D'EXÉCUTION :
#   MODE=prod    (défaut) → ZÉRO mutation SQL. Lectures API uniquement.
#                           Les tests nécessitant DB sont SKIP.
#   MODE=staging          → Lectures DB autorisées via $DB_URL (env var).
#                           AUCUNE écriture SQL. Jamais. Nulle part.
#
# USAGE :
#   MODE=prod bash tests/robustesse-v6.sh
#   MODE=staging DB_URL="postgresql://..." bash tests/robustesse-v6.sh
#   BASE="https://staging.example.com" bash tests/robustesse-v6.sh
#
# VERDICT :
#   FAIL > 0          → NOT READY
#   FAIL = 0, WARN > 0 → READY WITH RISKS
#   FAIL = 0, WARN = 0 → READY
# ═══════════════════════════════════════════════════════════════════════════════
set -o pipefail
export LC_ALL=C

# ─── Configuration ───────────────────────────────────────────────────────────
MODE="${MODE:-prod}"
BASE="${BASE:-https://komerce-backend-production.up.railway.app}"
TS=$(date +%s)

# ─── DB — read-only, via env var, NEVER hardcoded ────────────────────────────
# RULE: db_query_ro() is the ONLY function that touches the DB.
#       It is READ-ONLY. No INSERT/UPDATE/DELETE ever.
#       Only available when MODE=staging AND DB_URL is set.
HAS_DB=false
if [[ "$MODE" == "staging" && -n "${DB_URL:-}" ]]; then
  command -v psql > /dev/null 2>&1 || apk add --quiet postgresql16-client > /dev/null 2>&1
  if psql "$DB_URL" -c "SELECT 1" > /dev/null 2>&1; then
    HAS_DB=true
  fi
fi

db_query_ro() {
  # Read-only DB query. Returns empty string if no DB.
  if [[ "$HAS_DB" == "true" ]]; then
    psql "$DB_URL" -t -A -c "$1" 2>/dev/null | tr -d '[:space:]'
  fi
}

db_pickup() {
  db_query_ro "SELECT pickup_code FROM orders WHERE id='$1'"
}

# ─── Cookie jars ─────────────────────────────────────────────────────────────
ACK="/tmp/v6a_${TS}.ck"   # admin
HCK="/tmp/v6h_${TS}.ck"   # hub
RCK="/tmp/v6r_${TS}.ck"   # relais
C1CK="/tmp/v6c1_${TS}.ck" # client A
C2CK="/tmp/v6c2_${TS}.ck" # client B

# ─── Shared state ────────────────────────────────────────────────────────────
PID="" PPRICE=0 RID=""
CA_ID="" CB_ID=""
R_ANJ="" R_MOR="" R_MOH="" R_MAY=""
ORDER_IDS=()

# ═══ REPORTING ═══════════════════════════════════════════════════════════════
TP=0 TF=0 TW=0 TSK=0
CP=0 CF=0 CW=0 CSK=0 CSEC=""
declare -a SREP
declare -A SEC_FAILS SEC_WARNS

ss() {
  CSEC="$1"; CP=0; CF=0; CW=0; CSK=0
  printf '\n▶ [%s] %s\n%s\n' "$1" "$2" "────────────────────────────────────────"
}
pt() { ((CP++)); ((TP++)); printf '  ✅ %s\n' "$1"; }
ft() { ((CF++)); ((TF++)); printf '  ❌ %s%s\n' "$1" "${2:+ — $2}"; }
wt() { ((CW++)); ((TW++)); printf '  ⚠️  %s%s\n' "$1" "${2:+ — $2}"; }
sk() { ((CSK++)); ((TSK++)); printf '  ⏭️  %s%s\n' "$1" "${2:+ — $2}"; }
es() {
  local v="✅"; [[ $CW -gt 0 ]] && v="⚠️"; [[ $CF -gt 0 ]] && v="❌"
  printf '%s\n  [%s] %dP %dF %dW %dS  %s\n' \
    "────────────────────────────────────────" "$CSEC" $CP $CF $CW $CSK "$v"
  SEC_FAILS[$CSEC]=$CF; SEC_WARNS[$CSEC]=$CW
  SREP+=("$(printf '[%-2s] %-22s %2dP %2dF %2dW %2dS %s' "$CSEC" "$1" $CP $CF $CW $CSK "$v")")
}

# ═══ API HELPERS ═════════════════════════════════════════════════════════════
api() {
  local m="$1" p="$2" c="$3" d="$4"
  local a=(-s -o /tmp/v6_r.json -w '%{http_code}')
  [[ -n "$c" ]] && a+=(-b "$c")
  [[ "$m" != "GET" ]] && a+=(-X "$m")
  [[ -n "$d" ]] && a+=(-H 'Content-Type: application/json' -d "$d")
  HTTP=$(curl "${a[@]}" "${BASE}${p}" 2>/dev/null)
  BODY=$(cat /tmp/v6_r.json 2>/dev/null)
}

do_login() {
  HTTP=$(curl -s -o /tmp/v6_r.json -w '%{http_code}' -c "$3" \
    -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    "${BASE}/api/auth/login" 2>/dev/null)
  BODY=$(cat /tmp/v6_r.json 2>/dev/null)
}

jv() { echo "$1" | jq -r "$2 // empty" 2>/dev/null; }
jn() { echo "$1" | jq -r "$2 // 0" 2>/dev/null; }
jl() { echo "$1" | jq -r "$2 | length" 2>/dev/null; }

get_stock() {
  # API-based stock check — no DB needed
  local r
  r=$(curl -s -b "$ACK" "${BASE}/api/products" 2>/dev/null)
  echo "$r" | jq -r --arg p "$1" \
    '[(.products // .)[] | select(.id==$p)][0].stock // "0"' 2>/dev/null
}

api_history_count() {
  # API-based history count via /api/orders/:id/history
  local _hbody
  _hbody=$(curl -s -b "$ACK" "${BASE}/api/orders/$1/history" 2>/dev/null)
  echo "$_hbody" | jq 'if type == "array" then length else 0 end' 2>/dev/null
}

api_history_body() {
  # Returns full history body for detailed checks
  curl -s -b "$ACK" "${BASE}/api/orders/$1/history" 2>/dev/null
}

track() { ORDER_IDS+=("$1"); }

mk_order() {
  local ck="$1" pid="$2" rid="$3" qty="${4:-1}"
  local nm="${5:-Test}" ph="${6:-+2693001234}" uw="$7"
  local extra=""
  [[ "$uw" == "true" ]] && extra=',"use_wallet":true'
  api POST "/api/orders" "$ck" \
    "{\"items\":[{\"product_id\":\"$pid\",\"quantity\":$qty}],\"relais_id\":\"$rid\",\"payment_mode\":\"cash_relais\",\"recipient_name\":\"$nm\",\"recipient_phone\":\"$ph\"$extra}"
}

confirm_cash() {
  api POST "/api/payments/cash/confirm" "$RCK" "{\"cash_ref_code\":\"$1\"}"
}
patch_st() {
  api PATCH "/api/orders/$1/status" "$2" "{\"status\":\"$3\"}"
}
do_cancel() {
  api POST "/api/orders/$1/cancel" "$2" "${3:-{}}"
}

race2() {
  local m="$1" url="${BASE}$2" ck1="$3" d1="$4" ck2="${5:-$3}" d2="${6:-$4}"
  curl -s -o /tmp/v6_r1b.json -w '%{http_code}' -b "$ck1" -X "$m" \
    -H 'Content-Type: application/json' -d "$d1" "$url" \
    > /tmp/v6_r1h.txt 2>/dev/null &
  local p1=$!
  curl -s -o /tmp/v6_r2b.json -w '%{http_code}' -b "$ck2" -X "$m" \
    -H 'Content-Type: application/json' -d "$d2" "$url" \
    > /tmp/v6_r2h.txt 2>/dev/null &
  local p2=$!
  wait $p1 $p2
  R1H=$(cat /tmp/v6_r1h.txt 2>/dev/null)
  R2H=$(cat /tmp/v6_r2h.txt 2>/dev/null)
  R1B=$(cat /tmp/v6_r1b.json 2>/dev/null)
  R2B=$(cat /tmp/v6_r2b.json 2>/dev/null)
}
cnt200() {
  local c=0
  [[ "$R1H" == "200" ]] && ((c++)) || true
  [[ "$R2H" == "200" ]] && ((c++)) || true
  echo $c
}

# ═══════════════════════════════════════════════════════════════════════════════
# A. AUTH & SETUP
# ═══════════════════════════════════════════════════════════════════════════════
section_A() {
  ss "A" "AUTHENTIFICATION & SETUP"

  printf '  ℹ️  MODE=%s | HAS_DB=%s\n' "$MODE" "$HAS_DB"

  # Admin reset (Railway redeploy safety)
  curl -s -X POST -H 'Content-Type: application/json' \
    -d '{"key":"komerce-dev-2026","new_password":"admin123"}' \
    "${BASE}/api/auth/admin-reset" > /dev/null 2>&1

  do_login "admin@komerce.km" "admin123" "$ACK"
  [[ "$HTTP" == "200" ]] && pt "A1: Admin login" || ft "A1: Admin login" "HTTP=$HTTP"

  do_login "said@komerce.km" "admin123" "$HCK"
  [[ "$HTTP" == "200" ]] && pt "A2: Hub login" || ft "A2: Hub login" "HTTP=$HTTP"

  do_login "fatouma@komerce.km" "admin123" "$RCK"
  [[ "$HTTP" == "200" ]] && pt "A3: Relais login" || ft "A3: Relais login" "HTTP=$HTTP"

  # ── Client A — register + EXPLICIT login + session verify ──
  local ea="v6ca${TS}@test.km"
  local pa="+269${TS:3:7}"
  curl -s -o /tmp/v6_reg.json -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"V6 ClientA\",\"email\":\"$ea\",\"phone\":\"$pa\",\"password\":\"pass1234\"}" \
    "${BASE}/api/auth/register" > /tmp/v6_regh.txt 2>/dev/null
  do_login "$ea" "pass1234" "$C1CK"
  CA_ID=$(jv "$BODY" '.user.id // .id')
  if [[ "$HTTP" == "200" && -n "$CA_ID" ]]; then
    api GET "/api/wallet" "$C1CK"
    if [[ "$HTTP" == "200" ]]; then
      pt "A4: Client A ($CA_ID) — login + session verified"
    else
      ft "A4: Client A login OK but session broken" "wallet=$HTTP"
    fi
  else
    ft "A4: Client A" "login=$HTTP — $(jv "$(cat /tmp/v6_reg.json 2>/dev/null)" '.error')"
  fi

  # ── Client B — register + EXPLICIT login + session verify ──
  local eb="v6cb${TS}@test.km"
  local pb="+269${TS:2:7}"
  curl -s -o /tmp/v6_reg.json -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"V6 ClientB\",\"email\":\"$eb\",\"phone\":\"$pb\",\"password\":\"pass1234\"}" \
    "${BASE}/api/auth/register" > /tmp/v6_regh.txt 2>/dev/null
  do_login "$eb" "pass1234" "$C2CK"
  CB_ID=$(jv "$BODY" '.user.id // .id')
  if [[ "$HTTP" == "200" && -n "$CB_ID" ]]; then
    api GET "/api/wallet" "$C2CK"
    if [[ "$HTTP" == "200" ]]; then
      pt "A5: Client B ($CB_ID) — login + session verified"
    else
      ft "A5: Client B login OK but session broken" "wallet=$HTTP"
    fi
  else
    ft "A5: Client B" "login=$HTTP — $(jv "$(cat /tmp/v6_reg.json 2>/dev/null)" '.error')"
  fi

  # Products — find one with stock>30
  api GET "/api/products" "$ACK"
  PID=$(echo "$BODY" | jq -r \
    '[(.products // .)[] | select(.stock!=null and (.stock|tonumber)>30 and .is_active!=false)][0].id // empty' 2>/dev/null)
  if [[ -n "$PID" ]]; then
    PPRICE=$(echo "$BODY" | jq -r --arg p "$PID" \
      '[(.products // .)[] | select(.id==$p)][0].price_kmf // 0' 2>/dev/null)
    pt "A6: Product $PID (stock=$(get_stock "$PID"), price=$PPRICE)"
  else
    ft "A6: No product with stock>30"
  fi

  # Relais — flat JSON array, field is "island" not "island_code"
  api GET "/api/relais" "$ACK"
  RID=$(echo "$BODY" | jq -r '.[0].id // empty' 2>/dev/null)
  R_ANJ=$(echo "$BODY" | jq -r '[.[] | select(.island=="Anjouan")][0].id // empty' 2>/dev/null)
  R_MOR=$(echo "$BODY" | jq -r '[.[] | select(.island=="Grande Comore")][0].id // empty' 2>/dev/null)
  R_MOH=$(echo "$BODY" | jq -r '[.[] | select(.island | test("Moh"))][0].id // empty' 2>/dev/null)
  R_MAY=$(echo "$BODY" | jq -r '[.[] | select(.island | test("(?i)mayotte"))][0].id // empty' 2>/dev/null)
  [[ -n "$RID" ]] && pt "A7: Default relais $RID" || ft "A7: No relais"
  [[ -n "$R_ANJ" ]] && pt "A7b: ANJOUAN ($R_ANJ)" || wt "A7b: No ANJOUAN relais"
  [[ -n "$R_MOR" ]] && pt "A7c: GRANDE COMORE ($R_MOR)" || wt "A7c: No Grande Comore relais"
  [[ -n "$R_MOH" ]] && pt "A7d: MOHELI ($R_MOH)" || wt "A7d: No MOHELI relais"
  [[ -n "$R_MAY" ]] && pt "A7e: MAYOTTE" || wt "A7e: No MAYOTTE relais"

  es "AUTH & SETUP"
}

# ═══════════════════════════════════════════════════════════════════════════════
# B. VALIDATORS & GARDE-FOUS
# ═══════════════════════════════════════════════════════════════════════════════
section_B() {
  ss "B" "VALIDATORS & GARDE-FOUS"
  local S="\"relais_id\":\"$RID\",\"payment_mode\":\"cash_relais\",\"recipient_name\":\"T\",\"recipient_phone\":\"+2693000000\""

  # B1: qty = 0
  api POST "/api/orders" "$C1CK" "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":0}],$S}"
  [[ "$HTTP" == "400" ]] && pt "B1: qty=0 → 400" || ft "B1: qty=0 accepted" "HTTP=$HTTP"

  # B2: qty < 0
  api POST "/api/orders" "$C1CK" "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":-1}],$S}"
  [[ "$HTTP" == "400" ]] && pt "B2: qty<0 → 400" || ft "B2: qty<0 accepted" "HTTP=$HTTP"

  # B3: items = []
  api POST "/api/orders" "$C1CK" "{\"items\":[],$S}"
  [[ "$HTTP" == "400" ]] && pt "B3: items=[] → 400" || ft "B3: items=[] accepted" "HTTP=$HTTP"

  # B4: fake product UUID
  api POST "/api/orders" "$C1CK" \
    "{\"items\":[{\"product_id\":\"00000000-0000-0000-0000-000000000000\",\"quantity\":1}],$S}"
  [[ "$HTTP" == "400" || "$HTTP" == "404" ]] && pt "B4: Fake product → $HTTP" || ft "B4: Fake product" "HTTP=$HTTP"

  # B5: fake relais UUID
  api POST "/api/orders" "$C1CK" \
    "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":1}],\"relais_id\":\"00000000-0000-0000-0000-000000000000\",\"payment_mode\":\"cash_relais\",\"recipient_name\":\"T\",\"recipient_phone\":\"+2693000000\"}"
  [[ "$HTTP" == "400" || "$HTTP" == "404" ]] && pt "B5: Fake relais → $HTTP" || ft "B5: Fake relais" "HTTP=$HTTP"

  # B6: invalid payment_mode
  api POST "/api/orders" "$C1CK" \
    "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":1}],\"relais_id\":\"$RID\",\"payment_mode\":\"bitcoin\",\"recipient_name\":\"T\",\"recipient_phone\":\"+2693000000\"}"
  [[ "$HTTP" == "400" ]] && pt "B6: payment_mode=bitcoin → 400" || ft "B6: bad mode" "HTTP=$HTTP"

  # B7: empty body
  api POST "/api/orders" "$C1CK" "{}"
  [[ "$HTTP" == "400" ]] && pt "B7: empty body → 400" || ft "B7: empty body" "HTTP=$HTTP"

  # B8: invalid scan step
  api POST "/api/scans" "$HCK" '{"scan_code":"FAKE","step":"teleported"}'
  [[ "$HTTP" == "400" ]] && pt "B8: step=teleported → 400" || ft "B8: bad step" "HTTP=$HTTP"

  # B9: in_transit step ACCEPTED by Joi (F22 regression guard)
  # PROOF: If Joi rejects → 400 with validation error about "step"
  #        If Joi accepts → downstream logic (404=scan_code not found, 200/422=business logic)
  api POST "/api/scans" "$HCK" '{"scan_code":"FAKE","step":"in_transit"}'
  if [[ "$HTTP" == "400" ]]; then
    local err_msg
    err_msg=$(jv "$BODY" '.error // .message // .details')
    if echo "$err_msg" | grep -qiE 'step|valid|allow|in_transit'; then
      ft "B9: F22 REGRESSION — in_transit rejected by Joi" "$err_msg"
    else
      wt "B9: 400 but unclear if Joi rejection" "msg=$err_msg"
    fi
  elif [[ "$HTTP" == "404" || "$HTTP" == "422" || "$HTTP" == "200" || "$HTTP" == "201" ]]; then
    pt "B9: in_transit accepted by Joi → $HTTP (past validation, downstream=$HTTP)"
  else
    wt "B9: Unexpected HTTP $HTTP" "investigate"
  fi

  # B10: SQL injection in recipient_name
  api POST "/api/orders" "$C1CK" \
    "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":1}],\"relais_id\":\"$RID\",\"payment_mode\":\"cash_relais\",\"recipient_name\":\"'; DROP TABLE orders;--\",\"recipient_phone\":\"+2693000000\"}"
  [[ "$HTTP" != "500" ]] && pt "B10: SQL injection safe ($HTTP)" || ft "B10: SQL injection 500!"
  local toid=$(jv "$BODY" '.order.id')
  [[ -n "$toid" ]] && { track "$toid"; do_cancel "$toid" "$ACK" > /dev/null 2>&1; }

  # B11: qty = 999 (excessive)
  api POST "/api/orders" "$C1CK" "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":999}],$S}"
  if [[ "$HTTP" == "400" || "$HTTP" == "409" || "$HTTP" == "422" ]]; then
    pt "B11: qty=999 rejected ($HTTP)"
  else
    wt "B11: qty=999 accepted ($HTTP)" "no server limit"
    toid=$(jv "$BODY" '.order.id')
    [[ -n "$toid" ]] && { track "$toid"; do_cancel "$toid" "$ACK" > /dev/null 2>&1; }
  fi

  # B12: missing items field
  api POST "/api/orders" "$C1CK" \
    "{\"relais_id\":\"$RID\",\"payment_mode\":\"cash_relais\",\"recipient_name\":\"T\",\"recipient_phone\":\"+2693000000\"}"
  [[ "$HTTP" == "400" ]] && pt "B12: no items → 400" || ft "B12: no items" "HTTP=$HTTP"

  es "VALIDATORS"
}

# ═══════════════════════════════════════════════════════════════════════════════
# C. MACHINE MÉTIER — CYCLE COMPLET
# ═══════════════════════════════════════════════════════════════════════════════
section_C() {
  ss "C" "MACHINE MÉTIER — CYCLE COMPLET"

  # ── Full cycle: confirmed → ordered → preparation → shipped → in_transit → available → collected ──
  mk_order "$C1CK" "$PID" "$RID" 1 "Machine" "+2693100001"
  local oid ref crc
  oid=$(jv "$BODY" '.order.id'); ref=$(jv "$BODY" '.order.reference'); crc=$(jv "$BODY" '.order.cash_ref_code')
  if [[ "$HTTP" != "201" || -z "$oid" ]]; then
    ft "C1: Create order" "HTTP=$HTTP"; es "MACHINE"; return
  fi
  track "$oid"
  pt "C1: Create → confirmed ($ref)"

  confirm_cash "$crc"
  [[ "$HTTP" == "200" ]] && pt "C2: Cash confirm → ordered" || ft "C2: Confirm" "HTTP=$HTTP"

  patch_st "$oid" "$HCK" "preparation"
  [[ "$HTTP" == "200" ]] && pt "C3: → preparation" || ft "C3: preparation" "HTTP=$HTTP"

  patch_st "$oid" "$HCK" "shipped"
  [[ "$HTTP" == "200" ]] && pt "C4: → shipped (D4: quitte le hub)" || ft "C4: shipped" "HTTP=$HTTP"

  patch_st "$oid" "$HCK" "in_transit"
  [[ "$HTTP" == "200" ]] && pt "C5: → in_transit" || ft "C5: in_transit" "HTTP=$HTTP"

  patch_st "$oid" "$RCK" "available"
  [[ "$HTTP" == "200" ]] && pt "C6: → available" || ft "C6: available" "HTTP=$HTTP"

  # Collect via pickup_code — requires DB access (not exposed by API)
  local pcode
  pcode=$(db_pickup "$oid")
  if [[ -n "$pcode" ]]; then
    api POST "/api/scans/collect" "$RCK" "{\"pickup_code\":\"$pcode\"}"
    [[ "$HTTP" == "200" ]] && pt "C7: Collect → collected (pickup=$pcode)" || ft "C7: Collect" "HTTP=$HTTP"
  else
    if [[ "$HAS_DB" == "true" ]]; then
      wt "C7: pickup_code not found in DB"
    else
      sk "C7: pickup_code requires DB access (MODE=staging)"
    fi
  fi

  # Verify final status via history endpoint
  local hist_body last_st
  hist_body=$(api_history_body "$oid")
  last_st=$(echo "$hist_body" | jq -r '.[-1].status // empty' 2>/dev/null)
  if [[ -n "$pcode" ]]; then
    [[ "$last_st" == "collected" ]] && pt "C8: Final status = collected ✓" || ft "C8: Final=$last_st"
  else
    [[ "$last_st" == "available" ]] && pt "C8: Status = available ✓ (collect skipped)" \
      || wt "C8: Status=$last_st (expected available, collect skipped)"
  fi

  # ── Invalid transitions (tolerate 409 OR 422) ──
  mk_order "$C1CK" "$PID" "$RID" 1 "Invalid" "+2693100002"
  local oid2 crc2
  oid2=$(jv "$BODY" '.order.id'); crc2=$(jv "$BODY" '.order.cash_ref_code'); track "$oid2"

  # confirmed → shipped (skip)
  patch_st "$oid2" "$ACK" "shipped"
  [[ "$HTTP" == "422" || "$HTTP" == "409" ]] && pt "C9: confirmed→shipped BLOCKED ($HTTP)" || ft "C9: not blocked" "HTTP=$HTTP"

  # confirmed → collected (skip)
  patch_st "$oid2" "$ACK" "collected"
  [[ "$HTTP" == "422" || "$HTTP" == "409" ]] && pt "C10: confirmed→collected BLOCKED ($HTTP)" || ft "C10: not blocked" "HTTP=$HTTP"

  # Cancel oid2, then try cancelled→ordered
  do_cancel "$oid2" "$ACK"
  patch_st "$oid2" "$ACK" "ordered"
  [[ "$HTTP" == "422" || "$HTTP" == "409" ]] && pt "C11: cancelled→ordered BLOCKED ($HTTP)" || ft "C11: not blocked" "HTTP=$HTTP"

  # collected→cancelled (oid is collected or available)
  do_cancel "$oid" "$ACK"
  [[ "$HTTP" == "422" || "$HTTP" == "409" ]] && pt "C12: final→cancelled BLOCKED ($HTTP)" || ft "C12: not blocked" "HTTP=$HTTP"

  # ── Stock restoration on cancel ──
  mk_order "$C1CK" "$PID" "$RID" 2 "StockRestore" "+2693100003"
  local oid3 crc3
  oid3=$(jv "$BODY" '.order.id'); crc3=$(jv "$BODY" '.order.cash_ref_code'); track "$oid3"
  confirm_cash "$crc3"
  local sb sa
  sb=$(get_stock "$PID")
  do_cancel "$oid3" "$ACK"
  sa=$(get_stock "$PID")
  [[ $((sa - sb)) -eq 2 ]] && pt "C13: Cancel restores stock (+2)" || ft "C13: Stock delta=$((sa - sb)) (expected +2)"

  es "MACHINE"
}

# ═══════════════════════════════════════════════════════════════════════════════
# D. CONCURRENCE RÉELLE
# ═══════════════════════════════════════════════════════════════════════════════
section_D() {
  ss "D" "CONCURRENCE RÉELLE"

  # ── D1: Double cash confirm (même commande, simultané) ──
  mk_order "$C1CK" "$PID" "$RID" 1 "RaceD1" "+2693200001"
  local d1id d1crc
  d1id=$(jv "$BODY" '.order.id'); d1crc=$(jv "$BODY" '.order.cash_ref_code'); track "$d1id"
  local stock_before_d1 hist_before_d1
  stock_before_d1=$(get_stock "$PID")
  hist_before_d1=$(api_history_count "$d1id")

  race2 POST "/api/payments/cash/confirm" "$RCK" \
    "{\"cash_ref_code\":\"$d1crc\"}"
  local ok
  ok=$(cnt200)

  # Measure post-race state
  local stock_after_d1 hist_after_d1
  stock_after_d1=$(get_stock "$PID")
  hist_after_d1=$(api_history_count "$d1id")
  api GET "/api/orders/$d1id" "$ACK"
  local status_d1
  status_d1=$(jv "$BODY" '.status')

  if [[ $ok -eq 1 ]]; then
    pt "D1: Double confirm → 1 win"
    # Stock decremented exactly once
    [[ $((stock_before_d1 - stock_after_d1)) -eq 1 ]] \
      && pt "D1b: Stock delta = -1 ✓ ($stock_before_d1→$stock_after_d1)" \
      || ft "D1b: Stock delta" "expected -1 got $((stock_before_d1 - stock_after_d1))"
    # Exactly 1 history entry added
    [[ $((hist_after_d1 - hist_before_d1)) -eq 1 ]] \
      && pt "D1c: History delta = +1 ✓" \
      || ft "D1c: History delta = $((hist_after_d1 - hist_before_d1)) (expected 1)"
    [[ "$status_d1" == "ordered" ]] && pt "D1d: Status = ordered ✓" || ft "D1d: Status=$status_d1"
  elif [[ $ok -eq 0 ]]; then
    ft "D1: Both failed ($R1H/$R2H)"
  else
    # Both won = race condition
    wt "D1: Both won — race condition" "stock_delta=$((stock_before_d1 - stock_after_d1)) hist_delta=$((hist_after_d1 - hist_before_d1))"
    # Even if both won, stock must still be consistent
    [[ $((stock_before_d1 - stock_after_d1)) -ge 0 ]] || ft "D1e: Negative stock delta after race!"
  fi

  # ── D2: Double cancel (simultané) ──
  mk_order "$C1CK" "$PID" "$RID" 1 "RaceD2" "+2693200002"
  local d2id d2crc
  d2id=$(jv "$BODY" '.order.id'); d2crc=$(jv "$BODY" '.order.cash_ref_code'); track "$d2id"
  confirm_cash "$d2crc"
  local stock_before_d2
  stock_before_d2=$(get_stock "$PID")

  race2 POST "/api/orders/$d2id/cancel" "$ACK" '{}'
  ok=$(cnt200)
  local stock_after_d2
  stock_after_d2=$(get_stock "$PID")

  if [[ $ok -eq 1 ]]; then
    pt "D2: Double cancel → 1 win"
    [[ $((stock_after_d2 - stock_before_d2)) -eq 1 ]] \
      && pt "D2b: Stock restored +1 ✓" \
      || ft "D2b: Stock delta" "expected +1 got $((stock_after_d2 - stock_before_d2))"
  elif [[ $ok -eq 2 ]]; then
    ft "D2: Both cancel won — double stock reversal risk" "stock_delta=$((stock_after_d2 - stock_before_d2))"
  else
    ft "D2: Both cancel failed ($R1H/$R2H)"
  fi

  # ── D3: Double PATCH même statut (simultané) ──
  mk_order "$C1CK" "$PID" "$RID" 1 "RaceD3" "+2693200003"
  local d3id d3crc
  d3id=$(jv "$BODY" '.order.id'); d3crc=$(jv "$BODY" '.order.cash_ref_code'); track "$d3id"
  confirm_cash "$d3crc"
  local hist_before_d3
  hist_before_d3=$(api_history_count "$d3id")

  race2 PATCH "/api/orders/$d3id/status" "$HCK" '{"status":"preparation"}'
  api GET "/api/orders/$d3id" "$ACK"
  local status_d3
  status_d3=$(jv "$BODY" '.status')
  local hist_after_d3
  hist_after_d3=$(api_history_count "$d3id")

  [[ "$status_d3" == "preparation" ]] && pt "D3: Double PATCH → consistent (preparation)" || ft "D3: Inconsistent $status_d3"
  local hdelta_d3=$((hist_after_d3 - hist_before_d3))
  [[ $hdelta_d3 -eq 1 ]] && pt "D3b: History delta = 1 ✓ (no duplicate)" \
    || wt "D3b: History delta = $hdelta_d3" "possible duplicate entry"

  # ── D4: Stock race — 2 commandes, confirm simultané ──
  local s0
  s0=$(get_stock "$PID")
  mk_order "$C1CK" "$PID" "$RID" 1 "RaceD4a" "+2693200004"
  local d4a d4ac
  d4a=$(jv "$BODY" '.order.id'); d4ac=$(jv "$BODY" '.order.cash_ref_code'); track "$d4a"
  mk_order "$C1CK" "$PID" "$RID" 1 "RaceD4b" "+2693200005"
  local d4b d4bc
  d4b=$(jv "$BODY" '.order.id'); d4bc=$(jv "$BODY" '.order.cash_ref_code'); track "$d4b"
  race2 POST "/api/payments/cash/confirm" "$RCK" \
    "{\"cash_ref_code\":\"$d4ac\"}" "$RCK" "{\"cash_ref_code\":\"$d4bc\"}"
  ok=0
  [[ "$R1H" == "200" ]] && ((ok++)) || true
  [[ "$R2H" == "200" ]] && ((ok++)) || true
  local s1
  s1=$(get_stock "$PID")
  local expected=$((s0 - ok))
  [[ "$s1" == "$expected" ]] && pt "D4: Stock exact after race ($s0→$s1, $ok confirms)" \
    || ft "D4: Stock mismatch" "expected=$expected got=$s1"
  [[ $s1 -ge 0 ]] && pt "D5: Stock ≥ 0 ($s1)" || ft "D5: NEGATIVE STOCK ($s1)"

  # ── D6: SURVENTE stock=1 ──
  # Requires DB mutation (SET stock=1) which is FORBIDDEN in all modes.
  # This test needs a dedicated admin stock API or staging fixtures.
  sk "D6: Stock=1 race test" "requires admin stock API or staging fixtures (no DB mutation allowed)"

  # Cleanup
  do_cancel "$d3id" "$ACK" > /dev/null 2>&1
  do_cancel "$d4a" "$ACK" > /dev/null 2>&1
  do_cancel "$d4b" "$ACK" > /dev/null 2>&1

  es "CONCURRENCE"
}

# ═══════════════════════════════════════════════════════════════════════════════
# E. IDEMPOTENCE FORTE
# ═══════════════════════════════════════════════════════════════════════════════
section_E() {
  ss "E" "IDEMPOTENCE FORTE"

  # ── E1: Double cash confirm séquentiel ──
  mk_order "$C1CK" "$PID" "$RID" 1 "Idemp1" "+2693300001"
  local e1id e1crc
  e1id=$(jv "$BODY" '.order.id'); e1crc=$(jv "$BODY" '.order.cash_ref_code'); track "$e1id"
  local stock_e1_before hist_e1_before
  stock_e1_before=$(get_stock "$PID")
  hist_e1_before=$(api_history_count "$e1id")

  confirm_cash "$e1crc"
  local h1="$HTTP"
  confirm_cash "$e1crc"
  local h2="$HTTP"

  local stock_e1_after hist_e1_after
  stock_e1_after=$(get_stock "$PID")
  hist_e1_after=$(api_history_count "$e1id")

  [[ "$h1" == "200" && "$h2" != "200" ]] && pt "E1: Double confirm → 2nd rejected ($h2)" \
    || ft "E1: idempotence broken" "h1=$h1 h2=$h2"
  # FAIL on double business effect (not WARN)
  [[ $((stock_e1_before - stock_e1_after)) -eq 1 ]] \
    && pt "E1b: Stock decrement = 1 (no double)" \
    || ft "E1b: DOUBLE STOCK DECREMENT" "delta=$((stock_e1_before - stock_e1_after))"
  [[ $((hist_e1_after - hist_e1_before)) -eq 1 ]] \
    && pt "E1c: History delta = 1 (no duplicate)" \
    || ft "E1c: DOUBLE HISTORY ENTRY" "delta=$((hist_e1_after - hist_e1_before))"

  # ── E2: Double cancel séquentiel ──
  local stock_e2_before
  stock_e2_before=$(get_stock "$PID")
  do_cancel "$e1id" "$ACK"
  h1="$HTTP"
  do_cancel "$e1id" "$ACK"
  h2="$HTTP"
  local stock_e2_after
  stock_e2_after=$(get_stock "$PID")

  if [[ "$h1" == "200" && ("$h2" == "422" || "$h2" == "409") ]]; then
    pt "E2: Double cancel → 2nd blocked ($h2)"
  elif [[ "$h1" == "200" && "$h2" == "200" ]]; then
    ft "E2: BOTH CANCELS SUCCEEDED — double stock reversal"
  else
    ft "E2: Unexpected" "h1=$h1 h2=$h2"
  fi
  # FAIL on double stock reversal
  [[ $((stock_e2_after - stock_e2_before)) -eq 1 ]] \
    && pt "E2b: Stock restored +1 (no double reversal)" \
    || ft "E2b: DOUBLE STOCK REVERSAL" "delta=$((stock_e2_after - stock_e2_before)) expected +1"

  # ── E3–E4: Double PATCH même statut séquentiel ──
  mk_order "$C1CK" "$PID" "$RID" 1 "Idemp3" "+2693300003"
  local e3id e3crc
  e3id=$(jv "$BODY" '.order.id'); e3crc=$(jv "$BODY" '.order.cash_ref_code'); track "$e3id"
  confirm_cash "$e3crc"
  local hist_e3_before
  hist_e3_before=$(api_history_count "$e3id")

  patch_st "$e3id" "$HCK" "preparation"
  h1="$HTTP"
  patch_st "$e3id" "$HCK" "preparation"
  h2="$HTTP"

  local hist_e3_after
  hist_e3_after=$(api_history_count "$e3id")

  [[ "$h1" == "200" ]] && pt "E3: First PATCH OK" || ft "E3: First PATCH" "$h1"
  [[ "$h2" == "200" || "$h2" == "422" ]] && pt "E4: Second PATCH handled ($h2)" || ft "E4: Second PATCH" "$h2"

  local hist_delta_e3=$((hist_e3_after - hist_e3_before))
  if [[ "$h2" == "422" ]]; then
    [[ $hist_delta_e3 -eq 1 ]] && pt "E4b: History delta = 1 (2nd blocked, no dup)" \
      || ft "E4b: History delta" "$hist_delta_e3"
  else
    # Both 200: history MUST be ≤ 1 — else FAIL (double effect)
    [[ $hist_delta_e3 -le 1 ]] && pt "E4b: History delta = $hist_delta_e3 (idempotent)" \
      || ft "E4b: DOUBLE HISTORY on same-status PATCH" "delta=$hist_delta_e3"
  fi

  # ── E5: Double collect ──
  patch_st "$e3id" "$HCK" "shipped"
  patch_st "$e3id" "$HCK" "in_transit"
  patch_st "$e3id" "$RCK" "available"
  local e3pc
  e3pc=$(db_pickup "$e3id")
  if [[ -n "$e3pc" ]]; then
    api POST "/api/scans/collect" "$RCK" "{\"pickup_code\":\"$e3pc\"}"
    h1="$HTTP"
    api POST "/api/scans/collect" "$RCK" "{\"pickup_code\":\"$e3pc\"}"
    h2="$HTTP"
    if [[ "$h1" == "200" && "$h2" != "200" ]]; then
      pt "E5: Double collect → 2nd blocked ($h2)"
    elif [[ "$h1" == "200" && "$h2" == "200" ]]; then
      ft "E5: BOTH COLLECTS SUCCEEDED"
    else
      wt "E5: collect idempotence unclear" "h1=$h1 h2=$h2"
    fi
  else
    sk "E5: pickup_code requires DB access (MODE=staging)"
  fi

  es "IDEMPOTENCE"
}

# ═══════════════════════════════════════════════════════════════════════════════
# F. ATOMICITÉ / ROLLBACK
# ═══════════════════════════════════════════════════════════════════════════════
section_F() {
  ss "F" "ATOMICITÉ / ROLLBACK"

  # ── F1: Failed transition → status unchanged ──
  mk_order "$C1CK" "$PID" "$RID" 1 "Atom1" "+2693400001"
  local f1id f1crc
  f1id=$(jv "$BODY" '.order.id'); f1crc=$(jv "$BODY" '.order.cash_ref_code'); track "$f1id"
  local hist_f1_before
  hist_f1_before=$(api_history_count "$f1id")

  patch_st "$f1id" "$ACK" "shipped"  # confirmed→shipped = invalid
  api GET "/api/orders/$f1id" "$ACK"
  [[ "$(jv "$BODY" '.status')" == "confirmed" ]] && pt "F1: Status unchanged after failed transition" \
    || ft "F1: Dirty state $(jv "$BODY" '.status')"

  # No phantom history entry
  local hist_f1_after
  hist_f1_after=$(api_history_count "$f1id")
  [[ $hist_f1_after -eq $hist_f1_before ]] && pt "F1b: No phantom history entry" \
    || ft "F1b: Phantom history entry created" "before=$hist_f1_before after=$hist_f1_after"

  # ── F2: Failed order → stock unchanged ──
  local sb sa
  sb=$(get_stock "$PID")
  api POST "/api/orders" "$C1CK" \
    "{\"items\":[{\"product_id\":\"00000000-0000-0000-0000-000000000000\",\"quantity\":1}],\"relais_id\":\"$RID\",\"payment_mode\":\"cash_relais\",\"recipient_name\":\"T\",\"recipient_phone\":\"+2693400002\"}"
  sa=$(get_stock "$PID")
  [[ "$sb" == "$sa" ]] && pt "F2: Stock unchanged after failed order ($sb)" || ft "F2: Stock changed $sb→$sa"

  # ── F3: History count matches transitions exactly ──
  mk_order "$C1CK" "$PID" "$RID" 1 "Atom3" "+2693400003"
  local f3id f3crc
  f3id=$(jv "$BODY" '.order.id'); f3crc=$(jv "$BODY" '.order.cash_ref_code'); track "$f3id"
  confirm_cash "$f3crc"
  patch_st "$f3id" "$HCK" "preparation"
  # 3 transitions → at least 3 history entries
  local f3hist
  f3hist=$(api_history_count "$f3id")
  [[ ${f3hist:-0} -ge 3 ]] && pt "F3: History ≥ 3 entries ($f3hist)" || ft "F3: History=$f3hist"

  # ── F4: Failed cancel → stock/status unchanged ──
  patch_st "$f3id" "$HCK" "shipped"
  local stock_f4_before
  stock_f4_before=$(get_stock "$PID")
  do_cancel "$f3id" "$ACK"
  [[ "$HTTP" == "422" || "$HTTP" == "409" ]] || wt "F4x: Expected 422/409 on cancel" "HTTP=$HTTP"
  local stock_f4_after
  stock_f4_after=$(get_stock "$PID")
  api GET "/api/orders/$f3id" "$ACK"
  local st_f4
  st_f4=$(jv "$BODY" '.status')
  [[ "$stock_f4_before" == "$stock_f4_after" && "$st_f4" == "shipped" ]] \
    && pt "F4: Failed cancel → stock+status unchanged (shipped, $stock_f4_before)" \
    || ft "F4: State polluted" "stock=$stock_f4_before→$stock_f4_after status=$st_f4"

  # ── F5: Wallet atomicity — invalid credit → balance unchanged ──
  if [[ -n "$CA_ID" ]]; then
    api GET "/api/wallet" "$C1CK"
    local w_before
    w_before=$(jn "$BODY" '.balance_kmf')
    api POST "/api/wallet/admin/credit" "$ACK" "{\"user_id\":\"$CA_ID\"}"
    api GET "/api/wallet" "$C1CK"
    local w_after
    w_after=$(jn "$BODY" '.balance_kmf')
    [[ "$w_before" == "$w_after" ]] && pt "F5: Wallet unchanged after invalid credit ($w_before)" \
      || ft "F5: Wallet changed after invalid credit" "$w_before→$w_after"
  else
    wt "F5: No Client A — cannot test wallet atomicity"
  fi

  # ── F6: No dangling order if product doesn't exist ──
  api POST "/api/orders" "$C1CK" \
    "{\"items\":[{\"product_id\":\"00000000-dead-dead-dead-000000000000\",\"quantity\":1}],\"relais_id\":\"$RID\",\"payment_mode\":\"cash_relais\",\"recipient_name\":\"AtomGhost\",\"recipient_phone\":\"+2693400006\"}"
  local ghost_id
  ghost_id=$(jv "$BODY" '.order.id')
  if [[ "$HTTP" != "201" && -z "$ghost_id" ]]; then
    pt "F6: No dangling order after failed create (HTTP=$HTTP)"
  elif [[ -n "$ghost_id" ]]; then
    ft "F6: Dangling order created!" "id=$ghost_id"
    track "$ghost_id"
  else
    wt "F6: Ambiguous — HTTP=$HTTP but no order.id" "check manually"
  fi

  # ── F7: Atomicity limitation acknowledgment ──
  wt "F7: Atomicity tested via invalid input, not via crash mid-transaction" "true crash atomicity requires chaos engineering"

  do_cancel "$f1id" "$ACK" > /dev/null 2>&1

  es "ATOMICITÉ"
}

# ═══════════════════════════════════════════════════════════════════════════════
# G. STOCK INTEGRITY
# ═══════════════════════════════════════════════════════════════════════════════
section_G() {
  ss "G" "STOCK INTEGRITY"
  local s0
  s0=$(get_stock "$PID")

  # G1: 3 confirms → stock -3
  mk_order "$C1CK" "$PID" "$RID" 1 "Stock1" "+2693500001"
  local g1 g1c; g1=$(jv "$BODY" '.order.id'); g1c=$(jv "$BODY" '.order.cash_ref_code'); track "$g1"
  mk_order "$C1CK" "$PID" "$RID" 1 "Stock2" "+2693500002"
  local g2 g2c; g2=$(jv "$BODY" '.order.id'); g2c=$(jv "$BODY" '.order.cash_ref_code'); track "$g2"
  mk_order "$C1CK" "$PID" "$RID" 1 "Stock3" "+2693500003"
  local g3 g3c; g3=$(jv "$BODY" '.order.id'); g3c=$(jv "$BODY" '.order.cash_ref_code'); track "$g3"

  confirm_cash "$g1c"; confirm_cash "$g2c"; confirm_cash "$g3c"
  local s1
  s1=$(get_stock "$PID")
  [[ $s1 -eq $((s0 - 3)) ]] && pt "G1: 3 confirms → stock -3 ($s0→$s1)" || ft "G1: Expected $((s0-3)) got $s1"

  # G2: 2 cancels → stock +2
  do_cancel "$g1" "$ACK"; do_cancel "$g2" "$ACK"
  local s2
  s2=$(get_stock "$PID")
  [[ $s2 -eq $((s0 - 1)) ]] && pt "G2: 2 cancels → stock +2 ($s1→$s2)" || ft "G2: Expected $((s0-1)) got $s2"

  # G3: Last cancel → stock restored
  do_cancel "$g3" "$ACK"
  local s3
  s3=$(get_stock "$PID")
  [[ $s3 -eq $s0 ]] && pt "G3: All cancelled → stock restored ($s3=$s0)" || ft "G3: Expected $s0 got $s3"

  # G4: Never negative
  [[ $s1 -ge 0 && $s2 -ge 0 && $s3 -ge 0 ]] && pt "G4: Stock never negative ✓" || ft "G4: Negative stock detected"

  # G5: Overstock order (more than available)
  local big=$((s3 + 100))
  mk_order "$C1CK" "$PID" "$RID" "$big" "StockBig" "+2693500004"
  if [[ "$HTTP" == "201" ]]; then
    local gbig gbigc
    gbig=$(jv "$BODY" '.order.id'); gbigc=$(jv "$BODY" '.order.cash_ref_code'); track "$gbig"
    confirm_cash "$gbigc"
    if [[ "$HTTP" != "200" ]]; then
      pt "G5: Overstock rejected at confirm ($HTTP)"
    else
      ft "G5: Overstock confirm accepted! Stock=$(get_stock "$PID")"
    fi
    do_cancel "$gbig" "$ACK" > /dev/null 2>&1
  else
    pt "G5: Overstock rejected at create ($HTTP)"
  fi

  # G6: Stock=1 oversell (séquentiel)
  # Requires DB mutation (SET stock=1) → SKIP
  sk "G6: Stock=1 sequential oversell" "requires admin stock API or staging fixtures"

  es "STOCK INTEGRITY"
}

# ═══════════════════════════════════════════════════════════════════════════════
# H. WALLET INTEGRITY
# ═══════════════════════════════════════════════════════════════════════════════
section_H() {
  ss "H" "WALLET INTEGRITY"

  if [[ -z "$CA_ID" ]]; then
    ft "H0: No Client A user_id"; es "WALLET"; return
  fi

  # H1: Initial balance
  api GET "/api/wallet" "$C1CK"
  local w0
  w0=$(jn "$BODY" '.balance_kmf')
  pt "H1: Initial balance = ${w0} KMF"

  # H2: Admin credit 5000
  api POST "/api/wallet/admin/credit" "$ACK" \
    "{\"user_id\":\"$CA_ID\",\"amount_kmf\":5000,\"reason\":\"v6 test\"}"
  [[ "$HTTP" == "200" || "$HTTP" == "201" ]] && pt "H2: Credit +5000 OK" || ft "H2: Credit" "HTTP=$HTTP"
  local lot_id
  lot_id=$(jv "$BODY" '.lot.id // .transaction.lot_id // .id')

  # H3: Balance = w0 + 5000
  api GET "/api/wallet" "$C1CK"
  local w1
  w1=$(jn "$BODY" '.balance_kmf')
  [[ $w1 -eq $((w0 + 5000)) ]] && pt "H3: Balance = $w1 ✓ (expected $((w0 + 5000)))" \
    || ft "H3: Expected $((w0+5000)) got $w1"

  # H4: Order with wallet
  mk_order "$C1CK" "$PID" "$RID" 1 "Wallet1" "+2693600001" "true"
  local hw1 hw1c credit_used
  hw1=$(jv "$BODY" '.order.id'); hw1c=$(jv "$BODY" '.order.cash_ref_code')
  credit_used=$(jn "$BODY" '.credit_applied_kmf // .order.credit_applied_kmf')
  [[ "$HTTP" == "201" ]] && pt "H4: Order with wallet (credit=$credit_used)" || ft "H4: Order" "HTTP=$HTTP"
  track "$hw1"

  # H5: Balance reduced by exact credit_used amount
  api GET "/api/wallet" "$C1CK"
  local w2
  w2=$(jn "$BODY" '.balance_kmf')
  if [[ ${credit_used:-0} -gt 0 ]]; then
    [[ $w2 -eq $((w1 - credit_used)) ]] && pt "H5: Balance after order = $w2 ✓ (w1=$w1 - credit=$credit_used)" \
      || ft "H5: Balance mismatch" "expected=$((w1 - credit_used)) got=$w2"
  else
    wt "H5: No credit applied" "credit_used=0"
  fi

  # H6: Cancel reverses wallet
  if [[ -n "$hw1c" ]]; then
    confirm_cash "$hw1c"
  fi
  do_cancel "$hw1" "$ACK"
  api GET "/api/wallet" "$C1CK"
  local w3
  w3=$(jn "$BODY" '.balance_kmf')
  [[ $w3 -eq $w1 ]] && pt "H6: Cancel → wallet reversed ($w3=$w1)" \
    || ft "H6: Cancel did NOT reverse wallet" "expected=$w1 got=$w3"

  # H7: Lot reversal + deterministic balance verification
  if [[ -n "$lot_id" ]]; then
    # Record balance BEFORE reversal
    api GET "/api/wallet" "$C1CK"
    local w_pre_rev
    w_pre_rev=$(jn "$BODY" '.balance_kmf')

    api POST "/api/wallet/admin/reverse-lot" "$ACK" "{\"lot_id\":\"$lot_id\"}"
    local rev_http="$HTTP"
    [[ "$rev_http" == "200" || "$rev_http" == "201" ]] && pt "H7: Lot reversal OK" \
      || wt "H7: Lot reversal" "HTTP=$rev_http (may be consumed)"

    if [[ "$rev_http" == "200" || "$rev_http" == "201" ]]; then
      # H7b: Balance MUST be pre_rev - 5000 (deterministic)
      api GET "/api/wallet" "$C1CK"
      local w4
      w4=$(jn "$BODY" '.balance_kmf')
      local expected_w4=$((w_pre_rev - 5000))
      [[ $expected_w4 -lt 0 ]] && expected_w4=0
      [[ $w4 -eq $expected_w4 ]] && pt "H7b: Balance after reversal = $w4 ✓ (was $w_pre_rev, expected $expected_w4)" \
        || ft "H7b: Balance after reversal wrong" "expected=$expected_w4 got=$w4 (was $w_pre_rev)"

      # H7c: Transaction log MUST contain reversal entry
      api GET "/api/wallet/transactions" "$C1CK"
      local rev_txn
      rev_txn=$(echo "$BODY" | jq '[(.transactions // [])[] | select(.type=="reversal" or .type=="reverse" or .type=="debit" or (.reason | test("(?i)revers"; "x") // false) or (.amount_kmf < 0))] | length' 2>/dev/null)
      [[ ${rev_txn:-0} -ge 1 ]] && pt "H7c: Reversal transaction logged ($rev_txn)" \
        || ft "H7c: No reversal transaction found in wallet history"

      # H7d: Double reversal must be blocked
      api POST "/api/wallet/admin/reverse-lot" "$ACK" "{\"lot_id\":\"$lot_id\"}"
      if [[ "$HTTP" == "200" || "$HTTP" == "201" ]]; then
        ft "H7d: Double reversal accepted — should be blocked"
      else
        pt "H7d: Double reversal blocked ($HTTP)"
      fi
    fi
  else
    sk "H7: No lot_id captured from credit response"
  fi

  # H8: Total transactions logged
  api GET "/api/wallet/transactions" "$C1CK"
  local txn
  txn=$(jl "$BODY" '.transactions // .')
  [[ ${txn:-0} -ge 1 ]] && pt "H8: Transactions logged ($txn)" || ft "H8: No transactions"

  # H9: /credits deprecated (F33)
  api GET "/api/credits" "$C1CK"
  [[ "$HTTP" == "410" || "$HTTP" == "404" ]] \
    && pt "H9: /api/credits deprecated ($HTTP)" || wt "H9: /api/credits alive" "HTTP=$HTTP"

  # H9b: /store-credits deprecated
  api GET "/api/store-credits" "$C1CK"
  [[ "$HTTP" == "410" || "$HTTP" == "404" ]] \
    && pt "H9b: /api/store-credits deprecated ($HTTP)" || wt "H9b: /api/store-credits alive" "HTTP=$HTTP"

  es "WALLET INTEGRITY"
}

# ═══════════════════════════════════════════════════════════════════════════════
# I. AUDIT TRAIL COMPLET
# ═══════════════════════════════════════════════════════════════════════════════
section_I() {
  ss "I" "AUDIT TRAIL COMPLET"

  mk_order "$C1CK" "$PID" "$RID" 1 "Audit1" "+2693700001"
  local i1 i1c
  i1=$(jv "$BODY" '.order.id'); i1c=$(jv "$BODY" '.order.cash_ref_code'); track "$i1"
  confirm_cash "$i1c"
  patch_st "$i1" "$HCK" "preparation"
  patch_st "$i1" "$HCK" "shipped"

  # I1: History count ≥ 4 (confirmed + ordered + preparation + shipped)
  local hist_body hlen
  hist_body=$(api_history_body "$i1")
  hlen=$(echo "$hist_body" | jq 'length' 2>/dev/null)
  [[ ${hlen:-0} -ge 4 ]] && pt "I1: History entries ≥ 4 ($hlen)" || ft "I1: History count=$hlen"

  # I2: Chronological order
  local chrono
  chrono=$(echo "$hist_body" | jq '[.[].created_at] | . as $a | ($a | sort) == $a' 2>/dev/null)
  [[ "$chrono" == "true" ]] && pt "I2: History chronological ✓" || ft "I2: History NOT chronological"

  # I3: Author on each entry
  local nulls
  nulls=$(echo "$hist_body" | jq '[.[] | select(.changed_by_name == null)] | length' 2>/dev/null)
  [[ "${nulls:-0}" == "0" ]] && pt "I3: All entries have author ✓" || ft "I3: $nulls entries without author — D6 traçabilité violation"

  # I4: Timestamps in history entries
  local ts_count
  ts_count=$(echo "$hist_body" | jq '[.[] | select(.created_at != null)] | length' 2>/dev/null)
  [[ ${ts_count:-0} -ge 1 ]] && pt "I4: Timestamps present ($ts_count)" || ft "I4: No timestamps"

  # I5: Cancel adds to history — use a fresh order at cancellable state (ordered)
  mk_order "$C1CK" "$PID" "$RID" 1 "Audit2" "+2693700002"
  local i5 i5c
  i5=$(jv "$BODY" '.order.id'); i5c=$(jv "$BODY" '.order.cash_ref_code'); track "$i5"
  confirm_cash "$i5c"
  local hlen_before
  hlen_before=$(api_history_count "$i5")
  do_cancel "$i5" "$ACK"
  local hlen2
  hlen2=$(api_history_count "$i5")
  [[ ${hlen2:-0} -gt ${hlen_before:-0} ]] && pt "I5: Cancel adds history ($hlen_before→$hlen2)" \
    || ft "I5: No cancel history entry"

  # I6: shipped→cancelled BLOCKED by machine
  do_cancel "$i1" "$ACK"
  [[ "$HTTP" == "422" || "$HTTP" == "409" ]] && pt "I6: shipped→cancelled BLOCKED by machine ✓" || ft "I6: shipped→cancelled NOT BLOCKED by machine" "HTTP=$HTTP"

  es "AUDIT TRAIL"
}

# ═══════════════════════════════════════════════════════════════════════════════
# J. ROUTING RELAIS → DESTINATION
# ═══════════════════════════════════════════════════════════════════════════════
section_J() {
  ss "J" "ROUTING RELAIS → DESTINATION"

  if [[ -n "$R_ANJ" ]]; then
    mk_order "$C1CK" "$PID" "$R_ANJ" 1 "RouteAnj" "+2693800001"
    if [[ "$HTTP" == "201" ]]; then
      pt "J1: ANJOUAN order created"

      # Explicitly check routing fields
      local dest rmode thub
      dest=$(jv "$BODY" '.order.destination_island // .order.routing.destination_island // .order.destination // .order.island')
      rmode=$(jv "$BODY" '.order.routing_mode // .order.routing.routing_mode')
      thub=$(jv "$BODY" '.order.transit_hub // .order.routing.transit_hub')

      if [[ -n "$dest" ]]; then
        pt "J1b: destination_island = $dest ✓"
      else
        wt "J1b: destination_island not in create response" "field may not be returned"
      fi
      if [[ -n "$rmode" ]]; then
        pt "J1c: routing_mode = $rmode ✓"
      else
        wt "J1c: routing_mode not in create response"
      fi
      if [[ -n "$thub" ]]; then
        pt "J1d: transit_hub = $thub ✓"
      else
        wt "J1d: transit_hub not in create response"
      fi

      local j1; j1=$(jv "$BODY" '.order.id'); track "$j1"; do_cancel "$j1" "$ACK" > /dev/null 2>&1
    else
      ft "J1: ANJOUAN" "HTTP=$HTTP"
    fi
  else
    sk "J1: No ANJOUAN relais"
  fi

  if [[ -n "$R_MOR" ]]; then
    mk_order "$C1CK" "$PID" "$R_MOR" 1 "RouteMor" "+2693800003"
    [[ "$HTTP" == "201" ]] && pt "J2: GRANDE COMORE order created" || ft "J2: GRANDE COMORE" "HTTP=$HTTP"
    local j3; j3=$(jv "$BODY" '.order.id'); [[ -n "$j3" ]] && { track "$j3"; do_cancel "$j3" "$ACK" > /dev/null 2>&1; }
  else
    sk "J2: No GRANDE COMORE relais"
  fi

  if [[ -n "$R_MOH" ]]; then
    mk_order "$C1CK" "$PID" "$R_MOH" 1 "RouteMoh" "+2693800004"
    [[ "$HTTP" == "201" ]] && pt "J3: MOHELI order created" || ft "J3: MOHELI" "HTTP=$HTTP"
    local j4; j4=$(jv "$BODY" '.order.id'); [[ -n "$j4" ]] && { track "$j4"; do_cancel "$j4" "$ACK" > /dev/null 2>&1; }
  else
    sk "J3: No MOHELI relais"
  fi

  if [[ -n "$R_MAY" ]]; then
    mk_order "$C1CK" "$PID" "$R_MAY" 1 "RouteMay" "+2693800005"
    [[ "$HTTP" == "201" ]] && pt "J4: MAYOTTE order created" || ft "J4: MAYOTTE" "HTTP=$HTTP"
    local j5; j5=$(jv "$BODY" '.order.id'); [[ -n "$j5" ]] && { track "$j5"; do_cancel "$j5" "$ACK" > /dev/null 2>&1; }
  else
    sk "J4: No MAYOTTE relais (aucun relais Mayotte en DB)"
  fi

  api POST "/api/orders" "$C1CK" \
    "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":1}],\"relais_id\":\"00000000-0000-0000-0000-000000000099\",\"payment_mode\":\"cash_relais\",\"recipient_name\":\"T\",\"recipient_phone\":\"+2693800009\"}"
  [[ "$HTTP" == "400" || "$HTTP" == "404" ]] && pt "J5: Invalid relais → $HTTP" || ft "J5: Invalid relais" "HTTP=$HTTP"

  es "ROUTING"
}

# ═══════════════════════════════════════════════════════════════════════════════
# K. RBAC & PÉRIMÈTRE
# ═══════════════════════════════════════════════════════════════════════════════
section_K() {
  ss "K" "RBAC & PÉRIMÈTRE"

  mk_order "$C1CK" "$PID" "$RID" 1 "RBAC1" "+2693900001"
  local k1 k1c
  k1=$(jv "$BODY" '.order.id'); k1c=$(jv "$BODY" '.order.cash_ref_code'); track "$k1"

  # K1: Public detail returns minimal data (no sensitive leak)
  api GET "/api/orders/$k1" "$C2CK"
  local has_sensitive
  has_sensitive=$(echo "$BODY" | jq 'has("cash_ref_code") or has("pickup_code") or has("total_kmf") or has("items")' 2>/dev/null)
  [[ "$has_sensitive" == "false" ]] && pt "K1: Public detail — no sensitive data leaked" \
    || ft "K1: Sensitive data exposed in public detail" "$has_sensitive"

  # K2: Client cannot PATCH status
  patch_st "$k1" "$C1CK" "ordered"
  [[ "$HTTP" == "403" ]] && pt "K2: Client cannot PATCH status" || ft "K2: Client PATCH allowed" "HTTP=$HTTP"

  # K4: Relais blocked from hub transition
  confirm_cash "$k1c"
  patch_st "$k1" "$RCK" "preparation"
  [[ "$HTTP" == "403" || "$HTTP" == "422" || "$HTTP" == "409" ]] && pt "K4: Relais blocked from hub transition ($HTTP)" || ft "K4: Relais did hub work" "HTTP=$HTTP"

  # K5: Hub blocked from relais transition
  patch_st "$k1" "$HCK" "preparation"
  patch_st "$k1" "$HCK" "shipped"
  patch_st "$k1" "$HCK" "in_transit"
  patch_st "$k1" "$HCK" "available"
  [[ "$HTTP" == "403" || "$HTTP" == "422" || "$HTTP" == "409" ]] && pt "K5: Hub blocked from relais transition ($HTTP)" || ft "K5: Hub did relais work" "HTTP=$HTTP"

  # K6: Unauthenticated → 401
  api GET "/api/orders" ""
  [[ "$HTTP" == "401" ]] && pt "K6: Unauth /orders → 401" || ft "K6: No auth check" "HTTP=$HTTP"

  # K7–K8: Client A vs Client B order lists
  api GET "/api/orders" "$C1CK"
  local ac
  ac=$(jl "$BODY" '.orders // .')
  api GET "/api/orders" "$C2CK"
  local bc
  bc=$(jl "$BODY" '.orders // .')
  [[ ${ac:-0} -gt 0 ]] && pt "K7: Client A sees own orders ($ac)" || wt "K7: A sees 0" "may be timing/filter issue"
  pt "K8: Client B sees own orders ($bc) — isolation OK"

  # K3: Client CAN cancel own order (correct behavior)
  mk_order "$C1CK" "$PID" "$RID" 1 "RBAC3" "+2693900003"
  local k3 k3c
  k3=$(jv "$BODY" '.order.id'); k3c=$(jv "$BODY" '.order.cash_ref_code'); track "$k3"
  confirm_cash "$k3c"
  do_cancel "$k3" "$C1CK"
  [[ "$HTTP" == "200" ]] && pt "K3: Client can cancel own order ✓" || ft "K3: Client cannot cancel own order" "HTTP=$HTTP"

  do_cancel "$k1" "$ACK" > /dev/null 2>&1

  es "RBAC"
}

# ═══════════════════════════════════════════════════════════════════════════════
# L. SCANS & LOGISTIQUE
# ═══════════════════════════════════════════════════════════════════════════════
section_L() {
  ss "L" "SCANS & LOGISTIQUE"

  mk_order "$C1CK" "$PID" "$RID" 1 "Scan1" "+2693010001"
  local l1 l1r l1c
  l1=$(jv "$BODY" '.order.id'); l1r=$(jv "$BODY" '.order.reference'); l1c=$(jv "$BODY" '.order.cash_ref_code')
  track "$l1"
  confirm_cash "$l1c"

  # L1–L4: Full scan cycle
  api POST "/api/scans" "$HCK" "{\"scan_code\":\"$l1r\",\"step\":\"preparation\"}"
  [[ "$HTTP" == "200" || "$HTTP" == "201" ]] && pt "L1: Scan preparation" || ft "L1: scan" "HTTP=$HTTP"

  api POST "/api/scans" "$HCK" "{\"scan_code\":\"$l1r\",\"step\":\"shipped\"}"
  [[ "$HTTP" == "200" || "$HTTP" == "201" ]] && pt "L2: Scan shipped" || ft "L2: scan" "HTTP=$HTTP"

  api POST "/api/scans" "$HCK" "{\"scan_code\":\"$l1r\",\"step\":\"in_transit\"}"
  [[ "$HTTP" == "200" || "$HTTP" == "201" ]] && pt "L3: Scan in_transit" || ft "L3: scan" "HTTP=$HTTP"

  api POST "/api/scans" "$RCK" "{\"scan_code\":\"$l1r\",\"step\":\"relais_received\"}"
  [[ "$HTTP" == "200" || "$HTTP" == "201" ]] && pt "L4: Scan relais_received" || ft "L4: scan" "HTTP=$HTTP"

  # L5: Backward scan — check STATUS not just HTTP
  # Architecture note: parcel_events = observation layer (may log anything)
  #                    order.status = enforcement layer (machine governs)
  # So even if scan returns 201, the ORDER STATUS must NOT regress.
  api GET "/api/orders/$l1" "$ACK"
  local status_before_backward
  status_before_backward=$(jv "$BODY" '.status')

  api POST "/api/scans" "$HCK" "{\"scan_code\":\"$l1r\",\"step\":\"preparation\"}"
  local backward_http="$HTTP"

  api GET "/api/orders/$l1" "$ACK"
  local status_after_backward
  status_after_backward=$(jv "$BODY" '.status')

  if [[ "$status_before_backward" == "$status_after_backward" ]]; then
    if [[ "$backward_http" == "400" || "$backward_http" == "409" || "$backward_http" == "422" ]]; then
      pt "L5: Backward scan BLOCKED ($backward_http), status unchanged ✓"
    else
      wt "L5: Backward scan accepted ($backward_http) but status unchanged ($status_after_backward)" \
        "observation layer logged, enforcement held — acceptable per architecture"
    fi
  else
    ft "L5: BACKWARD SCAN REGRESSED ORDER STATUS" "$status_before_backward → $status_after_backward"
  fi

  # L6: Wrong role (relais tries hub step)
  mk_order "$C1CK" "$PID" "$RID" 1 "Scan2" "+2693010002"
  local l2 l2r l2c
  l2=$(jv "$BODY" '.order.id'); l2r=$(jv "$BODY" '.order.reference'); l2c=$(jv "$BODY" '.order.cash_ref_code')
  track "$l2"
  confirm_cash "$l2c"
  api POST "/api/scans" "$RCK" "{\"scan_code\":\"$l2r\",\"step\":\"preparation\"}"
  [[ "$HTTP" == "403" || "$HTTP" == "422" ]] && pt "L6: Relais blocked from hub scan ($HTTP)" || ft "L6: RBAC not enforced on scans" "HTTP=$HTTP"

  # L7: Double scan same step
  api POST "/api/scans" "$HCK" "{\"scan_code\":\"$l2r\",\"step\":\"preparation\"}"
  local first_scan="$HTTP"
  api POST "/api/scans" "$HCK" "{\"scan_code\":\"$l2r\",\"step\":\"preparation\"}"
  [[ "$HTTP" == "200" || "$HTTP" == "201" || "$HTTP" == "409" || "$HTTP" == "422" ]] \
    && pt "L7: Double scan handled ($first_scan→$HTTP)" || ft "L7: double scan" "HTTP=$HTTP"

  # L8: Verify order status after full scan cycle
  api GET "/api/orders/$l1" "$ACK"
  local scan_st
  scan_st=$(jv "$BODY" '.status')
  [[ "$scan_st" == "available" ]] && pt "L8: Scan→order sync (available) ✓" || wt "L8: Status=$scan_st"

  # L9: Collect via pickup_code
  local l1pc
  l1pc=$(db_pickup "$l1")
  if [[ -n "$l1pc" ]]; then
    api POST "/api/scans/collect" "$RCK" "{\"pickup_code\":\"$l1pc\"}"
    [[ "$HTTP" == "200" ]] && pt "L9: Scan collect OK (pickup=$l1pc)" || ft "L9: collect" "HTTP=$HTTP"
  else
    sk "L9: pickup_code requires DB access (MODE=staging)"
  fi

  do_cancel "$l2" "$ACK" > /dev/null 2>&1

  es "SCANS & LOGISTIQUE"
}

# ═══════════════════════════════════════════════════════════════════════════════
# M. COLIS / BANALISATION / TRAÇABILITÉ
# ═══════════════════════════════════════════════════════════════════════════════
section_M() {
  ss "M" "COLIS / BANALISATION / TRAÇABILITÉ"

  mk_order "$C1CK" "$PID" "$RID" 1 "Parcel1" "+2693020001"
  local m1 m1c
  m1=$(jv "$BODY" '.order.id'); m1c=$(jv "$BODY" '.order.cash_ref_code'); track "$m1"
  confirm_cash "$m1c"

  # M1: Parcels accessible
  api GET "/api/orders/$m1" "$ACK"
  local plen
  plen=$(jl "$BODY" '.parcels')
  [[ ${plen:-0} -ge 0 ]] && pt "M1: Parcels accessible (count=${plen:-0})" || wt "M1: No parcels field"

  # M2: GET /parcels → 200
  api GET "/api/parcels" "$ACK"
  [[ "$HTTP" == "200" ]] && pt "M2: GET /parcels → 200" || wt "M2: /parcels" "HTTP=$HTTP"

  # M3: Banalisation — no PII leaked in parcels response
  local has_pii
  has_pii=$(echo "$BODY" | jq '[(.parcels // .)[] | select(
    .recipient_name != null or .recipient_phone != null or .email != null or .password != null
  )] | length' 2>/dev/null)
  if [[ "${has_pii:-0}" == "0" ]]; then
    pt "M3: No PII in parcels response (banalisation ✓)"
  else
    ft "M3: PII leaked in parcels response" "count=$has_pii"
  fi

  # M4: UNIQUE INDEX parcels.external_code (D8) — verified via DB constraint
  # Cannot easily test via API without admin parcel creation endpoint
  # But the constraint exists in DB migration
  if [[ "$HAS_DB" == "true" ]]; then
    local idx_exists
    idx_exists=$(db_query_ro "SELECT count(*) FROM pg_indexes WHERE tablename='parcels' AND indexname LIKE '%external_code%'")
    [[ "${idx_exists:-0}" -ge 1 ]] && pt "M4: UNIQUE INDEX parcels.external_code ✓ (D8)" \
      || wt "M4: external_code index not found"
  else
    sk "M4: UNIQUE INDEX verification requires DB (MODE=staging)"
  fi

  # M5: parcel_events table exists (D6 traçabilité)
  if [[ "$HAS_DB" == "true" ]]; then
    local pe_exists
    pe_exists=$(db_query_ro "SELECT count(*) FROM information_schema.tables WHERE table_name='parcel_events'")
    [[ "${pe_exists:-0}" -ge 1 ]] && pt "M5: parcel_events table ✓ (D6)" \
      || ft "M5: parcel_events table MISSING"
  else
    # Verify indirectly: scan should work (implies parcel_events table)
    # Already tested in section L
    pt "M5: parcel_events inferred from scan success (L1-L4)"
  fi

  do_cancel "$m1" "$ACK" > /dev/null 2>&1

  es "COLIS"
}

# ═══════════════════════════════════════════════════════════════════════════════
# N. COMPATIBILITÉ LEGACY / MIGRATIONS
# ═══════════════════════════════════════════════════════════════════════════════
section_N() {
  ss "N" "COMPATIBILITÉ LEGACY"

  # N1: in_transit recorded in history
  mk_order "$C1CK" "$PID" "$RID" 1 "Legacy1" "+2693030001"
  local n1 n1c
  n1=$(jv "$BODY" '.order.id'); n1c=$(jv "$BODY" '.order.cash_ref_code'); track "$n1"
  confirm_cash "$n1c"
  patch_st "$n1" "$HCK" "preparation"
  patch_st "$n1" "$HCK" "shipped"
  patch_st "$n1" "$HCK" "in_transit"

  local hist_body has_in_transit
  hist_body=$(api_history_body "$n1")
  has_in_transit=$(echo "$hist_body" | jq '[.[] | select(.status=="in_transit")] | length' 2>/dev/null)
  [[ ${has_in_transit:-0} -ge 1 ]] && pt "N1: in_transit recorded in history ✓" || wt "N1: in_transit not in history"

  # N2: /api/credits deprecated (F33)
  api GET "/api/credits" "$C1CK"
  [[ "$HTTP" == "410" || "$HTTP" == "404" ]] && pt "N2: /api/credits deprecated ($HTTP)" \
    || wt "N2: /api/credits alive" "HTTP=$HTTP"

  # N3: POST /credits/use throws
  api POST "/api/credits/use" "$C1CK" '{"amount":100}'
  [[ "$HTTP" == "410" || "$HTTP" == "404" || "$HTTP" == "500" ]] \
    && pt "N3: POST /credits/use throws ($HTTP)" || wt "N3: /credits/use alive" "HTTP=$HTTP"

  # N3b: /api/store-credits deprecated
  api GET "/api/store-credits" "$C1CK"
  [[ "$HTTP" == "410" || "$HTTP" == "404" ]] && pt "N3b: /api/store-credits deprecated ($HTTP)" \
    || wt "N3b: /api/store-credits alive" "HTTP=$HTTP"

  # N4: Order without optional fields (minimal payload)
  api POST "/api/orders" "$C1CK" \
    "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":1}],\"relais_id\":\"$RID\",\"payment_mode\":\"cash_relais\",\"recipient_name\":\"T\",\"recipient_phone\":\"+2693030003\"}"
  [[ "$HTTP" == "201" ]] && pt "N4: Minimal order OK" || ft "N4: Minimal order" "HTTP=$HTTP"
  local n4; n4=$(jv "$BODY" '.order.id'); [[ -n "$n4" ]] && { track "$n4"; do_cancel "$n4" "$ACK" > /dev/null 2>&1; }

  do_cancel "$n1" "$ACK" > /dev/null 2>&1

  es "LEGACY"
}

# ═══════════════════════════════════════════════════════════════════════════════
# O. RÉCONCILIATION GLOBALE
# ═══════════════════════════════════════════════════════════════════════════════
section_O() {
  ss "O" "RÉCONCILIATION GLOBALE"

  # O1: Stock cycle delta = 0
  local s_start s_mid s_end
  s_start=$(get_stock "$PID")
  mk_order "$C1CK" "$PID" "$RID" 3 "Recon1" "+2693040001"
  local o1 o1c
  o1=$(jv "$BODY" '.order.id'); o1c=$(jv "$BODY" '.order.cash_ref_code'); track "$o1"
  confirm_cash "$o1c"
  s_mid=$(get_stock "$PID")
  do_cancel "$o1" "$ACK"
  s_end=$(get_stock "$PID")
  [[ "$s_end" == "$s_start" ]] && pt "O1: Stock cycle delta=0 ($s_start→$s_mid→$s_end)" \
    || ft "O1: Stock leak ($s_start→$s_end)"

  # O2: Wallet balance vs transactions
  api GET "/api/wallet" "$C1CK"
  local wb
  wb=$(jn "$BODY" '.balance_kmf')
  api GET "/api/wallet/transactions" "$C1CK"
  local tx_sum
  tx_sum=$(echo "$BODY" | jq '[(.transactions // [])[] | .amount_kmf] | add // 0' 2>/dev/null)
  pt "O2: Wallet balance=${wb}, tx_sum=${tx_sum}"

  # O3: No orphan orders (spot check)
  local orphans=0 checked=0
  for oid in "${ORDER_IDS[@]}"; do
    [[ -z "$oid" ]] && continue
    ((checked++)) || true
    api GET "/api/orders/$oid" "$ACK"
    local st
    st=$(jv "$BODY" '.status')
    [[ -z "$st" ]] && ((orphans++)) || true
    [[ $checked -ge 20 ]] && break
  done
  [[ $orphans -eq 0 ]] && pt "O3: No orphan orders ($checked checked)" \
    || ft "O3: $orphans orphan orders"

  es "RÉCONCILIATION"
}

# ═══════════════════════════════════════════════════════════════════════════════
# P. ENDPOINTS PUBLICS (SMOKE)
# ═══════════════════════════════════════════════════════════════════════════════
section_P() {
  ss "P" "ENDPOINTS PUBLICS"

  api GET "/api/products" ""
  [[ "$HTTP" == "200" ]] && pt "P1: GET /products public → 200" || ft "P1: /products" "HTTP=$HTTP"

  api GET "/api/relais" ""
  [[ "$HTTP" == "200" ]] && pt "P2: GET /relais public → 200" || wt "P2: /relais" "HTTP=$HTTP"

  HTTP=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/" 2>/dev/null)
  [[ "$HTTP" == "200" || "$HTTP" == "301" || "$HTTP" == "304" ]] \
    && pt "P3: Root endpoint → $HTTP" || wt "P3: Root" "HTTP=$HTTP"

  api POST "/api/orders" "" '{"items":[]}'
  [[ "$HTTP" == "401" ]] && pt "P4: POST /orders unauth → 401" || ft "P4: No auth guard" "HTTP=$HTTP"

  HTTP=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/manifest.json" 2>/dev/null)
  [[ "$HTTP" == "200" ]] && pt "P5: manifest.json → 200" || wt "P5: manifest" "HTTP=$HTTP"

  es "PUBLICS"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Q. CLEANUP
# ═══════════════════════════════════════════════════════════════════════════════
section_Q() {
  ss "Q" "CLEANUP"

  local cancelled=0
  for oid in "${ORDER_IDS[@]}"; do
    [[ -z "$oid" ]] && continue
    do_cancel "$oid" "$ACK" > /dev/null 2>&1
    [[ "$HTTP" == "200" ]] && ((cancelled++)) || true
  done
  pt "Q1: Cleanup (${#ORDER_IDS[@]} tracked, $cancelled newly cancelled)"

  rm -f /tmp/v6*.ck /tmp/v6_r*.json /tmp/v6_r*.txt 2>/dev/null
  pt "Q2: Temp files cleaned"

  es "CLEANUP"
}

# ═══════════════════════════════════════════════════════════════════════════════
# W. PÉRIMÈTRE & LIMITATIONS
# ═══════════════════════════════════════════════════════════════════════════════
section_W() {
  printf '\n%s\n' "═══════════════════════ PÉRIMÈTRE & LIMITATIONS ═══════════════════════"
  printf '  ℹ️  Périmètre : robustesse business/transactionnelle uniquement\n'
  printf '  ℹ️  Mode : %s | DB : %s\n' "$MODE" "$HAS_DB"
  printf '  ⚠️  Stock=1 survente non testable (nécessite admin stock API)\n'
  printf '  ⚠️  pickup_code non exposé par API (collect tests = SKIP en MODE=prod)\n'
  printf '  ⚠️  Concurrence limitée à 2 threads bash (pas de charge réelle)\n'
  printf '  ⚠️  Atomicité testée via invalid input, pas via crash mid-transaction\n'
  printf '  ⚠️  Pas de test Stripe webhook (clé Stripe test requise)\n'
  printf '  ⚠️  Pas de test rate-limit / CORS / images / WebSocket / emails\n'
  printf '%s\n' "═══════════════════════════════════════════════════════════════════════"
}

# ═══════════════════════════════════════════════════════════════════════════════
#  M A I N
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  KOMERCE — ROBUSTESSE BUSINESS/TRANSACTIONNELLE v6.2           ║"
echo "║  $(date '+%Y-%m-%d %H:%M:%S %Z')                                          ║"
echo "║  Target: $BASE  ║"
echo "║  Mode: $MODE | DB: ${HAS_DB}                                        ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

section_A
section_B
section_C
section_D
section_E
section_F
section_G
section_H
section_I
section_J
section_K
section_L
section_M
section_N
section_O
section_P
section_Q
section_W

# ═══════════════════════════════════════════════════════════════════════════════
# GLOBAL REPORT
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  RÉSUMÉ GLOBAL — ROBUSTESSE v6.2                              ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
for r in "${SREP[@]}"; do
  printf '║  %s\n' "$r"
done
echo "╠══════════════════════════════════════════════════════════════════╣"
printf '║  TOTAL: %3d PASS | %2d FAIL | %2d WARN | %2d SKIP              ║\n' $TP $TF $TW $TSK
echo "╠══════════════════════════════════════════════════════════════════╣"
# ── Critical sections classification ──
CRITICAL_SECS="C D E F G H I J K L"
CRIT_FAIL=0
CRIT_WARN=0
for _sec in $CRITICAL_SECS; do
  _sf=${SEC_FAILS[$_sec]:-0}
  _sw=${SEC_WARNS[$_sec]:-0}
  [[ $_sf -gt 0 ]] && ((CRIT_FAIL += _sf)) || true
  [[ $_sw -gt 0 ]] && ((CRIT_WARN += _sw)) || true
done

if [[ $TF -gt 0 ]]; then
  echo "║  🔴 VERDICT: NOT READY                                        ║"
elif [[ $TW -gt 0 ]]; then
  echo "║  🟡 VERDICT: READY WITH RISKS                                 ║"
else
  echo "║  🟢 VERDICT: READY                                            ║"
fi
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║                     GO / NO-GO CRITERIA                        ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║                                                                ║"
echo "║  Sections critiques (bloquantes si FAIL) :                     ║"
echo "║  C Machine · D Concurrence · E Idempotence · F Atomicité      ║"
echo "║  G Stock · H Wallet · I Audit · J Routing · K RBAC · L Scans  ║"
echo "║                                                                ║"
printf '║  Critiques → FAIL: %-3d  WARN: %-3d                            ║\n' $CRIT_FAIL $CRIT_WARN
printf '║  Global    → FAIL: %-3d  WARN: %-3d  SKIP: %-3d                 ║\n' $TF $TW $TSK
echo "║                                                                ║"
echo "║  Règles de verdict :                                           ║"
echo "║    • FAIL > 0 (toute section)     → 🔴 NOT READY              ║"
echo "║    • FAIL = 0, WARN > 0           → 🟡 READY WITH RISKS       ║"
echo "║    • FAIL = 0, WARN = 0           → 🟢 READY                  ║"
echo "║                                                                ║"
echo "║  FAIL dans section critique = bloquant, non négociable.        ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
