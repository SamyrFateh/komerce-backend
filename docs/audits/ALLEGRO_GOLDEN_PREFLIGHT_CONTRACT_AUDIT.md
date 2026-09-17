# Allegro Golden Preflight Contract Audit

> **Date** : 2026-09-17
> **Branche audité** : `origin/main` @ `a886bb5f`
> **Cible Golden** : `K4C61VO`
> **Auteur** : Claude (audit prédictif — aucun appel externe, aucune correction structurelle)

---

## 1. Executive Summary

Le Golden Allegro Sandbox peut produire une Purchase Order canonique (native PLN, sans AED inventé) **à condition que 2 pré-requis soient fermés** — un patch DB déjà en PR et un invariant seed/onboarding du produit cible.

La chaîne interne est architecturalement cohérente : Checkout → SKU resolution → Canonical Unit → SOI → Purchasing → PO. Aucun HARD_STOP structurel n'a été identifié au-delà des 2 blocages certains listés ci-dessous.

| Sévérité | Nombre | Résumé |
|----------|--------|--------|
| BLOCKER  | 1      | `suppliers_platform_check` (PR #1592) |
| BLOCKER CONDITIONNEL | 1 | `products.inventory_model = 'SKU'` pour le produit cible |
| HIGH     | 3      | `callSupplierAPI` sans allegro, schema dump stale, `PLATFORMS` / DB mismatch |
| MEDIUM   | 3      | AED fallback silencieux, adapter pas branché sur core, schema-freshness CI rouge |
| LOW      | 2      | labels/commentaires legacy, stubs Phase 2 |

---

## 2. Golden Path Réel — Reconstruit depuis le Code

```
1. Checkout (order-checkout-service.js)
   └── resolveCheckoutItems (order-checkout-item-resolution.js)
       └── product.inventory_model === 'SKU'
           └── resolveActiveSku (product-sku-service.js)
               └── item._resolved_sku_id = sku.id
   └── persistOrderItems (order-checkout-persistence.js)
       └── INSERT order_items … sku_id = _resolved_sku_id
       └── INSERT order_items … fulfillment_source = 'IMPORT'

2. Cash Confirm (routes/cash.js L152)
   └── triggerPurchasing(orderId)

3. triggerPurchasing (purchasing-trigger-service.js)
   └── per order_item:
       ├── fulfillment_source === 'LOCAL_STOCK' → skip
       ├── loadExactSoldSku(item) — needs item.sku_id ≠ NULL
       │   └── product_skus → supplier_sku, supplier_unit_ref, supplier_order_identity
       ├── resolveCanonicalSupplierMoney(exactSku)
       │   └── sourcing-canonical-unit-product-sku-resolution.js
       │       └── sourcing-catalog-product-linkage → canonical product id
       │       └── sourcing_canonical_entities (unit grain, active)
       │       └── sourcing-canonical-unit-projection → current_state
       │           └── { purchase_price: 29.90, currency: 'PLN', supplier_order_identity: {...} }
       │   └── normalizeIdentity cross-check: canonical SOI === sold SKU SOI
       ├── loadSupplierMapping(item, exactSku)
       │   └── product_suppliers JOIN suppliers
       │   └── WHERE platform = lower(exactSku.identity.provider) = 'allegro'
       │   └── ⚡ REQUIRES suppliers_platform_check to include 'allegro'
       ├── findExistingPo → idempotence check
       ├── triggerMode = 'manual' (auto_order=false, platform≠whatsapp)
       ├── purchaseTarget = { supplier_unit_price: 29.90, supplier_currency: 'PLN' }
       ├── requireSupplierMoney → OK
       ├── unitPriceAed = NULL (currency ≠ 'AED')
       └── INSERT purchase_orders
           (supplier_unit_price=29.90, supplier_currency='PLN', unit_price_aed=NULL)
           status='pending' → UPDATE status='notified'
           → notifyAdminManual()
```

---

## 3. Contrats Déjà Fermés

| # | Contrat | Preuve |
|---|---------|--------|
| 1 | SOI = autorité fournisseur | `supplier-order-identity.js` — `normalizeIdentity()` exige provider, version ≥ 1, payload objet non vide, supplier_unit_ref |
| 2 | Canonical Unit porte le prix natif | `purchasing-canonical-money.js` — `resolveCanonicalSupplierMoney()` extrait `purchase_price` + `currency` depuis la projection |
| 3 | PO native money columns | Migration 239 — `supplier_unit_price numeric(18,4)`, `supplier_currency text`, `supplier_total_price GENERATED` |
| 4 | PO idempotence | `findExistingPo()` + unique index `ux_purchase_orders_order_item_supplier_active` (migration 225) |
| 5 | `unit_price_aed` nullable | `unitPriceAed = money.currency === 'AED' ? money.amount : null` — explicite, pas de conversion |
| 6 | `product_suppliers.supplier_price_aed` nullable | Migration 239 `DROP NOT NULL` |
| 7 | PLN dans ALLOWED_CURRENCIES | `supplier-order-identity.js` L3 : `Set(['AED', 'EUR', 'USD', 'KMF', 'PLN'])` |
| 8 | Allegro connector V2 | `allegro-connector.js` — `normalizeOffer()` produit `NormalizedSupplierProduct V2` avec `currency: 'PLN'` |
| 9 | Allegro fulfillment adapter | `allegro-fulfillment-adapter.js` — `evaluate()` + `buildOrderPayload()` mode manual uniquement |
| 10 | Allegro reconciliation | `allegro-purchase-reconciliation.js` — `verifyCheckoutForm()` vérifie status=READY_FOR_PROCESSING, offerId, quantity, PLN |
| 11 | Auth + CSRF Golden | PR #1591 mergée |
| 12 | Canonical mapping sans AED | PR #1589 — `resolveCanonicalMappingMoney()` autorise `supplier_price_aed = NULL` |
| 13 | `sku_id` persisté au checkout | `order-checkout-persistence.js` L193-215 : `sku_id = item._resolved_sku_id` |
| 14 | Fulfillment source snapshot | `order-checkout-persistence.js` : `fulfillment_source` écrit sur `order_items` |
| 15 | SOI identity check PO | Migration 225 — CHECK constraint `chk_purchase_orders_supplier_order_identity_shape` |
| 16 | Supplier money pair check | Migration 239 — CHECK `chk_purchase_orders_supplier_money_pair` |

---

## 4. Blocages Certains

### BLOCKER-1 — `suppliers_platform_check` ne connaît pas `allegro`

| Champ | Valeur |
|-------|--------|
| **Fichier(s)** | `db/schema.sql:3755`, `validators/index.js:477`, migration 240 |
| **Fonction** | `INSERT INTO suppliers … platform='allegro'` |
| **Entrée** | Supplier creation via `POST /api/purchasing/suppliers` |
| **Invariant** | `platform = ANY(ARRAY['noon','amazon_uae','aliexpress','local','whatsapp'])` |
| **Sortie attendue** | supplier row créée |
| **Comportement fail-closed** | PostgreSQL 23514 check_violation → 500 |
| **Risque K4C61VO** | Bloque la création du fournisseur Allegro → pas de mapping → pas de PO |
| **Preuve existante** | PR #1592 avec 20 tests, non encore mergée |
| **Preuve manquante** | Merge + CI verte |
| **Sévérité** | **BLOCKER** |
| **Patch minimal** | Merger PR #1592 |

### BLOCKER-2 (conditionnel) — `products.inventory_model` doit être `'SKU'`

| Champ | Valeur |
|-------|--------|
| **Fichier(s)** | `services/order-checkout-item-resolution.js:103` |
| **Fonction** | `resolveCheckoutItems()` |
| **Entrée** | `product.inventory_model` du produit Allegro |
| **Invariant** | Si `inventory_model ≠ 'SKU'`, le checkout ne résout pas le SKU → `sku_id = null` sur `order_items` |
| **Sortie attendue** | `order_items.sku_id` peuplé |
| **Comportement fail-closed** | Purchasing tombe dans le chemin legacy → `supplier_price_aed` null → `SUPPLIER_MONEY_UNAVAILABLE` |
| **Risque K4C61VO** | Si le produit `34a3a56e…` n'est pas en mode SKU → HARD_STOP |
| **Preuve existante** | `allegro-golden-customer-checkout-proof.js` asserte `sku_id ≠ null` (L102) |
| **Preuve manquante** | Vérifier `SELECT inventory_model FROM products WHERE id = '34a3a56e…'` en staging |
| **Sévérité** | **BLOCKER si inventory_model ≠ 'SKU'**, sinon résolu |
| **Patch minimal** | `UPDATE products SET inventory_model = 'SKU' WHERE id = '34a3a56e…'` (si pas déjà fait par l'onboarding Allegro) |

---

## 5. Blocages Probables

### HIGH-1 — `callSupplierAPI` n'a pas de case `allegro`

| Champ | Valeur |
|-------|--------|
| **Fichier(s)** | `services/purchasing-trigger-service.js:94-101` |
| **Fonction** | `callSupplierAPI(ps, item)` |
| **Entrée** | `ps.platform = 'allegro'` |
| **Invariant** | switch/case hardcodé : noon, amazon_uae, aliexpress. Default = `{ success: false }` |
| **Sortie** | Pour `auto_order=true` : tombe en `api_failed_notified`. Pour `auto_order=false` (Golden) : **chemin non atteint** (le code va directement en mode manual) |
| **Risque K4C61VO** | **Aucun pour le Golden actuel** (auto_order=false). Bloquant pour futur auto_order. |
| **Preuve manquante** | Test que `auto_order=false` + `platform=allegro` → mode manual sans toucher `callSupplierAPI` |
| **Sévérité** | **HIGH** (futur), **LOW** (Golden actuel) |

### HIGH-2 — `db/schema.sql` massivement stale

| Champ | Valeur |
|-------|--------|
| **Fichier(s)** | `db/schema.sql` |
| **Colonnes manquantes sur `purchase_orders`** | `order_item_id`, `product_sku_id`, `supplier_unit_ref`, `supplier_order_identity`, `supplier_unit_price`, `supplier_currency` |
| **`product_suppliers.supplier_price_aed`** | Marqué `NOT NULL` dans le dump mais rendu nullable par migration 239 |
| **Impact runtime** | Aucun (les migrations Mode B sont appliquées sur la DB live) |
| **Impact CI** | `check-schema-freshness.js` est rouge (20 objets manquants, migrations 227-233 + 239) |
| **Sévérité** | **HIGH** (gouvernance CI cassée) |

### HIGH-3 — `PLATFORMS` validator / DB mismatch sur `manual`

| Champ | Valeur |
|-------|--------|
| **Fichier(s)** | `validators/index.js:477` vs `db/schema.sql:3755` |
| **Invariant** | Validator inclut `'manual'`, DB CHECK ne l'a pas |
| **Impact** | `POST /api/purchasing/suppliers { platform: 'manual' }` passe Joi → rejeté par PostgreSQL |
| **Risque K4C61VO** | Aucun (Allegro n'utilise pas `manual`) |
| **Sévérité** | **HIGH** (dette technique, autre produit potentiellement touché) |

---

## 6. Risques Legacy

### MEDIUM-1 — AED fallback silencieux dans le chemin legacy (purchasing-trigger-service.js:229-230)

Quand `exactSku` est null (pas de sku_id), le code force :
```js
supplier_unit_price: Number(ps.supplier_price_aed),
supplier_currency: 'AED',
```
Ce fallback est correct pour les fournisseurs historiques AED-only mais dangereux si un produit Allegro se retrouve sans sku_id : il produirait une PO avec `supplier_unit_price=NaN, supplier_currency='AED'` → `SUPPLIER_MONEY_UNAVAILABLE`.

**Risque K4C61VO** : inexistant si BLOCKER-2 est fermé (inventory_model = 'SKU').

### MEDIUM-2 — Allegro fulfillment adapter non branché sur `callSupplierAPI`

Le core purchasing (`callSupplierAPI`) ne connaît pas l'adapter Allegro. L'adapter existe (`allegro-fulfillment-adapter.js`) mais est utilisé uniquement par les scripts Golden, pas par le service de trigger. Le mode manual évite le problème aujourd'hui.

**Chantier structurel recommandé** : registre d'adapters provider-agnostic remplaçant le switch/case hardcodé.

### MEDIUM-3 — Schema freshness CI rouge

Déjà documenté en HIGH-2. Le `npm run db:snapshot` n'a pas été lancé depuis la baseline commit `cdea3f05` (219 migrations). 6 migrations sont post-snapshot en Mode B (235-240).

### LOW-1 — Labels legacy dans les commentaires et le code

`price_aed`, `total_price_aed` : colonnes toujours nommées AED mais économiquement legacy. Pas de risque fonctionnel.

### LOW-2 — Stubs Phase 2 (noon, amazon, aliexpress)

Fonctions stub qui retournent toujours `{ success: false }`. Comportement fail-closed correct.

---

## 7. Purchasing Readiness de K4C61VO

### Prédicat exact tracé dans `purchasing-trigger-service.js`

```
GIVEN:
  order_id = 0f384555-27b0-4561-8607-343d9daeaa3c
  product_id = 34a3a56e-c580-4abe-b245-a0c2ff5a7a42
  sku_id = 127d107e-9ce1-4e7e-be2e-a252b807905c
  supplier_sku = allegro-sandbox:7782182471
  SOI = { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: '7782182471' } }
  supplier price = 29.90 PLN
  stock = 10

TRACE:
  1. item.fulfillment_source ≠ 'LOCAL_STOCK'                    → continue
  2. item.sku_id = 127d107e… (non null)                         → loadExactSoldSku
  3. product_skus.supplier_sku = 'allegro-sandbox:7782182471'   → non vide ✓
  4. supplier_order_identity.provider = 'allegro'                → normalizeIdentity OK
  5. resolveCanonicalSupplierMoney:
     a. resolveCanonicalUnitForProductSku → STATUS.RESOLVED      → continue
     b. current_state.purchase_price = 29.90                     → > 0 ✓
     c. current_state.currency = 'PLN'                           → normalizeCurrency OK
     d. canonical SOI === sold SKU SOI                           → cross-check OK
  6. loadSupplierMapping:
     a. product_suppliers WHERE product_id AND is_active         → mapping exists
     b. suppliers WHERE platform = 'allegro' AND is_active       → ⚡ REQUIRES BLOCKER-1 fixed
  7. findExistingPo → null (first run)                           → continue
  8. triggerMode = 'manual' (auto_order=false, platform≠whatsapp)
  9. purchaseTarget.supplier_unit_price = 29.90
  10. purchaseTarget.supplier_currency = 'PLN'
  11. requireSupplierMoney → { amount: 29.90, currency: 'PLN' }  → OK
  12. unitPriceAed = null (currency ≠ 'AED')
  13. INSERT purchase_orders → status='pending'
  14. UPDATE status='notified'
  15. notifyAdminManual → WhatsApp admin notification

VERDICT: PO CRÉÉE (status=notified, trigger_mode=manual)
         supplier_unit_price=29.90, supplier_currency=PLN, unit_price_aed=NULL
```

---

## 8. Native-Money PO Proof

| Propriété | Valeur | Source code |
|-----------|--------|------------|
| `supplier_unit_price` | `29.90` | `canonicalMoney.unit_price` via `resolveCanonicalSupplierMoney` |
| `supplier_currency` | `PLN` | `canonicalMoney.currency` |
| `unit_price_aed` | `NULL` | `money.currency === 'AED' ? money.amount : null` (L233) |
| `supplier_total_price` | `29.90 * qty` | `GENERATED ALWAYS` (migration 239) |
| Conversion AED inventée | **Non** | Aucun code de conversion dans le chemin canonique |
| Fallback legacy | **Non** | Le chemin exactSku ≠ null n'utilise jamais `ps.supplier_price_aed` |
| DB constraint | `chk_purchase_orders_supplier_money_pair` | `29.90 > 0 AND 'PLN' ~ '^[A-Z]{3}$'` → PASS |

---

## 9. Idempotence / Duplicate Purchase Protection

| Couche | Mécanisme |
|--------|-----------|
| Application | `findExistingPo()` — SELECT avant INSERT, filtre `order_item_id + product_supplier_id + status ≠ cancelled` |
| DB | `ux_purchase_orders_order_item_supplier_active` — UNIQUE partiel (migration 225) |
| Sémantique | Deux appels `triggerPurchasing(orderId)` pour le même item → deuxième appel retourne `already_exists` |
| Trou connu | PO historiques sans `order_item_id` (NULL) ne sont pas couvertes par l'index unique — volontaire (pas de backfill heuristique) |

---

## 10. Allegro Adapter Contract

| Aspect | Fichier | État |
|--------|---------|------|
| Connector V2 | `services/suppliers/connectors/allegro-connector.js` | Complet — `normalizeOffer()` produit V2 |
| Fulfillment adapter | `services/suppliers/allegro-fulfillment-adapter.js` | Complet — mode manual uniquement |
| Sandbox client | `services/suppliers/allegro-sandbox-client.js` | Complet — OAuth, token rotation, encrypted refresh |
| Reconciliation | `services/suppliers/allegro-purchase-reconciliation.js` | Complet — vérifie `READY_FOR_PROCESSING` |
| Identity validation | `exactOfferId()` — provider=allegro, version=1, environment=sandbox, offer_id regex, cross-check refs |
| `buildOrderPayload` | Requiert `preflight.ready && manual_procurement_ready` |
| auto_order | **Non supporté** — Allegro n'expose pas de REST buyer checkout API |
| `callSupplierAPI` branché | **Non** — pas de case allegro, default retourne `success: false` |

### Données attendues par l'adapter pour construire la requête

| Champ | Source | Valeur K4C61VO |
|-------|--------|----------------|
| `identity.provider` | SOI | `'allegro'` |
| `identity.version` | SOI | `1` |
| `identity.payload.environment` | SOI | `'sandbox'` |
| `identity.payload.offer_id` | SOI | `'7782182471'` |
| `row.supplier_unit_ref` | product_skus | `'7782182471'` |
| `row.supplier_sku` | product_skus | `'allegro-sandbox:7782182471'` |
| `quantity` | order_item | `1` |

### Champs manquants

Aucun champ manquant identifié pour le mode manual sandbox.

---

## 11. Sandbox / Live Isolation

| Aspect | Sandbox | Live |
|--------|---------|------|
| API base | `api.allegro.pl.allegrosandbox.pl` | `api.allegro.pl` |
| Token endpoint | `allegro.pl.allegrosandbox.pl/auth/oauth/token` | `allegro.pl/auth/oauth/token` |
| SOI payload.environment | `'sandbox'` | `'production'` (non implémenté) |
| supplier_sku format | `allegro-sandbox:OFFER_ID` | Non défini |
| Env gate | `KOMERCE_ALLOW_ALLEGRO_SANDBOX=1` | Aucun client live codé |
| Seed gate | `KOMERCE_ENV=staging` + `KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED=1` | N/A |

**Risque de fuite sandbox→live** : aucun. L'URL API est hardcodée dans le client sandbox. Le SOI porte explicitement `environment: 'sandbox'` et l'adapter vérifie cette valeur.

---

## 12. Reconciliation Contract

| Aspect | Détail |
|--------|--------|
| Point d'entrée | `reconcile({ checkoutFormId, identity, quantity, ... })` |
| API call | `getSellerOrder(checkoutFormId)` → `/order/checkout-forms/{id}` |
| Status attendu | `READY_FOR_PROCESSING` (payment completed) |
| Line items | Exactement 1, offerId doit matcher |
| Quantity | Exacte (line.quantity === expected quantity) |
| Prix | `line.price.amount` > 0, `currency === 'PLN'` |
| Cross-checks | `checkoutFormId`, `offerId` via SOI, `supplier_unit_ref`, `supplier_sku` |
| Output | `{ verified: true, provider: 'allegro', environment: 'sandbox', ... }` |

---

## 13. Failure / Retry Contract

| Scénario | Comportement |
|----------|-------------|
| `loadExactSoldSku` échoue | `blockedSupplierIdentity` → alertItemFailure → SAVEPOINT rollback → `{ status: 'error' }` |
| `resolveCanonicalSupplierMoney` échoue | Idem |
| Pas de supplier mapping | `notifyAdminNoSupplier` → `{ status: 'no_supplier' }` |
| PO déjà existante | `{ status: 'already_exists' }` — idempotent |
| `callSupplierAPI` échoue | PO créée en `pending` → update `notified/manual` + notification admin |
| DB erreur item | SAVEPOINT rollback, alert insérée, continue les items suivants |
| DB erreur globale | ROLLBACK complet, exception propagée |
| Rejouer `triggerPurchasing` | Safe — l'idempotence retourne `already_exists` |

---

## 14. Preflight Suite Proposée

### Allegro Golden Preflight Contract Suite

Concept : valider toutes les briques internes AVANT l'appel externe final.

```
Internal contract proofs → all green → external Sandbox Golden authorised.
```

| # | Test | Prouve |
|---|------|--------|
| P-01 | `suppliers_platform_check` inclut `allegro` | BLOCKER-1 fermé |
| P-02 | Validator PLATFORMS inclut `allegro` | BLOCKER-1 fermé (applicatif) |
| P-03 | `purchase_orders` a les colonnes native money | Migration 239 appliquée |
| P-04 | `purchase_orders` a les colonnes SOI | Migration 225 appliquée |
| P-05 | `product_suppliers.supplier_price_aed` est nullable | Migration 239 appliquée |
| P-06 | `resolveCanonicalSupplierMoney` accepte un mock SKU Allegro | Chemin canonique |
| P-07 | `requireSupplierMoney` accepte `{ supplier_unit_price: 29.90, supplier_currency: 'PLN' }` | Native money |
| P-08 | `requireSupplierMoney` rejette `{ supplier_unit_price: NaN }` | Fail-closed |
| P-09 | `normalizeIdentity` accepte SOI Allegro v1 sandbox | SOI contract |
| P-10 | `normalizeIdentity` rejette SOI sans provider | Fail-closed |
| P-11 | `normalizeIdentity` rejette SOI sans supplier_unit_ref | Fail-closed |
| P-12 | `exactOfferId` accepte une identity Allegro sandbox correcte | Adapter contract |
| P-13 | `exactOfferId` rejette un mismatch provider/environment | Adapter isolation |
| P-14 | `verifyCheckoutForm` accepte une réponse READY_FOR_PROCESSING | Reconciliation |
| P-15 | `verifyCheckoutForm` rejette status BOUGHT | Reconciliation fail-closed |
| P-16 | PO INSERT avec `supplier_currency='PLN', unit_price_aed=NULL` est valide (schema check) | DB contract |
| P-17 | PO INSERT avec `supplier_currency='INVALID'` viole la constraint | DB fail-closed |
| P-18 | Idempotence : deux trigger pour le même item → 1 PO | Duplicate protection |
| P-19 | `triggerMode = 'manual'` pour platform=allegro, auto_order=false | Flow routing |
| P-20 | Chemin legacy (sku_id=null) avec supplier_price_aed=null → SUPPLIER_MONEY_UNAVAILABLE | Fail-closed safety net |

---

## 15. Ordre Recommandé des Corrections

1. **Merger PR #1592** — `suppliers_platform_check` + validator (déjà prêt, 20 tests)
2. **Vérifier `products.inventory_model`** du produit cible en staging
3. **Vérifier que migrations 225 + 239 sont appliquées** sur la DB staging
4. **Rafraîchir schema dump** — `npm run db:snapshot` (débloquer CI)
5. *(Structurel — hors Golden)* Brancher l'adapter Allegro sur un registre d'adapters
6. *(Structurel — hors Golden)* Aligner `manual` entre validator et DB CHECK
7. *(Structurel — hors Golden)* Documenter la dette AED fallback

---

## 16. Conditions Exactes pour Autoriser le Prochain Golden Réel

| # | Condition | Vérifié par |
|---|-----------|-------------|
| 1 | PR #1592 mergée | CI verte |
| 2 | `products.inventory_model = 'SKU'` pour `34a3a56e…` | `SELECT inventory_model FROM products WHERE id = '34a3a56e…'` |
| 3 | Migration 225 appliquée sur staging | Présence de `purchase_orders.supplier_order_identity` |
| 4 | Migration 239 appliquée sur staging | Présence de `purchase_orders.supplier_unit_price` |
| 5 | Canonical Unit RESOLVED pour SKU `127d107e…` | `resolveCanonicalUnitForProductSku('127d107e…')` |
| 6 | product_skus `127d107e…` a SOI Allegro sandbox | `SELECT supplier_order_identity FROM product_skus WHERE id = '127d107e…'` |
| 7 | Preflight Contract Suite 20/20 verte | `npx jest allegro-golden-preflight-contract` |

**Si ces 7 conditions sont vertes** → le Golden peut tourner sans surprise interne.
