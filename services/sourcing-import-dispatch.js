/**
 * @komerce-arch
 * @role          sourcing-import-connector-dispatch
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        supplier_import_payload
 * @outputs       normalized_supplier_products, connector_catalog, source_automation_catalog, acquisition_discovery_plan
 * @depends       services/suppliers/connectors/csv-connector.js, services/suppliers/connectors/manual-connector.js, services/suppliers/connectors/noon-connector.js, services/suppliers/connectors/cj-connector.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/allegro-connector.js, services/suppliers/connectors/ebay-connector.js, services/external-provider-onboarding-contracts.js
 * @used-by       routes/sourcing-scanner.js, services/sourcing-workspace.js, services/sourcing-source-autopilot.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_connector_dispatch_authority, source_autopull_is_registry_metadata_not_provider_branching, discovery_plan_precedes_import
 * @impact-areas  sourcing, supplier-import
 * @version       2026-10
 */

'use strict';

const csvConnector = require('./suppliers/connectors/csv-connector');
const manualConnector = require('./suppliers/connectors/manual-connector');
const noonModule = require('./suppliers/connectors/noon-connector');
const cjModule = require('./suppliers/connectors/cj-connector');
const aliexpressModule = require('./suppliers/connectors/aliexpress-connected-connector');
const allegroModule = require('./suppliers/connectors/allegro-connector');
const ebayModule = require('./suppliers/connectors/ebay-connector');
const providerOnboarding = require('./external-provider-onboarding-contracts');

// `automation` is deliberately declarative. The autopilot runner never branches
// on provider names: adding a future source means registering a connector and
// its bounded pull defaults here, not editing the runner.
const CONNECTORS = Object.freeze({
  csv: { module: csvConnector, active: true, label: 'CSV import' },
  manual: { module: manualConnector, active: true, label: 'Saisie manuelle' },
  api: {
    noon: {
      module: noonModule,
      active: noonModule.IS_ACTIVE,
      label: 'Noon API',
      reason: noonModule.INACTIVE_REASON,
      supplierName: 'Noon',
      auth: Object.freeze({ mode: 'none' }),
      automation: null,
    },
    cj: {
      module: cjModule,
      // Disponibilité plateforme : aucun prérequis serveur. La clé API relève de la source.
      active: true,
      label: 'CJdropshipping API',
      reason: null,
      auth: Object.freeze({
        mode: 'api_key',
        scope: 'source',
        fields: Object.freeze([Object.freeze({
          key: 'api_key',
          label: 'Clé API CJdropshipping',
          secret: true,
        })]),
        hasEnvironmentCredentials: () => typeof cjModule.hasEnvironmentCredentials === 'function' && cjModule.hasEnvironmentCredentials(process.env),
      }),
      supplierName: 'CJdropshipping',
      connection: Object.freeze({ mode: 'server_managed' }),
      discovery: Object.freeze({ mode: 'static', version: 'cj-catalog-page-v1' }),
      automation: Object.freeze({ page: 1, size: 20, include_commandable_units: true }),
    },
    allegro: {
      supportsFullSnapshot: false,
      module: allegroModule,
      get active() { return allegroModule.IS_ACTIVE; },
      label: 'Allegro Sandbox (seller test offers)',
      get reason() { return allegroModule.INACTIVE_REASON; },
      supplierName: 'Allegro Sandbox',
      connection: Object.freeze({ mode: 'server_managed' }),
      auth: Object.freeze({
        mode: 'client_credentials',
        scope: 'source',
        fields: Object.freeze([
          Object.freeze({ key: 'client_id', label: 'Client ID Allegro', secret: false }),
          Object.freeze({ key: 'client_secret', label: 'Client Secret Allegro', secret: true }),
        ]),
        hasEnvironmentCredentials: () => typeof allegroModule.hasEnvironmentCredentials === 'function' && allegroModule.hasEnvironmentCredentials(process.env),
      }),
      discovery: Object.freeze({ mode: 'static', version: 'allegro-sandbox-offers-v1' }),
      automation: Object.freeze({}),
    },
    ebay: {
      supportsFullSnapshot: false,
      module: ebayModule,
      get active() { return ebayModule.IS_ACTIVE; },
      label: 'eBay Sandbox Browse API',
      get reason() { return ebayModule.INACTIVE_REASON; },
      supplierName: 'eBay Sandbox',
      connection: Object.freeze({ mode: 'server_managed' }),
      // Contrat déclaré ; le connecteur eBay lit encore l'env (pas d'autopilot, non migré ici).
      auth: Object.freeze({
        mode: 'client_credentials',
        scope: 'platform',
      }),
      // P3 registration only: no unattended broad crawl until a bounded
      // automation policy is separately proved.
      automation: null,
    },
    aliexpress: {
      module: aliexpressModule,
      active: aliexpressModule.IS_ACTIVE,
      label: 'AliExpress Dropshipper API',
      reason: aliexpressModule.INACTIVE_REASON,
      supplierName: 'AliExpress',
      connection: Object.freeze({ mode: 'oauth', connectPath: '/api/integrations/aliexpress/oauth/start' }),
      // Cas A : APP_KEY/APP_SECRET = application Komerce (secret d'infrastructure). Seule la
      // session du compte est propre à la source, obtenue par OAuth côté serveur.
      auth: Object.freeze({
        mode: 'oauth',
        scope: 'platform',
        sessionKey: 'aliexpress',
      }),
      discovery: Object.freeze({ mode: 'runtime', version: 'aliexpress-ds-discovery-v1' }),
      automation: Object.freeze({ size: 20 }),
    },
  },
});

