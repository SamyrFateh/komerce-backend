-- ============================================================================
-- Migration 110 — Audit des batchs d'ingestion (ING-6 / ING-I9)
-- ============================================================================
-- Statut      : VALIDÉE pour exécution sur base de test. Renommée depuis
--               110_catalog_import_audit.PROPOSAL.sql après validation du
--               diff ci-joint. INERTE tant que catalog-import-json.js
--               n'écrit pas ces colonnes (cf. note en fin de fichier).
-- Dépendances : 041_sourcing_candidates.sql, 076_sourcing_candidates_unique.sql
-- Impact      : additif. Aucune colonne supprimée, aucune donnée réécrite,
--               aucune clé d'identité modifiée.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS, VOLONTAIREMENT :
--   • elle NE touche PAS uniq_sc_supplier_ref (supplier_name,
--     supplier_product_id). L'identité métier d'un candidat reste le couple
--     fournisseur + référence fournisseur. profile_id, profile_version,
--     profile_hash, source_sha256, connector_version et import_batch_id
--     décrivent une OBSERVATION, pas un produit : les mettre dans la clé
--     ferait naître un second candidat à chaque bump de profil — exactement
--     la duplication que l'idempotence doit interdire.
--   • elle NE promeut RIEN et ne touche pas à `products`.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. source_type : ouvrir 'json'
-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUANT DÉCOUVERT : la whitelist JS de catalog-import-orchestrator.js:66
-- n'est pas le seul verrou. La table porte son propre CHECK :
--   CONSTRAINT supplier_catalog_imports_source_type_check
--     CHECK (source_type = ANY (ARRAY['csv','manual','api']))
-- Ajouter 'json' côté JS sans cette migration ferait échouer l'INSERT du batch
-- au premier import JSON réel, APRÈS un parsing réussi de 82 produits.
-- Un fichier JSON n'est pas une source 'api' : le déclarer ainsi falsifierait
-- provenance, connecteur, configuration applicable, métriques et reprise.

ALTER TABLE public.supplier_catalog_imports
  DROP CONSTRAINT IF EXISTS supplier_catalog_imports_source_type_check;

