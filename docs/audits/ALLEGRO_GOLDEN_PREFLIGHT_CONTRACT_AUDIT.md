# Allegro Golden Preflight Contract Audit

> **Date** : 2026-09-17 (v2 — rebasé sur main incluant PR #1592)
> **Branche audité** : `origin/main` @ `5e3953d` (post-merge #1592)
> **Cible Golden** : `K4C61VO`
> **Auteur** : Claude (audit prédictif — aucun appel externe, aucune correction structurelle)

---

## 1. Executive Summary

Le Golden Allegro Sandbox peut produire une Purchase Order canonique
(native PLN, sans AED inventé). Le dernier BLOCKER DB (`suppliers_platform_check`)
est fermé par PR #1592 mergée. Il reste **un seul pré-requis conditionnel**
(inventory_model = SKU sur le produit cible) et des vérifications staging
à effectuer avant de lancer le runner.

### Tableau de bord

| Sévérité | Nombre | Résumé |
|----------|--------|--------|
| BLOCKER  | 0      | ~~suppliers_platform_check~~ fermé par #1592 |
| BLOCKER CONDITIONNEL | 1 | `products.inventory_model = 'SKU'` (vérifier en staging) |
| HIGH     | 2      | `callSupplierAPI` sans case allegro ; schema dump stale |
| MEDIUM   | 3      | AED fallback, adapter non branché sur core, `manual` validator/DB mismatch |
| LOW      | 2      | labels legacy, stubs Phase 2 |

### Chantier structurel identifié (hors-scope Golden)

Feature-First **`supplier-connectivity`** : Provider Registry + Capability
Contract + Adapter Registry + Provider Contract Suite. Documenté en
section 15. Ne doit PAS être lancé avant la fin du Golden.

---

## 2. Golden Path Réel — Reconstruit depuis le Code

```
1. Checkout (order-checkout-service.js)
   └→ resolveCheckoutItems (order-checkout-item-resolution.js)
       └→ product.inventory_model === 'SKU'
           └→ resolveActiveSku (product-sku-service.js)
               └→ item._resolved_sku_id = sku.id
   └→ persistOrderItems (order-checkout-persistence.js)
       └→ INSERT order_items … sku_id = _resolved_sku_id
       └→ INSERT order_items … fulfillment_source = 'IMPORT'

2. Cash Confirm (routes/cash.js L152)
   └→ triggerPurchasing(orderId)

3. triggerPurchasing (purchasing-trigger-service.js)
   └→ per order_item:
       ├─ fulfillment_source === 'LOCAL_STOCK' → skip
       ├─ loadExactSoldSku(item) — needs item.sku_id ≠ NULL
       │   └→ product_skus → supplier_sku, supplier_unit_ref, SOI
       ├─ resolveCanonicalSupplierMoney(exactSku)
       │   └→ canonical-unit-product-sku-resolution
       │       └→ current_state.purchase_price=29.90, currency=PLN
       │   └→ SOI cross-check: canonical === sold
       ├─ loadSupplierMapping(item, exactSku)
       │   └→ product_suppliers JOIN suppliers
       │   └→ WHERE platform = 'allegro'  ← #1592 closed
       ├─ findExistingPo → idempotence
       ├─ triggerMode = 'manual' (auto_order=false, ≠whatsapp)
       ├─ purchaseTarget = { 29.90, PLN }
       ├─ requireSupplierMoney → OK
       ├─ unitPriceAed = NULL (currency ≠ AED)
       └→ INSERT purchase_orders
           status=pending → notified → notifyAdminManual
```

---

## 3. Contrats Déjà Fermés

| # | Contrat | Preuve |
|---|---------|--------|
| 1 | `suppliers_platform_check` inclut `allegro` | PR #1592 — migration 240 + validator + 19 tests |
| 2 | SOI = autorité fournisseur | `supplier-order-identity.js` |
| 3 | Canonical Unit porte le prix natif | `purchasing-canonical-money.js` |
| 4 | PO native money columns | Migration 239 |
| 5 | PO idempotence | `findExistingPo()` + unique index (migration 225) |
| 6 | `unit_price_aed` explicitement nullable | L233 : `currency === 'AED' ? amount : null` |
| 7 | `product_suppliers.supplier_price_aed` nullable | Migration 239 |
| 8 | PLN dans ALLOWED_CURRENCIES | `supplier-order-identity.js` |
| 9 | Allegro connector V2 | `allegro-connector.js` |
| 10 | Allegro fulfillment adapter | `allegro-fulfillment-adapter.js` — mode manual |
| 11 | Allegro reconciliation | `allegro-purchase-reconciliation.js` |
| 12 | Auth + CSRF Golden | PR #1591 |
| 13 | Canonical mapping sans AED | PR #1589 |
| 14 | `sku_id` persisté au checkout | `order-checkout-persistence.js` L193-215 |
| 15 | Fulfillment source snapshot | `order-checkout-persistence.js` |
| 16 | SOI identity check PO | Migration 225 constraint |
| 17 | Supplier money pair check | Migration 239 constraint |

---

## 4. Blocage Conditionnel Restant

### COND-1 — `products.inventory_model = 'SKU'`

Le checkout résout le SKU (et popule `order_items.sku_id`) uniquement si
`product.inventory_model === 'SKU'`. Sans ça, le purchasing tombe dans le
legacy path → `supplier_price_aed` null → `SUPPLIER_MONEY_UNAVAILABLE`.

**Vérification staging requise** :
```sql
SELECT inventory_model FROM products WHERE id = '34a3a56e-c580-4abe-b245-a0c2ff5a7a42';
```

Le Golden checkout proof (`allegro-golden-customer-checkout-proof.js` L102)
asserte déjà `sku_id ≠ null`, donc si le checkout a passé, cet invariant
est vérifié. Mais il faut le confirmer avant de relancer.

---

## 5. Risques par Frontière

### HIGH-1 — `callSupplierAPI` sans case `allegro`

- **Fichier** : `purchasing-trigger-service.js:94-101`
- **Impact Golden actuel** : aucun (auto_order=false → manual → `callSupplierAPI` jamais appelé)
- **Impact futur** : bloque tout auto_order Allegro
- **Chantier** : Feature `supplier-connectivity` — Adapter Registry

### HIGH-2 — Schema dump stale

- **Fichier** : `docs/db/railway-live-schema.sql`
- **Impact runtime** : aucun (migrations Mode B appliquées)
- **Impact CI** : schema-freshness gate rouge
- **Fix** : `npm run db:snapshot` post-déploiement
- **Leçon apprise** : ne jamais éditer ce fichier manuellement (cf. incident #1592 v1)

### MEDIUM-1 — `PLATFORMS` validator / DB mismatch

- `validators/index.js` inclut `manual` ; DB CHECK ne l'a pas
- Non bloquant pour Allegro, dette à fermer dans le lot structurel

### MEDIUM-2 — AED fallback silencieux

- `purchasing-trigger-service.js:229-230` force `currency: 'AED'` quand exactSku est null
- Non atteint si inventory_model = SKU

### MEDIUM-3 — Adapter fulfillment non branché sur core

- `allegro-fulfillment-adapter.js` existe mais n'est pas appelé par `callSupplierAPI`
- Non bloquant en mode manual

---

## 6. Purchasing Readiness de K4C61VO

### Prédicat exact tracé

Avec les données connues et #1592 mergée :

1. `fulfillment_source ≠ LOCAL_STOCK` → continue
2. `sku_id = 127d107e…` → `loadExactSoldSku` → OK
3. `supplier_sku = allegro-sandbox:7782182471` → non vide ✓
4. `SOI.provider = allegro` → `normalizeIdentity` OK
5. `resolveCanonicalSupplierMoney` → `purchase_price=29.90, currency=PLN` → OK
6. `loadSupplierMapping` → `platform = allegro` → **✅ #1592 fermé**
7. `findExistingPo` → null (first run)
8. `triggerMode = manual`
9. `requireSupplierMoney({29.90, PLN})` → OK
10. `unitPriceAed = null`
11. INSERT PO → `status=notified`

**Verdict : PO créée** — `supplier_unit_price=29.90, supplier_currency=PLN, unit_price_aed=NULL`

---

## 7. Conditions Avant le Prochain Golden

| # | Condition | Comment vérifier |
|---|-----------|------------------|
| 1 | ~~PR #1592 mergée~~ | ✅ Fait |
| 2 | Migration 240 appliquée sur staging | `SELECT 1 FROM suppliers WHERE platform='allegro'` ne viole plus |
| 3 | `products.inventory_model = 'SKU'` | `SELECT inventory_model FROM products WHERE id='34a3a56e…'` |
| 4 | Migrations 225 + 239 appliquées | `SELECT supplier_unit_price FROM purchase_orders LIMIT 0` ne plante pas |
| 5 | Canonical Unit RESOLVED pour SKU 127d107e | `resolveCanonicalUnitForProductSku('127d107e…')` |
| 6 | Preflight Contract Suite 23/23 verte | `npx jest allegro-golden-preflight-contract` |

---

## 8. Gouvernance `railway-live-schema.sql`

**Règle formalisée** (leçon #1592 v1) :

```
migrations/  →  déploiement DB  →  snapshot réel  →  railway-live-schema.sql
```

**Jamais** :
```
développeur  →  édite railway-live-schema.sql à la main
```

Toucher ce fichier déplace le commit baseline CI et cause des migrations
Mode B à être baselinées sans être exécutées.

---

## 9. Chantier Structurel Post-Golden : Feature `supplier-connectivity`

**Ne pas lancer avant la fin du Golden.** Allegro continue de révéler
les concepts réels nécessaires à cette feature. Abstraire trop tôt
serait prématuré.

### Scope

```
FEATURE: supplier-connectivity
│
├── Provider Registry (remplace CHECK + validator lists)
├── Provider Identity Contract
├── Capability Contract (fetchProduct, refreshStock, placeOrder, …)
├── Adapter Registry (fail-closed)
├── Environment Contract (sandbox / production)
├── Supplier Money Contract
└── Provider Contract Suite
```

### Principe

```
Purchasing → Supplier Connectivity : autorisé
Purchasing → Allegro adapter direct : interdit
```

### Ce qu'Allegro a révélé

| Déjà agnostique | Encore provider-coupled | Legacy dans le core |
|------------------|------------------------|---------------------|
| Canonical Product/Unit | platforms allowlist | supplier_price_aed fallback |
| supplier_order_identity | adapter dispatch (switch/case) | unit_price_aed compat |
| native supplier money | capabilities non déclarées | |
| SKU exact + PO | | |
| idempotence | | |
