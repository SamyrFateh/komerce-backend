'use strict';
const fs = require('fs');

const p = 'scripts/contract-generate.js';
let src = fs.readFileSync(p, 'utf8');
const marker = '  // health routes (ready, metrics, version, detailed, health)\n';
if (!src.includes(marker)) throw new Error('KNOWN_RESPONSES insertion marker not found');
if (!src.includes("'/api/admin/demo/orders/{orderId}/timeline'")) {
  const block = `  // DEBT ZERO — réponses historiques prouvées par route/service/tests (2026-09-06)\n  '/api/admin/demo/orders/{orderId}/timeline': { get: { fields: ['order','history','notifications','invoices','documents'], source: 'route-read' } },\n  '/api/admin/entities/clients': { get: { fields: ['scope','query','pagination','clients','data_quality'], source: 'service-read' } },\n  '/api/admin/entities/clients/market/{marketCode}': { get: { fields: ['scope','query','pagination','clients','data_quality'], source: 'service-read' } },\n  '/api/admin/workspaces/pricing/market/{marketCode}': { get: { fields: ['scope','summary','cost_components'], source: 'service-read' } },\n  '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/reset': { post: { fields: ['ok','action','result'], source: 'route-read' } },\n  '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/toggle': { post: { fields: ['ok','action','result'], source: 'route-read' } },\n  '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/update': { post: { fields: ['ok','action','result'], source: 'route-read' } },\n  '/api/admin/users/{id}/market-scopes': {\n    get: { fields: ['user','active','history'], source: 'route-read' },\n    post: { fields: ['success','status','scope'], source: 'route-read' },\n  },\n  '/api/admin/users/{id}/market-scopes/{marketCode}': { delete: { fields: ['success','revoked'], source: 'route-read' } },\n  '/api/admin/users/markets': { get: { fields: ['markets'], source: 'route-read' } },\n  '/api/auth/me/documents': { get: { fields: ['documents','count','limit','offset'], source: 'route-read' } },\n  '/api/auth/me/documents/{id}/download': { get: { fields: [], source: 'route-read' } },\n  '/api/auth/me/notifications': { get: { fields: ['notifications','count'], source: 'route-read' } },\n  '/api/auth/me/notifications/{id}/ack': { post: { fields: ['notification'], source: 'route-read' } },\n  '/api/auth/me/pickup-authorization': {\n    get: { fields: ['status','given_names','family_name','version','updated_at'], source: 'service-read' },\n    put: { fields: ['status','given_names','family_name','version','updated_at'], source: 'service-read' },\n    delete: { fields: ['status'], source: 'service-read' },\n  },\n  '/api/local-stock/availability': { get: { fields: ['availability','exposable'], source: 'route-read' } },\n  '/api/local-stock/checkout-preview': { get: { fields: ['preview','relais_id','items'], source: 'route-read' } },\n  '/api/pickup/exceptional-pickup/{orderId}': { get: { fields: ['available','reason'], source: 'test' } },\n  '/api/pickup/exceptional-pickup/{orderId}/collect': { post: { fields: ['success','message','order_ref','parcel_id','parcel_reference','partial','order_status'], source: 'test' } },\n  '/api/products/{id}/detail': { get: { fields: ['contract_version','inventory_model','product','pricing','media','option_axes','sellable_units','delivery_options','content'], source: 'service-read' } },\n  '/api/products/{id}/skus': {\n    get: { fields: ['product_id','product_name','inventory_model','skus','count','has_variants','axes','candidates','declared_count'], source: 'service-read' },\n    post: { fields: ['message','sku'], source: 'service-read' },\n  },\n  '/api/products/{id}/skus/{skuId}': { delete: { fields: ['message','sku'], source: 'service-read' } },\n  '/api/products/{id}/skus/readiness': { get: { fields: ['product_id','ready','already_sku','reasons','active_sku_count','orphaned'], source: 'service-read' } },\n  '/api/providers-services/inquiries': { post: { fields: ['inquiry'], source: 'route-read' } },\n  '/api/providers-services/physical-offers/{id}': { get: { fields: ['id','title','description','zone','market_id','image_ref','provider_name','actions','public_contact'], source: 'route-read' } },\n  '/api/providers-services/services/{id}': { get: { fields: ['id','title','description','zone','market_id','image_ref','provider_name','actions','public_contact'], source: 'route-read' } },\n  '/api/shared-carts/library': { get: { fields: ['created','saved'], source: 'route-read' } },\n  '/api/shared-carts/save': { post: { fields: ['ok','shared_cart_id','already_saved'], source: 'service-read' } },\n  '/api/shared-carts/saved/{sharedCartId}': { delete: { fields: ['ok','shared_cart_id','removed'], source: 'service-read' } },\n\n`;
  src = src.replace(marker, block + marker);
}

const responseMarker = '// Surcharges de réponse par route — pour les cas réels observés';
if (!src.includes('SUCCESS_STATUS_OVERRIDES')) {
  src = src.replace(responseMarker,
    `const SUCCESS_STATUS_OVERRIDES = Object.freeze({\n  'POST /api/providers-services/inquiries': '201',\n});\n\n${responseMarker}`);
}
const oldResponses = `  op.responses = {\n    '200': { description: 'Succès', content: { 'application/json': { schema: respSchema } } },`;
const newResponses = `  const successStatus = SUCCESS_STATUS_OVERRIDES[\`${'${ep.method} ${prefix}'}\`] || '200';\n  op.responses = {\n    [successStatus]: { description: 'Succès', content: { 'application/json': { schema: respSchema } } },`;
if (src.includes(oldResponses)) src = src.replace(oldResponses, newResponses);
else if (!src.includes('const successStatus = SUCCESS_STATUS_OVERRIDES')) throw new Error('op.responses block not found');

const receiptMarker = "  // La route receipt retourne du HTML imprimable, pas du JSON.\n";
if (!src.includes("'GET /api/auth/me/documents/{id}/download':")) {
  const pdfOverride = `  'GET /api/auth/me/documents/{id}/download': {\n    '200': {\n      description: 'Document transactionnel PDF privé',\n      content: { 'application/pdf': { schema: { type: 'string', format: 'binary', 'x-contract-status': 'route-read' } } },\n    },\n    '404': { description: 'Document introuvable' },\n    '503': { description: 'Document temporairement indisponible' },\n  },\n`;
  if (!src.includes(receiptMarker)) throw new Error('RESPONSE_OVERRIDES insertion marker not found');
  src = src.replace(receiptMarker, pdfOverride + receiptMarker);
}

if (!src.includes("'POST /api/admin/users/{id}/market-scopes':")) {
  const scope201 = `  'POST /api/admin/users/{id}/market-scopes': {\n    '201': {\n      description: 'Scope marché créé',\n      content: { 'application/json': { schema: {\n        type: 'object',\n        'x-contract-status': 'route-read',\n        properties: { success: { type: 'string', 'x-observed': true }, status: { type: 'string', 'x-observed': true }, scope: { type: 'string', 'x-observed': true } },\n      } } },\n    },\n  },\n`;
  if (!src.includes(receiptMarker)) throw new Error('market scope 201 insertion marker not found');
  src = src.replace(receiptMarker, scope201 + receiptMarker);
}

fs.writeFileSync(p, src);

const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.scripts['contract:generate'] = 'node scripts/contract-generate.js && node scripts/contract-debt-sync.js --write';
pkg.scripts['contract:debt:check'] = 'node scripts/contract-debt-sync.js --check';
pkg.scripts['contract:debt:write'] = 'node scripts/contract-debt-sync.js --write';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
