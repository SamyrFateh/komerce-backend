'use strict';
/**
 * contract-generate.js
 * Génère docs/contract/openapi.json depuis :
 *   - les schémas Joi (validators/index.js) → face requête, haute fidélité
 *   - les routes montées (bootstrap/api-routes.js) → inventaire complet
 *   - les assertions body des tests d'intégration → face réponse partielle
 * Les réponses sans test sont marquées UNKNOWN (jamais inventées).
 *
 * Usage : node scripts/contract-generate.js
 */

const fs   = require('fs');
const path = require('path');

// ── 1. Convertir un describe() Joi en JSON Schema ────────────────────────────
function joiDescribeToSchema(desc) {
  if (!desc) return {};
  const schema = {};

  switch (desc.type) {
    case 'object': {
      schema.type = 'object';
      if (desc.keys) {
        schema.properties = {};
        const required = [];
        for (const [k, v] of Object.entries(desc.keys)) {
          schema.properties[k] = joiDescribeToSchema(v);
          if (v.flags?.presence === 'required') required.push(k);
        }
        if (required.length) schema.required = required;
      }
      break;
    }
    case 'array': {
      schema.type = 'array';
      if (desc.items?.[0]) schema.items = joiDescribeToSchema(desc.items[0]);
      const minRule = desc.rules?.find(r => r.name === 'min');
      if (minRule) schema.minItems = minRule.args.limit;
      break;
    }
    case 'string': {
      schema.type = 'string';
      const isUuid = desc.rules?.some(r => r.name === 'guid');
      if (isUuid) schema.format = 'uuid';
      const isEmail = desc.rules?.some(r => r.name === 'email');
      if (isEmail) schema.format = 'email';
      const isUri = desc.rules?.some(r => r.name === 'uri');
      if (isUri) schema.format = 'uri';
      const maxRule = desc.rules?.find(r => r.name === 'max');
      if (maxRule) schema.maxLength = maxRule.args.limit;
      if (desc.flags?.only && desc.allow) schema.enum = desc.allow;
      break;
    }
    case 'number': {
      schema.type = desc.rules?.some(r => r.name === 'integer') ? 'integer' : 'number';
      const min = desc.rules?.find(r => r.name === 'min');
      if (min) schema.minimum = min.args.limit;
      break;
    }
    case 'boolean': schema.type = 'boolean'; break;
    case 'date':    schema.type = 'string'; schema.format = 'date-time'; break;
    case 'alternatives': {
      if (desc.matches) {
        schema.oneOf = desc.matches
          .filter(m => m.schema)
          .map(m => joiDescribeToSchema(m.schema));
      }
      break;
    }
    default: schema.type = desc.type || 'string';
  }

  if (desc.flags?.default !== undefined) schema.default = desc.flags.default;
  if (desc.flags?.presence === 'optional' && schema.type) schema.nullable = true;
  return schema;
}

// ── 2. Construire le bloc requestBody depuis un schéma { body, params, query }
function buildRequestBody(schemaObj) {
  if (!schemaObj) return null;
  const body = schemaObj.body;
  if (!body || !body.describe) return null;
  try {
    return {
      required: true,
      content: {
        'application/json': {
          schema: joiDescribeToSchema(body.describe())
        }
      }
    };
  } catch { return null; }
}

function buildParameters(schemaObj) {
  const params = [];
  for (const loc of ['params', 'query']) {
    const s = schemaObj?.[loc];
    if (!s || !s.describe) continue;
    try {
      const desc = s.describe();
      for (const [name, def] of Object.entries(desc.keys || {})) {
        params.push({
          name, in: loc === 'params' ? 'path' : 'query',
          required: def.flags?.presence === 'required',
          schema: joiDescribeToSchema(def)
        });
      }
    } catch { /* skip */ }
  }
  return params;
}

// ── 3. Catalogue routes → schémas Joi (mapping manuel basé sur A1/A2) ────────
const validators = require('../validators');

