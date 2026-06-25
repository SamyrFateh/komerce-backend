-- 092_customs_shipments_declaration_workflow.sql
-- Workflow de déclaration douanière en deux étapes
--
-- Doctrine : DOUANE_DECLARATION_PIVOT.md
-- Spec     : docs/specs/SPEC_KEYSTONE_DOUANE.md
--
-- Avant : createShipment exigeait customs_paid_kmf à la création
--   → admin devait tout saisir d'un coup après la douane
--   → ventilation items jamais déclenchée automatiquement
--   → pas de gate avant de marquer une commande comme reçue
--
-- Après : deux étapes
--   1. Création (pending)   : date, transitaire, colis rattachés. Montant vide.
--   2. Déclaration (declared): admin saisit le montant réel → ventilation auto
--   Gate : impossible de passer une commande en 'available' si douane non déclarée.

-- 1. Enum status pour customs_shipments
CREATE TYPE public.customs_shipment_status AS ENUM (
  'pending',    -- en mer, montant douane inconnu
  'declared',   -- montant saisi par admin, ventilation faite
  'confirmed'   -- réception validée, ordres passés en available
);

-- 2. Colonne status (NOT NULL, défaut pending)
ALTER TABLE public.customs_shipments
  ADD COLUMN IF NOT EXISTS status public.customs_shipment_status
    NOT NULL DEFAULT 'pending';

-- 3. customs_paid_kmf : passe de NOT NULL à nullable
--    (était requis à la création, maintenant saisi lors de la déclaration)
ALTER TABLE public.customs_shipments
  ALTER COLUMN customs_paid_kmf DROP NOT NULL;

ALTER TABLE public.customs_shipments
  ALTER COLUMN customs_paid_kmf SET DEFAULT NULL;

-- 4. Backfill : les shipments existants avec un montant > 0 sont déjà déclarés
UPDATE public.customs_shipments
   SET status = 'declared'
 WHERE customs_paid_kmf IS NOT NULL
   AND customs_paid_kmf > 0;

-- 5. Index pour lister les expéditions en attente de déclaration
CREATE INDEX IF NOT EXISTS idx_customs_shipments_status
  ON public.customs_shipments (status)
  WHERE status = 'pending';

-- 6. Colonne declared_at (traçabilité de l'acte de déclaration)
ALTER TABLE public.customs_shipments
  ADD COLUMN IF NOT EXISTS declared_at  timestamp with time zone,
  ADD COLUMN IF NOT EXISTS declared_by  uuid REFERENCES public.users(id);

-- Backfill declared_at pour les shipments déjà déclarés
UPDATE public.customs_shipments
   SET declared_at = updated_at
 WHERE status = 'declared';
