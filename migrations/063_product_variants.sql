-- ─────────────────────────────────────────────────────────────────────────────
-- LOT 11 — Variantes produits (taille, couleur, matériau, etc.)
--
-- Permet à un produit d'avoir N axes de variation, chacun avec M options.
-- Chaque option a son propre stock optionnel et son image optionnelle.
--
-- L'objet GET /api/products/:id retournera product.variants = { type: [...] }
-- conformément au format attendu par le frontend (b-modal.js, déjà déployé).
--
-- Cohabite avec les colonnes module_* de order_items (couture) sans interférer.
-- À terme, les colonnes module_* pourront être migrées vers cette structure
-- générique, mais ce n'est PAS dans cette PR.
--
-- Invariants respectés :
--   - R3 (orders.status machine fermée) : non touché
--   - R4 (parcels.status machine fermée) : non touché
--   - R5 (stock = transaction Supabase) : la décrémentation des variantes
--     se fera dans la même transaction que celle du stock global, dans
--     services/order-payment-confirmation.js (PR-VAR-4 à venir).
--
-- Reverse :
--   DROP INDEX IF EXISTS idx_order_items_variant_combo;
--   ALTER TABLE order_items DROP COLUMN IF EXISTS variant_combo;
--   DROP TRIGGER IF EXISTS trg_product_variants_updated ON product_variants;
--   DROP TABLE IF EXISTS product_variants;
--   ALTER TABLE products DROP COLUMN IF EXISTS has_variants;
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Flag has_variants sur products ────────────────────────────────────────────
-- Évite un JOIN systématique sur product_variants pour les 95% de produits
-- qui n'ont pas de variantes. Le code lit ce flag avant de charger.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS has_variants BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Table product_variants ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  -- Type de la variante : 'Taille', 'Couleur', 'Matériau', etc. Libre.
  variant_type    TEXT        NOT NULL,

  -- Valeur affichée à l'utilisateur : 'S', 'Bleu', 'Coton', etc.
  variant_value   TEXT        NOT NULL,

  -- SKU optionnel pour suivi vendeur
  sku             TEXT,

  -- Stock spécifique à cette variante.
  -- NULL = "non géré par cette variante" (retombe sur products.stock).
  -- 0   = en rupture pour cette variante.
  stock           INTEGER,

  -- Surcharge prix optionnelle. NULL = même prix que products.price_kmf.
  price_kmf       INTEGER,

  -- Image spécifique à la variante (ex: photo en couleur "Rouge")
  image_url       TEXT,

  -- Ordre d'affichage dans le sélecteur (asc)
  display_order   INTEGER     NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Pas deux fois la même valeur pour le même type sur le même produit
  CONSTRAINT product_variants_unique_value
    UNIQUE (product_id, variant_type, variant_value),

  -- Stock négatif interdit
  CONSTRAINT product_variants_stock_non_negatif
    CHECK (stock IS NULL OR stock >= 0),

  -- Prix négatif interdit
  CONSTRAINT product_variants_prix_non_negatif
    CHECK (price_kmf IS NULL OR price_kmf >= 0)
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON product_variants(product_id);

CREATE INDEX IF NOT EXISTS idx_product_variants_lookup
  ON product_variants(product_id, variant_type, display_order);

-- Trigger updated_at (réutilise la fonction set_updated_at déjà définie)
DROP TRIGGER IF EXISTS trg_product_variants_updated ON product_variants;
CREATE TRIGGER trg_product_variants_updated
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Colonne variant_combo sur order_items ─────────────────────────────────────
-- Format JSON: {"Taille": "M", "Couleur": "Bleu"}
-- NULL pour les commandes existantes et pour les produits sans variantes.
-- jsonb (pas json) pour pouvoir indexer si besoin de stats.
--
-- Pourquoi un jsonb plutôt qu'une FK vers product_variants ?
-- → Pour qu'une commande passée reste cohérente même si le vendeur supprime
--   une variante après coup. On stocke la combo "telle qu'elle était au
--   moment de la commande", pas un pointeur fragile.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS variant_combo JSONB;

-- Index pour stats futures (ventes par taille, par couleur, etc.)
CREATE INDEX IF NOT EXISTS idx_order_items_variant_combo
  ON order_items USING gin (variant_combo)
  WHERE variant_combo IS NOT NULL;

-- ── Documentation : aucune donnée seedée ──────────────────────────────────────
-- Tous les produits existants ont has_variants = false par défaut.
-- L'admin pose les variantes via POST /api/products/:id/variants (PR-VAR-3).
-- Le frontend (b-modal.js) reste invisible tant qu'aucune variante n'est posée.
