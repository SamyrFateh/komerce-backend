-- @migration 096_quality_foundation.sql
-- @domain    logistics
-- @purpose   Fondations doctrine non-conformité : source unique fragilité (Q-0)
--            + photos au scan hub Dubaï (Q-1). Zéro contrainte bloquante.

-- ============================================================================
--  096_quality_foundation.sql
--  Doctrine : DOCTRINE_NON_CONFORMITE.md (§2 photo, §3 tags, §11 lots Q-0/Q-1)
--
--  Q-0 — ARBITRAGE FRAGILITÉ (pattern C5, comme 087 pour weight_kg) :
--    products.fragility (texte) devient la SOURCE UNIQUE du tag manipulation.
--    Valeurs conseillées : 'fragile', 'electronique', 'sensible_chaleur',
--    'sensible_humidite' (texte libre, pas d'enum : la doctrine évolue plus
--    vite que le schéma). products.is_fragile est DÉPRÉCIÉE : backfill puis
--    drop planifié (scheduled/097, exécutable à partir du 2026-07-16).
--
--  Q-1 — PHOTO AU SCELLÉ DUBAÏ :
--    scan_events.photo_urls (text[], miroir de disputes.photo_urls) : la
--    borne 1 des trois fenêtres de responsabilité. Une photo par colis au
--    scellé, systématique ; par carton maître sur les gros volumes ; par
--    article uniquement si un contrôle est prescrit.
--
--  APPLICATION SANS CONTRAINTE : colonnes nullables/défaut, aucun CHECK
--  bloquant, aucun trigger. La photo INFORME et PROUVE, elle ne bloque
--  jamais un scan ni un scellé (la discipline vient du terrain et du
--  dashboard, pas d'une contrainte SQL qui casserait la cadence).
--
--  Idempotente : IF NOT EXISTS / WHERE-garde partout.
-- ============================================================================

SET client_encoding = 'UTF8';

-- ── Q-0.1 : backfill is_fragile → fragility ─────────────────────────────────
-- Ne touche que les lignes où le booléen dit vrai et le texte est vide :
-- une valeur texte existante prime toujours (plus riche que le booléen).

UPDATE products
SET fragility = 'fragile'
WHERE is_fragile = TRUE
  AND (fragility IS NULL OR btrim(fragility) = '');

-- ── Q-0.2 : documenter la source unique et la dépréciation ──────────────────

COMMENT ON COLUMN products.fragility IS
  'SOURCE UNIQUE du tag manipulation (doctrine non-conformité §3). '
  'Texte libre ; valeurs conseillées : fragile, electronique, '
  'sensible_chaleur, sensible_humidite. Tag => contrôle qualité prescrit au '
  'hub Dubaï + exclusion repack si fragile. NULL = aucune précaution requise.';

COMMENT ON COLUMN products.is_fragile IS
  'DÉPRÉCIÉE (096, 2026-07-02) — remplacée par fragility (texte). '
  'Backfillée puis figée ; ne plus écrire. Drop planifié : '
  'migrations/scheduled/097_drop_products_is_fragile.sql (exécutable 2026-07-16).';

-- ── Q-1 : photos au scan hub (borne 1 de responsabilité) ────────────────────
-- Portées par scan_events (l''événement EST la preuve datée, signée, géolocalisée
-- — colonnes scanned_by/actor_role/location existantes). Un événement dédié
-- event_type=''seal_photo'' est inséré par POST /api/hub/photo.

ALTER TABLE scan_events
  ADD COLUMN IF NOT EXISTS photo_urls text[] DEFAULT '{}'::text[];

COMMENT ON COLUMN scan_events.photo_urls IS
  'Photos attachées à l''événement de scan (URLs sous /uploads/hub/). '
  'Usage doctrinal : event_type=seal_photo au scellé Dubaï = borne 1 des '
  'fenêtres de responsabilité (avant : fournisseur ; après : transport). '
  'Miroir structurel de disputes.photo_urls.';

-- ── Vérification post-migration (lecture seule) ──────────────────────────────
-- SELECT count(*) FROM products WHERE is_fragile = TRUE AND fragility IS NULL;  -- attendu : 0
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'scan_events' AND column_name = 'photo_urls';

DO $$
BEGIN
  RAISE NOTICE 'Migration 096 OK : source unique fragility + photos scan hub (0 contrainte bloquante)';
END $$;