function connectorCatalog() {
  return {
    sources: [
      { type: 'csv', active: true, label: 'CSV import' },
      { type: 'manual', active: true, label: 'Saisie manuelle' },
    ],
    api_suppliers: Object.keys(CONNECTORS.api).map(supplier => ({
      supplier,
      active: CONNECTORS.api[supplier].active,
      label: CONNECTORS.api[supplier].label,
      reason: CONNECTORS.api[supplier].active ? null : CONNECTORS.api[supplier].reason,
    })),
  };
}

function sourceAutomationCatalog() {
  return Object.entries(CONNECTORS.api)
    .filter(([, entry]) => entry.automation)
    .map(([adapter, entry]) => {
      const onboarding = providerOnboarding.checkReady(adapter, publicAuthContract(entry));
      const connectorReady = Boolean(entry.active) && onboarding.ready;
      return {
        adapter,
        supplier_name: entry.supplierName || entry.label || adapter,
        label: entry.label,
        connector_ready: connectorReady,
        reason: !entry.active
          ? (entry.reason || 'connecteur inactif')
          : (!onboarding.ready ? 'Étude API / onboarding fournisseur incomplet' : null),
        onboarding_ready: onboarding.ready,
        discovery_mode: entry.discovery?.mode || null,
        discovery_version: entry.discovery?.version || null,
        discovery_ready: connectorReady && (
          entry.discovery?.mode === 'static'
          || typeof entry.module?.discoverAcquisitionPlan === 'function'
        ),
        pull_options: { ...entry.automation },
        supports_full_snapshot: entry.supportsFullSnapshot !== false,
      };
    });
}

// Faits opérateur sur les connecteurs API du registre : jamais de nom de module, de classe,
// de variable d'environnement ni de trace. La raison est un libellé métier.
function sourceConnectorFacts() {
  return Object.entries(CONNECTORS.api).map(([adapter, entry]) => {
    const available = Boolean(entry.active);
    const automatable = Boolean(entry.automation);
    const auth = publicAuthContract(entry);
    const onboardingCheck = providerOnboarding.checkReady(adapter, auth);
    let reason = null;
    if (!available) reason = 'Connecteur non configuré sur ce serveur';
    else if (!automatable) reason = 'Alimentation automatique non certifiée pour ce connecteur';
    else if (!onboardingCheck.ready) reason = 'Étude API / onboarding fournisseur incomplet';
    return {
      adapter,
      name: entry.supplierName || entry.label || adapter,
      label: entry.label || adapter,
      available,
      automatable,
      onboarding_ready: onboardingCheck.ready,
      onboarding: onboardingCheck.contract,
      connection_mode: entry.connection?.mode || null,
      connect_path: entry.connection?.connectPath || null,
      can_test_connection: Boolean(entry.connection && typeof entry.module?.testConnection === 'function'),
      auth,
      reason,
    };
  });
}

