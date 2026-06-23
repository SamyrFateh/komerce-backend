# Audit schéma DB — Sourcing (Lot C4)

> Créé : **2026-06-23**
> Source : `docs/db/railway-live-schema.sql` (DB live Railway)
> Périmètre : tables `products`, `sourcing_candidates`, `sourcing_candidate_events`, `partners`, `supplier_catalog_imports`, `pricing_components`, `cost_components`.

---

## 1. Résumé des findings

| # | Sévérité | Sujet | Table | Lot associé |
|---|---|---|---|---|
| F-01 | 🔴 Critique | Colonnes coût en doublon actif | `products` | C5 |
| F-02 | 🔴 Critique | Colonnes poids en doublon actif | `products` | C5 |
| F-03 | 🟡 Moyen | `partner_type` : texte libre sans ENUM DB | `partners` | C7 |
| F-04 | 🟡 Moyen | FK manquante `sourcing_candidates.komerce_category` | `sourcing_candidates` | À créer |
| F-05 | 🟢 Faible | Index manquant `sourcing_candidates.state + import_id` (composite) | `sourcing_candidates` | C7 (guard) |
| F-06 | 🟢 Faible | `products.sourcing_rail` : texte libre sans contrainte DB | `products` | C7 |
| F-07 | ℹ️ Info | `partners` n'a pas de FK vers `sourcing_candidates` | `partners` | Pas de lien prévu |

---

## 2. Table `products` — Analyse détaillée

### 2.1 Colonnes coût en doublon (F-01 🔴)

La table `products` contient **deux colonnes de coût** :

| Colonne | Type | Usage actuel |
|---|---|---|
| `cost_kmf` | `INTEGER` | Pricing engine (`pricing-engine.js`) — **source de vérité pricing** |
| `cost_price_kmf` | `INTEGER` | Sourcing engine (historique) — **ajouté plus tard** |

**Problème documenté** (commentaire `sourcing-analysis.js`) :
> "Un produit créé côté pricing n'apparaissait pas côté sourcing, et vice-versa."

La migration 042 synchronise les colonnes existantes. Le code actuel écrit les **deux colonnes en parallèle** (temporaire, via `sourcing-mutations.js`). La lecture se fait via `getProductCostKmf()` qui priorise `cost_kmf` puis tombe sur `cost_price_kmf`.

**Recommandation C5** :
- Source de vérité choisie : **`cost_kmf`** (utilisé par le pricing, plus ancienne).
- Migration à écrire : copier `cost_price_kmf` → `cost_kmf` là où `cost_kmf IS NULL`, annoter `cost_price_kmf` comme dépréciée (commentaire SQL), ne pas dropper (rollback safe).
- Code à mettre à jour : retirer `cost_price_kmf` de `ALLOWED_PRODUCT_FIELDS` dans `sourcing-mutations.js`.

### 2.2 Colonnes poids en doublon (F-02 🔴)

| Colonne | Type | Usage actuel |
|---|---|---|
| `weight_kg` | `NUMERIC(6,2)` | Pricing engine — **source de vérité** |
| `weight_g` | `INTEGER` | Sourcing engine (historique) |

Même problème que F-01. Le code lit via `getProductWeightKg()` / `getProductWeightG()` qui priorisent `weight_kg`.

**Recommandation C5** (identique à F-01) :
- Source de vérité : **`weight_kg`**.
- Migration : calculer `weight_kg = weight_g / 1000.0` là où `weight_kg IS NULL AND weight_g IS NOT NULL`.

### 2.3 `sourcing_rail` : texte libre (F-06 🟢)

| Colonne | Type | Valeurs valides |
|---|---|---|
| `sourcing_rail` | `TEXT` | `'A'`, `'B'`, `'C'`, `'D'` |

Aucune contrainte `CHECK` en DB. Le code applique une validation dans `sourcing-mutations.js` (`VALID_RAILS = ['A', 'B', 'C', 'D']`), mais la DB accepte n'importe quelle valeur.

**Recommandation C7** : ajouter au guard `audit-sourcing.js` une vérification des valeurs hors rails valides. Migration optionnelle pour poser un `CHECK` DB (non bloquant C5).

### 2.4 Indexes `products` existants