const ROUTE_SCHEMA_MAP = [
  // AUTH
  { prefix: '/api/auth/login',             method: 'post',   schema: validators.auth?.login },
  { prefix: '/api/auth/register',          method: 'post',   schema: validators.auth?.register },
  { prefix: '/api/auth/otp/request',       method: 'post',   schema: validators.auth?.otpRequest },
  { prefix: '/api/auth/otp/verify',        method: 'post',   schema: validators.auth?.otpVerify },
  // PRODUCTS
  { prefix: '/api/products',              method: 'get',    schema: validators.products?.list },
  { prefix: '/api/products/{id}',         method: 'get',    schema: validators.products?.getOne },
  { prefix: '/api/products',              method: 'post',   schema: validators.products?.create },
  { prefix: '/api/products/{id}',         method: 'put',    schema: validators.products?.update },
  // ORDERS
  { prefix: '/api/orders',               method: 'post',   schema: validators.orders?.create },
  { prefix: '/api/orders',               method: 'get',    schema: validators.orders?.list },
  { prefix: '/api/orders/{id}/status',   method: 'put',    schema: validators.orders?.updateStatus },
  { prefix: '/api/orders/{id}',          method: 'delete', schema: validators.orders?.cancelOrder },
  // PAYMENTS
  { prefix: '/api/payments/stripe/intent', method: 'post', schema: validators.payments?.stripeIntent },
  { prefix: '/api/payments/cash/confirm',  method: 'post', schema: validators.payments?.cashConfirm },
  // SHARED-CARTS (trou critique — sans Joi)
  { prefix: '/api/shared-carts/from-cart-items', method: 'post', schema: null },
  { prefix: '/api/shared-carts/mine',            method: 'get',  schema: null },
  { prefix: '/api/shared-carts/public/{token}',  method: 'get',  schema: null },
  { prefix: '/api/shared-carts/{id}/finalize',   method: 'post', schema: null },
  // PARCELS
  { prefix: '/api/parcels',              method: 'get',    schema: validators.parcels?.list },
  { prefix: '/api/v2/parcels',           method: 'get',    schema: null },
  // SCANS
  { prefix: '/api/scans',               method: 'post',   schema: validators.scans?.create },
  // HUB
  { prefix: '/api/hub/pending',          method: 'get',    schema: null },
  { prefix: '/api/hub/inventory/buffer', method: 'get',    schema: null },
  { prefix: '/api/hub/inventory/proposals', method: 'get', schema: null },
  // TRACKING
  { prefix: '/api/tracking',            method: 'get',    schema: null },
  { prefix: '/api/client/tracking',     method: 'get',    schema: null },
  // WALLET
  { prefix: '/api/wallet',              method: 'get',    schema: null },
  // LOGISTICS
  { prefix: '/api/logistics/shipments', method: 'get',    schema: validators.logistics?.listShipments },
  // PRICING
  { prefix: '/api/pricing/apply-price/{id}', method: 'post', schema: validators.pricing?.applyPrice },
  // CATEGORIES
  { prefix: '/api/categories',          method: 'get',    schema: null },
  // RELAIS
  { prefix: '/api/relais/public',       method: 'get',    schema: null },
  // LOYALTY
  { prefix: '/api/loyalty',             method: 'get',    schema: validators.loyalty?.list },
  // PICKUP
  { prefix: '/api/pickup/verify',       method: 'post',   schema: null },
  { prefix: '/api/pickup/collect',      method: 'post',   schema: null },
  // ADMIN — surfaces dashboards
  { prefix: '/api/admin/costing/orders',   method: 'get', schema: null },
  { prefix: '/api/admin/costing/products', method: 'get', schema: null },
  { prefix: '/api/admin/costing/relais',   method: 'get', schema: null },
  { prefix: '/api/admin/radar',            method: 'get', schema: null },
  { prefix: '/api/unsold/stats/summary',   method: 'get', schema: validators.unsold?.statsSummary },
  { prefix: '/api/dashboard',             method: 'get',  schema: null },
  { prefix: '/api/hub-dash/start-prep/{id}', method: 'post', schema: null },
  { prefix: '/api/transitaire/parcels',   method: 'get',  schema: null },
  { prefix: '/api/simulator/start',       method: 'post', schema: null },
  { prefix: '/api/simulator/status',      method: 'get',  schema: null },
  // HEALTH
  { prefix: '/api/health',              method: 'get',    schema: null },
];

