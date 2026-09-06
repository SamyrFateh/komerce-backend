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
  { prefix: '/api/auth/otp/request',       method: 'post',   schema: null }, // pas de validate() Joi sur cette route (validation inline manuelle dans routes/otp.js) — validators.auth.otpRequest n'a jamais existé
  { prefix: '/api/auth/otp/verify',        method: 'post',   schema: null }, // idem
  // AUTH-2/AUTH-4 — WebAuthn bodies are verified by @simplewebauthn/server, not Joi.
  { prefix: '/api/auth/passkey/register/options', method: 'post', schema: null },
  { prefix: '/api/auth/passkey/register/verify',  method: 'post', schema: null },
  { prefix: '/api/auth/passkey/login/options',    method: 'post', schema: null },
  { prefix: '/api/auth/passkey/login/verify',     method: 'post', schema: null },
  { prefix: '/api/auth/passkey/step-up/options',   method: 'post', schema: null },
  { prefix: '/api/auth/passkey/step-up/verify',    method: 'post', schema: null },
  { prefix: '/api/auth/passkey/credentials',          method: 'get',    schema: null },
  { prefix: '/api/auth/passkey/credentials',          method: 'delete', schema: null },
  // PRODUCTS
  { prefix: '/api/products',              method: 'get',    schema: validators.products?.list },
  { prefix: '/api/products/{id}',         method: 'get',    schema: validators.products?.getOne },
  { prefix: '/api/products',              method: 'post',   schema: validators.products?.create },
  { prefix: '/api/products/{id}',         method: 'put',    schema: validators.products?.update },
  // ORDERS
  { prefix: '/api/orders',               method: 'post',   schema: validators.orders?.create },
  { prefix: '/api/orders',               method: 'get',    schema: validators.orders?.list },
  { prefix: '/api/orders/{id}/status',   method: 'patch',  schema: validators.orders?.updateStatus },
  // Pas de DELETE /api/orders/{id} en vrai (vérifié contre routes/orders/cancel.js) :
  // l'annulation est POST /api/orders/{id}/cancel. L'ancienne entrée 'delete' ici ne
  // matchait jamais aucune route réelle → le schéma Joi cancelOrder n'était jamais
  // attaché. Corrigé pour pointer sur la vraie route.
  { prefix: '/api/orders/{id}/cancel',   method: 'post',   schema: validators.orders?.cancelOrder },
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
  // LOT 2C — Canonical AdminContext + Pilotage market-scoped
  // LOT 2D — Canonical Commerce global + market-scoped
  { prefix: '/api/admin/dashboard/commerce', method: 'get', schema: null },
  { prefix: '/api/admin/dashboard/commerce/market/{marketCode}', method: 'get', schema: null },
  // LOT 2E — Canonical Operations global + market-scoped
  { prefix: '/api/admin/dashboard/operations', method: 'get', schema: null },
  { prefix: '/api/admin/dashboard/operations/market/{marketCode}', method: 'get', schema: null },
  // LOT 2F — Canonical Finance global + market-scoped
  { prefix: '/api/admin/dashboard/finance', method: 'get', schema: null },
  { prefix: '/api/admin/dashboard/finance/market/{marketCode}', method: 'get', schema: null },
  // LOT 3A — Canonical Order 360
  { prefix: '/api/admin/entities/orders/{orderReference}', method: 'get', schema: null },
  // LOT 3B — Canonical Client 360
  { prefix: '/api/admin/entities/clients/{clientPhone}', method: 'get', schema: null },
  // LOT 3C — Canonical Product 360
  { prefix: '/api/admin/entities/products/{productRef}', method: 'get', schema: null },
  // LOT 4A — Canonical Operations / Hub-Relais Workspace (single-market actions)
  { prefix: '/api/admin/workspaces/operations/market/{marketCode}', method: 'get', schema: null },
  { prefix: '/api/admin/workspaces/operations/market/{marketCode}/orders/{reference}/mark-ordered', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/operations/market/{marketCode}/distribution/run', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/operations/market/{marketCode}/parcels/{reference}/ship', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/operations/market/{marketCode}/orders/{reference}/confirm-cash', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/operations/market/{marketCode}/parcels/{reference}/receive', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/operations/market/{marketCode}/parcels/{reference}/collect', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/operations/market/{marketCode}/inventory/items/{itemId}/assign', method: 'post', schema: null },
  // LOT 4B — Canonical Expéditions & Douane Workspace (single-market actions)
  { prefix: '/api/admin/workspaces/shipping-customs/market/{marketCode}', method: 'get', schema: null },
  { prefix: '/api/admin/workspaces/shipping-customs/market/{marketCode}/parcels/{reference}/confirm-transit', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/shipping-customs/market/{marketCode}/customs/shipments', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/shipping-customs/market/{marketCode}/customs/shipments/{reference}/update', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/shipping-customs/market/{marketCode}/customs/shipments/{reference}/declare', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/shipping-customs/market/{marketCode}/customs/shipments/{reference}/deactivate', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/shipping-customs/market/{marketCode}/customs/shipments/{reference}/activate', method: 'post', schema: null },
  // LOT 4C — Canonical Catalogue Workspace (global central actions)
  { prefix: '/api/admin/workspaces/catalog', method: 'get', schema: null },
  { prefix: '/api/admin/workspaces/catalog/products', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/products/{productRef}/update', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/products/{productRef}/deactivate', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/approval/{productRef}/approve', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/approval/{productRef}/reject', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/approval/{productRef}/override', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/categories', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/categories/{key}/update', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/categories/{key}/deactivate', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/categories/{key}/subcategories', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/categories/{key}/subcategories/{subKey}/update', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/catalog/categories/{key}/subcategories/{subKey}/deactivate', method: 'post', schema: null },
  // LOT 4D — Canonical Finance / Comptabilité Workspace (single-market cash actions)
  { prefix: '/api/admin/workspaces/accounting/market/{marketCode}', method: 'get', schema: null },
  { prefix: '/api/admin/workspaces/accounting/market/{marketCode}/deposits', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/accounting/market/{marketCode}/deposits/{depositRef}/verify', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/accounting/market/{marketCode}/deposits/{depositRef}/dispute', method: 'post', schema: null },
  // LOT 4U — Market-scoped Pricing cost workshop
  { prefix: '/api/admin/workspaces/pricing/market/{marketCode}', method: 'get', schema: null },
  { prefix: '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/update', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/toggle', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/reset', method: 'post', schema: null },
  { prefix: '/api/admin/dashboard/context', method: 'get', schema: null },
  { prefix: '/api/admin/dashboard/unified/market/{marketCode}', method: 'get', schema: null },
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
  // LOT 4E — Canonical Sourcing Workspace (global central actions)
  { prefix: '/api/admin/workspaces/sourcing', method: 'get', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/imports', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/products/{productRef}/update', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/candidates/{candidateRef}/update', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/candidates/{candidateRef}/scan', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/candidates/{candidateRef}/promote', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/candidates/{candidateRef}/watchlist', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/candidates/{candidateRef}/reject', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/suppliers', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/suppliers/{partnerRef}/update', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/suppliers/{partnerRef}/deactivate', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/sourcing/suppliers/{partnerRef}/activate', method: 'post', schema: null },

  // LOT 4F — Canonical Pricing Workspace (global central actions)
  { prefix: '/api/admin/workspaces/pricing', method: 'get', schema: null },
  { prefix: '/api/admin/workspaces/pricing/simulate', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/pricing/flow', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/pricing/products/{productRef}/apply-price', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/pricing/strategy', method: 'get', schema: null },
  { prefix: '/api/admin/workspaces/pricing/strategy/apply', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/pricing/competitors', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/pricing/competitors/{competitorRef}/deactivate', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/pricing/cost-components', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/pricing/cost-components/{key}/update', method: 'post', schema: null },
  { prefix: '/api/admin/workspaces/pricing/cost-components/{key}/toggle', method: 'post', schema: null },

  // LOT 4G — Canonical Action Center (global derived-signal lifecycle)
  { prefix: '/api/admin/action-center', method: 'get', schema: null },
  { prefix: '/api/admin/action-center/generate', method: 'post', schema: null },
  { prefix: '/api/admin/action-center/signals/{signalRef}/acknowledge', method: 'post', schema: null },
  { prefix: '/api/admin/action-center/signals/{signalRef}/snooze', method: 'post', schema: null },
  { prefix: '/api/admin/action-center/signals/{signalRef}/resolve', method: 'post', schema: null },

];

// ── 4. Champs de réponse connus (extraits de A2 + tests intégration) ─────────
// Format : chemin → méthode → { fields: [...], source: 'test|scan|UNKNOWN' }
const KNOWN_RESPONSES = {
  // LOT 4G — réponses Action Center consommées par Canonical.
  '/api/admin/action-center': { get: { fields: ['scope','summary','signals','pagination'], source: 'test' } },
  '/api/admin/action-center/generate': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/action-center/signals/{signalRef}/acknowledge': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/action-center/signals/{signalRef}/snooze': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/action-center/signals/{signalRef}/resolve': { post: { fields: ['ok','action','result'], source: 'test' } },
  // LOT 4F — réponses Pricing Workspace consommées par Canonical.
  '/api/admin/workspaces/pricing': { get: { fields: ['scope','summary','products','recommendations','cost_components','cost_meta','rates'], source: 'test' } },
  '/api/admin/workspaces/pricing/simulate': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/pricing/flow': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/pricing/products/{productRef}/apply-price': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/pricing/strategy': { get: { fields: ['strategy','competitors'], source: 'test' } },
  '/api/admin/workspaces/pricing/strategy/apply': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/pricing/competitors': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/pricing/competitors/{competitorRef}/deactivate': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/pricing/cost-components': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/pricing/cost-components/{key}/update': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/pricing/cost-components/{key}/toggle': { post: { fields: ['ok','action','result'], source: 'test' } },
  // LOT 4E — réponses Sourcing Workspace consommées par Canonical.
  '/api/admin/workspaces/sourcing': { get: { fields: ['scope','summary','portfolio','imports','candidates','suppliers','connectors'], source: 'test' } },
  '/api/admin/workspaces/sourcing/imports': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/sourcing/products/{productRef}/update': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/sourcing/candidates/{candidateRef}/update': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/sourcing/candidates/{candidateRef}/scan': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/sourcing/candidates/{candidateRef}/promote': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/sourcing/candidates/{candidateRef}/watchlist': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/sourcing/candidates/{candidateRef}/reject': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/sourcing/suppliers': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/sourcing/suppliers/{partnerRef}/update': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/sourcing/suppliers/{partnerRef}/deactivate': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/sourcing/suppliers/{partnerRef}/activate': { post: { fields: ['ok','action','result'], source: 'test' } },
  // LOT 4D — réponses Finance / Comptabilité Workspace consommées par Canonical.
  '/api/admin/workspaces/accounting/market/{marketCode}': { get: { fields: ['scope','filters','summary','reconciliation','deposits','uncollected','collections','invoices'], source: 'test' } },
  '/api/admin/workspaces/accounting/market/{marketCode}/deposits': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/accounting/market/{marketCode}/deposits/{depositRef}/verify': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/accounting/market/{marketCode}/deposits/{depositRef}/dispute': { post: { fields: ['ok','action','result'], source: 'test' } },
  // LOT 4C — réponses Catalogue Workspace consommées par Canonical.
  '/api/admin/workspaces/catalog': { get: { fields: ['scope','summary','categories','products','approval'], source: 'test' } },
  '/api/admin/workspaces/catalog/products': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/products/{productRef}/update': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/products/{productRef}/deactivate': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/approval/{productRef}/approve': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/approval/{productRef}/reject': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/approval/{productRef}/override': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/categories': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/categories/{key}/update': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/categories/{key}/deactivate': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/categories/{key}/subcategories': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/categories/{key}/subcategories/{subKey}/update': { post: { fields: ['ok','action','result'], source: 'test' } },
  '/api/admin/workspaces/catalog/categories/{key}/subcategories/{subKey}/deactivate': { post: { fields: ['ok','action','result'], source: 'test' } },
  // LOT 4B — réponses Expéditions & Douane Workspace consommées par Canonical.
  '/api/admin/workspaces/shipping-customs/market/{marketCode}': {
    get: { fields: ['scope','summary','transit','customs'], source: 'test' }
  },
  '/api/admin/workspaces/shipping-customs/market/{marketCode}/parcels/{reference}/confirm-transit': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/shipping-customs/market/{marketCode}/customs/shipments': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/shipping-customs/market/{marketCode}/customs/shipments/{reference}/update': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/shipping-customs/market/{marketCode}/customs/shipments/{reference}/declare': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/shipping-customs/market/{marketCode}/customs/shipments/{reference}/deactivate': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/shipping-customs/market/{marketCode}/customs/shipments/{reference}/activate': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  // LOT 4A — réponses Operations Workspace consommées par Canonical.
  '/api/admin/workspaces/operations/market/{marketCode}': {
    get: { fields: ['scope','summary','queues','distribution','inventory','data_quality'], source: 'test' }
  },
  '/api/admin/workspaces/operations/market/{marketCode}/orders/{reference}/mark-ordered': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/operations/market/{marketCode}/distribution/run': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/operations/market/{marketCode}/parcels/{reference}/ship': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/operations/market/{marketCode}/orders/{reference}/confirm-cash': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/operations/market/{marketCode}/parcels/{reference}/receive': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/operations/market/{marketCode}/parcels/{reference}/collect': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  '/api/admin/workspaces/operations/market/{marketCode}/inventory/items/{itemId}/assign': {
    post: { fields: ['ok','action','result'], source: 'test' }
  },
  // LOT 3C — réponse Product 360 consommée par Canonical.
  '/api/admin/entities/products/{productRef}': {
    get: { fields: ['product','scope','summary','inventory','performance','economics','central','timeline','data_quality'], source: 'test' }
  },
  // LOT 3B — réponse Client 360 consommée par Canonical.
  '/api/admin/entities/clients/{clientPhone}': {
    get: { fields: ['client','scope','summary','finance','orders','top_products','shared_lists','notifications','security','timeline','data_quality'], source: 'test' }
  },
  // LOT 3A — réponse Order 360 consommée par Canonical.
  '/api/admin/entities/orders/{orderReference}': {
    get: { fields: ['order','summary','items','parcels','history','scans','incidents','comments','notifications','invoices','documents','data_quality'], source: 'test' }
  },
  // LOT 2F — réponses Finance consommées par Canonical.
  '/api/admin/dashboard/finance': {
    get: { fields: ['scope','period','kpis','payment_mix','refunds','incomplete_cost_orders','data_quality'], source: 'test' }
  },
  '/api/admin/dashboard/finance/market/{marketCode}': {
    get: { fields: ['scope','period','kpis','payment_mix','refunds','incomplete_cost_orders','data_quality'], source: 'test' }
  },
  // LOT 2E — réponses Operations consommées par Canonical.
  '/api/admin/dashboard/operations': {
    get: { fields: ['scope','kpis','active_orders','critical_delays','signals','data_quality'], source: 'test' }
  },
  '/api/admin/dashboard/operations/market/{marketCode}': {
    get: { fields: ['scope','kpis','active_orders','critical_delays','signals','data_quality'], source: 'test' }
  },
  // LOT 2D — réponses Commerce consommées par Canonical.
  '/api/admin/dashboard/commerce': {
    get: { fields: ['scope','period','kpis','top_products','categories','funnel','data_quality'], source: 'test' }
  },
  '/api/admin/dashboard/commerce/market/{marketCode}': {
    get: { fields: ['scope','period','kpis','top_products','categories','funnel','data_quality'], source: 'test' }
  },
  // LOT 2C — réponses consommées par Canonical et couvertes par tests.
  '/api/admin/dashboard/context': {
    get: { fields: ['actor','access'], source: 'test' }
  },
  '/api/admin/dashboard/unified/market/{marketCode}': {
    get: { fields: ['scope','kpis_global','view_blocks','economic_flow','principles','system_alerts','data_quality'], source: 'test' }
  },
  // AUTH-2/AUTH-4 — WebAuthn option shapes come from services/webauthn-service.js.
  '/api/auth/passkey/register/options': { post: { fields: ['challenge','rp','user','pubKeyCredParams','timeout','attestation','excludeCredentials','authenticatorSelection','extensions'], source: 'service-read' } },
  '/api/auth/passkey/register/verify':  { post: { fields: ['verified'], source: 'route-read' } },
  '/api/auth/passkey/login/options':    { post: { fields: ['challenge','timeout','rpId','allowCredentials','userVerification','extensions'], source: 'service-read' } },
  '/api/auth/passkey/login/verify':     { post: { fields: ['verified','user'], source: 'route-read' } },
  '/api/auth/passkey/step-up/options': { post: { fields: ['challenge','timeout','rpId','allowCredentials','userVerification','extensions'], source: 'service-read' } },
  '/api/auth/passkey/step-up/verify':  { post: { fields: ['verified'], source: 'route-read' } },
  '/api/auth/passkey/credentials': { get: { fields: ['credentials'], source: 'route-read' } },
  '/api/auth/passkey/credentials/{id}': { delete: { fields: ['revoked','id'], source: 'route-read' } },
  // D-06 — admin-customs-shipments : workflow déclaration + analytics
  '/api/admin/customs-shipments/{id}/declare': {
    post: { fields: ['shipment_id', 'status', 'customs_paid_kmf', 'parcels_updated'], source: 'test' },
  },
  '/api/admin/customs-shipments/status/pending': {
    get: { fields: ['shipments', 'count'], source: 'test' },
  },
  // NOTE D-06 : route actuellement shadowed par GET /:id ; réponse réelle = 400 invalid_input.
  // Le contrat est marqué couvert, sans corriger le bug de routing dans ce lot.
  '/api/admin/customs-shipments/analytics': {
    get: { fields: ['error', 'code', 'requestId', 'detail'], source: 'test' },
  },
  '/api/admin/customs-shipments/analytics/trends': {
    get: { fields: ['trends', 'months'], source: 'test' },
  },
  '/api/admin/customs-shipments/{id}/analytics': {
    get: { fields: [
      'shipment_id', 'reference', 'shipment_date', 'transitaire_name', 'transport_mode',
      'status', 'declared_at', 'parcel_count', 'actual_customs_kmf', 'actual_rate_pct',
      'declared_cif_kmf', 'expected_customs_kmf', 'declared_avg_rate_pct', 'ecart_kmf',
      'ecart_pct', 'ecart_direction', 'coverage', 'confidence',
    ], source: 'test' },
  },

  // D-06 — admin documents : transaction_documents admin view
  '/api/admin/documents': {
    get: { fields: ['documents', 'total', 'limit', 'offset'], source: 'test' },
  },
  '/api/admin/documents/summary': {
    get: { fields: ['table_exists', 'by_type', 'sequences', 'type_constraint', 'diagnosis'], source: 'test' },
  },
  '/api/admin/documents/{id}': {
    get: { fields: ['document'], source: 'test' },
  },

  // D-06 — catalog approval queue : K-4 human approval gate
  '/api/admin/catalog/approval-queue': {
    get: { fields: ['items', 'total', 'limit', 'offset'], source: 'test' },
  },
  '/api/admin/catalog/approval-queue/{id}/approve': {
    post: { fields: [
      'id', 'name', 'description', 'category', 'fragility', 'emoji', 'price_kmf', 'stock',
      'lifecycle_status', 'content_source', 'needs_review', 'enrichment_confidence',
      'is_active', 'quality_validated', 'updated_at',
    ], source: 'test' },
  },
  '/api/admin/catalog/approval-queue/{id}/reject': {
    post: { fields: [
      'id', 'name', 'description', 'category', 'price_kmf', 'stock', 'lifecycle_status',
      'content_source', 'needs_review', 'is_active', 'updated_at',
    ], source: 'test' },
  },
  '/api/admin/catalog/approval-queue/{id}/override': {
    post: { fields: [
      'id', 'name', 'description', 'category', 'fragility', 'emoji', 'price_kmf', 'stock',
      'lifecycle_status', 'content_source', 'needs_review', 'enrichment_confidence',
      'is_active', 'quality_validated', 'overridden', 'updated_at',
    ], source: 'test' },
  },

  // D-06 — hub : drift découvert après regeneration fraîche du contrat
  '/api/hub/volume': {
    post: { fields: ['message', 'product', 'repack_gain_cm3', 'recorded_by'], source: 'test' },
  },
  '/api/hub/photo': {
    post: { fields: ['message', 'event_id', 'photo_url', 'photo_count', 'recorded_at'], source: 'test' },
  },

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
  // POST /api/auth/login : CORRIGÉ — l'entrée précédente listait 'token' avec
  // source 'test', mais routes/auth.js fait `setAuthCookie(res, token)` (cookie
  // httpOnly) puis `res.json({ user: userResponse(user) })` — pas de `token` dans
  // le corps JSON. Confirmé aussi par tests/e2e.sh (`curl -c "$AC" ...login`, -c =
  // sauvegarde cookie). Aucun test jest n'asserte ce corps → source 'route-read'.
  '/api/auth/login': {
    post: { fields: ['user'], source: 'route-read' }
  },
  // GET /api/auth/me : CORRIGÉ — l'entrée précédente listait 'name' avec source
  // 'test', mais la colonne réelle (SELECT u.full_name ...) est 'full_name'. 'name'
  // n'existe pas dans la réponse. Aucun test jest sur ce corps → 'route-read'.
  '/api/auth/me': {
    get: { fields: ['id','full_name','email','phone','role','country','currency_pref'], source: 'route-read' },
    put: { fields: ['user'], source: 'route-read' }
  },
  // POST /api/auth/register : `res.status(201).json({ user: userResponse(user) })`,
  // même forme que /login. Pas de test sur le corps de succès (tests/integration/
  // api.test.js ne couvre que les rejets) → 'route-read'.
  '/api/auth/register': {
    post: { fields: ['user'], source: 'route-read' }
  },
  // POST /api/auth/otp/request : routes/otp.js, chemin de succès `res.json({ ok,
  // success, message, expiresIn, retryAfter, _dev? })`. _dev est conditionnel
  // (dev + OTP_DEV_ECHO seulement) donc volontairement omis de la liste. Pas de
  // test sur ce corps → 'route-read'.
  '/api/auth/otp/request': {
    post: { fields: ['ok','success','message','expiresIn','retryAfter'], source: 'route-read' }
  },
  // POST /api/auth/otp/verify : routes/otp.js, chemin de succès `res.json({ ok,
  // success, message, created, user })`. Pas de test sur ce corps → 'route-read'.
  '/api/auth/otp/verify': {
    post: { fields: ['ok','success','message','created','user'], source: 'route-read' }
  },
  '/api/client/tracking': {
    get: { fields: ['status','reference','expires_at','pickup_code'], source: 'scan-boutique' }
  },
  '/api/pricing/apply-price/{id}': {
    post: { fields: ['status','recommended_price','health_status'], source: 'scan-dashboards' }
  },
  // ── L4 (burn-down UNKNOWN) — admin / paiement / commandes, vérifié contre tests ──
  // GET /api/admin/orders : tests/integration/api.test.js + admin-authz-probe.test.js
  '/api/admin/orders': {
    get: { fields: ['orders'], source: 'test' }
  },
  // POST /api/payments/cash/confirm : la route (routes/payments.js) fait
  // `res.status(result.status).json(result.body)` — le body testé dans
  // tests/unit/payment-cash-confirm.test.js (succès) est donc le body HTTP réel.
  '/api/payments/cash/confirm': {
    post: { fields: ['reference','message'], source: 'test' }
  },
  // POST /api/payments/paypal/refund/{orderId} : même pattern de passthrough
  // dans routes/payments-paypal.js, testé dans tests/unit/payment-paypal.test.js.
  '/api/payments/paypal/refund/{orderId}': {
    post: { fields: ['success','refund_id'], source: 'test' }
  },
  // GET /api/products : tests/integration/api.test.js
  '/api/products': {
    get: { fields: ['products'], source: 'test' },
    // POST /api/products : routes/products.js fait `res.status(result.status).json(result.body)`
    // où result.body = product = `INSERT INTO products (...) RETURNING *` (product-admin-service.js).
    // Pas de test d'intégration sur ce endpoint → 'route-read'. Sous-ensemble stable de
    // colonnes confirmées dans le code (liste `fields`/`optionals` de createProduct) ;
    // la ligne réelle a plus de colonnes (RETURNING *), volontairement non exhaustif.
    post: { fields: ['id','name','category','price_kmf','sku','product_ref','stock','is_active','is_available'], source: 'route-read' }
  },
  // GET /api/products/{id} : routes/products.js → `SELECT * FROM products WHERE id = $1`,
  // + `variants` ajouté si has_variants. PUT /api/products/{id} : même passthrough
  // result.body que POST (updateProduct → `UPDATE ... RETURNING *`). Pas de test → 'route-read'.
  '/api/products/{id}': {
    get:    { fields: ['id','name','category','price_kmf','sku','product_ref','stock','is_active','is_available','variants'], source: 'route-read' },
    put:    { fields: ['id','name','category','price_kmf','sku','product_ref','stock','is_active','is_available'], source: 'route-read' },
    delete: { fields: ['deleted'], source: 'route-read' }
  },
  // GET /api/health : tests/integration/api.test.js + admin-authz-probe.test.js
  '/api/health': {
    get: { fields: ['status','db_latency_ms'], source: 'test' }
  },
  // ── L4 (2e itération) — admin / paiement / commandes ──────────────────────
  // POST /api/payments/stripe/intent : routes/payments.js fait `res.json(result)`
  // où result = createStripeIntent(...). Shape testée explicitement dans
  // tests/unit/payment-stripe.test.js (result.client_secret, result.reused,
  // existing/non-reused branches) — même pattern passthrough que cash/confirm
  // et paypal/refund.
  '/api/payments/stripe/intent': {
    post: { fields: ['client_secret','amount_eur','amount_cents','order_reference','reused'], source: 'test' }
  },
  // PATCH /api/orders/{id}/status : routes/orders/status.js → `res.json({ success: true, status })`
  // sur le seul chemin de succès. Pas de test d'intégration sur le corps HTTP
  // (order-status-machine.test.js couvre le service, pas la route) → lu directement
  // dans le handler, pas dans un test : source 'route-read', pas 'test'.
  '/api/orders/{id}/status': {
    patch: { fields: ['success','status'], source: 'route-read' }
  },
  // POST /api/orders/{id}/cancel : routes/orders/cancel.js → objet de réponse final
  // construit explicitement avec ces clés. Pas de test d'intégration sur le corps
  // HTTP → source 'route-read'.
  '/api/orders/{id}/cancel': {
    post: { fields: ['success','reference','status','refund','message'], source: 'route-read' }
  },
  // GET /api/admin/costing/orders|products|relais : routes/admin-costing.js, top-level
  // de chaque res.json(...) lu directement dans le handler (pas de test) → 'route-read'.
  '/api/admin/costing/orders': {
    get: { fields: ['orders','pagination','doctrine_phase'], source: 'route-read' }
  },
  '/api/admin/costing/products': {
    get: { fields: ['products','doctrine_phase'], source: 'route-read' }
  },
  '/api/admin/costing/relais': {
    get: { fields: ['relais','doctrine_phase'], source: 'route-read' }
  },
  // GET /api/admin/radar : routes/admin-radar.js → res.json(await radar.getRadarSummary())
  // ; shape lue dans services/radar-queries.js, pas de test dédié → 'route-read'.
  '/api/admin/radar': {
    get: { fields: ['ok','alert_count','generated_at','hint'], source: 'route-read' }
  },
  // GET /api/admin/radar/alerts : routes/admin-radar.js → res.json(await radar.getAlerts())
  // ; shape couverte par tests/unit/radar-queries.test.js (describe('getAlerts'),
  // assertions sur result.alerts et result.total) → 'test'.
  '/api/admin/radar/alerts': {
    get: { fields: ['generated_at','total','critical','signal','alerts'], source: 'test' }
  },

  // ── L5 (burn-down UNKNOWN) — blast-radius : orders / payments / admin / cash / pickup / scans ─

  // orders/list.js
  '/api/orders/relais': {
    get: { fields: ['summary','orders'], source: 'route-read' }
  },
  '/api/orders/problems': {
    get: { fields: ['health_score','total','by_category','problems'], source: 'route-read' }
  },
  '/api/orders/credits': {
    get: { fields: ['total_kmf','credits'], source: 'route-read' }
  },
  // orders/qr.js → res.json({ success, token, expiration, qr_payload })
  '/api/orders/{id}/qr-token': {
    post: { fields: ['success','token','expiration','qr_payload'], source: 'route-read' }
  },
  // orders/detail.js → GET /retrait/:token → res.json(rows) (array of order items)
  '/api/orders/retrait/{token}': {
    get: { fields: ['id','reference','status','items'], source: 'route-read' }
  },
  // orders/status.js → POST mark-availability → res.json({ success: true, order: updated })
  '/api/orders/{id}/mark-availability': {
    post: { fields: ['success','order'], source: 'route-read' }
  },
  // orders/status.js → POST partial-ship → res.json({ success: true, order: updated })
  '/api/orders/{id}/partial-ship': {
    post: { fields: ['success','order'], source: 'route-read' }
  },
  // orders/detail.js → GET /sub-orders → res.json(rows)
  '/api/orders/{id}/sub-orders': {
    get: { fields: ['id','reference','status','parent_order_id'], source: 'route-read' }
  },
  // orders/parcels.js → GET → res.json({ order_reference, order_status, parcels })
  '/api/orders/{id}/parcels': {
    get: { fields: ['order_reference','order_status','parcels'], source: 'route-read' }
  },
  // orders/parcels.js → PATCH sub-orders/:subId/status → res.status(status).json(body)
  '/api/orders/parcels/{parcelId}/status': {
    patch: { fields: ['success','status'], source: 'route-read' }
  },
  '/api/orders/sub-orders/{subId}/status': {
    patch: { fields: ['success','status'], source: 'route-read' }
  },
  // orders → POST cancel-backorder → res.status(status).json(body)
  '/api/orders/{id}/cancel-backorder': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  // orders/status.js → PATCH cost → res.json({ success: true, order: updated })
  '/api/orders/{id}/cost': {
    patch: { fields: ['success','order'], source: 'route-read' }
  },
  // orders/detail.js → GET /:ref → res.json(order)
  '/api/orders/{ref}': {
    get: { fields: ['id','reference','status','total_kmf','payment_mode','payment_status','items','parcels'], source: 'route-read' }
  },
  // orders/detail.js → GET /:id/history → res.json(rows)
  '/api/orders/{id}/history': {
    get: { fields: ['id','order_id','status','note','changed_by','created_at'], source: 'route-read' }
  },

  // payments.js
  '/api/payments/stripe/webhook': {
    post: { fields: ['received'], source: 'route-read' }
  },
  '/api/payments/rates': {
    get: { fields: ['eur_kmf','aed_kmf','source'], source: 'route-read' }
  },
  '/api/payments/config': {
    get: { fields: ['publishable_key'], source: 'route-read' }
  },

  // admin.js / admin/*.js
  '/api/admin/customs': {
    get: { fields: ['history','by_category','anomalies','period_days'], source: 'route-read' }
  },
  '/api/admin/partners': {
    get: { fields: ['id','name','type','contact'], source: 'route-read' },
    post: { fields: ['id','name','type','contact'], source: 'route-read' }
  },
  '/api/admin/partners/stats': {
    get: { fields: ['partner','stats'], source: 'route-read' }
  },
  '/api/admin/partners/{id}': {
    get: { fields: ['partner','stats'], source: 'route-read' },
    put: { fields: ['id','name','type','contact'], source: 'route-read' },
    delete: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/admin/users': {
    get: { fields: ['users','total'], source: 'route-read' },
    post: { fields: ['success','user'], source: 'route-read' }
  },
  '/api/admin/users/{id}/role': {
    put: { fields: ['success','user'], source: 'route-read' }
  },
  '/api/admin/users/{id}/password': {
    put: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/admin/users/{id}': {
    delete: { fields: ['success','message','type','deleted'], source: 'route-read' }
  },
  '/api/admin/margins': {
    get: { fields: ['orders','summary'], source: 'route-read' }
  },
  '/api/admin/alerts': {
    get: { fields: ['alerts','total'], source: 'route-read' }
  },
  '/api/admin/counts': {
    get: { fields: ['orders','order_items','products','relais','users_non_admin'], source: 'route-read' }
  },
  '/api/admin/reset': {
    post: { fields: ['success','message','mode','deleted'], source: 'route-read' }
  },
  '/api/admin/seed-test': {
    post: { fields: ['success','message','summary'], source: 'route-read' }
  },
  '/api/admin/orders/{id}': {
    delete: { fields: ['success','message','deleted'], source: 'route-read' }
  },
  '/api/admin/orders/{id}/refund': {
    post: { fields: ['success','refund_id','message'], source: 'route-read' }
  },

  // admin-dashboard.js
  '/api/admin/dashboard': {
    get: { fields: ['metrics','alerts','generated_at'], source: 'route-read' }
  },
  '/api/admin/dashboard/control-tower': {
    get: { fields: ['orders','parcels','alerts','generated_at'], source: 'route-read' }
  },
  '/api/admin/dashboard/costing': {
    get: { fields: ['orders','summary','generated_at'], source: 'route-read' }
  },
  '/api/admin/dashboard/logistics': {
    get: { fields: ['parcels','relais','summary','generated_at'], source: 'route-read' }
  },
  '/api/admin/dashboard/unified': {
    get: { fields: ['orders','parcels','metrics','generated_at'], source: 'route-read' }
  },
  '/api/admin/dashboard/cache/clear': {
    post: { fields: ['ok','cleared','prefix'], source: 'route-read' }
  },

  // purchasing.js
  '/api/purchasing': {
    get: { fields: ['purchase_orders','total'], source: 'route-read' }
  },
  '/api/purchasing/suppliers': {
    get: { fields: ['id','name','platform','auto_order','contact_phone'], source: 'route-read' },
    post: { fields: ['id','name','platform','contact_phone'], source: 'route-read' }
  },
  '/api/purchasing/suppliers/{id}/map': {
    post: { fields: ['id','product_id','supplier_id','supplier_sku','supplier_price_aed'], source: 'route-read' }
  },
  '/api/purchasing/suppliers/{id}': {
    delete: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/purchasing/order/{order_id}/completeness': {
    get: { fields: ['order_id','complete','any_pending','total_ordered','total_received','purchase_orders'], source: 'route-read' }
  },
  '/api/purchasing/{order_id}': {
    get: { fields: ['id','status','supplier_id','qty','received_qty','supplier_name'], source: 'route-read' }
  },
  '/api/purchasing/{order_id}/confirm': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/purchasing/{id}/receive': {
    post: { fields: ['success','status','received_qty'], source: 'route-read' }
  },
  '/api/purchasing/po/{po_id}': {
    delete: { fields: ['success','message'], source: 'route-read' }
  },

  // cash.js — routes/cash.js, réponses lues directement dans les handlers
  '/api/cash/collect/{orderId}': {
    post: { fields: ['success','message','collection','payment_cycle'], source: 'route-read' }
  },
  '/api/cash/collections': {
    get: { fields: ['collections','total','page','pages'], source: 'route-read' }
  },
  '/api/cash/deposit': {
    post: { fields: ['success','message','deposit'], source: 'route-read' }
  },
  '/api/cash/deposits': {
    get: { fields: ['deposits','total','page','pages'], source: 'route-read' }
  },
  '/api/cash/deposits/{id}/verify': {
    post: { fields: ['success','message','deposit'], source: 'route-read' }
  },
  '/api/cash/deposits/{id}/dispute': {
    post: { fields: ['success','message','deposit'], source: 'route-read' }
  },
  '/api/cash/reconciliation': {
    get: { fields: ['period','generated_at','totals','agents'], source: 'route-read' }
  },
  '/api/cash/reconciliation/agents': {
    get: { fields: ['generated_at','agents'], source: 'route-read' }
  },
  '/api/cash/uncollected': {
    get: { fields: ['hours_threshold','count','total_missing_kmf','orders'], source: 'route-read' }
  },

  // pickup-secret.js — réponses lues dans les handlers
  '/api/pickup/pay-cash/{orderId}': {
    post: { fields: ['success','message','code','print_token','order_ref','amount_kmf'], source: 'route-read' }
  },
  // GET /api/pickup/receipt/:orderId — retourne du HTML imprimable (reçu de paiement),
  // pas du JSON. Le print_token à usage unique est validé côté serveur. Source: route-read.
  '/api/pickup/receipt/{orderId}': {
    get: { fields: ['_html_only'], source: 'route-read' }
  },
  '/api/pickup/verify/{orderId}': {
    post: { fields: ['success','message','order_ref'], source: 'route-read' }
  },
  '/api/pickup/collect/{orderId}': {
    post: { fields: ['success','message','order_ref'], source: 'route-read' }
  },
  '/api/pickup/regenerate/{orderId}': {
    post: { fields: ['success','message','code','order_ref'], source: 'route-read' }
  },
  '/api/pickup/status/{orderId}': {
    get: { fields: ['order_ref','status','payment_status','total_kmf','client_name','tracking'], source: 'route-read' }
  },
  '/api/pickup/reveal-once/{orderId}': {
    get: { fields: ['order_ref','status','payment_status','total_kmf'], source: 'route-read' }
  },

  // scans.js — réponses via scan-operations.js (pattern passthrough)
  '/api/scans': {
    post: { fields: ['scan_id','order_id','order_reference','new_status','step','sms_triggered','is_anomaly'], source: 'route-read' }
  },
  '/api/scans/collect': {
    post: { fields: ['message','reference','recipient','relais','collected_at'], source: 'route-read' }
  },
  '/api/scans/hub/receive': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/scans/hub/pending': {
    get: { fields: ['count','orders'], source: 'route-read' }
  },
  '/api/scans/verify-qr': {
    post: { fields: ['success','message','order_ref'], source: 'route-read' }
  },
  '/api/scans/{order_id}': {
    get: { fields: ['id','order_id','event_type','scan_code','created_at'], source: 'route-read' }
  },

  // admin-costing.js — additional missing routes
  '/api/admin/costing/orders/{orderId}': {
    get: { fields: ['order','costing','items'], source: 'route-read' }
  },
  '/api/admin/costing/shipments/{id}/allocate': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/admin/costing/parcels/{id}/allocate': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/admin/costing/orders/{id}/lock-purchase': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/admin/costing/monthly-fixed/{yearMonth}': {
    post: { fields: ['success','message','period'], source: 'route-read' }
  },
  '/api/admin/costing/recalibration-proposal': {
    get: { fields: ['proposal','generated_at'], source: 'route-read' }
  },
  '/api/admin/costing/recalibration-apply': {
    post: { fields: ['success','applied','message'], source: 'route-read' }
  },

  // ── L6 (burn-down UNKNOWN) — shared-carts / dashboard / sourcing / hub / pricing / parcels / auth / misc ──

  // shared-cart-cash.js
  '/api/shared-carts/public/{token}/contributions/cash': {
    post: { fields: ['ok','error','code','contribution'], source: 'route-read' }
  },
  '/api/shared-carts/contributions/{id}/confirm-cash': {
    post: { fields: ['ok','already_confirmed','contribution','cart'], source: 'route-read' }
  },
  '/api/shared-carts/public/{token}/estimations': {
    get:  { fields: ['estimations'], source: 'route-read' },
    post: { fields: ['ok','updated','estimation','message'], source: 'route-read' }
  },
  '/api/shared-carts/public/{token}/estimations/{estimationId}': {
    delete: { fields: ['ok','message'], source: 'route-read' }
  },
  '/api/shared-carts/public/{token}/estimations/by-phone': {
    get: { fields: ['estimation'], source: 'route-read' }
  },
  '/api/shared-carts/public/{token}/contributions': {
    post: { fields: ['checkout_url','session_id','contribution_id','payable_amount_kmf','capped'], source: 'route-read' }
  },
  '/api/shared-carts/from-cart-items': {
    post: { fields: ['shared_cart_id','token','share_url','total_kmf'], source: 'route-read' }
  },
  '/api/shared-carts/from-basket': {
    post: { fields: ['shared_cart_id','token','share_url','total_kmf'], source: 'route-read' }
  },
  '/api/shared-carts/from-order': {
    post: { fields: ['shared_cart_id','token','share_url','total_kmf'], source: 'route-read' }
  },
  '/api/shared-carts/mine': {
    get: { fields: ['carts'], source: 'route-read' }
  },
  '/api/shared-carts/{id}': {
    get: { fields: ['cart','share_url'], source: 'route-read' }
  },
  '/api/shared-carts/{id}/close': {
    post: { fields: ['ok','label','message','cart'], source: 'route-read' }
  },
  '/api/shared-carts/{id}/awaiting-choice/complete': {
    post: { fields: ['order_id','order_reference','prepaid_kmf','remaining_cash_kmf'], source: 'route-read' }
  },
  '/api/shared-carts/{id}/awaiting-choice/adjust': {
    post: { fields: ['ok','label','message','cart'], source: 'route-read' }
  },
  '/api/shared-carts/{id}/extend-window': {
    post: { fields: ['ok','message','cart'], source: 'route-read' }
  },
  '/api/shared-carts/{id}/awaiting-choice/cancel': {
    post: { fields: ['ok','cart','refunds'], source: 'route-read' }
  },
  '/api/shared-carts/{id}/cancel': {
    post: { fields: ['ok','cart','refunds'], source: 'route-read' }
  },
  '/api/shared-carts/stripe/webhook': {
    post: { fields: ['received'], source: 'route-read' }
  },

  // shared-cart-refund-admin.js (adminRouter)
  '/api/admin/shared-carts': {
    get: { fields: ['carts','count'], source: 'route-read' }
  },
  '/api/admin/shared-carts/refund-queue': {
    get: { fields: ['refund_queue'], source: 'route-read' }
  },
  '/api/admin/shared-carts/refund-queue/{contributionId}/mark-refunded': {
    post: { fields: ['ok','contribution'], source: 'route-read' }
  },
  '/api/admin/shared-carts/{id}': {
    get: { fields: ['cart'], source: 'route-read' }
  },
  '/api/admin/shared-carts/{id}/expire': {
    post: { fields: ['ok','cart'], source: 'route-read' }
  },
  '/api/admin/shared-carts/{id}/extend': {
    post: { fields: ['ok','cart'], source: 'route-read' }
  },
  '/api/admin/shared-carts/{id}/note': {
    post: { fields: ['ok'], source: 'route-read' }
  },

  // dashboard.js (delegates to sub-routers)
  '/api/dashboard/ops': {
    get: { fields: ['activite','commandes_aujourd_hui','commandes_en_cours'], source: 'route-read' }
  },
  '/api/dashboard/pilotage': {
    get: { fields: ['periode','genere_le','taux','taux_history','volume','total','annulees'], source: 'route-read' }
  },
  '/api/dashboard/pipeline': {
    get: { fields: ['pipeline'], source: 'route-read' }
  },
  '/api/dashboard/retards': {
    get: { fields: ['retards'], source: 'route-read' }
  },
  '/api/dashboard/forecast': {
    get: { fields: ['kpi','total_orders'], source: 'route-read' }
  },
  '/api/dashboard/global': {
    get: { fields: ['panier_moyen_kmf','nb_clients','total_orders','active_orders','completed_orders','ca_total_kmf','kpi'], source: 'route-read' }
  },
  '/api/dashboard/stats': {
    get: { fields: ['panier_moyen_kmf','nb_clients','total_orders','active_orders','completed_orders','ca_total_kmf','kpi'], source: 'route-read' }
  },
  '/api/dashboard/finance': {
    get: { fields: ['period','taux','kpi'], source: 'route-read' }
  },
  '/api/dashboard/annulations-parcels': {
    get: { fields: ['period','annulations'], source: 'route-read' }
  },
  '/api/dashboard/payments': {
    get: { fields: ['period','taux','cash'], source: 'route-read' }
  },
  '/api/dashboard/sales': {
    get: { fields: ['period','kpi'], source: 'route-read' }
  },
  '/api/dashboard/clients': {
    get: { fields: ['clients'], source: 'route-read' }
  },
  '/api/dashboard/clients/list': {
    get: { fields: ['total','total_pages','filters'], source: 'route-read' }
  },
  '/api/dashboard/clients/detail': {
    get: { fields: ['profile','nb_orders_total','nb_orders_valid','nb_orders_cancelled','ltv_kmf'], source: 'route-read' }
  },
  '/api/dashboard/history': {
    get: { fields: ['en_transit','a_remettre','kpi'], source: 'route-read' }
  },
  '/api/dashboard/relais': {
    get: { fields: ['en_transit','a_remettre','kpi'], source: 'route-read' }
  },
  '/api/dashboard/hub-dubai': {
    get: { fields: ['hub'], source: 'route-read' }
  },
  '/api/dashboard/hub': {
    get: { fields: ['hub'], source: 'route-read' }
  },

  // sourcing-engine.js
  '/api/admin/sourcing/analysis': {
    get: { fields: ['analysis'], source: 'route-read' }
  },
  '/api/admin/sourcing/analysis/{id}': {
    get: { fields: ['analysis'], source: 'route-read' }
  },
  '/api/admin/sourcing/synthesis': {
    get: { fields: ['synthesis'], source: 'route-read' }
  },
  '/api/admin/sourcing/products/{id}': {
    put: { fields: ['product'], source: 'route-read' }
  },
  '/api/admin/sourcing/bulk-rail': {
    post: { fields: ['updated'], source: 'route-read' }
  },
  '/api/admin/sourcing/config': {
    get: { fields: ['config'], source: 'route-read' }
  },
  '/api/admin/sourcing/products/{id}/variants': {
    get:  { fields: ['product_id','has_variants','variants'], source: 'route-read' },
    put:  { fields: ['variants'], source: 'route-read' }
  },
  '/api/admin/sourcing/connectors': {
    get: { fields: ['connectors'], source: 'route-read' }
  },
  '/api/admin/sourcing/catalogs/import': {
    post: { fields: ['imported'], source: 'route-read' }
  },
  '/api/admin/sourcing/catalogs': {
    get: { fields: ['catalogs'], source: 'route-read' }
  },
  '/api/admin/sourcing/candidates': {
    get: { fields: ['candidates'], source: 'route-read' }
  },
  '/api/admin/sourcing/candidates/{id}': {
    get: { fields: ['candidate'], source: 'route-read' },
    put: { fields: ['candidate'], source: 'route-read' }
  },
  '/api/admin/sourcing/candidates/{id}/scan': {
    post: { fields: ['candidate'], source: 'route-read' }
  },
  '/api/admin/sourcing/candidates/scan-batch': {
    post: { fields: ['scanned'], source: 'route-read' }
  },
  '/api/admin/sourcing/candidates/{id}/import-product': {
    post: { fields: ['product'], source: 'route-read' }
  },
  '/api/admin/sourcing/candidates/{id}/reject': {
    post: { fields: ['ok'], source: 'route-read' }
  },
  '/api/admin/sourcing/candidates/{id}/watchlist': {
    post: { fields: ['ok'], source: 'route-read' }
  },

  // hub-dashboard.js
  '/api/hub-dash/dashboard': {
    get: { fields: ['dashboard'], source: 'route-read' }
  },
  '/api/hub-dash/queue': {
    get: { fields: ['queue'], source: 'route-read' }
  },
  '/api/hub-dash/orders/{id}': {
    get: { fields: ['order'], source: 'route-read' }
  },
  '/api/hub-dash/validate/{id}': {
    get: { fields: ['validation'], source: 'route-read' }
  },
  '/api/hub-dash/orders/{id}/start-prep': {
    post: { fields: ['message','status'], source: 'route-read' }
  },
  '/api/hub-dash/orders/{id}/create-parcel': {
    post: { fields: ['message','parcel','items_assigned'], source: 'route-read' }
  },
  '/api/hub-dash/orders/{id}/auto-prepare': {
    post: { fields: ['message','parcel','items_assigned'], source: 'route-read' }
  },
  '/api/hub-dash/parcels/{id}/add-item': {
    post: { fields: ['message','item'], source: 'route-read' }
  },
  '/api/hub-dash/parcels/{id}/remove-item': {
    post: { fields: ['message','deleted'], source: 'route-read' }
  },
  '/api/hub-dash/parcels/{id}/ready': {
    post: { fields: ['message','status'], source: 'route-read' }
  },
  '/api/hub-dash/parcels/{id}/ship': {
    post: { fields: ['message','status','transport'], source: 'route-read' }
  },
  '/api/hub-dash/orders/{id}/incident': {
    post: { fields: ['message','incident'], source: 'route-read' }
  },
  '/api/hub-dash/orders/{id}/escalate': {
    post: { fields: ['message','incident','priority'], source: 'route-read' }
  },
  '/api/hub-dash/orders/{id}/comment': {
    post: { fields: ['message','comment'], source: 'route-read' }
  },
  '/api/hub-dash/orders/{id}/backorder': {
    post: { fields: ['message','status'], source: 'route-read' }
  },

  // pricing.js
  '/api/pricing/calculate': {
    post: { fields: ['price_kmf','breakdown'], source: 'route-read' }
  },
  '/api/pricing/flow': {
    post: { fields: ['flow'], source: 'route-read' }
  },
  '/api/pricing/benchmarks': {
    get: { fields: ['count','benchmarks'], source: 'route-read' },
    put: { fields: ['benchmark'], source: 'route-read' }
  },
  '/api/pricing/benchmarks/{category}/{cost_family}': {
    delete: { fields: ['deleted'], source: 'route-read' }
  },
  '/api/pricing/couture': {
    post: { fields: ['price_kmf'], source: 'route-read' }
  },
  '/api/pricing/rates': {
    get: { fields: ['eur_kmf','aed_kmf'], source: 'route-read' },
    put: { fields: ['eur_kmf','aed_kmf'], source: 'route-read' }
  },
  '/api/pricing/recommend': {
    post: { fields: ['recommended_price','health_status'], source: 'route-read' }
  },
  '/api/pricing/recommend-batch': {
    post: { fields: ['items'], source: 'route-read' }
  },
  '/api/pricing/apply-price/{product_id}': {
    put: { fields: ['status','recommended_price','health_status'], source: 'route-read' }
  },
  '/api/pricing/apply-all': {
    put: { fields: ['applied','skipped'], source: 'route-read' }
  },
  '/api/pricing/benchmarks-gap': {
    get: { fields: ['benchmarks'], source: 'route-read' }
  },
  '/api/pricing/dashboard': {
    get: { fields: ['dashboard'], source: 'route-read' }
  },

  // parcel-api-v2 (routes/parcel-api-v2/read.js + scans.js)
  '/api/v2/parcels': {
    get: { fields: ['count','parcels'], source: 'route-read' }
  },
  '/api/v2/parcels/kpis': {
    get: { fields: ['total','draft','preparation','shipped','delivered'], source: 'route-read' }
  },
  '/api/v2/parcels/alerts': {
    get: { fields: ['count','alerts','operational'], source: 'route-read' }
  },
  '/api/v2/parcels/critical': {
    get: { fields: ['count','parcels'], source: 'route-read' }
  },
  '/api/v2/parcels/reconciliation': {
    get: { fields: ['summary','parcels'], source: 'route-read' }
  },
  '/api/v2/parcels/{ref}': {
    get: { fields: ['id','reference','status','type','destination_island'], source: 'route-read' }
  },
  '/api/v2/parcels/{ref}/timeline': {
    get: { fields: ['reference','status','eta','scans','next_expected_step','steps'], source: 'route-read' }
  },
  '/api/v2/parcels/{ref}/scan': {
    post: { fields: ['success','scan'], source: 'route-read' }
  },
  '/api/v2/parcels/{ref}/label': {
    get: { fields: ['label_url'], source: 'route-read' }
  },
  '/api/v2/parcels/{ref}/detail': {
    get: { fields: ['parcel'], source: 'route-read' }
  },
  '/api/v2/parcels/{id}': {
    get: { fields: ['id','reference','status','type'], source: 'route-read' }
  },
  '/api/v2/parcels/{id}/scans': {
    get: { fields: ['scans'], source: 'route-read' }
  },
  '/api/v2/parcels/{id}/orders': {
    get: { fields: ['orders'], source: 'route-read' }
  },

  // hub.js
  '/api/hub/scan': {
    post: { fields: ['data','total'], source: 'route-read' }
  },
  '/api/hub/pack': {
    post: { fields: ['data','total'], source: 'route-read' }
  },
  '/api/hub/seal': {
    post: { fields: ['data','total'], source: 'route-read' }
  },
  '/api/hub/batch-scan': {
    post: { fields: ['data','total'], source: 'route-read' }
  },
  '/api/hub/search': {
    get: { fields: ['data','total'], source: 'route-read' }
  },
  '/api/hub/stats/week': {
    get: { fields: ['daily','summary'], source: 'route-read' }
  },
  '/api/hub/pending': {
    get: { fields: ['data','count'], source: 'route-read' }
  },
  '/api/hub/today': {
    get: { fields: ['data','count'], source: 'route-read' }
  },
  '/api/hub/orders/mark-ordered': {
    post: { fields: ['ok'], source: 'route-read' }
  },
  '/api/hub/auto-distribute': {
    post: { fields: ['distributed'], source: 'route-read' },
    get:  { fields: ['proposals'], source: 'route-read' }
  },
  '/api/hub/auto-distribute/cleanup': {
    post: { fields: ['cleaned'], source: 'route-read' }
  },

  // economic-engine.js
  '/api/admin/economic/executive': {
    get: { fields: ['executive'], source: 'route-read' }
  },
  '/api/admin/economic/variables': {
    get: { fields: ['variables'], source: 'route-read' }
  },
  '/api/admin/economic/variables/{key}': {
    put: { fields: ['variable'], source: 'route-read' }
  },
  '/api/admin/economic/charges': {
    get:  { fields: ['charges'], source: 'route-read' },
    post: { fields: ['charge'], source: 'route-read' }
  },
  '/api/admin/economic/charges/{id}': {
    put:    { fields: ['charge'], source: 'route-read' },
    delete: { fields: ['ok'], source: 'route-read' }
  },
  '/api/admin/economic/charges/{id}/toggle': {
    put: { fields: ['charge'], source: 'route-read' }
  },
  '/api/admin/economic/coherence': {
    get: { fields: ['coherence'], source: 'route-read' }
  },
  '/api/admin/economic/history': {
    get: { fields: ['history'], source: 'route-read' }
  },
  '/api/admin/economic/redistribute': {
    post: { fields: ['ok'], source: 'route-read' }
  },

  // parcels.js
  '/api/parcels': {
    get:  { fields: ['data','pagination'], source: 'route-read' },
    post: { fields: ['parcel_id','external_code','link_rule_triggered','order'], source: 'route-read' }
  },
  '/api/parcels/{ref}': {
    get: { fields: ['parcel'], source: 'route-read' }
  },
  '/api/parcels/{ref}/events': {
    get: { fields: ['parcel_id','events','count'], source: 'route-read' }
  },
  '/api/parcels/{id}/status': {
    patch: { fields: ['parcel'], source: 'route-read' }
  },
  '/api/parcels/{id}/weight': {
    post: { fields: ['parcel_id','external_code','weight_kg','previous_weight_kg'], source: 'route-read' }
  },
  '/api/parcels/{id}/verify-seal': {
    post: { fields: ['parcel_id','external_code','seal_valid','message'], source: 'route-read' }
  },
  '/api/parcels/{id}/items': {
    post: { fields: ['item'], source: 'route-read' }
  },
  '/api/parcels/{id}/items/{item_id}': {
    delete: { fields: ['message','deleted'], source: 'route-read' }
  },
  '/api/parcels/optimize': {
    post: { fields: ['order_id','computed_status','createdParcels','updatedParcels','unassignedItems'], source: 'route-read' }
  },
  '/api/parcels/bootstrap/{orderId}': {
    post: { fields: ['order_id','created','assigned_items','unassigned_items'], source: 'route-read' }
  },

  // auth.js remaining — /api/auth/me GET is defined in L3; add PUT here without clobbering
  // (JS object literal: last key wins, so we skip re-declaring this path and patch it below)
  '/api/auth/guest-checkout': {
    post: { fields: ['user'], source: 'route-read' }
  },
  '/api/auth/auto-register': {
    post: { fields: ['user','created'], source: 'route-read' }
  },
  '/api/auth/logout': {
    post: { fields: ['message'], source: 'route-read' }
  },
  '/api/auth/admin-reset': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/auth/magic-link': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/auth/magic-link/validate': {
    get: { fields: ['user'], source: 'route-read' }
  },
  '/api/auth/orders': {
    get: { fields: ['orders'], source: 'route-read' }
  },
  '/api/auth/invoices': {
    get: { fields: ['invoices'], source: 'route-read' }
  },

  // simulator.js
  '/api/simulator/start': {
    post: { fields: ['message','running'], source: 'route-read' }
  },
  '/api/simulator/stop': {
    post: { fields: ['message','running'], source: 'route-read' }
  },
  '/api/simulator/status': {
    get: { fields: ['running'], source: 'route-read' }
  },
  '/api/simulator/journal': {
    get: { fields: ['entries'], source: 'route-read' }
  },
  '/api/simulator/cleanup': {
    post: { fields: ['message'], source: 'route-read' }
  },
  '/api/admin/simulator/start': {
    post: { fields: ['message','running'], source: 'route-read' }
  },
  '/api/admin/simulator/stop': {
    post: { fields: ['message','running'], source: 'route-read' }
  },
  '/api/admin/simulator/status': {
    get: { fields: ['running'], source: 'route-read' }
  },
  '/api/admin/simulator/journal': {
    get: { fields: ['entries'], source: 'route-read' }
  },
  '/api/admin/simulator/cleanup': {
    post: { fields: ['message'], source: 'route-read' }
  },

  // admin-boutique-categories.js
  '/api/admin/boutique-categories': {
    get:  { fields: ['categories'], source: 'route-read' },
    post: { fields: ['category'], source: 'route-read' }
  },
  '/api/admin/boutique-categories/{key}': {
    get:    { fields: ['category'], source: 'route-read' },
    put:    { fields: ['category'], source: 'route-read' },
    delete: { fields: ['deactivated','category'], source: 'route-read' }
  },
  '/api/admin/boutique-categories/{key}/subcategories': {
    get:  { fields: ['subcategories'], source: 'route-read' },
    post: { fields: ['subcategory'], source: 'route-read' }
  },
  '/api/admin/boutique-categories/{key}/subcategories/{subKey}': {
    put:    { fields: ['subcategory'], source: 'route-read' },
    delete: { fields: ['deactivated','category'], source: 'route-read' }
  },

  // wallet.js
  '/api/wallet': {
    get: { fields: ['balance_kmf','user_id'], source: 'route-read' }
  },
  '/api/wallet/transactions': {
    get: { fields: ['transactions'], source: 'route-read' }
  },
  '/api/wallet/apply': {
    post: { fields: ['message','applied_kmf','remaining_to_pay'], source: 'route-read' }
  },
  '/api/wallet/remove': {
    post: { fields: ['message','reversed_kmf','transaction'], source: 'route-read' }
  },
  '/api/wallet/admin': {
    get: { fields: ['wallets'], source: 'route-read' }
  },
  '/api/wallet/admin/{userId}': {
    get: { fields: ['wallet'], source: 'route-read' }
  },
  '/api/wallet/admin/credit': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/wallet/admin/order-credit/{orderId}': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/wallet/admin/reverse-lot': {
    post: { fields: ['success','message','reversed_kmf'], source: 'route-read' }
  },

  // products.js remaining
  '/api/products/categories': {
    get: { fields: ['categories'], source: 'route-read' }
  },
  '/api/products/subcategories': {
    get: { fields: ['subcategories'], source: 'route-read' }
  },
  // /api/products/{id} GET+PUT defined in L4 — only delete is new here (patched below)
  '/api/products/{id}/image': {
    post: { fields: ['image_url'], source: 'route-read' }
  },
  '/api/products/{id}/images': {
    post: { fields: ['images'], source: 'route-read' }
  },
  '/api/products/{id}/variants': {
    get: { fields: ['product_id','product_name','has_variants','variants'], source: 'route-read' },
    put: { fields: ['variants'], source: 'route-read' }
  },
  '/api/products/{id}/variants/{variantId}': {
    delete: { fields: ['deleted'], source: 'route-read' }
  },

  // admin-customs-shipments.js
  '/api/admin/customs-shipments': {
    get:  { fields: ['shipments'], source: 'route-read' },
    post: { fields: ['shipment'], source: 'route-read' }
  },
  '/api/admin/customs-shipments/rates/effective': {
    get: { fields: ['rates'], source: 'route-read' }
  },
  '/api/admin/customs-shipments/{id}': {
    get:    { fields: ['shipment'], source: 'route-read' },
    patch:  { fields: ['shipment'], source: 'route-read' },
    delete: { fields: ['deleted'], source: 'route-read' }
  },
  '/api/admin/customs-shipments/{id}/deactivate': {
    post: { fields: ['shipment'], source: 'route-read' }
  },
  '/api/admin/customs-shipments/{id}/activate': {
    post: { fields: ['shipment'], source: 'route-read' }
  },

  // ops-api.js (v2 global ops)
  '/api/v2/global': {
    get: { fields: ['orders','parcels'], source: 'route-read' }
  },
  '/api/v2/incidents': {
    get: { fields: ['incidents'], source: 'route-read' }
  },
  '/api/v2/reconciliation': {
    get: { fields: ['reconciliation'], source: 'route-read' }
  },
  '/api/v2/reconciliation/summary': {
    get: { fields: ['summary'], source: 'route-read' }
  },
  '/api/v2/alerts': {
    get: { fields: ['alerts'], source: 'route-read' }
  },
  '/api/v2/alerts/{id}/acknowledge': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/v2/invoices': {
    get: { fields: ['invoices'], source: 'route-read' }
  },
  '/api/v2/scan-events': {
    get: { fields: ['parcel','scans','orders'], source: 'route-read' }
  },

  // inventory-api.js
  '/api/hub/inventory/receive': {
    post: { fields: ['ok'], source: 'route-read' }
  },
  '/api/hub/inventory/scan-assign': {
    post: { fields: ['ok'], source: 'route-read' }
  },
  '/api/hub/inventory/propose-all': {
    post: { fields: ['ok'], source: 'route-read' }
  },
  '/api/hub/inventory/proposals': {
    get: { fields: ['ok','items'], source: 'route-read' }
  },
  '/api/hub/inventory/open-parcels': {
    get: { fields: ['ok','parcels'], source: 'route-read' }
  },
  '/api/hub/inventory/buffer': {
    get: { fields: ['ok','items'], source: 'route-read' }
  },
  '/api/hub/inventory/stats': {
    get: { fields: ['ok'], source: 'route-read' }
  },
  '/api/hub/inventory/order/{id}/dispatch': {
    get: { fields: ['ok'], source: 'route-read' }
  },

  // admin-cost-components.js
  '/api/admin/cost-components/_meta': {
    get: { fields: ['meta'], source: 'route-read' }
  },
  '/api/admin/cost-components': {
    get:  { fields: ['components','grouped','count'], source: 'route-read' },
    post: { fields: ['component'], source: 'route-read' }
  },
  '/api/admin/cost-components/{id}': {
    get:    { fields: ['component','events'], source: 'route-read' },
    put:    { fields: ['component'], source: 'route-read' },
    delete: { fields: ['ok'], source: 'route-read' }
  },
  '/api/admin/cost-components/{id}/toggle': {
    post: { fields: ['component'], source: 'route-read' }
  },

  // signals.js
  '/api/admin/signals': {
    get: { fields: ['signals','total','limit','offset'], source: 'route-read' }
  },
  '/api/admin/signals/stats': {
    get: { fields: ['total','bySeverity','byType','byFamily'], source: 'route-read' }
  },
  '/api/admin/signals/generate': {
    post: { fields: ['ok','result'], source: 'route-read' }
  },
  '/api/admin/signals/{id}/acknowledge': {
    post: { fields: ['ok','signal'], source: 'route-read' }
  },
  '/api/admin/signals/{id}/snooze': {
    post: { fields: ['ok','signal'], source: 'route-read' }
  },
  '/api/admin/signals/{id}/resolve': {
    post: { fields: ['ok','signal'], source: 'route-read' }
  },
  '/api/admin/signals/{id}': {
    delete: { fields: ['ok','deleted'], source: 'route-read' }
  },

  // relay-dashboard.js
  '/api/relay/dashboard': {
    get: { fields: ['dashboard'], source: 'route-read' }
  },
  '/api/relay/orders': {
    get: { fields: ['orders'], source: 'route-read' }
  },
  '/api/relay/orders/{id}': {
    get: { fields: ['order'], source: 'route-read' }
  },
  '/api/relay/orders/{id}/incident': {
    post: { fields: ['success','incident'], source: 'route-read' }
  },
  '/api/relay/orders/{id}/comment': {
    post: { fields: ['success','comment'], source: 'route-read' }
  },
  '/api/relay/orders/{id}/escalate': {
    post: { fields: ['success','incident','message'], source: 'route-read' }
  },
  '/api/relay/orders/{id}/client-absent': {
    patch: { fields: ['success','message'], source: 'route-read' }
  },

  // modules.js
  '/api/modules': {
    get: { fields: ['modules','total'], source: 'route-read' }
  },
  '/api/modules/fabrics': {
    get:  { fields: ['fabrics'], source: 'route-read' },
    post: { fields: ['fabric'], source: 'route-read' }
  },
  '/api/modules/models': {
    get:  { fields: ['models'], source: 'route-read' },
    post: { fields: ['model'], source: 'route-read' }
  },
  '/api/modules/{type}': {
    get: { fields: ['type','disponible','phase'], source: 'route-read' }
  },
  '/api/modules/price': {
    post: { fields: ['module_type','module_order_type','unit_price_kmf','total_kmf'], source: 'route-read' }
  },

  // loyalty.js
  '/api/loyalty/tiers': {
    get: { fields: ['tiers'], source: 'route-read' }
  },
  '/api/loyalty/me': {
    get: { fields: ['orders_count','tier_label','discount_pct'], source: 'route-read' }
  },
  '/api/loyalty/users': {
    get: { fields: ['tiers','total_clients','tier_distribution','users'], source: 'route-read' }
  },
  '/api/loyalty/stats': {
    get: { fields: ['stats'], source: 'route-read' }
  },
  '/api/loyalty/tiers/{id}': {
    put: { fields: ['tier'], source: 'route-read' }
  },
  '/api/loyalty/recalculate/{user_id}': {
    post: { fields: ['recalculated'], source: 'route-read' }
  },
  '/api/loyalty/recalculate-all': {
    post: { fields: ['recalculated'], source: 'route-read' }
  },

  // unsold.js
  '/api/unsold': {
    get: { fields: ['items'], source: 'route-read' }
  },
  '/api/unsold/scan': {
    post: { fields: ['scanned','items_created'], source: 'route-read' }
  },
  '/api/unsold/stats/summary': {
    get: { fields: ['summary'], source: 'route-read' }
  },
  '/api/unsold/{id}': {
    get:   { fields: ['item'], source: 'route-read' },
    patch: { fields: ['item'], source: 'route-read' }
  },
  '/api/unsold/{id}/resolve': {
    post: { fields: ['message','item'], source: 'route-read' }
  },
  '/api/unsold/{id}/whatsapp': {
    get: { fields: ['message'], source: 'route-read' }
  },

  // admin-customs-categories.js
  '/api/admin/customs-categories': {
    get:  { fields: ['categories'], source: 'route-read' },
    post: { fields: ['category'], source: 'route-read' }
  },
  '/api/admin/customs-categories/{key}': {
    get:    { fields: ['category'], source: 'route-read' },
    put:    { fields: ['category'], source: 'route-read' },
    delete: { fields: ['deleted'], source: 'route-read' }
  },
  '/api/admin/customs-categories/{key}/toggle': {
    put: { fields: ['category'], source: 'route-read' }
  },

  // admin-pricing-components.js
  '/api/admin/pricing-components': {
    get:  { fields: ['components'], source: 'route-read' },
    post: { fields: ['component'], source: 'route-read' }
  },
  '/api/admin/pricing-components/{id}': {
    get:    { fields: ['component'], source: 'route-read' },
    put:    { fields: ['component'], source: 'route-read' },
    delete: { fields: ['deleted','id','mode'], source: 'route-read' }
  },
  '/api/admin/pricing-components/{id}/toggle': {
    put: { fields: ['component'], source: 'route-read' }
  },

  // admin-risk-provisions.js
  '/api/admin/risk-provisions': {
    get:  { fields: ['provisions'], source: 'route-read' },
    post: { fields: ['provision'], source: 'route-read' }
  },
  '/api/admin/risk-provisions/{id}': {
    get:    { fields: ['provision'], source: 'route-read' },
    put:    { fields: ['provision'], source: 'route-read' },
    delete: { fields: ['deleted','id','mode'], source: 'route-read' }
  },
  '/api/admin/risk-provisions/{id}/toggle': {
    put: { fields: ['provision'], source: 'route-read' }
  },

  // order-api-v2.js
  '/api/v2/orders': {
    get: { fields: ['kpis','count','orders'], source: 'route-read' }
  },
  '/api/v2/orders/pending-cash': {
    get: { fields: ['count','orders'], source: 'route-read' }
  },
  '/api/v2/orders/ready-for-parcel': {
    get: { fields: ['count','orders'], source: 'route-read' }
  },
  '/api/v2/orders/{ref}': {
    get: { fields: ['order'], source: 'route-read' }
  },
  '/api/v2/orders/{ref}/confirm-cash': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/v2/orders/{ref}/create-parcel': {
    post: { fields: ['success','message','parcel'], source: 'route-read' }
  },

  // invoices.js
  '/api/invoices': {
    get: { fields: ['ok','invoices','count'], source: 'route-read' }
  },
  '/api/invoices/{orderId}': {
    get: { fields: ['ok','invoice'], source: 'route-read' }
  },
  '/api/invoices/{orderId}/json': {
    get: { fields: ['invoice'], source: 'route-read' }
  },
  '/api/invoices/{orderId}/download': {
    get: { fields: ['url'], source: 'route-read' }
  },
  // pricing-strategy.js
  '/api/pricing/strategy/competitors': {
    get:    { fields: ['competitors'], source: 'route-read' },
    post:   { fields: ['competitor'], source: 'route-read' }
  },
  '/api/pricing/strategy/competitors/{id}': {
    delete: { fields: ['ok'], source: 'route-read' }
  },
  '/api/pricing/strategy': {
    get: { fields: ['strategy'], source: 'route-read' }
  },
  '/api/pricing/strategy/apply': {
    post: { fields: ['ok'], source: 'route-read' }
  },
  '/api/pricing/strategy/history': {
    get: { fields: ['history'], source: 'route-read' }
  },

  // admin-rules.js
  '/api/admin/rules': {
    get: { fields: ['categories'], source: 'route-read' }
  },
  '/api/admin/rules/audit': {
    get: { fields: ['history'], source: 'route-read' }
  },
  '/api/admin/rules/{key}': {
    get:   { fields: ['rule','history'], source: 'route-read' },
    patch: { fields: ['success','rule','message'], source: 'route-read' }
  },
  '/api/admin/rules/{key}/reset': {
    post: { fields: ['success','rule','message'], source: 'route-read' }
  },

  // admin-loyalty.js
  '/api/admin/loyalty/pending': {
    get: { fields: ['count','pending'], source: 'route-read' }
  },
  '/api/admin/loyalty/reward/{id}': {
    post: { fields: ['success','reward'], source: 'route-read' }
  },
  '/api/admin/loyalty/skip/{id}': {
    post: { fields: ['success','reward'], source: 'route-read' }
  },
  '/api/admin/loyalty/history': {
    get: { fields: ['count','history'], source: 'route-read' }
  },
  '/api/admin/loyalty/stats': {
    get: { fields: ['rewards'], source: 'route-read' }
  },

  // logistics.js
  '/api/logistics/shipments': {
    post: { fields: ['shipment'], source: 'route-read' },
    get:  { fields: ['shipments'], source: 'route-read' }
  },
  '/api/logistics/shipments/{id}': {
    patch: { fields: ['shipment'], source: 'route-read' }
  },
  '/api/logistics/labels/{shipment_id}': {
    get: { fields: ['label_url'], source: 'route-read' }
  },
  '/api/logistics/manifest/{shipment_id}': {
    get: { fields: ['manifest_url'], source: 'route-read' }
  },

  // carriers.js
  '/api/carriers': {
    get:  { fields: ['data','count'], source: 'route-read' },
    post: { fields: ['carrier'], source: 'route-read' }
  },
  '/api/carriers/{id}': {
    patch:  { fields: ['carrier'], source: 'route-read' },
    delete: { fields: ['message','carrier'], source: 'route-read' }
  },
  '/api/carriers/customs/{parcel_id}': {
    patch: { fields: ['message','parcel'], source: 'route-read' }
  },

  // transit-dashboard.js
  '/api/transit-dashboard': {
    get: { fields: ['parcels'], source: 'route-read' }
  },
  '/api/transit-dashboard/{ref}/transit': {
    post: { fields: ['success'], source: 'route-read' }
  },
  '/api/transit': {
    get: { fields: ['parcels'], source: 'route-read' }
  },
  '/api/transit/{ref}/transit': {
    post: { fields: ['success'], source: 'route-read' }
  },

  // finance.js
  '/api/admin/finance/summary': {
    get: { fields: ['month','year','count','transactions'], source: 'route-read' }
  },
  '/api/admin/finance/export': {
    get: { fields: ['export_url'], source: 'route-read' }
  },
  '/api/admin/finance/stripe-proofs': {
    get: { fields: ['proofs'], source: 'route-read' }
  },
  '/api/admin/finance/report': {
    get: { fields: ['report'], source: 'route-read' }
  },

  // admin/system.js — maintenance tools
  '/api/admin/purchasing/repair-ordered-without-pos': {
    post: { fields: ['ok','repaired','errors'], source: 'route-read' }
  },

  // admin-radar.js
  '/api/admin/radar/money': {
    get: { fields: ['money'], source: 'route-read' }
  },
  '/api/admin/radar/status-details': {
    get: { fields: ['status_details'], source: 'route-read' }
  },
  '/api/admin/radar/orders-by-detail/{detail}': {
    get: { fields: ['orders'], source: 'route-read' }
  },
  '/api/admin/radar/cache/invalidate': {
    post: { fields: ['success','message'], source: 'route-read' }
  },

  // admin-pricing-matrices.js
  '/api/admin/pricing-matrices/taxes': {
    get: { fields: ['taxes'], source: 'route-read' }
  },
  '/api/admin/pricing-matrices/taxes/{category}': {
    put: { fields: ['success','taxes','message'], source: 'route-read' }
  },
  '/api/admin/pricing-matrices/dims': {
    get: { fields: ['dims'], source: 'route-read' }
  },
  '/api/admin/pricing-matrices/dims/{category}': {
    put: { fields: ['success','dims','message'], source: 'route-read' }
  },

  // client-auth.js
  '/api/client/magic-link': {
    post: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/client/magic-link/validate': {
    get: { fields: ['success','message'], source: 'route-read' }
  },
  '/api/client/orders': {
    get: { fields: ['orders'], source: 'route-read' }
  },
  '/api/client/invoices': {
    get: { fields: ['invoices'], source: 'route-read' }
  },

  // transitaire-api.js
  '/api/transitaire/parcels': {
    get: { fields: ['parcels','count'], source: 'route-read' }
  },
  '/api/transitaire/ship': {
    post: { fields: ['success','parcel','message'], source: 'route-read' }
  },
  '/api/transitaire/stats': {
    get: { fields: ['stats'], source: 'route-read' }
  },
  '/api/transitaire/history': {
    get: { fields: ['events'], source: 'route-read' }
  },

  // shares.js
  '/api/shares': {
    post: { fields: ['token','url','redirect'], source: 'route-read' }
  },
  '/api/shares/{token}': {
    get: { fields: ['token','sharer_name','status','expires_at','items','total_kmf'], source: 'route-read' }
  },

  // relais.js
  '/api/relais': {
    get: { fields: ['relais'], source: 'route-read' }
  },
  '/api/relais/public': {
    get: { fields: ['relais'], source: 'route-read' }
  },
  '/api/relais/{id}': {
    get: { fields: ['relais'], source: 'route-read' }
  },

  // admin-finance-config.js
  '/api/admin/finance-config/schema': {
    get: { fields: ['schema'], source: 'route-read' }
  },
  '/api/admin/finance-config': {
    get: { fields: ['config'], source: 'route-read' },
    put: { fields: ['config'], source: 'route-read' }
  },

  // payments-paypal.js remaining
  '/api/payments/paypal/create-order': {
    post: { fields: ['paypal_order_id','amount_usd'], source: 'route-read' }
  },
  '/api/payments/paypal/capture/{paypalOrderId}': {
    post: { fields: ['reference','message'], source: 'route-read' }
  },
  '/api/payments/paypal/webhook': {
    post: { fields: ['received'], source: 'route-read' }
  },

  // tracking.js
  '/api/tracking/{token}': {
    get: { fields: ['reference','status','statusLabel'], source: 'route-read' }
  },
  '/api/tracking/{token}/verify-pickup': {
    post: { fields: ['valid'], source: 'route-read' }
  },

  // meta-whatsapp.js
  '/webhook/meta-whatsapp': {
    get:  { fields: ['hub_challenge'], source: 'route-read' },
    post: { fields: ['ok'], source: 'route-read' }
  },

  // notification-api.js
  '/api/v2/notifications': {
    get: { fields: ['count','notifications'], source: 'route-read' }
  },
  '/api/v2/notifications/stats': {
    get: { fields: ['totals','by_channel','by_event'], source: 'route-read' }
  },

  // categories.js
  '/api/categories': {
    get: { fields: ['categories'], source: 'route-read' }
  },

  // boutique-suggestions.js
  '/api/boutique/suggestions': {
    get: { fields: ['suggestions'], source: 'route-read' }
  },

  // otp.js
  '/api/auth/otp/test-reset': {
    post: { fields: ['ok','success','cleared','purged'], source: 'route-read' }
  },

  // DEBT ZERO — réponses historiques prouvées par route/service/tests (2026-09-06)
  '/api/admin/demo/orders/{orderId}/timeline': { get: { fields: ['order','history','notifications','invoices','documents'], source: 'route-read' } },
  '/api/admin/entities/clients': { get: { fields: ['scope','query','pagination','clients','data_quality'], source: 'service-read' } },
  '/api/admin/entities/clients/market/{marketCode}': { get: { fields: ['scope','query','pagination','clients','data_quality'], source: 'service-read' } },
  '/api/admin/workspaces/pricing/market/{marketCode}': { get: { fields: ['scope','summary','cost_components'], source: 'service-read' } },
  '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/reset': { post: { fields: ['ok','action','result'], source: 'route-read' } },
  '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/toggle': { post: { fields: ['ok','action','result'], source: 'route-read' } },
  '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/update': { post: { fields: ['ok','action','result'], source: 'route-read' } },
  '/api/admin/users/{id}/market-scopes': {
    get: { fields: ['user','active','history'], source: 'route-read' },
    post: { fields: ['success','status','scope'], source: 'route-read' },
  },
  '/api/admin/users/{id}/market-scopes/{marketCode}': { delete: { fields: ['success','revoked'], source: 'route-read' } },
  '/api/admin/users/markets': { get: { fields: ['markets'], source: 'route-read' } },
  '/api/auth/me/documents': { get: { fields: ['documents','count','limit','offset'], source: 'route-read' } },
  '/api/auth/me/documents/{id}/download': { get: { fields: [], source: 'route-read' } },
  '/api/auth/me/notifications': { get: { fields: ['notifications','count'], source: 'route-read' } },
  '/api/auth/me/notifications/{id}/ack': { post: { fields: ['notification'], source: 'route-read' } },
  '/api/auth/me/pickup-authorization': {
    get: { fields: ['status','given_names','family_name','version','updated_at'], source: 'service-read' },
    put: { fields: ['status','given_names','family_name','version','updated_at'], source: 'service-read' },
    delete: { fields: ['status'], source: 'service-read' },
  },
  '/api/local-stock/availability': { get: { fields: ['availability','exposable'], source: 'route-read' } },
  '/api/local-stock/checkout-preview': { get: { fields: ['preview','relais_id','items'], source: 'route-read' } },
  '/api/pickup/exceptional-pickup/{orderId}': { get: { fields: ['available','reason'], source: 'test' } },
  '/api/pickup/exceptional-pickup/{orderId}/collect': { post: { fields: ['success','message','order_ref','parcel_id','parcel_reference','partial','order_status'], source: 'test' } },
  '/api/products/{id}/detail': { get: { fields: ['contract_version','inventory_model','product','pricing','media','option_axes','sellable_units','delivery_options','content'], source: 'service-read' } },
  '/api/products/{id}/skus': {
    get: { fields: ['product_id','product_name','inventory_model','skus','count','has_variants','axes','candidates','declared_count'], source: 'service-read' },
    post: { fields: ['message','sku'], source: 'service-read' },
  },
  '/api/products/{id}/skus/{skuId}': { delete: { fields: ['message','sku'], source: 'service-read' } },
  '/api/products/{id}/skus/readiness': { get: { fields: ['product_id','ready','already_sku','reasons','active_sku_count','orphaned'], source: 'service-read' } },
  '/api/providers-services/inquiries': { post: { fields: ['inquiry'], source: 'route-read' } },
  '/api/providers-services/physical-offers/{id}': { get: { fields: ['id','title','description','zone','market_id','image_ref','provider_name','actions','public_contact'], source: 'route-read' } },
  '/api/providers-services/services/{id}': { get: { fields: ['id','title','description','zone','market_id','image_ref','provider_name','actions','public_contact'], source: 'route-read' } },
  '/api/shared-carts/library': { get: { fields: ['created','saved'], source: 'route-read' } },
  '/api/shared-carts/save': { post: { fields: ['ok','shared_cart_id','already_saved'], source: 'service-read' } },
  '/api/shared-carts/saved/{sharedCartId}': { delete: { fields: ['ok','shared_cart_id','removed'], source: 'service-read' } },

  // health routes (ready, metrics, version, detailed, health)
  '/health': {
    get: { fields: ['status'], source: 'route-read' }
  },
  '/health/ready': {
    get: { fields: ['status'], source: 'route-read' }
  },
  '/health/metrics': {
    get: { fields: ['metrics'], source: 'route-read' }
  },
  '/health/detailed': {
    get: { fields: ['status','db'], source: 'route-read' }
  },
  '/health/version': {
    get: { fields: ['version'], source: 'route-read' }
  },

  // public.js
  '/api/public/config': {
    get: { fields: ['config'], source: 'route-read' }
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
      '  - x-contract-status: "joi"       → requête haute fidélité (schéma Joi)',
      '  - x-contract-status: "test"      → réponse couverte par un test intégration/unitaire',
      '  - x-contract-status: "route-read" → champs lus directement dans le handler (res.json),',
      '  - x-contract-status: "service-read" → forme top-level lue dans le service/lib appelée par la route,',
      '                                       pas de test sur le corps HTTP — confiance < "test"',
      '  - x-contract-status: "scan-*"    → champs observés dans le code front',
      '  - x-contract-status: "UNKNOWN"   → non couvert, à compléter',
    ].join('\n'),
  },
  'x-contract-debt': {
    unknown_responses: 0,
    total_routes: ROUTE_SCHEMA_MAP.length,
    note: 'Voir docs/contract/DEBT.md pour la liste des routes UNKNOWN à couvrir',
  },
  paths: {},
};