// Contrat d'authentification déclaré par le registre : l'UI en dérive son formulaire.
// Jamais de valeur, de nom de variable d'environnement ni d'indice sur un secret.
function publicAuthContract(entry) {
  const auth = entry?.auth || { mode: 'none' };
  return {
    mode: auth.mode,
    scope: auth.scope || null,
    fields: (auth.fields || []).map((field) => ({
      key: field.key,
      label: field.label,
      secret: Boolean(field.secret),
    })),
  };
}

function authContract(adapter) {
  const entry = CONNECTORS.api[String(adapter || '').trim().toLowerCase()];
  if (!entry) return null;
  const auth = entry.auth || { mode: 'none' };
  return {
    ...publicAuthContract(entry),
    sessionKey: auth.sessionKey || null,
    hasEnvironmentCredentials: typeof auth.hasEnvironmentCredentials === 'function'
      ? Boolean(auth.hasEnvironmentCredentials())
      : false,
  };
}

const CONNECTION_FAILURE_MESSAGES = Object.freeze({
  connector_unknown: 'Ce connecteur n’existe pas dans Komerce.',
  connector_unavailable: 'Le connecteur n’est pas configuré sur ce serveur.',
  connection_test_unavailable: 'Aucun test de connexion n’est disponible pour ce connecteur.',
  account_not_connected: 'Le compte fournisseur n’est pas encore connecté.',
  credentials_rejected: 'Le fournisseur a refusé les identifiants.',
  credentials_missing: 'Identifiants à configurer.',
  authorization_expired: 'Autorisation expirée : nouvelle autorisation nécessaire.',
  provider_unreachable: 'Le fournisseur ne répond pas pour le moment.',
  connection_failed: 'La connexion au fournisseur a échoué.',
});

function classifyConnectionFailure(error) {
  const text = String(error?.message || error || '');
  let code = 'connection_failed';
  if (/identifiants (à configurer|du coffre incomplets)|VAULT_CREDENTIALS_INCOMPLETE|CREDENTIALS_REQUIRED|_CLIENT_(ID|SECRET) requis/i.test(text)) code = 'credentials_missing';
  else if (/refresh token expir|nouvelle autorisation|REFRESH_TOKEN_REQUIRED|REFRESH_TOKEN_UNREADABLE/i.test(text)) code = 'authorization_expired';
  else if (/non autoris|nouvelle autorisation|aucun refresh|refresh token expir|compte .* non/i.test(text)) code = 'account_not_connected';
  else if (/rejected|refus|unauthori[sz]ed|forbidden|invalid.*(key|token|client)|HTTP_40[13]|\b40[13]\b/i.test(text)) code = 'credentials_rejected';
  else if (/TRANSPORT|timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|HTTP_5\d\d|\b5\d\d\b/i.test(text)) code = 'provider_unreachable';
  return { ok: false, code, message: CONNECTION_FAILURE_MESSAGES[code] };
}

// Test réel du connecteur, sans import, sans KIR, sans secret en sortie.
// Un test de connexion n'est jamais une certification runtime.
async function testConnection(adapter, { credentials = null } = {}) {
  const key = String(adapter || '').trim().toLowerCase();
  const entry = CONNECTORS.api[key];
  if (!entry) return { ok: false, code: 'connector_unknown', message: CONNECTION_FAILURE_MESSAGES.connector_unknown };
  if (!entry.active) return { ok: false, code: 'connector_unavailable', message: CONNECTION_FAILURE_MESSAGES.connector_unavailable };
  if (!entry.connection || typeof entry.module?.testConnection !== 'function') {
    return { ok: false, code: 'connection_test_unavailable', message: CONNECTION_FAILURE_MESSAGES.connection_test_unavailable };
  }
  try {
    await entry.module.testConnection(credentials ? { credentials } : {});
    return { ok: true, code: 'connection_ok', message: 'Connexion valide' };
  } catch (error) {
    return classifyConnectionFailure(error);
  }
}

function sourceAutomationDescriptor(adapter) {
  const key = String(adapter || '').trim().toLowerCase();
  return sourceAutomationCatalog().find((entry) => entry.adapter === key) || null;
}

