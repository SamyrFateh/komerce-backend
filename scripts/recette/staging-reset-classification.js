/**
 * @komerce-arch
 * @role          staging-reset-classification
 * @domain        infrastructure
 * @layer         script
 * @criticality   critical
 * @inputs        docs/db/railway-live-schema.sql, migrations/*.sql, governance/golden-staging-clean-policy.json
 * @outputs       classification de chaque table du schema (purge_root | purge_via_fk | foundation | fixture_scoped), regles fixtures
 * @depends       governance/golden-staging-clean-policy.json
 * @used-by       scripts/controlled-business-purge.js, scripts/recette/staging-reset.js, scripts/recette/staging-reset-fixtures.js, scripts/recette/staging-verify-empty.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_source_of_truth_staging_reset_classification_exhaustive_fail_closed
 * @impact-areas  database, staging, recette
 * @version       2026-11
 */
'use strict';

/**
 * Source unique de verite du reset Staging : CHAQUE table du schema est classee.
 *  - purge_root     : fait metier/test, racine de TRUNCATE (ou DELETE si mode:'delete').
 *  - purge_via_fk   : vidée par la fermeture FK calculee par PostgreSQL depuis les racines.
 *  - foundation     : referentiel / configuration / securite / audit de configuration : JAMAIS modifiee.
 *  - fixture_scoped : table dont certaines lignes sont des comptes/structures de test (retrait cible, voir fixtures).
 * Une table non classee fait echouer tests/unit/staging-reset-classification.test.js (garde anti-derive) et
 * bloque le plan de purge a l'execution (fail-closed). `uncertain: true` = classement conservateur a arbitrer.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const R = (name, why, extra) => [name, 'purge_root', why, extra || {}];
const V = (name, why) => [name, 'purge_via_fk', why, {}];
const F = (name, why, uncertain) => [name, 'foundation', why, uncertain ? { uncertain: true } : {}];
const S = (name, why) => [name, 'fixture_scoped', why, {}];

const ENTRIES = [
  // ── purge_root : racines metier (reprises de l'ancien ROOT_CANDIDATES) ──
  R('orders', 'commandes'), R('purchase_orders', 'achats fournisseur'), 
  
  R('refunds', 'remboursements'), R('invoices', 'factures'), R('transaction_documents', 'documents de transaction'),
  R('notification_log', 'journal notifications'), R('sms_log', 'journal SMS'),
  R('parcels', 'colis'), R('scan_events', 'scans'),
  R('customs_history', 'historique douane'), R('inventory_items', 'stock'), R('incidents', 'incidents'),
  R('outbox_events', 'outbox'), R('physical_outcome_receipts', 'recus physiques'),
  R('supplier_execution_orders', 'execution fournisseur'), R('supplier_execution_order_lines', 'execution fournisseur'),
  R('supplier_execution_payments', 'execution fournisseur'), R('supplier_execution_events', 'execution fournisseur'),
  R('supplier_execution_group_members', 'execution fournisseur'), R('supplier_execution_fulfillments', 'execution fournisseur'),
  R('supplier_execution_payment_proofs', 'execution fournisseur'),
  R('hub_physical_units', 'unites Hub'), R('hub_physical_unit_placements', 'unites Hub'), R('hub_custody_events', 'garde Hub'),
  R('hub_purchase_allocations', 'allocations Hub'),
  R('cash_collections', 'cash'), R('cash_deposits', 'cash'), R('cash_deposit_allocations', 'cash'),
  R('cash_custody_receipts', 'cash'), R('cash_custody_losses', 'cash'), 
  R('market_settlements', 'reglements marche'), R('market_settlement_events', 'reglements marche'),
  R('signals', 'signaux de decision'), R('baskets', 'paniers'), R('recipients', 'destinataires'), R('cart_shares', 'partages panier'),
  R('shared_carts', 'paniers partages'), R('shared_cart_items', 'paniers partages'), 
  
  R('supplier_catalog_imports', 'imports catalogue'), R('supplier_catalog_sync_checkpoints', 'imports catalogue'),
  R('sourcing_candidates', 'sourcing'), R('sourcing_observations', 'sourcing'), R('sourcing_candidate_events', 'sourcing'),
  R('sourcing_canonical_entities', 'sourcing'),
  R('sourcing_canonical_entity_refs', 'sourcing'), R('products', 'catalogue produits (reconstruit par API)'),
  // sourcing_captures : sourcing_sources.production_certified_capture_id y pointe ; TRUNCATE tronquerait le registre protege.
  R('sourcing_captures', 'captures sourcing : DELETE (FK retour sourcing_sources) et non TRUNCATE', { mode: 'delete' }),
  // ── purge_root : ajouts LOT 1 (constat Opus, ecrivains verifies) ──
  R('shipments', 'expeditions'), R('shipment_batches', 'lots d expedition'),
  R('international_shipments', 'expeditions internationales'), R('international_shipment_charges', 'frais d expedition internationale'),
  R('international_shipment_events', 'evenements expedition internationale'), R('international_n1_reconciliations', 'reconciliation N1 (fait calcule)'),
  R('customs_shipments', 'dossiers douane'), R('customs_shipment_fees', 'frais douane'),
  R('customs_shipment_financial_audit', 'audit financier douane (fait metier)'), R('customs_shipment_parcel_events', 'evenements colis douane'),
  R('cash_reconciliation', 'rapprochement cash agent'), R('order_cost_entry_events', 'evenements de cout commande'),
  R('wallets', 'portefeuilles clients (reset d environnement, pas une transaction metier)'),
  R('wallet_transactions', 'ledger wallet'), R('wallet_credit_lots', 'lots de credit wallet'), R('wallet_consumptions', 'consommations wallet'),
  R('stripe_events_processed', 'idempotence webhooks Stripe'), R('paypal_events_processed', 'idempotence webhooks PayPal'),
  R('alerts', 'alertes radar derivees de donnees metier'), R('client_notifications', 'notifications client'),
  R('otp_codes', 'codes OTP ephemeres'), R('pickup_verify_attempts', 'tentatives de verification retrait'),
  R('user_pickup_authorizations', 'autorisations de retrait par client'), R('webauthn_challenges', 'challenges ephemeres'),
  R('economic_snapshots', 'instantanes economiques calcules'), R('risk_provisions', 'provisions de risque (fait financier)'),
  R('financial_movements', 'journal financier'), R('financial_movement_documents', 'documents du journal financier'),
  R('market_cost_attributions', 'attribution de couts marche (fait metier)'), R('inquiries', 'demandes de contact discovery'),
  R('catalog_field_sync_state', 'etat de synchro par produit (orphelin apres purge produits)'),
  // Arbitrage utilisateur 2026-11-01 : sauvegardes ponctuelles de demo, suppression validee (vidage des lignes, pas de DROP).
  R('demo_kpr_backup_20261024', 'sauvegarde de demo du 2026-10-24 : vidage valide par l utilisateur'),
  R('demo_kpr_exposure_backup_20261024', 'sauvegarde de demo du 2026-10-24 : vidage valide par l utilisateur'),
  R('economic_risk_watermark_events', 'jalons de risque calcules sur commandes (FK RESTRICT users)', { uncertain: true }),

  // ── purge_via_fk : fermeture FK (verifiee contre PostgreSQL par le test d integration) ──
  ...`basket_items cash_confirmation_controls cash_custody_provenance_edges catalog_enrichment_runs catalog_field_overrides catalog_media
catalog_media_recovery_audit catalog_media_visual_fr_reviews catalog_publication_decision_audit catalog_stock_sync_state competitor_prices
customs_shipment_parcels disputes economic_risk_cost_events import_runtime_item_events import_runtime_runs
international_shipment_hub_units local_stock local_stock_allocations loyalty_rewards
market_price_observation_events market_price_observations mobile_money_transactions order_comments order_incidents
order_item_cost_imputations order_item_real_cost_allocations order_items order_status_history parcel_events parcel_items
pickup_print_tokens pickup_reveal_codes price_history pricing_maturity_disposition_events pricing_strategies pricing_strategy_history
product_attributes product_content_profile product_content_sections product_market_exposure product_market_price_draft_events
product_market_price_drafts product_sku_media product_skus product_suppliers product_variants purchase_lines refund_execution_intents
scans shared_cart_events shared_cart_saved_access sourcing_candidate_observations sourcing_identity_constraints sourcing_match_proposals
sourcing_observation_evidence sourcing_resolution_bindings sourcing_resolution_decisions store_credits supplier_catalog_import_rejections
supplier_execution_groups supplier_payment_settlements unsold_items`.split(/\s+/).map((t) => V(t, 'enfant FK d une racine purgee')),

  // ── foundation : referentiels / configuration / securite (jamais modifiee) ──
  F('schema_migrations', 'historique de migrations'), F('markets', 'marches (KM/YT/CM/CG/DJ + marches crees)'),
  F('finance_config', 'singleton de configuration financiere'), F('currency_parities', 'parites EUR pivot'),
  F('fx_pegs', 'pegs FX officiels (append-only)'), F('fx_rate_observations', 'observations FX approuvees (reference)'),
  F('fx_public_reference_quotes', 'cotations publiques de reference FX'), F('exchange_rates', 'taux de change de reference'),
  F('capability_registry', 'registre de capacites'), F('ceiling_templates', 'plafonds delegation'),
  F('ceiling_template_capabilities', 'plafonds delegation'), F('assignment_capability_ceiling', 'plafonds par affectation'),
  F('market_operating_assignments', 'affectations operateur/marche (structure de delegation)'),
  F('market_delegation_audit', 'audit de delegation (configuration)', true),
  F('market_cash_control_policies', 'politiques de controle cash'), F('market_cash_destinations', 'destinations cash'),
  F('market_central_collection_modes', 'modes de collecte centrale'), F('market_payment_providers', 'fournisseurs de paiement par marche'),
  F('market_payment_accounts', 'comptes de paiement par marche (configuration)', true),
  F('market_transport_sale_rates', 'tarifs de transport marche'),
  F('market_delivery_attestations', 'attestations de tarif de livraison transporteur (config tarifaire; Opus: purge)', true),
  F('business_rules', 'regles metier'), F('business_rules_history', 'historique des regles metier'),
  F('economic_variables', 'variables economiques'), F('charges', 'charges'), F('loyalty_tiers', 'paliers fidelite'),
  F('cost_components', 'composantes de cout (config pricing)'), F('cost_component_events', 'evenements config cout', true),
  F('cost_component_market_overrides', 'surcharges marche (config)'), F('cost_component_market_override_events', 'evenements config cout marche', true),
  F('cost_benchmarks', 'references de cout'), F('pricing_benchmarks', 'references pricing'), F('pricing_components', 'composantes de prix'),
  F('pricing_category_dims', 'dimensions pricing par categorie'), F('pricing_category_taxes', 'taxes pricing par categorie'),
  F('pricing_matrices_audit', 'audit matrices pricing'), F('pricing_market_decision_policy_events', 'politique de decision pricing', true),
  F('economic_structure_cost_events', 'structure de couts par periode (saisie admin)', true),
  F('customs_categories', 'categories douane'), F('carriers', 'transporteurs'), F('suppliers', 'fournisseurs (achats)', true),
  F('boutique_categories', 'taxonomie boutique'), F('boutique_subcategories', 'taxonomie boutique'),
  F('catalog_exclusions', 'exclusions catalogue'), F('catalog_glossary', 'glossaire catalogue'),
  F('catalog_terminology_reference', 'terminologie de reference', true), F('catalog_taxonomy_audit', 'audit taxonomie'),
  F('supplier_commercial_category_mappings', 'mappings categories fournisseur'),
  F('fabrics', 'modules couture : tissus', true), F('garment_models', 'modules couture : modeles', true),
  F('sourcing_sources', 'registre des sources'), F('sourcing_source_provides', 'capacites des sources'),
  F('sourcing_source_execution_modes', 'modes d execution des sources'), F('sourcing_commercial_principals', 'principaux commerciaux'),
  F('sourcing_source_principal_refs', 'references principaux'), F('sourcing_merge_policies', 'politiques de fusion'),
  F('sourcing_provider_control_events', 'controle fournisseur sourcing'), F('sourcing_source_requests', 'demandes de sources', true),
  F('supplier_oauth_connections', 'connexions OAuth fournisseurs'),
  F('providers', 'prestataires discovery locale (chantier staging en cours)', true),
  F('provider_credentials', 'identifiants prestataires'), F('services', 'services discovery (chantier en cours)', true),
  F('physical_offers', 'offres locales discovery (chantier en cours)', true),
  F('revoked_tokens', 'jetons revoques (securite : purger reactiverait des jetons)', true),

  // ── fixture_scoped : lignes retirees uniquement si rattachees a un compte/une structure de test ──
  S('users', 'comptes : fixtures retirees, admin/technique en allowlist'), S('relais', 'relais : fixtures retirees'),
  S('partners', 'partenaires : fixtures retirees'),
  S('assignment_memberships', 'adhesions des comptes (owner user_id)'), S('membership_capabilities', 'capacites d adhesion (enfant FK)'),
  S('operator_market_scopes', 'portees operateur (owner user_id)'), S('market_team_invitations', 'invitations equipe (owner invited_by/accepted_by)'),
  S('catalog_global_access_grants', 'acces globaux (owner user_id)'), S('dashboard_global_access_grants', 'acces globaux (owner user_id)'),
  S('pricing_global_access_grants', 'acces globaux (owner user_id)'), S('sourcing_global_access_grants', 'acces globaux (owner user_id)'),
  S('decision_signal_global_access_grants', 'acces globaux (owner user_id)'), S('webauthn_credentials', 'passkeys (owner user_id)'),
];

const TABLES = new Map();
for (const [name, cls, why, extra] of ENTRIES) {
  if (TABLES.has(name)) throw new Error(`STAGING_RESET_CLASSIFICATION_DUPLICATE:${name}`);
  TABLES.set(name, Object.freeze({ name, class: cls, why, ...extra }));
}

/** Colonnes dont la reference a un compte/relais/partenaire de test designe la LIGNE comme fixture (les autres colonnes sont des acteurs). */
const FIXTURE_OWNER_COLUMNS = Object.freeze({
  assignment_memberships: ['user_id'],
  operator_market_scopes: ['user_id'],
  market_team_invitations: ['invited_by_user_id', 'accepted_by_user_id'],
  catalog_global_access_grants: ['user_id'],
  dashboard_global_access_grants: ['user_id'],
  pricing_global_access_grants: ['user_id'],
  sourcing_global_access_grants: ['user_id'],
  decision_signal_global_access_grants: ['user_id'],
  webauthn_credentials: ['user_id'],
});
/** Racines de ciblage : leurs lignes sont designees par les regles ci-dessous. */
const FIXTURE_ROOT_TABLES = Object.freeze(['users', 'relais', 'partners']);

