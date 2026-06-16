'use strict';

/**
 * Audits @komerce-arch coverage across the Komerce codebase.
 * Writes machine-readable and human-readable reports under docs/.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

const INCLUDED_ROOTS = [
  'server.js',
  'bootstrap',
  'routes',
  'services',
  'middleware',
  'utils',
  'public/boutique/js',
  'scripts'
];

const EXCLUDED_PARTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.next',
  '.cache'
]);

const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

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
    if (EXCLUDED_PARTS.has(entry)) continue;
    walk(path.join(relativePath, entry), out);
  }
}

function layerOf(file) {
  if (file === 'server.js') return 'entrypoint';
  if (file.startsWith('bootstrap/')) return 'bootstrap';
  if (file.startsWith('routes/')) return 'route';
  if (file.startsWith('services/')) return 'service';
  if (file.startsWith('middleware/')) return 'middleware';
  if (file.startsWith('utils/')) return 'util';
  if (file.startsWith('public/boutique/js/group/')) return 'boutique-group';
  if (file.startsWith('public/boutique/js/render/')) return 'boutique-render';
  if (file.startsWith('public/boutique/js/view-models/')) return 'boutique-view-model';
  if (file.startsWith('public/boutique/js/controllers/')) return 'boutique-controller';
  if (file.startsWith('public/boutique/js/')) return 'boutique-js';
  if (file.startsWith('scripts/')) return 'script';
  return 'other';
}

function domainHint(file) {
  const f = file.toLowerCase();
  if (f.includes('shared-cart') || f.includes('/group/') || f.includes('group-')) return 'shared-cart';
  if (f.includes('payment') || f.includes('stripe') || f.includes('paypal') || f.includes('cash')) return 'payment';
  if (f.includes('order')) return 'orders';
  if (f.includes('otp') || f.includes('auth') || f.includes('identity')) return 'auth';
  if (f.includes('wallet') || f.includes('credit')) return 'wallet';
  if (f.includes('economic')) return 'economic-engine';
  if (f.includes('catalog') || f.includes('product') || f.includes('category') || f.includes('schema')) return 'catalog';
  if (f.includes('suggest')) return 'recommendations';
  if (f.includes('tracking')) return 'tracking';
  if (f.includes('notification') || f.includes('whatsapp') || f.includes('meta')) return 'notification';
  if (f.startsWith('public/boutique/js/')) return 'boutique';
  return 'unknown';
}

function criticalityHint(file) {
  const f = file.toLowerCase();
  if (f === 'server.js') return 'critical';
  if (f.includes('payment') || f.includes('stripe') || f.includes('shared-cart-engine') || f.includes('order-payment-confirmation') || f.includes('order-status-machine')) return 'critical';
  if (f.includes('checkout') || f.includes('cart') || f.includes('identity') || f.includes('otp') || f.includes('orders') || f.includes('wallet')) return 'high';
  if (f.includes('catalog') || f.includes('product') || f.includes('modal') || f.includes('tracking') || f.includes('suggest')) return 'high';
  return 'medium';
}

function readHeaderRole(src) {
  const m = src.match(/@role\s+([^\n]+)/);
  return m ? m[1].trim() : null;
}

function main() {
  const files = [];
  for (const root of INCLUDED_ROOTS) walk(root, files);
  files.sort();

  const rows = files.map(file => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const hasHeader = src.includes('@komerce-arch');
    return {
      file,
      hasHeader,
      role: hasHeader ? readHeaderRole(src) : null,
      layer: layerOf(file),
      domainHint: domainHint(file),
      criticalityHint: criticalityHint(file),
      lines: src.split(/\r?\n/).length
    };
  });

  const byLayer = rows.reduce((acc, row) => {
    if (!acc[row.layer]) acc[row.layer] = { total: 0, covered: 0, missing: 0 };
    acc[row.layer].total += 1;
    acc[row.layer][row.hasHeader ? 'covered' : 'missing'] += 1;
    return acc;
  }, {});

  const report = {
    version: '2026-06',
    generatedAt: new Date().toISOString(),
    scope: INCLUDED_ROOTS,
    totals: {
      files: rows.length,
      covered: rows.filter(r => r.hasHeader).length,
      missing: rows.filter(r => !r.hasHeader).length
    },
    byLayer,
    files: rows,
    missingPriority: rows
      .filter(r => !r.hasHeader)
      .sort((a, b) => {
        const rank = { critical: 0, high: 1, medium: 2 };
        return (rank[a.criticalityHint] - rank[b.criticalityHint]) || (b.lines - a.lines);
      })
      .slice(0, 80)
  };

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, 'komerce-arch-header-audit.json'), JSON.stringify(report, null, 2) + '\n');

  const pct = report.totals.files ? Math.round(report.totals.covered / report.totals.files * 100) : 0;
  const lines = [];
  lines.push('# Komerce Architecture Header Audit');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(`Coverage: ${report.totals.covered}/${report.totals.files} files (${pct}%).`);
  lines.push('');
  lines.push('## Coverage By Layer');
  lines.push('');
  lines.push('| Layer | Covered | Missing | Total |');
  lines.push('|---|---:|---:|---:|');
  for (const [layer, stats] of Object.entries(byLayer).sort()) {
    lines.push(`| ${layer} | ${stats.covered} | ${stats.missing} | ${stats.total} |`);
  }
  lines.push('');
  lines.push('## Next Missing Priority');
  lines.push('');
  for (const row of report.missingPriority.slice(0, 40)) {
    lines.push(`- ${row.criticalityHint} · ${row.layer} · ${row.domainHint} · ${row.file} (${row.lines} lines)`);
  }
  lines.push('');
  lines.push('## Rule');
  lines.push('');
  lines.push('Before modifying a structurally relevant file, read its `@komerce-arch` header and this audit. If the file has no header and is high/critical, add one before changing behavior.');
  lines.push('');
  fs.writeFileSync(path.join(DOCS, 'KOMERCE_ARCH_HEADER_AUDIT.md'), lines.join('\n'));

  console.log(`Coverage: ${report.totals.covered}/${report.totals.files} (${pct}%)`);
  console.log(`Missing: ${report.totals.missing}`);
}

main();