| Index | Colonnes | Condition |
|---|---|---|
| `idx_products_category` | `category` | — |
| `idx_products_category_subcategory` | `(category, subcategory)` | `is_available = true` |
| `idx_products_lifecycle` | `lifecycle_status` | `is_active = true` |
| `idx_products_sourcing_rail` | `sourcing_rail` | `sourcing_rail IS NOT NULL` |
| `idx_products_weight_kg` | `weight_kg` | — |
| `idx_products_price_eur` | `price_eur` | — |
| `idx_products_fragile_bulky` | `(is_fragile, is_bulky)` | — |
| `uq_products_sku` | `sku` | `sku IS NOT NULL` (UNIQUE) |

Couverture adéquate pour les requêtes sourcing. Aucun index manquant critique.

---

## 3. Table `sourcing_candidates` — Analyse détaillée

### 3.1 Structure complète

```sql
CREATE TABLE public.sourcing_candidates (
  id                  UUID DEFAULT gen_random_uuid() NOT NULL,
  import_id           UUID,           -- FK → supplier_catalog_imports
  supplier_name       TEXT NOT NULL,
  supplier_product_id TEXT,
  product_name        TEXT NOT NULL,
  supplier_category   TEXT,
  purchase_price      NUMERIC(12,2),
  currency            TEXT DEFAULT 'AED',
  image_url           TEXT,
  product_url         TEXT,
  description         TEXT,
  stock_available     INTEGER,
  min_order_qty       INTEGER,
  supplier_delay_days INTEGER,
  weight_kg           NUMERIC(8,3),
  dim_l_cm            NUMERIC(6,1),
  dim_w_cm            NUMERIC(6,1),
  dim_h_cm            NUMERIC(6,1),
  komerce_category    TEXT,           -- catégorie mappée, pas de FK
  estimated_weight_kg NUMERIC(8,3),
  estimated_volume_m3 NUMERIC(8,5),
  purchase_price_kmf  INTEGER,
  target_margin_pct   NUMERIC(5,2),
  data_sources        JSONB DEFAULT '{}',
  scan_result         JSONB,          -- résultat complet du scan pricing
  scan_at             TIMESTAMPTZ,
  confidence          TEXT DEFAULT 'low',  -- CHECK: low/medium/high
  state               TEXT DEFAULT 'raw_imported' NOT NULL,  -- CHECK: enum 8 valeurs
  product_id          UUID,           -- FK → products (après import catalogue)
  notes               TEXT,
  rejected_reason     TEXT,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_by          UUID,           -- FK → users
  ...
);
```

### 3.2 Contraintes CHECK

| Colonne | Valeurs autorisées |
|---|---|
| `state` | `raw_imported`, `normalized`, `scanned`, `test_ready`, `watchlist`, `imported_to_catalog`, `rejected`, `archived` |
| `confidence` | `low`, `medium`, `high` |

État des ENUMs : suffisants pour le workflow actuel. Couvrent tout le cycle de vie d'un candidat.

### 3.3 Clés étrangères

| FK | Cible | Action |
|---|---|---|
| `import_id` | `supplier_catalog_imports(id)` | `ON DELETE SET NULL` |
| `product_id` | `products(id)` | `ON DELETE SET NULL` |
| `updated_by` | `users(id)` | `ON DELETE SET NULL` |

**FK manquante (F-04 🟡)** : `komerce_category` référence logiquement `customs_categories.key` mais aucune FK DB n'est posée. Texte libre en pratique. Risque : valeur orpheline si une catégorie est renommée.

**Recommandation** : ajouter une vérification dans `audit-sourcing.js` (C7) — `komerce_category` doit être dans la liste des `customs_categories.key` actives.

### 3.4 Indexes `sourcing_candidates`

| Index | Colonnes | Condition |
|---|---|---|
| `idx_sc_state` | `state` | — |
| `idx_sc_import` | `import_id` | — |
| `idx_sc_supplier` | `supplier_name` | — |
| `idx_sc_decision` | `scan_result->>'sourcing_decision'` | `scan_result IS NOT NULL` |
| `uniq_sc_supplier_ref` | `(supplier_name, supplier_product_id)` | `supplier_product_id IS NOT NULL` (UNIQUE) |

