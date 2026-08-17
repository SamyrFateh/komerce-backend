'use strict';
const fs = require('fs');
const file = 'scripts/temp-final-catalog-orders-boundary.js';
let src = fs.readFileSync(file, 'utf8');
const candidates = [
  String.raw`/\n  \/\* ── TOGGLE FAV ─+[\s\S]*?\n  \/\* ── CATEGORIES ─+\/\n/,`,
  String.raw`/\n  \/\* ── TOGGLE FAV ─+[\s\S]*?\n  \/\* ── CATEGORIES ─+\*\/\n/,`,
];
const replacement = String.raw`/\n\s*\/\*[^\n]*TOGGLE FAV[^\n]*\*\/[\s\S]*?\n\s*\/\*[^\n]*CATEGORIES[^\n]*\*\/\n/,`;
const found = candidates.find((candidate) => src.includes(candidate));
if (!found) throw new Error('final seam favorite-section regex marker not found');
src = src.replace(found, replacement);
fs.writeFileSync(file, src);
console.log('final seam favorite-section marker made typography-independent');
