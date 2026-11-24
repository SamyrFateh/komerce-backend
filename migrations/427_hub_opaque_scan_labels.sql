-- @migration 427_hub_opaque_scan_labels.sql
-- @domain logistics
-- @purpose Hub/Relais #5215: stable, printable, opaque QR identity; no customer data.
-- A scan never grants a custody mutation or a pickup right.
CREATE TABLE IF NOT EXISTS public.hub_scan_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('ARTICLE','COMBOX')),
  allocation_id uuid REFERENCES public.hub_purchase_allocations(id) ON DELETE RESTRICT,
  unit_number integer CHECK (unit_number IS NULL OR unit_number > 0),
  physical_unit_id uuid REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  relais_id uuid NOT NULL REFERENCES public.relais(id) ON DELETE RESTRICT,
  qr_value text NOT NULL UNIQUE CHECK (qr_value ~ '^KQ1_[A-F0-9]{32}$'),
  short_alias text NOT NULL UNIQUE CHECK (short_alias ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_hub_scan_label_target CHECK (
    (target_type='ARTICLE' AND allocation_id IS NOT NULL AND unit_number IS NOT NULL AND physical_unit_id IS NULL)
    OR (target_type='COMBOX' AND physical_unit_id IS NOT NULL AND allocation_id IS NULL AND unit_number IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hub_label_article
  ON public.hub_scan_labels(allocation_id,unit_number) WHERE target_type='ARTICLE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_hub_label_combox
  ON public.hub_scan_labels(physical_unit_id) WHERE target_type='COMBOX';
CREATE INDEX IF NOT EXISTS idx_hub_scan_labels_market_relais
  ON public.hub_scan_labels(market_id,relais_id);
COMMENT ON TABLE public.hub_scan_labels IS
  'Étiquettes QR opaques Hub #5215 : identifiant non secret, autorisation par session, référence commerciale non imprimée, scans validés par writers métier.';

-- Une étiquette d'article ne peut pas justifier deux placements en COMBOX.
-- L'écriture appartient à la même transaction que le REPACK canonique.
CREATE TABLE IF NOT EXISTS public.hub_scan_label_box_scans (
  label_id uuid PRIMARY KEY REFERENCES public.hub_scan_labels(id) ON DELETE RESTRICT,
  allocation_id uuid NOT NULL REFERENCES public.hub_purchase_allocations(id) ON DELETE RESTRICT,
  from_unit_id uuid NOT NULL REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT,
  box_unit_id uuid NOT NULL REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  scanned_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hub_scan_label_box_scans IS
  'Preuve unique de placement article en COMBOX ; doublon de QR refusé transactionnellement.';