**Index composite manquant (F-05 🟢)** : les requêtes d'analyse filtrent souvent sur `(state, import_id)` ou `(state, supplier_name)`. Pas d'index composite couvrant ces patterns. Performance acceptable en l'état (volume catalogue < 10k lignes), à réévaluer si volume dépasse 50k.

---

## 4. Table `partners` — Analyse détaillée

### 4.1 `partner_type` : texte libre sans ENUM (F-03 🟡)

| Colonne | Type | Valeurs documentées (commentaire SQL) |
|---|---|---|
| `partner_type` | `TEXT NOT NULL` | `relais_simple`, `relais_showroom`, `partenaire_avance`, `atelier_couture`, `artisan_retouche`, `franchise_s5` |

Seule contrainte : `NOT NULL`. Pas de `CHECK` ni d'ENUM PostgreSQL. Un typo en insertion passe silencieusement.

**Recommandation C7** : inclure dans `audit-sourcing.js` une vérification des `partner_type` hors liste connue.

**Migration possible** (optionnelle, non bloquante) : ajouter un `CHECK (partner_type IN (...))`. Risque : bloque les insertions avec nouvelle valeur non listée — mettre à jour la migration ET le CHECK en même temps.

### 4.2 Indexes `partners`

| Index | Colonnes |
|---|---|
| `idx_partners_type` | `partner_type` |

Couverture suffisante.

---

## 5. Table `pricing_components` et `cost_components`

### 5.1 `pricing_components`

Sert les calculs de CDR dans `pricing-engine.js`. Schéma stable, pas de dette sourcing directe.

### 5.2 `cost_components`

Table de référencement des composantes de coût (shipping, customs, hub). Pas de problème identifié.

---

## 6. Récapitulatif des actions recommandées

### C5 — Normalisation colonnes dupliquées (priorité haute, risque financier) ✅ Livré 2026-06-23

1. **Confirmé** : `cost_kmf` est la source de vérité (pricing-engine l'utilise).
2. **Migration** (`migrations/087_normalize_sourcing_duplicate_columns.sql`, ⚠️ approbation humaine requise avant exécution) :
   - `UPDATE products SET cost_kmf = cost_price_kmf WHERE cost_kmf IS NULL AND cost_price_kmf IS NOT NULL`
   - `UPDATE products SET weight_kg = weight_g / 1000.0 WHERE weight_kg IS NULL AND weight_g IS NOT NULL`
   - Colonnes dépréciées annotées via `COMMENT ON COLUMN` (non supprimées).
3. **Code mis à jour** :
   - `services/sourcing-mutations.js` : `cost_price_kmf`/`weight_g` retirés de `ALLOWED_PRODUCT_FIELDS` ; un `LEGACY_FIELD_MAP` mappe les entrées API legacy vers `cost_kmf`/`weight_kg` (plus de double-write).
   - `routes/sourcing-scanner.js` (`import-product`) : n'écrit plus que `cost_kmf`/`weight_kg` à la création produit.
   - `services/sourcing-analysis.js` : helpers de lecture (`getProductCostKmf`, `getProductWeightKg`, `getProductWeightG`) **inchangés** — ils gardent le fallback sur les colonnes dépréciées pendant la fenêtre de stabilisation.
   - Tests `tests/unit/sourcing-mutations.test.js` mis à jour pour refléter le mapping simple-write.
4. **Ne pas supprimer les colonnes** tant que la production n'est pas stable N jours après exécution de la migration 087.

### C7 — Guard `scripts/audit-sourcing.js`

Checks à implémenter :

```
1. products: cost_kmf IS NULL AND cost_price_kmf IS NULL → produit sans coût, pas de fallback
2. products: cost_kmf != cost_price_kmf (quand les deux sont non-NULL) → divergence doublon
3. products: weight_kg < 0 OR weight_g < 0 → poids négatif aberrant
4. products: sourcing_rail NOT IN ('A','B','C','D') AND sourcing_rail IS NOT NULL → rail invalide
5. sourcing_candidates: komerce_category non trouvée dans customs_categories.key → catégorie orpheline
6. partners: partner_type NOT IN ('relais_simple','relais_showroom','partenaire_avance','atelier_couture','artisan_retouche','franchise_s5') → type inconnu
```

### Pas de migration requise pour C4

Ce lot est audit uniquement. Les actions correctives vont en C5 et C7.
