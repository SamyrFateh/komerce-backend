'use strict';

/**
 * Refines generated coverage headers without changing runtime behavior.
 *
 * This pass only updates fields that are still generic:
 * - @domain unknown
 * - @impact-areas unknown
 * - @db-read/@db-write @unknown when SQL table usage is detectable
 *
 * It intentionally leaves ambiguous doctrine, depends, and transaction fields
 * as explicit debt instead of guessing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SCAN_ROOTS = [
  'server.js',
  'bootstrap',
  'routes',
  'services',
  'middleware',
  'utils',
  'public/boutique/js'
];

const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.cache', '.next', 'tmp', 'temp']);
const HEADER_RE = /^\s*\/\*\*[\s\S]*?\*\//;

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

function fieldValue(block, field) {
  const re = new RegExp(`^\\s*\\*\\s+@${field}\\s+(.+)$`, 'm');
  const match = block.match(re);
  return match ? match[1].trim() : null;
}

function replaceField(block, field, nextValue) {
  const re = new RegExp(`^(\\s*\\*\\s+@${field}\\s+).+$`, 'm');
  return block.replace(re, `$1${nextValue}`);
}

function inferDomain(file) {
  const f = file.toLowerCase();
  if (f.includes('shared-cart') || f.includes('/group/') || f.includes('collective') || f.includes('basket')) return 'shared-cart';
  if (f.includes('checkout')) return 'checkout';
  if (f.includes('payment') || f.includes('stripe') || f.includes('paypal') || f.includes('cash')) return 'payment';
  if (f.includes('order') || f.includes('invoice') || f.includes('billing')) return 'orders';
  if (f.includes('otp') || f.includes('auth') || f.includes('identity') || f.includes('jwt') || f.includes('user')) return 'auth';
  if (f.includes('wallet') || f.includes('credit') || f.includes('loyalty')) return 'wallet';
  if (f.includes('economic') || f.includes('cost') || f.includes('pricing') || f.includes('finance') || f.includes('margin')) return 'economic-engine';
  if (f.includes('catalog') || f.includes('product') || f.includes('category') || f.includes('taxonomy') || f.includes('supplier')) return 'catalog';
  if (f.includes('suggest') || f.includes('ranking') || f.includes('personal')) return 'recommendations';
  if (f.includes('tracking') || f.includes('scan') || f.includes('parcel') || f.includes('logistic') || f.includes('transit') || f.includes('carrier') || f.includes('relay') || f.includes('relais') || f.includes('pickup')) return 'logistics';
  if (f.includes('notification') || f.includes('whatsapp') || f.includes('meta') || f.includes('alert')) return 'notification';
  if (f.includes('dashboard') || f.includes('admin') || f.includes('support') || f.includes('client')) return 'dashboard';
  if (f.includes('inventory') || f.includes('stock')) return 'inventory';
  if (f.includes('health') || f.includes('config') || f.includes('module') || f.includes('system') || f.includes('ops')) return 'operations';
  if (f.startsWith('public/boutique/js/')) return 'boutique';
  if (f.startsWith('middleware/')) return 'auth';
  if (f.startsWith('bootstrap/') || f === 'server.js') return 'bootstrap';
  return null;
}

function inferImpactAreas(file, domain) {
  const f = file.toLowerCase();
  const areas = new Set();
  if (domain) areas.add(domain);
  if (f.includes('checkout') || f.includes('payment') || f.includes('order') || f.includes('invoice')) areas.add('checkout');
  if (f.includes('shared-cart') || f.includes('collective') || f.includes('basket')) areas.add('shared-cart');
  if (f.includes('catalog') || f.includes('product') || f.includes('category') || f.includes('supplier')) areas.add('product-discovery');
  if (f.includes('dashboard') || f.includes('admin') || f.includes('support')) areas.add('admin-dashboard');
  if (f.includes('parcel') || f.includes('tracking') || f.includes('logistic') || f.includes('transit') || f.includes('carrier') || f.includes('relay') || f.includes('relais')) areas.add('logistics');
  if (f.includes('auth') || f.includes('otp') || f.includes('identity') || f.includes('user')) areas.add('auth');
  if (f.includes('notification') || f.includes('whatsapp') || f.includes('alert')) areas.add('notifications');
  if (f.includes('pricing') || f.includes('finance') || f.includes('cost') || f.includes('economic')) areas.add('economic-engine');
  return Array.from(areas).filter(Boolean).join(', ');
}

function extractSqlTables(src) {
  const read = new Set();
  const write = new Set();
  const addMatches = (re, set) => {
    for (const match of src.matchAll(re)) {
      const table = match[1];
      if (table && !table.includes('$')) set.add(table);
    }
  };

  addMatches(/\bfrom\s+([a-z_][a-z0-9_]*)\b/gi, read);
  addMatches(/\bjoin\s+([a-z_][a-z0-9_]*)\b/gi, read);
  addMatches(/\binsert\s+into\s+([a-z_][a-z0-9_]*)\b/gi, write);
  addMatches(/\bupdate\s+([a-z_][a-z0-9_]*)\b/gi, write);
  addMatches(/\bdelete\s+from\s+([a-z_][a-z0-9_]*)\b/gi, write);

  return {
    read: Array.from(read).sort(),
    write: Array.from(write).sort()
  };
}

function isUnknownValue(value) {
  return value === 'unknown' || value === '@unknown';
}

function apply(file) {
  const full = path.join(ROOT, file);
  const src = fs.readFileSync(full, 'utf8');
  const match = src.match(HEADER_RE);
  if (!match || !match[0].includes('@komerce-arch')) return { file, changed: false, reason: 'no-header' };

  let block = match[0];
  const originalBlock = block;
  const domain = fieldValue(block, 'domain');
  let resolvedDomain = domain;

  if (isUnknownValue(domain)) {
    const inferred = inferDomain(file);
    if (inferred) {
      block = replaceField(block, 'domain', inferred);
      resolvedDomain = inferred;
    }
  }

  const impactAreas = fieldValue(block, 'impact-areas');
  if (isUnknownValue(impactAreas)) {
    const inferredImpact = inferImpactAreas(file, resolvedDomain === 'unknown' ? null : resolvedDomain);
    if (inferredImpact) block = replaceField(block, 'impact-areas', inferredImpact);
  }

  const tables = extractSqlTables(src.slice(match[0].length));
  const dbRead = fieldValue(block, 'db-read');
  if (dbRead === '@unknown' && tables.read.length) {
    block = replaceField(block, 'db-read', tables.read.join(', '));
  }

  const dbWrite = fieldValue(block, 'db-write');
  if (dbWrite === '@unknown' && tables.write.length) {
    block = replaceField(block, 'db-write', tables.write.join(', '));
  }

  if (block === originalBlock) return { file, changed: false, reason: 'already-specific-or-ambiguous' };

  fs.writeFileSync(full, src.replace(originalBlock, block), 'utf8');
  return { file, changed: true, reason: 'refined' };
}

const files = [];
for (const root of SCAN_ROOTS) walk(root, files);
files.sort();

const results = files.map(apply);
for (const result of results) {
  if (result.changed) console.log(`refined ${result.file}`);
}

const counts = results.reduce((acc, result) => {
  const key = result.changed ? 'refined' : result.reason;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

console.log('\nSummary:', counts);
