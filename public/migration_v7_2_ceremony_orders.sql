-- ============================================================
-- KOMERCE — Migration v7.2
-- Support 3 types de commandes cérémonie
--
-- Écrit à partir du schema Railway réel (dump 28/03/2026)
--
-- Corrections vs draft :
--   · uuid_generate_v4() (pas gen_random_uuid())
--   · fabrics + garment_models existent déjà → PAS de ceremony_fabric_catalog
--   · Colonnes ceremony_* sur orders + order_items seulement
--   · ENUM ceremony_order_type créé proprement
--   · Vue v_ceremony_orders jointure réelle (quantity / price_kmf)
--
-- Idempotent — safe à rejouer
-- Prérequis : migration_v6_to_v71.sql déjà appliqué
-- psql $DATABASE_URL -f migration_v7_2_ceremony_orders.sql
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ENUM ceremony_order_type
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'ceremony_order_type'
  ) THEN
    CREATE TYPE public.ceremony_order_type AS ENUM (
      'ready_made',            -- article prêt (Dubai) · taille standard · retouche possible
      'fabric_only',           -- tissu au mètre/yard + accessoires optionnels
      'custom_from_fabric'     -- confection sur tissu choisi · taille + retouche possible
    );
  END IF;
END $$;

-- ============================================================
-- 2. TABLE orders — colonnes ceremony_*
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ceremony_order_type   public.ceremony_order_type,
  ADD COLUMN IF NOT EXISTS ceremony_fabric_id    uuid  REFERENCES public.fabrics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ceremony_fabric_type  text,
  ADD COLUMN IF NOT EXISTS ceremony_size         varchar(8),
  ADD COLUMN IF NOT EXISTS ceremony_retouche     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ceremony_qty_meters   numeric(6,2),
  ADD COLUMN IF NOT EXISTS ceremony_accessories  jsonb;

COMMENT ON COLUMN public.orders.ceremony_order_type  IS 'ready_made | fabric_only | custom_from_fabric — null si commande standard';
COMMENT ON COLUMN public.orders.ceremony_fabric_id   IS 'FK vers fabrics.id — tissu choisi (fabric_only et custom_from_fabric)';
COMMENT ON COLUMN public.orders.ceremony_fabric_type IS 'Label lisible du tissu : Wax, Dentelle, Mousseline, Soie, Coton, Bogolan';
COMMENT ON COLUMN public.orders.ceremony_size        IS 'Taille standard client : XS S M L XL XXL XXXL';
COMMENT ON COLUMN public.orders.ceremony_retouche    IS 'Retouche locale demandée aux Comores — incluse sans surcoût MVP';
COMMENT ON COLUMN public.orders.ceremony_qty_meters  IS 'Quantité tissu en mètres ou yards (fabric_only uniquement)';
COMMENT ON COLUMN public.orders.ceremony_accessories IS 'Accessoires choisis ex: ["Fil assorti","Doublure","Boutons"]';

-- ============================================================
-- 3. TABLE order_items — colonnes ceremony_* (paniers mixtes)
-- ============================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS ceremony_order_type   public.ceremony_order_type,
  ADD COLUMN IF NOT EXISTS ceremony_fabric_id    uuid  REFERENCES public.fabrics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ceremony_fabric_type  text,
  ADD COLUMN IF NOT EXISTS ceremony_size         varchar(8),
  ADD COLUMN IF NOT EXISTS ceremony_retouche     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ceremony_qty_meters   numeric(6,2),
  ADD COLUMN IF NOT EXISTS ceremony_accessories  jsonb;

COMMENT ON COLUMN public.order_items.ceremony_order_type  IS 'Type cérémonie pour cet article — null si article standard';
COMMENT ON COLUMN public.order_items.ceremony_fabric_id   IS 'FK vers fabrics — tissu pour cet article';
COMMENT ON COLUMN public.order_items.ceremony_size        IS 'Taille pour cet article cérémonie';
COMMENT ON COLUMN public.order_items.ceremony_retouche    IS 'Retouche locale pour cet article';
COMMENT ON COLUMN public.order_items.ceremony_qty_meters  IS 'Quantité tissu en mètres (fabric_only)';
COMMENT ON COLUMN public.order_items.ceremony_accessories IS 'Accessoires pour cet article';

-- ============================================================
-- 4. TABLE fabrics — enrichissement pour les 3 flux
-- ============================================================
-- fabrics existe déjà avec : name, material, price_per_meter_aed,
-- colors, occasions, image_url, active, created_at
-- On ajoute les colonnes nécessaires aux 3 types de commandes.

ALTER TABLE public.fabrics
  ADD COLUMN IF NOT EXISTS fabric_type         text,
  ADD COLUMN IF NOT EXISTS price_per_meter_kmf integer,
  ADD COLUMN IF NOT EXISTS price_per_yard_kmf  integer,
  ADD COLUMN IF NOT EXISTS min_order_meters    numeric(4,1) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS stock_meters        numeric(8,2),
  ADD COLUMN IF NOT EXISTS is_available        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz DEFAULT now();