const classOf = (t) => (TABLES.has(t) ? TABLES.get(t).class : null);
const namesOf = (cls) => [...TABLES.values()].filter((e) => e.class === cls).map((e) => e.name);
const isPurgeClass = (t) => ['purge_root', 'purge_via_fk'].includes(classOf(t));
const isProtectedClass = (t) => ['foundation', 'fixture_scoped'].includes(classOf(t));

const ROOTS_TRUNCATE = Object.freeze(namesOf('purge_root').filter((t) => TABLES.get(t).mode !== 'delete'));
const ROOTS_DELETE = Object.freeze(namesOf('purge_root').filter((t) => TABLES.get(t).mode === 'delete'));
const PROTECTED = Object.freeze(new Set([...namesOf('foundation'), ...namesOf('fixture_scoped')]));
const UNCERTAIN_FOUNDATION = Object.freeze(namesOf('foundation').filter((t) => TABLES.get(t).uncertain).sort());
const UNCERTAIN_PURGE = Object.freeze(namesOf('purge_root').filter((t) => TABLES.get(t).uncertain).sort());

/** Tables du schema reconstruites statiquement (snapshot + migrations, CREATE/DROP dans l ordre). Egale pg_tables apres ci-db-bootstrap. */
function listSchemaTablesStatic(root = ROOT) {
  const strip = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /\b(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?)(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const files = [path.join(root, 'docs', 'db', 'railway-live-schema.sql'), ...migrations.map((f) => path.join(root, 'migrations', f))];
  const names = new Set();
  for (const file of files) {
    const text = strip(fs.readFileSync(file, 'utf8'));
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (/^create/i.test(m[1])) names.add(m[2]); else names.delete(m[2]);
    }
  }
  return [...names].sort();
}

