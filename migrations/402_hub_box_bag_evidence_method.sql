-- @migration 402_hub_box_bag_evidence_method.sql
-- #3900 P0-2 : provenance réelle (SCAN ou MANUAL + justification) du rattachement sac -> KOM-BOX.
-- Additif : les liens historiques gardent NULL (provenance non enregistrée), jamais présumée SCAN.
ALTER TABLE public.hub_box_bags
  ADD COLUMN IF NOT EXISTS evidence_method text,
  ADD COLUMN IF NOT EXISTS evidence_ref text;
ALTER TABLE public.hub_box_bags
  DROP CONSTRAINT IF EXISTS hub_box_bags_evidence_check;
ALTER TABLE public.hub_box_bags
  ADD CONSTRAINT hub_box_bags_evidence_check CHECK (
    (evidence_method IS NULL AND evidence_ref IS NULL)
    OR (evidence_method = 'SCAN' AND evidence_ref IS NULL)
    OR (evidence_method = 'MANUAL' AND evidence_ref IS NOT NULL AND length(btrim(evidence_ref)) >= 6)
  );
