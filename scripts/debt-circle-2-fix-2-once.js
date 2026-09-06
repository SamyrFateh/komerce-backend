'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content); }
function replaceOnce(file, from, to, label) {
  const src = read(file);
  if (!src.includes(from)) throw new Error(`${label}: pattern not found in ${file}`);
  write(file, src.replace(from, to));
}

// Les consommateurs existent déjà et sont légitimes : on les inscrit dans le contrat bus exact.
replaceOnce(
  'public/boutique/js/b-bus.js',
  " *   modal:opened     : b-modal-product-detail-bootstrap.js, boutique.js, b-pdp-curation-suggestions.js, b-pager.js, b-modal-desktop-enhancers.js\n",
  " *   modal:opened     : b-modal-product-detail-bootstrap.js, boutique.js, b-pdp-curation-suggestions.js, b-pager.js, b-modal-desktop-enhancers.js, spike-vertical-shell.js\n",
  'modal opened consumer contract'
);
replaceOnce(
  'public/boutique/js/b-bus.js',
  " *   modal:closed     : b-modal-product-detail-bootstrap.js, b-modal-discovery-detail.js, b-pager.js, group-side-cart.js\n",
  " *   modal:closed     : b-modal-product-detail-bootstrap.js, b-modal-discovery-detail.js, b-pager.js, group-side-cart.js, local-stock-badge-mount.js, spike-vertical-shell.js\n",
  'modal closed consumer contract'
);

// Dernière tolérance Boutique remboursée : le check frais devra maintenant tenir avec zéro baseline.
write('scripts/.boutique-360-baseline.json', JSON.stringify({
  orphanEmit: [],
  orphanListen: [],
  undeclared: [],
  notFoundEndpoints: [],
  ownershipRed: [],
  ownershipOrange: [],
  savedAt: '2026-09-06T00:00:00.000Z',
}, null, 2) + '\n');

console.log('✅ Boutique event-contract debt staged: ownershipOrange 1→0.');
