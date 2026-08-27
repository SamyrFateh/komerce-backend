-- @migration 153_local_stock_km_shadow.sql
-- @domain    local-stock
-- @purpose   Vague 1 Shadow (PR A) — stock physique vendable détenu par
--            Komerce dans un marché donné, distinct du stock hub/transit
--            (feature inventory, inventory_items) et distinct du stock
--            import/national (products.stock, product_skus.stock).
-- @added-header 2026-08-24
-- Idempotent : peut être rejoué sans risque.
--
-- Décision (analyse d'impact 2026-08-23, IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md) :
-- `inventory` existant possède le stock EN TRANSIT (réception hub, dispatch),
-- invariant "jamais négatif". Le stock KM est un état physique détenu par
-- Komerce dans un marché, avec un invariant différent (jamais > ce qui a
-- été compté). Mélanger les deux sous le même owner aurait fait porter à
-- `inventory` un invariant qui n'est pas le sien. Capacité SŒUR, jamais
-- une extension d'inventory_items.
--
-- Portée volontairement minimale (shadow, zéro exposition frontend) :
--   - PAS de table inventory_locations : un seul entrepôt (KM_MAIN) au
--     lancement, porté par une colonne texte. Un référentiel de lieux
--     multiples est une abstraction prématurée tant qu'il n'y a qu'un lieu
--     (red flag explicite de l'analyse d'impact, appliqué ici).
--   - PAS de qty_reserved matérialisé : aucun consommateur (checkout) ne
--     peut aujourd'hui poser de réservation sur cette table — rien ne la
--     concurrence. Un champ dérivable sans lecteur réel serait de la
--     spéculation, pas une donnée. Réintroduit au jour où L4 (réservation)
--     devient nécessaire, jamais avant.
--   - PAS de granularité variant_combo : le checkout raisonne product_id +
--     variant_combo (routes/orders/create.js), mais ce premier test porte
--     sur "Komerce sait-il qu'il a des unités physiques à Moroni ?", pas
--     sur le suivi fin par variante. Limitation explicite, pas un oubli —
--     à lever si le shadow test le justifie.

CREATE TABLE IF NOT EXISTS public.local_stock (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  market_id    uuid NOT NULL REFERENCES public.markets(id),
  location     text NOT NULL DEFAULT 'KM_MAIN',
  qty_physical integer NOT NULL DEFAULT 0,
  updated_by   uuid REFERENCES public.users(id),
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT local_stock_qty_non_negatif CHECK (qty_physical >= 0)
);

COMMENT ON TABLE public.local_stock IS
  'Stock physique vendable détenu par Komerce dans un marché (shadow, '
  'Vague 1 — aucune exposition frontend). Distinct de inventory_items '
  '(hub/transit) et de products.stock/product_skus.stock (import/national). '
  'location est un texte, pas une FK : un seul entrepôt (KM_MAIN) au '
  'lancement, table de lieux différée au deuxième lieu réel.';

COMMENT ON COLUMN public.local_stock.location IS
  'Identifiant texte du lieu physique (ex. KM_MAIN). Deviendra une FK vers '
  'un référentiel de lieux le jour où un deuxième lieu existe réellement — '
  'jamais avant, pour ne pas généraliser sur un seul cas.';

-- Un produit n'a qu'une ligne de stock local par (marché, lieu) — jamais
-- deux lignes concurrentes pour la même unité vendable au même endroit.
CREATE UNIQUE INDEX IF NOT EXISTS ux_local_stock_product_market_location
  ON public.local_stock (product_id, market_id, location);

CREATE INDEX IF NOT EXISTS idx_local_stock_market
  ON public.local_stock (market_id);
