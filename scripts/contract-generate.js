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
    get: { fields: ['id','full_name','email','phone','role','country','currency_pref'], source: 'route-read' }
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
    get: { fields: ['id','name','category','price_kmf','sku','product_ref','stock','is_active','is_available','variants'], source: 'route-read' },
    put: { fields: ['id','name','category','price_kmf','sku','product_ref','stock','is_active','is_available'], source: 'route-read' }
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
  try { app.use('/api/admin/shared-carts', require('../routes/shared-cart-refund-admin').router); } catch (_) {}
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

// GARDE-FOU anti-régression : un montage partiel ne doit JAMAIS écraser le contrat.
if (inventory.length < 150) {
  console.error(`✖ Introspection: seulement ${inventory.length} routes (< 150 attendu). Montage incomplet — écriture ANNULÉE pour ne pas régresser le contrat.`);
  process.exit(1);
}

// Surcharges de réponse par route — pour les cas réels observés (ex: probe Schemathesis)
// qui ne rentrent pas dans le moule "200 + UNKNOWN/test" et ne justifient pas une entrée
// KNOWN_RESPONSES (pas un schéma de corps, juste un code de statut documenté en plus).
// Format : "METHOD /chemin/{param}" → { [code]: { description } }
const RESPONSE_OVERRIDES = {
  'GET /webhook/meta-whatsapp': {
    '403': { description: 'Forbidden — token de vérification Meta invalide ou absent' },
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

  const op = { summary: `${ep.method} ${prefix}`, 'x-route-file': routeFileFor(prefix, routeFiles) };
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
  op.responses = {
    '200': { description: 'Succès', content: { 'application/json': { schema: respSchema } } },
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
