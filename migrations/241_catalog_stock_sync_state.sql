-- @migration 241_catalog_stock_sync_state.sql
-- @domain    catalog
-- @purpose   Trace, par product_skus.id, la dernière observation fournisseur
--            de stock effectivement APPLIQUÉE (pas seulement identifiée).
--            Sans ceci, le décideur de Mission 1 (GAP catalog change intake)
--            ne peut pas distinguer un événement plus récent d'un rejeu ou
--            d'un événement obsolète : product_skus ne porte aucune trace de
--            la dernière observation source qui a fixé sa valeur, et
--            purchase_orders ne concerne que les engagements Komerce, pas
--            l'historique des observations de stock elles-mêmes.
--            Une ligne = l'état courant (pas un journal) : une observation
--            plus récente REMPLACE la ligne existante en une seule
--            transaction verrouillée, jamais un second insert à réconcilier.

CREATE TABLE IF NOT EXISTS public.catalog_stock_sync_state (
  product_sku_id      uuid PRIMARY KEY REFERENCES public.product_skus(id) ON DELETE CASCADE,
  source_id           text NOT NULL,
  last_observation_id uuid NOT NULL,
  last_event_id       text NOT NULL,
  last_observed_at    timestamptz NOT NULL,
  applied_stock_value integer NOT NULL CHECK (applied_stock_value >= 0),
  applied_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_stock_sync_state_observation
  ON public.catalog_stock_sync_state (last_observation_id);

COMMENT ON TABLE public.catalog_stock_sync_state IS
  'Owner: catalog. État courant (non-journal) de la dernière observation de stock fournisseur appliquée par SKU. Alimenté exclusivement par le décideur de synchronisation de stock catalogue (Mission 1, DOCTRINE_CATALOG_CHANGE_INTAKE.md) — jamais par order-payment-confirmation.js ni order-status-machine.js, qui continuent de n''écrire que via product-stock-service.js#adjustStock.';

COMMENT ON COLUMN public.catalog_stock_sync_state.source_id IS
  'sourcing_sources.source_id de la source ayant produit la dernière observation appliquée. Une observation d''une AUTRE source pour le même SKU est un cas explicitement hors périmètre de la première tranche (cf. doctrine SOURCE_LINEAGE_AMBIGUOUS déjà appliquée en amont par la preuve d''identité SKU).';

COMMENT ON COLUMN public.catalog_stock_sync_state.applied_stock_value IS
  'Valeur de product_skus.stock immédiatement après cette application — preuve de lecture après écriture, jamais recalculée après coup.';
