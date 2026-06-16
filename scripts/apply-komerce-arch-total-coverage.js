'use strict';

/**
 * Adds architecture coverage to every scanned Komerce source file that is still silent.
 *
 * - Structural backend files get a full @komerce-arch header.
 * - Small/owned boutique files get @komerce-arch-lite with an explicit owner.
 * - Existing @komerce-arch and @komerce-arch-lite headers are preserved.
 *
 * This is a coverage pass: unknown dependencies/DB touchpoints must be resolved
 * before behavior changes in those files.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SCAN_ROOTS = [
  'bootstrap',
  'routes',
  'services',
  'middleware',
  'utils',
  'public/boutique/js'
];

const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.cache', '.next', 'tmp', 'temp']);

function walk(relativePath, out) {
  const full = path.join(ROOT, relativePath);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (EXTENSIONS.has(path.extname(full))) out.push(relativePath.replace(/\\/g, '/'));
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(full)) {
    if (IGNORE_DIRS.has(entry)) continue;
    walk(path.join(relativePath, entry), out);
  }
}

function kebabName(file) {
  const base = path.basename(file).replace(/\.(cjs|mjs|js)$/i, '');
  return base
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'unnamed';
}

function domainOf(file) {
  const f = file.toLowerCase();
  if (f.includes('shared-cart') || f.includes('/group/') || f.includes('collective')) return 'shared-cart';
  if (f.includes('payment') || f.includes('stripe') || f.includes('paypal') || f.includes('cash')) return 'payment';
  if (f.includes('order')) return 'orders';
  if (f.includes('otp') || f.includes('auth') || f.includes('identity') || f.includes('jwt')) return 'auth';
  if (f.includes('wallet') || f.includes('credit')) return 'wallet';
  if (f.includes('economic') || f.includes('cost') || f.includes('pricing') || f.includes('finance')) return 'economic-engine';
  if (f.includes('catalog') || f.includes('product') || f.includes('category') || f.includes('taxonomy') || f.includes('schema')) return 'catalog';
  if (f.includes('suggest') || f.includes('ranking') || f.includes('personal')) return 'recommendations';
  if (f.includes('tracking') || f.includes('scan') || f.includes('parcel') || f.includes('logistic') || f.includes('transit') || f.includes('carrier')) return 'logistics';
  if (f.includes('notification') || f.includes('whatsapp') || f.includes('meta') || f.includes('alert')) return 'notification';
  if (f.includes('dashboard') || f.includes('admin')) return 'dashboard';
  if (f.includes('inventory') || f.includes('stock')) return 'inventory';
  if (f.startsWith('public/boutique/js/')) return 'boutique';
  if (f.startsWith('middleware/')) return 'auth';
  if (f.startsWith('bootstrap/')) return 'bootstrap';
  return 'unknown';
}

function layerOf(file) {
  if (file.startsWith('bootstrap/')) return file.includes('cron') ? 'cron' : 'bootstrap';
  if (file.startsWith('routes/')) return 'route';
  if (file.startsWith('services/')) return 'service';
  if (file.startsWith('middleware/')) return 'middleware';
  if (file.startsWith('utils/')) return 'util';
  if (file.startsWith('public/boutique/js/render/')) return 'ui-renderer';
  if (file.startsWith('public/boutique/js/view-models/')) return 'view-model';
  if (file.startsWith('public/boutique/js/controllers/')) return 'controller';
  if (file.startsWith('public/boutique/js/group/')) return 'ui-component';
  if (file.startsWith('public/boutique/js/')) return 'ui-component';
  return 'unknown';
}

function criticalityOf(file) {
  const f = file.toLowerCase();
  if (f.includes('payment') || f.includes('stripe') || f.includes('paypal') || f.includes('cash')) return 'critical';
  if (f.includes('order') || f.includes('shared-cart') || f.includes('collective') || f.includes('stock') || f.includes('inventory')) return 'critical';
  if (f.includes('auth') || f.includes('otp') || f.includes('jwt') || f.includes('wallet')) return 'high';
  if (f.includes('dashboard') || f.includes('admin') || f.includes('pricing') || f.includes('finance') || f.includes('economic')) return 'high';
  if (f.includes('catalog') || f.includes('product') || f.includes('modal') || f.includes('tracking') || f.includes('parcel')) return 'high';
  return 'medium';
}

function impactAreasFor(file, domain) {
  const set = new Set([domain]);
  const f = file.toLowerCase();
  if (f.includes('checkout') || f.includes('payment') || f.includes('order')) set.add('checkout');
  if (f.includes('shared-cart') || f.includes('collective')) set.add('shared-cart');
  if (f.includes('catalog') || f.includes('product') || f.includes('category')) set.add('product-discovery');
  if (f.includes('dashboard') || f.includes('admin')) set.add('admin-dashboard');
  if (f.includes('parcel') || f.includes('tracking') || f.includes('logistic') || f.includes('transit')) set.add('logistics');
  if (f.includes('auth') || f.includes('otp') || f.includes('identity')) set.add('auth');
  return Array.from(set).filter(Boolean).join(', ');
}

function ownerForBoutique(file) {
  if (file.includes('/render/')) return 'public/boutique/js/b-catalog.js';
  if (file.includes('/view-models/product-card')) return 'public/boutique/js/b-catalog.js';
  if (file.includes('/group/')) return 'public/boutique/js/b-group-view.js';
  const name = path.basename(file);
  if (name === 'main.js') return 'public/boutique/js/boutique.js';
  if (name === 'b-bus.js') return null;
  if (name === 'b-cart-core.js') return null;
  if (name === 'b-paypal.js') return 'public/boutique/js/b-checkout.js';
  if (name.startsWith('b-modal') || name.includes('product-open')) return 'public/boutique/js/b-modal-core.js';
  if (name.includes('desktop') || name.includes('home') || name.includes('greeting')) return 'public/boutique/js/b-catalog.js';
  if (name.includes('cart')) return 'public/boutique/js/b-cart.js';
  if (name.includes('share') || name.includes('group') || name.includes('collective')) return 'public/boutique/js/b-group-view.js';
  if (name.includes('pdp') || name.includes('suggestion')) return 'public/boutique/js/b-modal-suggestions.js';
  if (name.includes('card') || name.includes('category') || name.includes('taxonomy')) return 'public/boutique/js/b-catalog.js';
  return 'public/boutique/js/boutique.js';
}

function shouldLite(file) {
  if (!file.startsWith('public/boutique/js/')) return false;
  const name = path.basename(file);
  if (name === 'b-bus.js' || name === 'b-cart-core.js') return false;
  return true;
}

function fullHeader(file) {
  const domain = domainOf(file);
  const layer = layerOf(file);
  const criticality = criticalityOf(file);
  const role = `${domain}-${kebabName(file)}`.replace(/^(unknown-)+/, '');
  const impact = impactAreasFor(file, domain);
  const dbNeeded = ['routes/', 'services/'].some(prefix => file.startsWith(prefix));
  const dbLines = dbNeeded
    ? ` * @db-read       @unknown\n * @db-write      @unknown\n * @db-txn        resolve_before_behavior_change\n`
    : '';
  const depends = file.startsWith('routes/') ? 'db.js, middleware/auth.js, services/*' : '@unknown';
  const usedBy = file.startsWith('routes/') ? 'bootstrap/api-routes.js' : '@unknown';

  return `/**
 * @komerce-arch
 * @role          ${role}
 * @domain        ${domain}
 * @layer         ${layer}
 * @criticality   ${criticality}
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       ${depends}
 * @used-by       ${usedBy}
${dbLines} * @doctrine      resolve_before_behavior_change
 * @impact-areas  ${impact}
 * @version       2026-06
 */`;
}

function liteHeader(file) {
  const domain = domainOf(file);
  const layer = layerOf(file);
  const owner = ownerForBoutique(file);
  const role = `${domain}-${kebabName(file)}`.replace(/^(unknown-)+/, '');
  const impact = impactAreasFor(file, domain);
  return `/**
 * @komerce-arch-lite
 * @role          ${role}
 * @domain        ${domain}
 * @layer         ${layer}
 * @owner         ${owner || '@missing-owner'}
 * @purpose       supports ${owner || 'unclassified owner'}
 * @impact-areas  ${impact}
 * @version       2026-06
 */`;
}

function apply(file) {
  const full = path.join(ROOT, file);
  const src = fs.readFileSync(full, 'utf8');
  if (src.includes('@komerce-arch')) return { file, status: 'skipped-existing' };

  const header = shouldLite(file) ? liteHeader(file) : fullHeader(file);
  fs.writeFileSync(full, `${header}\n\n${src}`, 'utf8');
  return { file, status: shouldLite(file) ? 'lite-added' : 'full-added' };
}

const files = [];
for (const root of SCAN_ROOTS) walk(root, files);
files.sort();

const results = files.map(apply);
const counts = results.reduce((acc, result) => {
  acc[result.status] = (acc[result.status] || 0) + 1;
  return acc;
}, {});

for (const result of results) {
  if (result.status !== 'skipped-existing') console.log(`${result.status.padEnd(16)} ${result.file}`);
}
console.log('\nSummary:', counts);
