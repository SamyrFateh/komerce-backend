-- @migration 356_international_shipment_hub_boxes.sql
-- @domain logistics
-- @purpose Lier les cartons physiques KOM-BOX aux dossiers internationaux sans
--         réécrire les allocations PO ni les anciens parcels.
-- @schema intended_migration_schema
-- PostgreSQL 16; liaison additive et unique, provenance physique conservée.
CREATE TABLE IF NOT EXISTS public.international_shipment_hub_boxes (
  shipment_id uuid NOT NULL REFERENCES public.international_shipments(id) ON DELETE RESTRICT,
  physical_unit_id uuid NOT NULL REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT,
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shipment_id, physical_unit_id),
  CONSTRAINT uq_international_hub_box_assignment UNIQUE (physical_unit_id)
);
CREATE INDEX IF NOT EXISTS idx_international_hub_boxes_shipment
  ON public.international_shipment_hub_boxes(shipment_id);
COMMENT ON TABLE public.international_shipment_hub_boxes IS
  'Rattachement unique d un KOM-BOX canonique à une expédition internationale ; marchés et destinations contrôlés avant écriture par logistics.';