/** { unclassified: tables du schema sans classe, stale: classes absentes du schema }. */
function diffAgainstSchema(existing) {
  const set = new Set(existing);
  return {
    unclassified: existing.filter((t) => !TABLES.has(t)).sort(),
    stale: [...TABLES.keys()].filter((t) => !set.has(t)).sort(),
  };
}

// ───────────────────────── Regles fixtures (deterministes, sans heuristique de role) ─────────────────────────
// Motifs e-mail : socle commun = governance/golden-staging-clean-policy.json (users.test_email_patterns, deja relu),
// complete par les marqueurs reellement utilises dans scripts/ et tests/ (RCT1, e2e, audit, a8-recette).
const EXTRA_EMAIL_PATTERNS = Object.freeze([
  '^rct1[._+-]', // scripts/recette/rct1/data.js : rct1.<cle>@<domaine>
  '^e2e([._+-]|@)', // e2e@komerce.km, e2e.chromium.agent@recette.komerce.invalid
  '^audit[._+-]', // comptes d audit
  '@e2e[.-]', // @e2e.invalid, @e2e-cash.test
  '@recette\\.', // @recette.komerce.invalid
]);
function loadPolicyEmailPatterns() {
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance', 'golden-staging-clean-policy.json'), 'utf8'));
  return policy.users.test_email_patterns;
}
const USER_EMAIL_REGEXES = Object.freeze([...loadPolicyEmailPatterns(), ...EXTRA_EMAIL_PATTERNS].map((p) => new RegExp(p, 'i')));
// Noms (full_name relais/partenaire/utilisateur) : prefixes des jeux de donnees de test (RCT1-REL-KM, A8-RECETTE-..., E2E-CASH Relais, e2e<runtag>-label).
const NAME_FIXTURE_REGEX = /^(rct1|a8|e2e|audit|golden)([-_ ]|$)|^e2e[0-9a-z]{6,}-/i;
/** Comptes techniques/admin conserves meme s ils ressemblent a un fixture. Extensible par KOMERCE_STAGING_RESET_KEEP_EMAILS (liste e-mails). */
const ALLOWLIST_EMAILS = Object.freeze(['admin@komerce.km', 'transitaire@komerce.km']);