async function discoverSourcePlan(adapter, options = {}) {
  const key = String(adapter || '').trim().toLowerCase();
  const entry = CONNECTORS.api[key];
  if (!entry || !entry.automation) {
    const error = new Error(`Discovery non configuré pour la source "${key || 'unknown'}"`);
    error.code = 'SOURCE_DISCOVERY_NOT_CONFIGURED';
    throw error;
  }
  if (!entry.active) {
    const error = new Error(entry.reason || `Connecteur ${key} inactif`);
    error.code = 'SOURCE_CONNECTOR_NOT_READY';
    throw error;
  }

  const baseOptions = { ...entry.automation, ...options };
  if (entry.discovery?.mode === 'runtime') {
    if (!entry.module || typeof entry.module.discoverAcquisitionPlan !== 'function') {
      const error = new Error(`Discovery runtime absent pour la source "${key}"`);
      error.code = 'SOURCE_DISCOVERY_RUNTIME_MISSING';
      throw error;
    }
    const plan = await entry.module.discoverAcquisitionPlan(baseOptions);
    if (!plan || plan.status !== 'READY' || !plan.pull_options) {
      const error = new Error(`Discovery runtime sans plan exploitable pour "${key}"`);
      error.code = 'SOURCE_DISCOVERY_PLAN_NOT_READY';
      error.details = plan || null;
      throw error;
    }
    return plan;
  }

  if (entry.discovery?.mode === 'static') {
    return {
      status: 'READY',
      provider: key,
      strategy: 'provider-static',
      version: entry.discovery.version || 'static-v1',
      pull_options: baseOptions,
      evidence: { source: 'provider_registry' },
    };
  }

  const error = new Error(`Mode Discovery inconnu pour la source "${key}"`);
  error.code = 'SOURCE_DISCOVERY_MODE_UNKNOWN';
  throw error;
}

function apiConnectorOptions(body = {}) {
  return {
    productIds: body.product_ids,
    productUrl: body.product_url,
    feedName: body.feed_name,
    keyword: body.keyword ?? body.query,
    page: body.page,
    size: body.size ?? body.page_size,
    categoryId: body.category_id,
    countryCode: body.country_code,
    sort: body.sort,
    startWarehouseInventory: body.start_warehouse_inventory,
    verifiedWarehouse: body.verified_warehouse,
    includeCommandableUnits: body.include_commandable_units === true,
  };
}

// Les secrets éventuels arrivent hors du corps d'import (second argument) : ils ne sont
// donc jamais persistés, journalisés ni recopiés avec le lot.
async function dispatchToConnector(body = {}, { credentials = null } = {}) {
  const sourceType = body.source_type || 'manual';
  if (sourceType === 'csv') {
    return csvConnector.fetchProducts({
      supplier_name: body.supplier_name,
      csv_text: body.csv_text,
      csv_mapping: body.csv_mapping,
    });
  }
  if (sourceType === 'manual') {
    return manualConnector.fetchProducts({
      supplier_name: body.supplier_name,
      items: body.items,
    });
  }
  if (sourceType === 'api') {
    const supplier = String(body.supplier_id || '').toLowerCase();
    const entry = CONNECTORS.api[supplier];
    if (!entry) throw new Error(`API non configurée : supplier "${supplier}" inconnu. Sources connues : ${Object.keys(CONNECTORS.api).join(', ')}`);
    if (entry.supportsFullSnapshot === false && body.is_full_snapshot) throw new Error('Ce connecteur borné ne permet pas un archivage full snapshot');
    if (!entry.active) throw new Error(`API non configurée : ${entry.reason || 'connecteur inactif'}`);
    if (!entry.module || typeof entry.module.fetchProducts !== 'function') {
      throw new Error(`API "${supplier}" déclarée mais non câblée. Voir api-connector.base.js.`);
    }

    // Le dispatch ne connaît pas la sémantique du fournisseur. Il transmet
    // uniquement une whitelist de capacités communes ; chaque connecteur décide
    // lesquelles il sait réellement interpréter.
    const options = apiConnectorOptions(body);
    if (credentials) options.credentials = credentials;
    return entry.module.fetchProducts(options);
  }
  throw new Error(`source_type inconnu : "${sourceType}". Valeurs supportées : csv, manual, api.`);
}

module.exports = {
  CONNECTORS,
  authContract,
  connectorCatalog,
  sourceAutomationCatalog,
  sourceAutomationDescriptor,
  sourceConnectorFacts,
  testConnection,
  _classifyConnectionFailure: classifyConnectionFailure,
  discoverSourcePlan,
  apiConnectorOptions,
  dispatchToConnector,
};