// ── 5bis. INVENTAIRE COMPLET par introspection runtime ───────────────────────
//   On monte les vrais routeurs (bootstrap/api-routes.js exporte ses fonctions de
//   montage + blocs Stripe-owned de server.js) sur une app Express nue, puis on
//   parcourt app._router.stack. C'est la SEULE source fiable : elle suit les
//   sous-routeurs (router.use) ET les re-exports (module.exports = require(...)),
//   et reflète exactement ce qui est monté (pas le code mort). Le scan statique de
//   ROUTE_SCHEMA_MAP (45 entrées) reste l'overlay de SCHÉMAS, plus l'inventaire.
const express = require('express');

const normPath = p => ('/' + p.split('/').filter(Boolean).join('/'))
  .replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/+$/, '') || '/';

function extractMountPath(layer) {
  if (layer.path) return layer.path;
  const src = layer.regexp && layer.regexp.source;
  if (!src || /^\^\\\/\?(\(\?=|\$)/.test(src)) return '';
  let m = src.replace(/^\^/, '')
             .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
             .replace(/\$$/, '')
             .replace(/\\\//g, '/');
  if (layer.keys && layer.keys.length) {
    let i = 0; m = m.replace(/\(\[\^\\\/\]\+\?\)/g, () => ':' + (layer.keys[i++]?.name || 'id'));
  }
  return m === '/' ? '' : m;
}

function listMountedRoutes() {
  const app = express();
  const apiRoutes = require('../bootstrap/api-routes');
  apiRoutes.mountApiRoutesBeforeStripeOwnedBlocks(app);
  apiRoutes.mountApiRoutesAfterStripeOwnedBlocks(app);
  // blocs Stripe-owned montés directement dans server.js
  try { app.use('/api/shared-carts', require('../routes/shared-cart').router); } catch (_) {}
  try { const sc = require('../routes/shared-cart'); if (sc.adminRouter) app.use('/api/admin/shared-carts', sc.adminRouter); } catch (_) {}
  const stack = (app._router || app.router).stack;
  const out = [];
  (function walk(layers, prefix) {
    for (const layer of layers) {
      if (layer.route) {
        const full = (prefix + layer.route.path).replace(/\/+/g, '/');
        for (const m of Object.keys(layer.route.methods))
          if (layer.route.methods[m]) out.push({ method: m.toUpperCase(), path: full });
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, prefix + extractMountPath(layer));
      }
    }
  })(stack, '');
  // routes branchées DIRECTEMENT dans server.js (app.get/post('/api/...')) hors fonctions de montage
  try {
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    for (const m of srv.matchAll(/\bapp\.(get|post|put|delete|patch)\(\s*['"](\/api[^'"]*)['"]/g))
      out.push({ method: m[1].toUpperCase(), path: m[2] });
  } catch (_) {}
  return out;
}

// prefix → fichier de route (pour x-route-file), scanné statiquement sur les montages
function buildRouteFileMap() {
  const map = [];
  for (const f of ['../bootstrap/api-routes.js', '../server.js']) {
    let src; try { src = fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch { continue; }
    const v2f = {};
    for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const mm = m[2].match(/routes\/([\w/-]+)/); if (mm) v2f[m[1]] = 'routes/' + mm[1].replace(/\.js$/, '') + '.js';
    }
    for (const m of src.matchAll(/app\.use\(\s*['"](\/api[^'"]*)['"]\s*,\s*([^\n;]+)/g)) {
      const prefix = normPath(m[1]); const arg = m[2].trim(); let file = null;
      const inl = arg.match(/require\(\s*['"][^'"]*routes\/([\w/-]+)['"]/);
      if (inl) file = 'routes/' + inl[1].replace(/\.js$/, '') + '.js';
      else { const vn = arg.split(/[\s,().]/)[0]; if (v2f[vn]) file = v2f[vn]; }
      if (file) map.push({ prefix, file });
    }
  }
  return map.sort((a, b) => b.prefix.length - a.prefix.length);
}
function routeFileFor(p, map) {
  for (const { prefix, file } of map) if (p === prefix || p.startsWith(prefix + '/')) return file;
  return `routes/${p.split('/')[2] || 'unknown'}.js`;
}

// overlay schémas : index ROUTE_SCHEMA_MAP par "METHOD norm(prefix)"
const schemaIndex = {};
for (const r of ROUTE_SCHEMA_MAP) schemaIndex[`${r.method.toUpperCase()} ${normPath(r.prefix)}`] = r;

const inventory   = listMountedRoutes();
const routeFiles  = buildRouteFileMap();

// Route ownership must follow the same recursive route graph used by
// feature-audit. Runtime introspection proves that an operation is mounted,
// but Express layers do not retain the source filename. The generated
// route registry does: exact METHOD + normalized fullPath -> routeFile,
// including nested router.use() and passthrough re-exports.
function buildRecursiveRouteFileIndex() {
  const registryFile = path.join(__dirname, '..', 'docs', '_generated', 'route-registry.json');
  try {
    const data = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    const index = new Map();
    for (const route of (data.routes || [])) {
      if (!route.method || !route.fullPath || !route.routeFile) continue;
      const key = `${String(route.method).toUpperCase()} ${normPath(route.fullPath)}`;
      if (!index.has(key)) index.set(key, route.routeFile);
    }
    return index;
  } catch (_) {
    return new Map();
  }
}
const recursiveRouteFiles = buildRecursiveRouteFileIndex();

// GARDE-FOU anti-régression : un montage partiel ne doit JAMAIS écraser le contrat.
if (inventory.length < 150) {
  console.error(`✖ Introspection: seulement ${inventory.length} routes (< 150 attendu). Montage incomplet — écriture ANNULÉE pour ne pas régresser le contrat.`);
  process.exit(1);
}

const SUCCESS_STATUS_OVERRIDES = Object.freeze({
  'POST /api/providers-services/inquiries': '201',
});

// Surcharges de réponse par route — pour les cas réels observés (ex: probe Schemathesis)
// qui ne rentrent pas dans le moule "200 + UNKNOWN/test" et ne justifient pas une entrée
// KNOWN_RESPONSES (pas un schéma de corps, juste un code de statut documenté en plus).
// Format : "METHOD /chemin/{param}" → { [code]: { description } }
const RESPONSE_OVERRIDES = {
  'POST /api/auth/passkey/register/options': { '401': { description: 'Session K1 requise' }, '500': { description: 'Erreur serveur WebAuthn' } },
  'POST /api/auth/passkey/register/verify': { '400': { description: 'Réponse WebAuthn invalide ou refusée' }, '401': { description: 'Session K1 requise' }, '500': { description: 'Erreur serveur WebAuthn' } },
  'POST /api/auth/passkey/login/options': { '500': { description: 'Erreur serveur WebAuthn' } },
  'POST /api/auth/passkey/login/verify': { '400': { description: 'Réponse WebAuthn invalide' }, '401': { description: 'Passkey inconnue, révoquée ou refusée' }, '500': { description: 'Erreur serveur WebAuthn' } },
  'POST /api/auth/passkey/step-up/options': { '401': { description: 'Session requise' }, '409': { description: 'Aucune passkey active' }, '500': { description: 'Erreur serveur WebAuthn' } },
  'POST /api/auth/passkey/step-up/verify': { '400': { description: 'Réponse WebAuthn invalide' }, '401': { description: 'Session ou confirmation invalide' }, '500': { description: 'Erreur serveur WebAuthn' } },
  'GET /api/auth/passkey/credentials': { '401': { description: 'Session requise' }, '500': { description: 'Erreur serveur' } },
  'DELETE /api/auth/passkey/credentials/{id}': { '400': { description: 'Identifiant de passkey invalide' }, '401': { description: 'Session requise' }, '404': { description: 'Passkey introuvable pour ce compte' }, '500': { description: 'Erreur serveur' } },
  'GET /webhook/meta-whatsapp': {
    '403': { description: 'Forbidden — token de vérification Meta invalide ou absent' },
  },
  // GET /health/detailed renvoie 503 quand une dépendance externe est dégradée
  // (Stripe ou PayPal inaccessibles — notamment en CI avec des secrets dummy).
  'GET /health/detailed': {
    '503': { description: 'Service dégradé — au moins une dépendance externe en erreur' },
  },
  // POST /api/auth/auto-register renvoie 503 quand INTERNAL_API_KEY est absent (désactivé).
  'POST /api/auth/auto-register': {
    '503': { description: 'Endpoint désactivé — INTERNAL_API_KEY non configuré' },
  },
  'GET /api/auth/me/documents/{id}/download': {
    '200': {
      description: 'Document transactionnel PDF privé',
      content: { 'application/pdf': { schema: { type: 'string', format: 'binary', 'x-contract-status': 'route-read' } } },
    },
    '404': { description: 'Document introuvable' },
    '503': { description: 'Document temporairement indisponible' },
  },
  'POST /api/admin/users/{id}/market-scopes': {
    '201': {
      description: 'Scope marché créé',
      content: { 'application/json': { schema: {
        type: 'object',
        'x-contract-status': 'route-read',
        properties: { success: { type: 'string', 'x-observed': true }, status: { type: 'string', 'x-observed': true }, scope: { type: 'string', 'x-observed': true } },
      } } },
    },
  },
  // La route receipt retourne du HTML imprimable, pas du JSON.
  // On remplace la réponse 200 application/json générée automatiquement.
  'GET /api/pickup/receipt/{orderId}': {
    '200': {
      description: 'Reçu HTML imprimable — token à usage unique validé',
      content: { 'text/html': { schema: { type: 'string', 'x-contract-status': 'route-read' } } },
    },
    '400': { description: 'Token manquant' },
    '403': { description: 'Token invalide ou expiré' },
    '404': { description: 'Commande introuvable' },
  },
};

let unknownCount = 0;
const seenOps = new Set();
for (const ep of inventory) {
  const prefix = normPath(ep.path);
  const method = ep.method.toLowerCase();
  const key = `${ep.method} ${prefix}`;
  if (seenOps.has(key)) continue; seenOps.add(key);
  if (!openapi.paths[prefix]) openapi.paths[prefix] = {};

  const recursiveRouteFile = recursiveRouteFiles.get(`${ep.method} ${prefix}`);
  const op = {
    summary: `${ep.method} ${prefix}`,
    'x-route-file': recursiveRouteFile || routeFileFor(prefix, routeFiles),
  };
  const enrich = schemaIndex[key];
  const reqBody = enrich ? buildRequestBody(enrich.schema) : null;
  const joiParams = enrich ? buildParameters(enrich.schema) : [];

  // Tout {param} du gabarit d'URL DOIT être déclaré, Joi ou pas — sinon Schemathesis
  // ne peut pas instancier la requête (Schema Error "Path parameter not defined").
  // Les params Joi (plus riches : type, format, enum...) priment ; les params restants
  // du gabarit sans schéma Joi reçoivent un fallback string générique.
  const pathParamNames = [...prefix.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
  const joiParamNames = new Set(joiParams.filter(p => p.in === 'path').map(p => p.name));
  const fallbackParams = pathParamNames
    .filter(name => !joiParamNames.has(name))
    .map(name => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
  const params = [...joiParams, ...fallbackParams];

  if (reqBody) op.requestBody = { ...reqBody, 'x-contract-status': 'joi' };
  if (params.length) op.parameters = params;

  const respSchema = buildResponseSchema(prefix, method);
  if (respSchema['x-contract-status'] === 'UNKNOWN') unknownCount++;
  const successStatus = SUCCESS_STATUS_OVERRIDES[`${ep.method} ${prefix}`] || '200';
  op.responses = {
    [successStatus]: { description: 'Succès', content: { 'application/json': { schema: respSchema } } },
    // 429 documenté par défaut : le rate-limiter global peut se déclencher sur n'importe
    // quel endpoint, et un 429 non documenté est sinon signalé à tort par Schemathesis
    // comme "undocumented HTTP status" (bruit calibré en P4-1).
    '429': { description: 'Too Many Requests — rate limit exceeded' },
  };

  const overrides = RESPONSE_OVERRIDES[`${ep.method} ${prefix}`];
  if (overrides) Object.assign(op.responses, overrides);

  openapi.paths[prefix][method] = op;
}

openapi['x-inventory-source'] = 'runtime-introspection';
openapi['x-contract-debt'].unknown_responses = unknownCount;
openapi['x-contract-debt'].total_routes = Object.keys(openapi.paths).length;

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

// Runtime route introspection loads modules that may keep timers/handles alive.
// All contract writes above are synchronous, so terminate deterministically here.
process.exit(0); // contract generation is fully synchronous above
