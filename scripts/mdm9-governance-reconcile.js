'use strict';

const fs = require('fs');

const livePath = 'docs/db/railway-live-schema.sql';
let live = fs.readFileSync(livePath, 'utf8');
const blocks = [];

if (!/CREATE TABLE public\.supplier_catalog_import_rejections\b/.test(live)) {
  blocks.push(`
-- Migration 110 — ING-6 audit des rejets (appliquée au pilote production le 2026-07-16)
CREATE TABLE public.supplier_catalog_import_rejections (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    import_id uuid NOT NULL,
    supplier_name text NOT NULL,
    supplier_product_id text,
    source_index integer NOT NULL,
    promotion_status text NOT NULL,
    reason_code text NOT NULL,
    reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw_payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scir_promotion_status_check CHECK ((promotion_status = ANY (ARRAY['REJECTED_SOURCE_DATA_INVALID'::text, 'REJECTED_CONTRACT_INVALID'::text]))),
    CONSTRAINT scir_reason_code_check CHECK ((reason_code = ANY (ARRAY['SOURCE_ROW_NOT_OBJECT'::text, 'MISSING_SUPPLIER_PRODUCT_ID'::text, 'DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH'::text, 'SOURCE_FIELD_TOO_LARGE'::text, 'SOURCE_PRODUCT_TOO_DEEP'::text, 'SOURCE_VALUE_UNPARSABLE'::text, 'CONTRACT_SCHEMA_INVALID'::text, 'SOURCE_WEIGHT_UNIT_UNKNOWN'::text, 'UNSUPPORTED_VIDEO_REJECTED_BY_POLICY'::text, 'LOSSY_MAPPING_REJECTED_BY_POLICY'::text]))),
    CONSTRAINT scir_import_source_index_unique UNIQUE (import_id, source_index),
    CONSTRAINT supplier_catalog_import_rejections_pkey PRIMARY KEY (id),
    CONSTRAINT supplier_catalog_import_rejections_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.supplier_catalog_imports(id) ON DELETE CASCADE
);
CREATE INDEX idx_scir_import ON public.supplier_catalog_import_rejections USING btree (import_id);
CREATE INDEX idx_scir_supplier ON public.supplier_catalog_import_rejections USING btree (supplier_name, supplier_product_id);
CREATE INDEX idx_scir_reason_code ON public.supplier_catalog_import_rejections USING btree (reason_code);
`);
}

if (!/CREATE TABLE public\.sourcing_candidate_observations\b/.test(live)) {
  blocks.push(`
-- Migration 110 — ING-6 historique des observations (appliquée au pilote production le 2026-07-16)
CREATE TABLE public.sourcing_candidate_observations (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    candidate_id uuid,
    import_id uuid NOT NULL,
    supplier_name text NOT NULL,
    supplier_product_id text NOT NULL,
    source_index integer NOT NULL,
    profile_id text NOT NULL,
    profile_version integer NOT NULL,
    profile_hash text NOT NULL,
    connector_version text NOT NULL,
    source_sha256 text NOT NULL,
    source_row_sha256 text NOT NULL,
    promotion_status text NOT NULL,
    schema_version_used text,
    contract jsonb,
    findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw_payload jsonb NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sco_import_source_index_unique UNIQUE (import_id, source_index),
    CONSTRAINT sourcing_candidate_observations_pkey PRIMARY KEY (id),
    CONSTRAINT sourcing_candidate_observations_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.sourcing_candidates(id) ON DELETE SET NULL,
    CONSTRAINT sourcing_candidate_observations_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.supplier_catalog_imports(id) ON DELETE CASCADE
);
CREATE INDEX idx_sco_identity ON public.sourcing_candidate_observations USING btree (supplier_name, supplier_product_id, observed_at DESC);
CREATE INDEX idx_sco_import ON public.sourcing_candidate_observations USING btree (import_id);
CREATE INDEX idx_sco_row_hash ON public.sourcing_candidate_observations USING btree (source_row_sha256);
`);
}

if (blocks.length) {
  live = `${live.trimEnd()}\n${blocks.join('\n')}\n`;
  fs.writeFileSync(livePath, live);
}

const schemaPath = 'docs/SCHEMA.md';
let schema = fs.readFileSync(schemaPath, 'utf8');
if (!schema.includes('| `supplier_catalog_import_rejections` |')) {
  schema = schema.replace('| Tables | 94 |', '| Tables | 96 |');
  schema = schema.replace('### 4.10 Sourcing et fournisseurs (7 tables)', '### 4.10 Sourcing et fournisseurs (10 tables)');
  schema = schema.replace(
    '| `supplier_catalog_imports` | Imports catalogues. |',
    '| `supplier_catalog_imports` | Imports catalogues et audit de batch JSON : profil, hash source, version connecteur, statut, compteurs et findings. Migration 110, vérifiée lors du pilote production ING-6 du 2026-07-16. |\n' +
    '| `supplier_catalog_import_rejections` | Rejets de lignes ou contrats non représentables, séparés des candidats promouvables. Conserve le payload brut, les findings et la cause automatisable ; unicité `(import_id, source_index)`. Migration 110. |\n' +
    '| `sourcing_candidate_observations` | Historique immuable des observations fournisseur par batch et profil, avec hash de ligne et snapshot du contrat normalisé. Migration 110. |'
  );
}
fs.writeFileSync(schemaPath, schema);

const cartoPath = 'docs/CARTOGRAPHY_360.md';
let carto = fs.readFileSync(cartoPath, 'utf8');
if (!carto.includes('MDM-9 — galerie produit adaptative')) {
  carto += `\n\n## Delta 2026-07-16 — MDM-9 — galerie produit adaptative\n\n- \`public/boutique/js/b-modal-product.js\` : propriétaire du mode média explicite \`single|multiple\`, mesure du sujet et navigation canonique.\n- \`public/boutique/js/boutique.js\` : suppression du listener délégué legacy qui annulait \`goToSlide()\`.\n- \`public/boutique/css/modal-mobile-canonical.css\` : 36 % du viewport visible en single, 48 % conservés en multiple ; CTA et contenu enrichi préservés.\n- Aucun endpoint, aucune route et aucune mutation de schéma introduits par MDM-9. Le snapshot DB documente séparément la migration ING-6 déjà appliquée.\n`;
  fs.writeFileSync(cartoPath, carto);
}
