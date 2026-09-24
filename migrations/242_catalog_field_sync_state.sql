-- @migration 242_catalog_field_sync_state.sql
-- @domain    catalog
-- @purpose   Généralise catalog_stock_sync_state (migration 241) à tout
--            champ du contrat Catalog Change Intake au-delà du stock :
--            trace, par (subject_type, subject_id, field_name), la
--            dernière observation fournisseur effectivement APPLIQUÉE.
--            Mission 2 (KOMERCE_AUDIT_ABSTRACTIONS_CATALOG_CHANGE_INTAKE) —
--            un contrat d'entrée commun, une seule table de suivi pour
--            tous les champs plutôt qu'une par champ (ne pas multiplier les
--            tables au fil des politiques de champ ajoutées).
--
--            subject_type distingue le niveau d'application du champ :
--            'product' pour title/description/media/attributes (portés par
--            products), 'sku' pour les champs par unité vendable (stock
--            reste sur catalog_stock_sync_state, table dédiée déjà en
--            production — non migrée ici pour ne rien casser).
--
--            Une ligne = l'état courant (pas un journal), même discipline
--            que catalog_stock_sync_state : une observation plus récente
--            REMPLACE la ligne existante en une transaction verrouillée.

CREATE TABLE IF NOT EXISTS public.catalog_field_sync_state (
  subject_type        text NOT NULL CHECK (subject_type IN ('product', 'sku')),
  subject_id          uuid NOT NULL,
  field_name          text NOT NULL,
  source_id           text NOT NULL,
  last_observation_id uuid NOT NULL,
  last_event_id       text NOT NULL,
  last_observed_at    timestamptz NOT NULL,
  applied_value       jsonb NOT NULL,
  applied_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id, field_name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_field_sync_state_observation
  ON public.catalog_field_sync_state (last_observation_id, field_name);

COMMENT ON TABLE public.catalog_field_sync_state IS
  'Owner: catalog. État courant (non-journal) de la dernière observation de changement de catalogue appliquée, par (subject_type, subject_id, field_name). Alimenté exclusivement par services/catalog-field-sync-application.js (Mission 2, DOCTRINE_CATALOG_CHANGE_INTAKE.md). N''écrit jamais products.cost_kmf (alimente le moteur économique actif, cf. services/pricing-output.js) ni offer_status/is_active/option_axes/sellable_units (lié à la publication, services/catalog-promotion/*) — decision-only pour ces champs, cette table n''en porte donc jamais de ligne applied.';

COMMENT ON COLUMN public.catalog_field_sync_state.applied_value IS
  'Valeur appliquée, typée selon le champ (texte, tableau de médias, prix+devise) — preuve de lecture après écriture, jamais recalculée après coup.';
