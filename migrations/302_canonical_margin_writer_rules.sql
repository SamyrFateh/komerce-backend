-- @migration 302_canonical_margin_writer_rules.sql
-- @domain    economic-engine
-- @purpose   Déclarer les règles applicatives de l'écrivain canonique de marge réelle (A8), DÉSACTIVÉES (0).
--
-- Sans ces lignes, PATCH /api/admin/rules/CANONICAL_MARGIN_WRITER_ENABLED répond « Règle introuvable »
-- (updateRule exige une ligne existante) : l'activation applicative serait impossible.
--   CANONICAL_MARGIN_WRITER_ENABLED     0|1  — 1 : les événements métier recalculent orders.margin_real_pct (writer unique).
--   CANONICAL_MARGIN_WRITE_PROVISIONAL  0|1  — 1 : écrit aussi les marges « provisional » (par défaut NULL).
--
-- Additive, idempotente, aucune activation, aucun backfill, aucune modification de commande.
-- Rollback d'activation : PATCH la règle à 0. Rollback de la migration : DELETE FROM business_rules WHERE key IN (…).

INSERT INTO public.business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
VALUES
  ('pricing', 'CANONICAL_MARGIN_WRITER_ENABLED', '{"value": 0}', 'number',
   'Écrivain canonique de marge réelle (A8)',
   '0 = désactivé (comportement historique). 1 = les événements douane/frais/règlement fournisseur/annulation-remboursement '
   'recalculent orders.margin_real_pct via computeOrderRealMarginShadow (une seule formule, un seul écrivain). '
   'Ne jamais activer en production sans GO distinct.', 0, 1),
  ('pricing', 'CANONICAL_MARGIN_WRITE_PROVISIONAL', '{"value": 0}', 'number',
   'Écrire aussi les marges réelles provisoires (A8)',
   '0 = une marge fondée sur une estimation reste NULL (jamais présentée comme définitive). 1 = l''écrire (opt-in).', 0, 1)
ON CONFLICT (key) DO NOTHING;
