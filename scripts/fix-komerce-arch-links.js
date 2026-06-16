'use strict';

/**
 * Normalizes @komerce-arch links after the first header pass.
 * Documentation-only: this script only edits header metadata comments.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FILES = [
  'public/boutique/js/b-cart.js',
  'public/boutique/js/b-checkout.js',
  'public/boutique/js/b-catalog.js',
  'public/boutique/js/b-subcat.js',
  'public/boutique/js/b-share-cart.js',
  'public/boutique/js/b-nav.js',
  'scripts/apply-komerce-arch-headers.js',
];

function normalizeFile(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    return { file: relativePath, status: 'missing' };
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const next = source.replace(/b-boutique\.js/g, 'boutique.js');
  if (next === source) {
    return { file: relativePath, status: 'unchanged' };
  }

  fs.writeFileSync(filePath, next, 'utf8');
  return { file: relativePath, status: 'updated' };
}

const results = FILES.map(normalizeFile);
for (const result of results) {
  console.log(`${result.status.padEnd(10)} ${result.file}`);
}
