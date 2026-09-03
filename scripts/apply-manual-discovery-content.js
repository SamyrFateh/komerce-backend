/**
 * @komerce-arch
 * @role          providers-services-manual-discovery-content-ops
 * @domain        providers-services
 * @layer         tooling
 * @criticality   medium
 * @inputs        operator_json_manifest, explicit_apply_flag
 * @outputs       source_owned_rows, DISCOVERY_RAIL_CANDIDATES_operator_value
 * @depends       db, services/product-admin-service.js, services/local-stock-service.js
 * @used-by       manual operator workflow
 * @db-read       markets, boutique_categories, products
 * @db-write      providers, services, physical_offers
 * @db-write-via:product-admin-service products, catalog_field_overrides
 * @db-write-via:local-stock-service local_stock
 * @db-txn        idempotent_replay
 * @doctrine      docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md, docs/doctrine/DOCTRINE_DISCOVERY_ACCESSIBILITE_LOCALE.md
 * @impact-areas  catalog, local-stock, providers-services, recommendations, discovery-rail
 * @version       2026-09
 */
'use strict';

/**
 * Alimentation manuelle de contenu Komerce sans créer de source de vérité
 * parallèle à Discovery.
 *
 * - catalog_products -> owner catalog via product-admin-service
 * - catalog_products.local_stock -> owner local-stock via local-stock-service
 * - providers/local_products/services -> tables owner providers-services
 * - discovery -> politique d'exposition uniquement ; le script IMPRIME la
 *   valeur DISCOVERY_RAIL_CANDIDATES mais ne persiste jamais de carte.
 *
 * Sécurité : validation/dry-run par défaut. Les écritures exigent à la fois
 * `--apply` ET MANUAL_DISCOVERY_WRITE_ENABLED=true.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { createProduct, updateProduct } = require('../services/product-admin-service');
const { setLocalStock, setLocalStockExposure } = require('../services/local-stock-service');

const WRITE_FLAG = 'MANUAL_DISCOVERY_WRITE_ENABLED';
const MAX_DISCOVERY_CANDIDATES = 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_STATUSES = new Set(['pending', 'active', 'suspended']);
const CONTENT_STATUSES = new Set(['draft', 'active', 'suspended']);

const CATALOG_FIELDS = new Set([
  'product_ref', 'sku', 'name', 'description', 'category', 'subcategory',
  'price_kmf', 'price_aed', 'price_eur', 'weight_kg', 'dimensions_cm', 'stock',
  'image_url', 'images', 'badge', 'emoji', 'promo_pct', 'is_available',
  'is_active', 'has_couture', 'sourcing_source', 'requires_secure_transport',
  'customs_risk_coeff', 'unsold_price_kmf', 'unsold_channel', 'has_variants',
  'sort_order', 'local_stock', 'discovery',
]);
const PROVIDER_FIELDS = new Set(['id', 'name', 'phone', 'status']);
const LOCAL_CONTENT_FIELDS = new Set([
  'id', 'provider_id', 'title', 'description', 'zone', 'image_ref',
  'status', 'expose', 'discovery',
]);
const LOCAL_STOCK_FIELDS = new Set(['location', 'qty_physical', 'expose']);
const DISCOVERY_FIELDS = new Set(['categories', 'order']);

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCategories(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

function unknownFields(value, allowed) {
  if (!isPlainObject(value)) return [];
  return Object.keys(value).filter(key => !allowed.has(key));
}

function validateDiscovery(discovery, label, errors, orders) {
  if (discovery == null) return null;
  if (!isPlainObject(discovery)) {
    errors.push(`${label}.discovery doit être un objet`);
    return null;
  }

  for (const key of unknownFields(discovery, DISCOVERY_FIELDS)) {
    errors.push(`${label}.discovery.${key} est inconnu`);
  }

  const categories = normalizeCategories(discovery.categories);
  if (categories === null) {
    errors.push(`${label}.discovery.categories doit être un tableau`);
  } else {
    for (const category of categories) {
      if (category.length > 80) errors.push(`${label}.discovery.categories contient une clé > 80 caractères`);
    }
  }

  if (!Number.isInteger(discovery.order) || discovery.order < 0) {
    errors.push(`${label}.discovery.order doit être un entier >= 0`);
  } else if (orders.has(discovery.order)) {
    errors.push(`${label}.discovery.order=${discovery.order} est dupliqué`);
  } else {
    orders.add(discovery.order);
  }

  return {
    categories: categories || [],
    order: discovery.order,
  };
}

function validateLocalStock(stock, label, errors) {
  if (stock == null) return null;
  if (!isPlainObject(stock)) {
    errors.push(`${label}.local_stock doit être un objet`);
    return null;
  }
  for (const key of unknownFields(stock, LOCAL_STOCK_FIELDS)) {
    errors.push(`${label}.local_stock.${key} est inconnu`);
  }
  if (!Number.isInteger(stock.qty_physical) || stock.qty_physical < 0) {
    errors.push(`${label}.local_stock.qty_physical doit être un entier >= 0`);
  }
  if (own(stock, 'expose') && typeof stock.expose !== 'boolean') {
    errors.push(`${label}.local_stock.expose doit être booléen`);
  }
  if (own(stock, 'location') && (!stock.location || String(stock.location).trim().length > 80)) {
    errors.push(`${label}.local_stock.location invalide`);
  }
  return stock;
}

function validateManifest(manifest) {
  const errors = [];
  const orders = new Set();
  const identities = new Set();
  const refs = new Set();

  if (!isPlainObject(manifest)) {
    return { ok: false, errors: ['Le manifeste doit être un objet JSON'] };
  }

  const market = String(manifest.market || '').trim().toUpperCase();
  if (!market || market.length > 12) errors.push('market est requis (code marché, ex. KM)');

  const arrays = ['catalog_products', 'providers', 'local_products', 'services'];
  for (const key of arrays) {
    if (manifest[key] != null && !Array.isArray(manifest[key])) {
      errors.push(`${key} doit être un tableau`);
    }
  }

  const catalogProducts = Array.isArray(manifest.catalog_products) ? manifest.catalog_products : [];
  const providers = Array.isArray(manifest.providers) ? manifest.providers : [];
  const localProducts = Array.isArray(manifest.local_products) ? manifest.local_products : [];
  const services = Array.isArray(manifest.services) ? manifest.services : [];

  catalogProducts.forEach((entry, index) => {
    const label = `catalog_products[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label} doit être un objet`);
      return;
    }
    for (const key of unknownFields(entry, CATALOG_FIELDS)) errors.push(`${label}.${key} est inconnu`);

    const productRef = String(entry.product_ref || '').trim();
    if (!productRef) errors.push(`${label}.product_ref est requis pour un upsert manuel idempotent`);
    if (productRef && refs.has(productRef)) errors.push(`${label}.product_ref=${productRef} est dupliqué`);
    refs.add(productRef);
    if (!entry.name) errors.push(`${label}.name est requis`);
    if (!entry.category) errors.push(`${label}.category est requis`);
    if (!(Number(entry.price_kmf) > 0)) errors.push(`${label}.price_kmf doit être > 0`);

    const stock = validateLocalStock(entry.local_stock, label, errors);
    const discovery = validateDiscovery(entry.discovery, label, errors, orders);
    if (discovery && (!stock || stock.expose !== true)) {
      errors.push(`${label} exposé dans Discovery doit déclarer local_stock.expose=true`);
    }
    if (discovery && (entry.is_active === false || entry.is_available === false)) {
      errors.push(`${label} exposé dans Discovery ne peut pas être explicitement inactif/indisponible`);
    }
  });

  providers.forEach((entry, index) => {
    const label = `providers[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label} doit être un objet`);
      return;
    }
    for (const key of unknownFields(entry, PROVIDER_FIELDS)) errors.push(`${label}.${key} est inconnu`);
    if (!UUID_RE.test(String(entry.id || ''))) errors.push(`${label}.id doit être un UUID explicite`);
    if (!entry.name) errors.push(`${label}.name est requis`);
    if (!entry.phone) errors.push(`${label}.phone est requis`);
    const status = String(entry.status || 'active');
    if (!PROVIDER_STATUSES.has(status)) errors.push(`${label}.status invalide`);
    const identity = `provider:${entry.id}`;
    if (identities.has(identity)) errors.push(`${label}.id est dupliqué`);
    identities.add(identity);
  });

  function validateLocalContent(entries, kind, arrayName) {
    entries.forEach((entry, index) => {
      const label = `${arrayName}[${index}]`;
      if (!isPlainObject(entry)) {
        errors.push(`${label} doit être un objet`);
        return;
      }
      for (const key of unknownFields(entry, LOCAL_CONTENT_FIELDS)) errors.push(`${label}.${key} est inconnu`);
      if (!UUID_RE.test(String(entry.id || ''))) errors.push(`${label}.id doit être un UUID explicite`);
      if (!UUID_RE.test(String(entry.provider_id || ''))) errors.push(`${label}.provider_id doit être un UUID`);
      if (!entry.title) errors.push(`${label}.title est requis`);
      const status = String(entry.status || 'active');
      if (!CONTENT_STATUSES.has(status)) errors.push(`${label}.status invalide`);
      if (own(entry, 'expose') && typeof entry.expose !== 'boolean') errors.push(`${label}.expose doit être booléen`);
      const discovery = validateDiscovery(entry.discovery, label, errors, orders);
      if (discovery && (entry.expose !== true || status !== 'active')) {
        errors.push(`${label} exposé dans Discovery doit être status=active et expose=true`);
      }
      const identity = `${kind}:${entry.id}`;
      if (identities.has(identity)) errors.push(`${label}.id est dupliqué`);
      identities.add(identity);
    });
  }

  validateLocalContent(localProducts, 'physical_offer', 'local_products');
  validateLocalContent(services, 'service', 'services');

  const discoveryCount = [
    ...catalogProducts.filter(entry => entry?.discovery),
    ...localProducts.filter(entry => entry?.discovery),
    ...services.filter(entry => entry?.discovery),
  ].length;
  if (discoveryCount > MAX_DISCOVERY_CANDIDATES) {
    errors.push(`Discovery contient ${discoveryCount} candidats ; maximum runtime=${MAX_DISCOVERY_CANDIDATES}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      market,
      catalog_products: catalogProducts,
      providers,
      local_products: localProducts,
      services,
    },
    summary: {
      catalog_products: catalogProducts.length,
      providers: providers.length,
      local_products: localProducts.length,
      services: services.length,
      discovery_candidates: discoveryCount,
    },
  };
}

function discoveryMeta(entry) {
  if (!entry?.discovery) return null;
  return {
    categories: normalizeCategories(entry.discovery.categories) || [],
    order: entry.discovery.order,
  };
}

function candidateToken({ kind, id, categories = [] }) {
  const scope = categories.length ? `@${categories.join('|')}` : '';
  return `${kind}:${id}${scope}`;
}

function buildCandidateString(entries) {
  const ordered = [...entries].sort((a, b) => a.order - b.order);
  if (ordered.length > MAX_DISCOVERY_CANDIDATES) {
    throw new Error(`Trop de candidats Discovery (${ordered.length} > ${MAX_DISCOVERY_CANDIDATES})`);
  }
  return ordered.map(candidateToken).join(',');
}

function catalogPayload(entry) {
  const payload = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key !== 'local_stock' && key !== 'discovery' && CATALOG_FIELDS.has(key)) {
      payload[key] = value;
    }
  }
  return payload;
}

async function resolveMarketId(marketCode) {
  const { rows } = await db.query(
    'SELECT id FROM markets WHERE code = $1 AND is_active = true',
    [marketCode]
  );
  return rows[0]?.id || null;
}

async function validateDiscoveryCategories(manifest) {
  const declared = new Set();
  for (const group of [manifest.catalog_products, manifest.local_products, manifest.services]) {
    for (const entry of group) {
      for (const category of normalizeCategories(entry?.discovery?.categories) || []) declared.add(category);
    }
  }
  if (declared.size === 0) return;

  const { rows } = await db.query(
    'SELECT key FROM boutique_categories WHERE is_active = TRUE'
  );
  const valid = new Set(rows.map(row => row.key));
  const unknown = [...declared].filter(category => !valid.has(category));
  if (unknown.length) throw new Error(`Catégories Discovery inconnues : ${unknown.join(', ')}`);
}

async function upsertProvider(entry, marketId) {
  const status = String(entry.status || 'active');
  const { rows } = await db.query(
    `INSERT INTO providers (id, name, phone, market_id, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       phone = EXCLUDED.phone,
       market_id = EXCLUDED.market_id,
       status = EXCLUDED.status,
       updated_at = now()
     RETURNING id, name, phone, market_id, status`,
    [entry.id, entry.name, entry.phone, marketId, status]
  );
  return rows[0];
}

async function upsertLocalContent(table, entry, marketId) {
  if (table !== 'services' && table !== 'physical_offers') {
    throw new Error(`Table locale non autorisée : ${table}`);
  }
  const status = String(entry.status || 'active');
  const exposure = entry.expose === true ? 'ENABLED' : 'DISABLED';
  const { rows } = await db.query(
    `INSERT INTO ${table}
       (id, provider_id, title, description, market_id, zone, image_ref, status, commercial_exposure)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       market_id = EXCLUDED.market_id,
       zone = EXCLUDED.zone,
       image_ref = EXCLUDED.image_ref,
       status = EXCLUDED.status,
       commercial_exposure = EXCLUDED.commercial_exposure,
       updated_at = now()
     RETURNING id, provider_id, title, description, market_id, zone, image_ref, status, commercial_exposure`,
    [
      entry.id, entry.provider_id, entry.title, entry.description || null,
      marketId, entry.zone || null, entry.image_ref || null, status, exposure,
    ]
  );
  return rows[0];
}

async function upsertCatalogProduct(entry, marketId) {
  const payload = catalogPayload(entry);
  const { rows } = await db.query(
    'SELECT id FROM products WHERE product_ref = $1 LIMIT 1',
    [entry.product_ref]
  );

  let result;
  if (rows[0]?.id) {
    result = await updateProduct(db, rows[0].id, payload, null);
  } else {
    result = await createProduct(db, payload, null);
  }
  if (!result || result.status >= 400 || !result.body?.id) {
    throw new Error(`Produit ${entry.product_ref} refusé : ${result?.body?.error || 'erreur inconnue'}`);
  }

  const product = result.body;
  if (entry.local_stock) {
    const location = String(entry.local_stock.location || 'KM_MAIN').trim();
    await setLocalStock({
      productId: product.id,
      marketId,
      location,
      qtyPhysical: entry.local_stock.qty_physical,
    });
    await setLocalStockExposure(
      product.id,
      marketId,
      entry.local_stock.expose === true ? 'ENABLED' : 'DISABLED',
      location
    );
  }
  return product;
}

async function applyManualDiscoveryContent(manifest) {
  const validation = validateManifest(manifest);
  if (!validation.ok) {
    throw new Error(`Manifeste invalide:\n- ${validation.errors.join('\n- ')}`);
  }
  const normalized = validation.normalized;
  const marketId = await resolveMarketId(normalized.market);
  if (!marketId) throw new Error(`Marché inconnu ou inactif : ${normalized.market}`);

  await validateDiscoveryCategories(normalized);

  for (const provider of normalized.providers) await upsertProvider(provider, marketId);

  const candidates = [];
  for (const entry of normalized.catalog_products) {
    const product = await upsertCatalogProduct(entry, marketId);
    const discovery = discoveryMeta(entry);
    if (discovery) candidates.push({ kind: 'product', id: product.id, ...discovery });
  }

  for (const entry of normalized.local_products) {
    const offer = await upsertLocalContent('physical_offers', entry, marketId);
    const discovery = discoveryMeta(entry);
    if (discovery) candidates.push({ kind: 'physical_offer', id: offer.id, ...discovery });
  }

  for (const entry of normalized.services) {
    const service = await upsertLocalContent('services', entry, marketId);
    const discovery = discoveryMeta(entry);
    if (discovery) candidates.push({ kind: 'service', id: service.id, ...discovery });
  }

  return {
    market: normalized.market,
    market_id: marketId,
    summary: validation.summary,
    discovery_candidates: buildCandidateString(candidates),
  };
}

function readManifest(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

async function runCli() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const filePath = args.find(arg => !arg.startsWith('--'));
  if (!filePath) {
    throw new Error('Usage: node scripts/apply-manual-discovery-content.js <manifest.json> [--apply]');
  }

  const manifest = readManifest(filePath);
  const validation = validateManifest(manifest);
  if (!validation.ok) {
    console.error('[manual-discovery] ❌ manifeste invalide');
    for (const error of validation.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[manual-discovery] ✅ validation structurelle — ${JSON.stringify(validation.summary)}`);
  if (!apply) {
    console.log('[manual-discovery] DRY-RUN : aucune écriture. Ajouter --apply pour appliquer.');
    return;
  }

  if (!isTruthy(process.env[WRITE_FLAG])) {
    throw new Error(`${WRITE_FLAG}=true est requis avec --apply`);
  }

  const result = await applyManualDiscoveryContent(manifest);
  console.log(`[manual-discovery] ✅ contenu appliqué sur ${result.market}`);
  console.log('DISCOVERY_RAIL_ENABLED=true');
  console.log(`DISCOVERY_RAIL_CANDIDATES=${result.discovery_candidates}`);
}

if (require.main === module) {
  runCli()
    .catch(err => {
      console.error(`[manual-discovery] ❌ ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  WRITE_FLAG,
  MAX_DISCOVERY_CANDIDATES,
  normalizeCategories,
  validateManifest,
  candidateToken,
  buildCandidateString,
  catalogPayload,
  applyManualDiscoveryContent,
};
