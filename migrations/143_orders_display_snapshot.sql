-- @migration 143_orders_display_snapshot.sql
-- @domain    market
-- @purpose   P3 — snapshot du montant PRÉSENTÉ au client au moment de
--            confirmer, dans sa devise de marché. Doctrine gelée le
--            22-08-2026 (GAP_ANALYSIS_CURRENCY_BOUNDARY.md, cartographie
--            monétaire complète effectuée AVANT cette migration).
--
--            TROISIÈME VÉRITÉ, distincte des deux existantes, jamais
--            mélangée :
--              orders.total_kmf / total_eur  = Payment Boundary
--                (finance_config, politique commerciale/paiement,
--                 STRICTEMENT INCHANGÉE par cette migration — Stripe,
--                 PayPal et cash_relais ne lisent JAMAIS les colonnes
--                 ci-dessous, invariant 1)
--              currency_parities              = Currency Boundary (P1)
--                (parité de référence, EUR pivot, déterministe)
--              display_total_amount/currency  = CETTE migration (P3)
--                (ce que le client a VU/confirmé, figé, jamais recalculé,
--                 jamais une source de paiement)
--
--            display_parity_snapshot conserve la parité utilisée, POUR
--            AUDIT UNIQUEMENT — ne remplace jamais display_total_amount
--            (invariant 5). Si currency_parities changeait un jour, ce
--            JSON permet de comprendre a posteriori COMMENT le montant a
--            été obtenu, sans jamais servir de source de vérité alternative.
--
--            Nullable, AUCUN backfill (invariant 7) : une commande légacy
--            dont on ne peut pas démontrer ce qui a été réellement affiché
--            reste NULL — honnête, jamais une valeur inventée.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS display_total_amount   NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS display_currency       TEXT,
  ADD COLUMN IF NOT EXISTS display_parity_snapshot JSONB;

COMMENT ON COLUMN orders.display_total_amount IS
  'Montant PRÉSENTÉ au client au moment de confirmer, dans display_currency. '
  'Figé à la création, jamais recalculé. JAMAIS lu par Stripe/PayPal/'
  'cash_relais (ceux-ci lisent exclusivement total_kmf/total_eur). '
  'NULL pour les commandes antérieures à cette migration — pas de backfill '
  'fabriqué (freeze P3, invariant 7).';

COMMENT ON COLUMN orders.display_currency IS
  'Devise de display_total_amount — celle du contexte marché du client au '
  'moment de la commande (market-context.js, override ?market= inclus), '
  'PAS nécessairement celle de relais.market_id (freeze P3, invariant 4 : '
  'ne jamais supposer silencieusement que orders.market_id == marché de '
  'navigation — un acheteur diaspora peut consulter en XAF et livrer via '
  'un relais KM).';

COMMENT ON COLUMN orders.display_parity_snapshot IS
  'Métadonnée d''audit : parité(s) currency_parities utilisée(s) pour '
  'calculer display_total_amount, et la source du contexte marché '
  '(explicite ou fallback). Ne remplace JAMAIS display_total_amount comme '
  'source de vérité (freeze P3, invariant 5) — lecture humaine/debug '
  'uniquement.';
