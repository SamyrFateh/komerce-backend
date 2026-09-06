'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content); }
function replaceOnce(file, from, to, label) {
  const src = read(file);
  if (!src.includes(from)) throw new Error(`${label}: pattern not found in ${file}`);
  write(file, src.replace(from, to));
}

// Zero est un état sain, pas une baseline suspecte.
replaceOnce(
  'scripts/feature-schema-check.js',
  "if (BASELINE_EXISTED && baseline.size === 0) {\n  console.log(`${C.yel}⚠ Baseline trouvée mais \\\"exempt\\\" est vide ou absent — vérifier le contenu de .feature-schema-tests-baseline.json.${C.r}`);\n}",
  "if (BASELINE_EXISTED && baseline.size === 0) {\n  console.log(`${C.dim}Baseline tests : zéro exemption historique.${C.r}`);\n}",
  'zero feature baseline message'
);

// Normalisation de chemin portable Windows/Linux pour les futures identités de baseline.
replaceOnce(
  'scripts/feature-schema-check.js',
  "const featureKey = m => String(m.__file || m.name || '').replace(/\\\\\\\\/g, '/');",
  "const featureKey = m => String(m.__file || m.name || '').replace(/\\\\/g, '/');",
  'feature key slash normalization'
);

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