ALTER TABLE public.supplier_catalog_imports
  ADD CONSTRAINT supplier_catalog_imports_source_type_check
  CHECK (source_type = ANY (ARRAY['csv'::text, 'manual'::text, 'api'::text, 'json'::text]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Audit du batch : profil, source, connecteur, statut, compteurs, fenêtre
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.supplier_catalog_imports
  ADD COLUMN IF NOT EXISTS profile_id                 text,
  ADD COLUMN IF NOT EXISTS profile_version            integer,
  ADD COLUMN IF NOT EXISTS profile_hash               text,
  ADD COLUMN IF NOT EXISTS source_sha256              text,
  ADD COLUMN IF NOT EXISTS source_bytes               bigint,
  ADD COLUMN IF NOT EXISTS connector_name             text,
  ADD COLUMN IF NOT EXISTS connector_version          text,
  ADD COLUMN IF NOT EXISTS connector_contract_version text,
  ADD COLUMN IF NOT EXISTS pipeline_version           text,
  ADD COLUMN IF NOT EXISTS status                     text NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS ready_count                integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quarantined_count          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_count             integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invalid_pct                numeric(5,2),
  ADD COLUMN IF NOT EXISTS quarantined_pct            numeric(5,2),
  ADD COLUMN IF NOT EXISTS started_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at                timestamptz,
  ADD COLUMN IF NOT EXISTS error_code                 text,
  ADD COLUMN IF NOT EXISTS error_detail               text,
  ADD COLUMN IF NOT EXISTS batch_findings             jsonb NOT NULL DEFAULT '[]'::jsonb;

-- DEFAULT 'COMPLETED' : uniquement pour ne pas casser les lignes historiques,
-- qui sont toutes des imports terminés. Tout NOUVEAU batch naît en PROCESSING
-- via un INSERT explicite (cf. modèle transactionnel), jamais par ce défaut.

ALTER TABLE public.supplier_catalog_imports
  DROP CONSTRAINT IF EXISTS supplier_catalog_imports_status_check;

ALTER TABLE public.supplier_catalog_imports
  ADD CONSTRAINT supplier_catalog_imports_status_check
  CHECK (status = ANY (ARRAY[
    'PROCESSING',                   -- batch né, parcours en cours
    'COMPLETED',                    -- 0 quarantaine, 0 rejet
    'COMPLETED_WITH_QUARANTINE',    -- seuils respectés, quarantaine tracée
    'BLOCKED_QUARANTINE_THRESHOLD', -- quarantined_pct > max_quarantined_pct
    'BLOCKED_INVALID_THRESHOLD',    -- rejected_pct > max_invalid_pct (ING-I4)
    'FAILED'                        -- exception : ROLLBACK, rien en staging
  ]::text[]));

-- profile_id/version/hash sont OBLIGATOIRES pour tout batch issu d'un profil.
-- NOT VALID : les lignes historiques (antérieures à ING-6) ne sont pas
-- réécrites ; la contrainte ne s'applique qu'aux nouvelles lignes. Un
-- VALIDATE CONSTRAINT ultérieur exigerait un backfill décidé séparément.
ALTER TABLE public.supplier_catalog_imports
  ADD CONSTRAINT supplier_catalog_imports_profile_traceability_check
  CHECK (
    source_type <> 'json'
    OR (profile_id IS NOT NULL AND profile_version IS NOT NULL AND profile_hash IS NOT NULL)
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_sci_source_sha256 ON public.supplier_catalog_imports (source_sha256);
CREATE INDEX IF NOT EXISTS idx_sci_profile       ON public.supplier_catalog_imports (profile_id, profile_version);
CREATE INDEX IF NOT EXISTS idx_sci_status        ON public.supplier_catalog_imports (status, imported_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Quarantaine : un état de candidat, réversible, distinct de 'rejected'
-- ─────────────────────────────────────────────────────────────────────────────
-- ING-I5 rend 'rejected' TERMINAL. Un produit vidéo n'est pas rejeté : il est
-- non représentable AUJOURD'HUI. Le jour où le support vidéo existe, il doit
-- pouvoir être réobservé. Le confondre avec 'rejected' le tuerait
-- définitivement ; le laisser hors staging le ferait disparaître.

ALTER TABLE public.sourcing_candidates
  DROP CONSTRAINT IF EXISTS sourcing_candidates_state_check;

ALTER TABLE public.sourcing_candidates
  ADD CONSTRAINT sourcing_candidates_state_check
  CHECK (state = ANY (ARRAY[
    'raw_imported', 'normalized', 'scanned', 'test_ready', 'watchlist',
    'imported_to_catalog',
    'quarantined',   -- NOUVEAU : tracé, jamais promu, réversible
    'rejected',      -- terminal (ING-I5)
    'archived'
  ]::text[]));

ALTER TABLE public.sourcing_candidates
  ADD COLUMN IF NOT EXISTS promotion_status  text,
  ADD COLUMN IF NOT EXISTS promotion_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS findings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS profile_id        text,
  ADD COLUMN IF NOT EXISTS profile_version   integer,
  ADD COLUMN IF NOT EXISTS profile_hash      text,
  ADD COLUMN IF NOT EXISTS source_sha256     text,
  ADD COLUMN IF NOT EXISTS source_row_sha256 text,
  ADD COLUMN IF NOT EXISTS connector_version text,
  ADD COLUMN IF NOT EXISTS observed_at       timestamptz;

-- `findings` existe parce que normalized-supplier-product.v{1,2} est
-- additionalProperties:false : ni les findings ni weight_provenance ne
-- peuvent voyager DANS le contrat. Ils sont persistés à côté, sinon
-- SOURCE_WEIGHT_UNIT_UNKNOWN et ESTIMATED_WEIGHT_FALLBACK_USED n'atteignent
-- jamais la décision aval.

ALTER TABLE public.sourcing_candidates
  DROP CONSTRAINT IF EXISTS sourcing_candidates_promotion_status_check;

ALTER TABLE public.sourcing_candidates
  ADD CONSTRAINT sourcing_candidates_promotion_status_check
  CHECK (promotion_status IS NULL OR promotion_status = ANY (ARRAY[
    'READY_FOR_PROMOTION',
    'QUARANTINED_UNSUPPORTED_MEDIA',
    'QUARANTINED_LOSSY_MAPPING',
    'QUARANTINED_CURRENCY_POLICY'
  ]::text[]));
-- Les REJECTED_* n'apparaissent pas ici : cf. section 4.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Rejets : table séparée, pas un sourcing_candidate
-- ─────────────────────────────────────────────────────────────────────────────
-- Raison technique, pas esthétique : sourcing_candidates.product_name est
-- NOT NULL. Un produit REJECTED_CONTRACT_INVALID peut précisément n'avoir
-- aucun product_name — c'est souvent son motif de rejet. L'y insérer
-- exigerait de FABRIQUER un nom (ING-I2) ou de relâcher le NOT NULL sur la
-- table des candidats promouvables. Les deux sont pires que cette table.
--
-- Second argument, arrivé avec les rejets de ligne : un rejet
-- MISSING_SUPPLIER_PRODUCT_ID n'a par définition pas de supplier_product_id.
-- Il ne peut donc PAS vivre dans une table dont l'identité est
-- (supplier_name, supplier_product_id). Ici, supplier_product_id est
-- nullable et l'identité de la ligne est (import_id, source_index).

CREATE TABLE IF NOT EXISTS public.supplier_catalog_import_rejections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id           uuid NOT NULL REFERENCES public.supplier_catalog_imports(id) ON DELETE CASCADE,
  supplier_name       text NOT NULL,
  supplier_product_id text,               -- nullable : le rejet peut PORTER sur l'identité
  source_index        integer NOT NULL,   -- toujours renseigné : position dans products[]
  promotion_status    text NOT NULL,      -- catégorie générale
  reason_code         text NOT NULL,      -- cause exploitable automatiquement
  reasons             jsonb NOT NULL DEFAULT '[]'::jsonb,   -- texte humain
  findings            jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload         jsonb NOT NULL,     -- ING-I3 : le brut ne se perd jamais
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scir_promotion_status_check
    CHECK (promotion_status = ANY (ARRAY['REJECTED_SOURCE_DATA_INVALID', 'REJECTED_CONTRACT_INVALID']::text[])),
  CONSTRAINT scir_reason_code_check
    CHECK (reason_code = ANY (ARRAY[
      -- défauts de ligne, détectés avant la classification métier
      'SOURCE_ROW_NOT_OBJECT',
      'MISSING_SUPPLIER_PRODUCT_ID',
      'DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH',
      'SOURCE_FIELD_TOO_LARGE',
      'SOURCE_PRODUCT_TOO_DEEP',
      -- défauts détectés pendant la classification
      'SOURCE_VALUE_UNPARSABLE',
      'CONTRACT_SCHEMA_INVALID',
      -- rejets PAR POLITIQUE de profil : la donnée n'est pas fautive, le
      -- profil a décidé de ne pas l'accepter. Ajoutés à la liste initiale —
      -- sans eux, policies.*=REJECT_PRODUCT produirait un rejet sans cause.
      'SOURCE_WEIGHT_UNIT_UNKNOWN',
      'UNSUPPORTED_VIDEO_REJECTED_BY_POLICY',
      'LOSSY_MAPPING_REJECTED_BY_POLICY'
    ]::text[])),
  -- Reprise interne d'un MÊME batch : rejouer un chunk ne duplique aucun
  -- rejet. source_index est la seule clé toujours disponible — un rejet
  -- MISSING_SUPPLIER_PRODUCT_ID n'a précisément pas d'identité fournisseur,
  -- et un DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH en a une non unique.
  CONSTRAINT scir_import_source_index_unique UNIQUE (import_id, source_index)
);

CREATE INDEX IF NOT EXISTS idx_scir_import      ON public.supplier_catalog_import_rejections (import_id);
CREATE INDEX IF NOT EXISTS idx_scir_supplier    ON public.supplier_catalog_import_rejections (supplier_name, supplier_product_id);
CREATE INDEX IF NOT EXISTS idx_scir_reason_code ON public.supplier_catalog_import_rejections (reason_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Historique des observations (optionnel — à trancher)
-- ─────────────────────────────────────────────────────────────────────────────
-- sourcing_candidates ne porte qu'un ÉTAT COURANT : un ré-import écrase
-- l'observation précédente. Si l'historique complet doit être conservé (« que
-- disait la source au batch d'avant, sous quel profil ? »), voici la table
-- séparée. Elle ne modifie jamais la clé du candidat.
--
-- Coût : ~1 ligne par produit et par batch. 82 produits x 1 import/jour x 1 an
-- = ~30 k lignes. Négligeable ici, à surveiller sur un vrai fournisseur.
-- À N'ACTIVER que si l'historique est réellement voulu — sinon supprimer
-- cette section du fichier avant exécution.

CREATE TABLE IF NOT EXISTS public.sourcing_candidate_observations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        uuid REFERENCES public.sourcing_candidates(id) ON DELETE SET NULL,
  import_id           uuid NOT NULL REFERENCES public.supplier_catalog_imports(id) ON DELETE CASCADE,
  supplier_name       text NOT NULL,
  supplier_product_id text NOT NULL,
  source_index        integer NOT NULL,
  profile_id          text NOT NULL,
  profile_version     integer NOT NULL,
  profile_hash        text NOT NULL,
  connector_version   text NOT NULL,
  source_sha256       text NOT NULL,
  source_row_sha256   text NOT NULL,      -- fiche identique ou modifiée ?
  promotion_status    text NOT NULL,
  schema_version_used text,
  contract            jsonb,
  findings            jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload         jsonb NOT NULL,
  observed_at         timestamptz NOT NULL DEFAULT now(),
  -- Reprise interne d'un MÊME batch : rejouer un chunk ne duplique aucune
  -- observation. source_index plutôt que supplier_product_id, parce qu'il est
  -- le plus fidèle à l'observation brute : il identifie LA LIGNE reçue, pas
  -- le produit qu'on croit qu'elle décrit. Si demain deux lignes d'une même
  -- source représentaient légitimement le même produit, cette contrainte
  -- tiendrait encore ; UNIQUE (import_id, supplier_product_id) non.
  CONSTRAINT sco_import_source_index_unique UNIQUE (import_id, source_index)
);

CREATE INDEX IF NOT EXISTS idx_sco_identity ON public.sourcing_candidate_observations (supplier_name, supplier_product_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sco_import   ON public.sourcing_candidate_observations (import_id);
CREATE INDEX IF NOT EXISTS idx_sco_row_hash ON public.sourcing_candidate_observations (source_row_sha256);

-- Une même fiche réimportée à l'identique sous le même profil produit le même
-- source_row_sha256 : c'est CE hash qui détecte « inchangée » sans comparer
-- champ à champ, et qui permettra plus tard de sauter le re-scan.

COMMIT;

-- ============================================================================
-- IMPACT — à lire avant exécution
-- ============================================================================
-- Verrous     : ALTER TABLE ... ADD COLUMN sans DEFAULT volumineux et
--               ADD CONSTRAINT ... NOT VALID prennent un ACCESS EXCLUSIVE
--               bref. Les DROP/ADD CONSTRAINT du CHECK source_type et du CHECK
--               state réécrivent la validation sur toute la table : sur
--               sourcing_candidates, prévoir un scan complet. Volume actuel
--               faible ; à mesurer avant exécution en production.
-- Réversible  : oui. Les colonnes sont additives ; les deux CHECK remplacés
--               peuvent être restaurés à l'identique (script down non fourni
--               tant que la migration n'est pas validée).
-- Données     : aucune ligne existante n'est réécrite. Les batchs historiques
--               restent status='COMPLETED', profil NULL — d'où le NOT VALID.
-- Code        : cette migration est INERTE tant que l'orchestrateur n'écrit
--               pas ces colonnes. Elle peut donc passer AVANT le branchement.
-- Non couvert : la clé unique de sourcing_candidates. Inchangée, volontairement.
-- ============================================================================
