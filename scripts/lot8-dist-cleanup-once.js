'use strict';

const fs = require('fs');
const path = require('path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const root = 'public/boutique/js/dist';
let changed = 0;
for (const file of walk(root).filter((name) => name.endsWith('.js'))) {
  const source = fs.readFileSync(file, 'utf8');
  const next = source
    .replaceAll('/api/shares/', '/api/shared-carts/public/')
    .replaceAll('/api/shares', '/api/shared-carts/from-cart-items');
  if (next !== source) {
    fs.writeFileSync(file, next, 'utf8');
    changed += 1;
  }
}

if (changed === 0) throw new Error('Aucun bundle contenant /api/shares trouvé');
console.log(`Lot 8 dist cleanup applied to ${changed} bundle(s).`);