COMMENT ON COLUMN public.fabrics.fabric_type         IS 'Wax | Dentelle | Mousseline | Soie | Coton | Bogolan';
COMMENT ON COLUMN public.fabrics.price_per_meter_kmf IS 'Prix au mètre KMF — calculé depuis price_per_meter_aed × taux 138';
COMMENT ON COLUMN public.fabrics.price_per_yard_kmf  IS 'Prix au yard KMF (optionnel)';
COMMENT ON COLUMN public.fabrics.min_order_meters    IS 'Minimum commandable en mètres';
COMMENT ON COLUMN public.fabrics.stock_meters        IS 'Stock Hub Deira en mètres — null = sur commande';
COMMENT ON COLUMN public.fabrics.is_available        IS 'Disponible à la commande';
COMMENT ON COLUMN public.fabrics.sort_order          IS 'Ordre affichage sélecteur cérémonie';

-- Initialiser price_per_meter_kmf depuis price_per_meter_aed × taux 138
UPDATE public.fabrics
SET price_per_meter_kmf = ROUND(price_per_meter_aed * 138)
WHERE price_per_meter_kmf IS NULL
  AND price_per_meter_aed IS NOT NULL;

-- Trigger updated_at (set_updated_at existe déjà dans le schema)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fabrics_updated'
  ) THEN
    CREATE TRIGGER trg_fabrics_updated
      BEFORE UPDATE ON public.fabrics
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 5. INDEX
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_orders_ceremony_type
  ON public.orders(ceremony_order_type)
  WHERE ceremony_order_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_ceremony_type
  ON public.order_items(ceremony_order_type)
  WHERE ceremony_order_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_ceremony_retouche
  ON public.order_items(ceremony_retouche)
  WHERE ceremony_retouche = true;

CREATE INDEX IF NOT EXISTS idx_fabrics_available
  ON public.fabrics(fabric_type, sort_order)
  WHERE is_available = true;

-- ============================================================
-- 6. VUE v_ceremony_orders
-- ============================================================
-- Noms de colonnes exacts du schema réel :
--   order_items.quantity  (pas qty)
--   order_items.price_kmf (pas unit_price_kmf)

CREATE OR REPLACE VIEW public.v_ceremony_orders AS
SELECT
  oi.id                                                             AS item_id,
  o.id                                                              AS order_id,
  o.reference                                                       AS order_ref,
  o.created_at::date                                                AS order_date,
  o.status                                                          AS order_status,

  COALESCE(oi.ceremony_order_type, o.ceremony_order_type)           AS ceremony_type,

  p.name                                                            AS product_name,
  COALESCE(oi.ceremony_fabric_type,  o.ceremony_fabric_type)        AS fabric_type,
  COALESCE(oi.ceremony_size,         o.ceremony_size)               AS size,
  COALESCE(oi.ceremony_retouche,     o.ceremony_retouche)           AS retouche,
  COALESCE(oi.ceremony_qty_meters,   o.ceremony_qty_meters)         AS qty_meters,
  COALESCE(oi.ceremony_accessories,  o.ceremony_accessories)        AS accessories,

  oi.price_kmf                                                      AS unit_price_kmf,
  oi.quantity,
  (oi.price_kmf * oi.quantity)                                      AS total_item_kmf,

  u.full_name                                                       AS client_name,
  u.phone                                                           AS client_phone,
  r.name                                                            AS relais_name,
  pa.name                                                           AS artisan_name,
  pa.phone                                                          AS artisan_phone

FROM public.order_items oi
JOIN public.orders   o  ON o.id  = oi.order_id
JOIN public.products p  ON p.id  = oi.product_id
JOIN public.users    u  ON u.id  = o.user_id
LEFT JOIN public.relais   r  ON r.id  = o.relais_id
LEFT JOIN public.partners pa ON pa.id = o.confection_artisan_id

WHERE
  oi.ceremony_order_type IS NOT NULL
  OR o.ceremony_order_type IS NOT NULL

ORDER BY o.created_at DESC;

COMMENT ON VIEW public.v_ceremony_orders IS
  'Commandes et articles cérémonie (3 types) — dashboard back-office et planning retouches';

COMMIT;

-- ============================================================
-- RÉSUMÉ
-- ============================================================
--
--  1. ENUM  ceremony_order_type   ready_made | fabric_only | custom_from_fabric
--  2. TABLE orders                +7 colonnes ceremony_*
--  3. TABLE order_items           +7 colonnes ceremony_*  ← paniers mixtes
--  4. TABLE fabrics (existante)   +7 colonnes + trigger updated_at
--                                  price_per_meter_kmf initialisé auto
--  5. INDEX                       4 index (type, retouche, fabrics dispo)
--  6. VUE   v_ceremony_orders     colonnes schema réel (quantity / price_kmf)
--
--  Idempotent — safe à rejouer
-- ============================================================