function allowlistFrom(env = process.env) {
  const extra = String(env.KOMERCE_STAGING_RESET_KEEP_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...ALLOWLIST_EMAILS, ...extra]);
}
function userFixtureReason(user, allow = allowlistFrom()) {
  const email = String(user.email || '').toLowerCase();
  if (email && allow.has(email)) return null;
  const i = USER_EMAIL_REGEXES.findIndex((re) => re.test(email));
  if (i >= 0) return `email_pattern_${i}`;
  if (NAME_FIXTURE_REGEX.test(String(user.full_name || ''))) return 'name_prefix';
  return null;
}
function relaisFixtureReason(r) {
  if (NAME_FIXTURE_REGEX.test(String(r.name || ''))) return 'name_prefix';
  if (/adresse recette|moroni test|recette rct1/i.test(String(r.address || ''))) return 'address_marker';
  return null;
}
function partnerFixtureReason(p) {
  if (NAME_FIXTURE_REGEX.test(String(p.name || ''))) return 'name_prefix';
  if (p.email && USER_EMAIL_REGEXES.some((re) => re.test(String(p.email)))) return 'email_pattern';
  return null;
}

module.exports = {
  TABLES, ENTRIES, FIXTURE_OWNER_COLUMNS, FIXTURE_ROOT_TABLES, ROOTS_TRUNCATE, ROOTS_DELETE, PROTECTED, UNCERTAIN_FOUNDATION, UNCERTAIN_PURGE,
  ALLOWLIST_EMAILS, USER_EMAIL_REGEXES, NAME_FIXTURE_REGEX,
  classOf, namesOf, isPurgeClass, isProtectedClass, listSchemaTablesStatic, diffAgainstSchema, allowlistFrom,
  userFixtureReason, relaisFixtureReason, partnerFixtureReason,
};