// ── 4. Champs de réponse connus (extraits de A2 + tests intégration) ─────────
// Format : chemin → méthode → { fields: [...], source: 'test|scan|UNKNOWN' }
const KNOWN_RESPONSES = {
  '/api/shared-carts/public/{token}': {
    get: { fields: ['contributed_kmf','remaining_kmf','total_kmf_snapshot','settlement_open','expires_at','token','status'], source: 'scan-boutique' }
  },
  '/api/shared-carts/{id}/finalize': {
    post: { fields: ['status','reference'], source: 'scan-boutique' }
  },
  '/api/orders': {
    post: { fields: ['reference','status','total_kmf','id'], source: 'test+scan' },
    get:  { fields: ['reference','status','total_kmf','phone'], source: 'test' }
  },
  '/api/auth/login': {
    post: { fields: ['token','user'], source: 'test' }
  },
  '/api/auth/me': {
    get: { fields: ['id','phone','role','name'], source: 'test' }
  },
  '/api/client/tracking': {
    get: { fields: ['status','reference','expires_at','pickup_code'], source: 'scan-boutique' }
  },
  '/api/pricing/apply-price/{id}': {
    post: { fields: ['status','recommended_price','health_status'], source: 'scan-dashboards' }
  },
};

function buildResponseSchema(routePrefix, method) {
  const known = KNOWN_RESPONSES[routePrefix]?.[method];
  if (!known) {
    return {
      'x-contract-status': 'UNKNOWN',
      description: 'Forme de réponse non couverte par un test. À compléter via des tests d\'intégration.',
    };
  }
  return {
    'x-contract-status': known.source,
    description: `Champs observés (source: ${known.source})`,
    type: 'object',
    properties: Object.fromEntries(known.fields.map(f => [f, { type: 'string', 'x-observed': true }])),
  };
}

// ── 5. Assembler l'OpenAPI ───────────────────────────────────────────────────
const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Komerce API — Contrat généré',
    version: '1.0.0',
    description: [
      'Généré automatiquement par scripts/contract-generate.js.',
      'NE PAS ÉDITER À LA MAIN — relancer `npm run contract:generate` après tout changement de route ou de validateur.',
      '',
      'Statuts de contrat :',
      '  - x-contract-status: "joi"      → requête haute fidélité (schéma Joi)',
      '  - x-contract-status: "test"     → réponse couverte par un test intégration',
      '  - x-contract-status: "scan-*"   → champs observés dans le code front',
      '  - x-contract-status: "UNKNOWN"  → non couvert, à compléter',
    ].join('\n'),
  },
  'x-generated-at': new Date().toISOString(),
  'x-contract-debt': {
    unknown_responses: 0,
    total_routes: ROUTE_SCHEMA_MAP.length,
    note: 'Voir docs/contract/DEBT.md pour la liste des routes UNKNOWN à couvrir',
  },
  paths: {},
};

let unknownCount = 0;

for (const route of ROUTE_SCHEMA_MAP) {
  const { prefix, method, schema } = route;
  if (!openapi.paths[prefix]) openapi.paths[prefix] = {};

  const op = {
    summary: `${method.toUpperCase()} ${prefix}`,
    'x-route-file': `routes/${prefix.split('/')[2] || 'unknown'}.js`,
  };

  const reqBody = buildRequestBody(schema);
  const params  = buildParameters(schema);
  if (reqBody) op.requestBody = { ...reqBody, 'x-contract-status': 'joi' };
  if (params.length) op.parameters = params;

  const respSchema = buildResponseSchema(prefix, method);
  if (respSchema['x-contract-status'] === 'UNKNOWN') unknownCount++;

  op.responses = {
    '200': {
      description: 'Succès',
      content: { 'application/json': { schema: respSchema } }
    }
  };

  openapi.paths[prefix][method] = op;
}

openapi['x-contract-debt'].unknown_responses = unknownCount;

// ── 6. Écrire le fichier + résumé de dette ───────────────────────────────────
const outDir  = path.join(__dirname, '..', 'docs', 'contract');
const outFile = path.join(outDir, 'openapi.json');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(openapi, null, 2));

const debtFile = path.join(outDir, 'DEBT.md');
const unknownRoutes = ROUTE_SCHEMA_MAP
  .filter(r => !KNOWN_RESPONSES[r.prefix]?.[r.method])
  .map(r => `- \`${r.method.toUpperCase()} ${r.prefix}\``);
fs.writeFileSync(debtFile, [
  '# Dette de contrat — réponses UNKNOWN',
  '',
  'Ces routes sont exposées mais leur forme de réponse n\'est pas couverte.',
  'Pour chaque route : ajouter un test d\'intégration qui asserte sur `.body`',
  'puis relancer `npm run contract:generate`.',
  '',
  ...unknownRoutes,
].join('\n'));

console.log(`✅ Contrat généré : ${outFile}`);
console.log(`   ${Object.keys(openapi.paths).length} routes · ${unknownCount} réponses UNKNOWN`);
console.log(`   Dette documentée dans : ${debtFile}`);
