'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, text) { fs.writeFileSync(file, text); }
function replaceOnce(file, from, to) {
  const text = read(file);
  if (!text.includes(from)) throw new Error(`${file}: target not found: ${from.slice(0, 160)}`);
  write(file, text.replace(from, to));
}

// Dashboard: seul module sans contrat d'architecture.
const guardFile = 'public/dashboards/admin/js/views/SettingsViewLot1aGuard.js';
const guard = read(guardFile);
if (!guard.includes('@komerce-arch')) {
  write(guardFile, `/**\n * @komerce-arch\n * @role          admin-settings-lot1a-retired-editors-guard\n * @domain        admin-dashboard\n * @layer         ui-page\n * @criticality   medium\n * @inputs        SettingsView, settings_dom_mutations\n * @outputs       settings_view_without_retired_tax_dimension_editors\n * @depends       SettingsView.js\n * @used-by       admin dashboard bootstrap\n * @db-read       none\n * @db-write      none\n * @db-txn        none\n * @doctrine      kmc_api_only, retired_settings_fail_closed\n * @impact-areas  settings, admin-dashboard\n * @version       2026-08\n */\n'use strict';\n\n` + guard);
}

// Boutique: aligner le registre sur les événements actifs réellement observés.
const busFile = 'public/boutique/js/b-bus.js';
replaceOnce(
  busFile,
  ' *   view:switch      { view }           — changer d\'onglet (home/favs/suivi)\n',
  ' *   view:changed     { view }           — notifier le changement effectif de vue aux enrichissements desktop\n'
);
replaceOnce(
  busFile,
  ' *   catalog:cat-changed { cat }         — catégorie active changée [b-catalog → b-desktop-upgrade]\n',
  ' *   catalog:cat-changed { cat }         — catégorie active changée [b-catalog → b-desktop-upgrade]\n *   favorites:view-refresh —               — rafraîchir la vue Favoris après mutation du catalogue\n'
);
replaceOnce(
  busFile,
  ' *   modal:suggestions-rendered { product } — suggestions modal rendues, prêtes pour curation PDP\n',
  ' *   modal:suggestions-rendered { product } — suggestions modal rendues, prêtes pour curation PDP\n *   carousel:changed { index }             — slide produit actif changé ; synchroniser l\'UX image\n'
);
replaceOnce(
  busFile,
  ', public/boutique/js/b-modal-image-ux.js, public/boutique/js/b-modal-nav.js, public/boutique/js/b-modal-product.js, public/boutique/js/b-modal-social-proof.js, public/boutique/js/b-modal-suggestions.js',
  ', public/boutique/js/b-modal-image-ux.js, public/boutique/js/b-modal-nav.js, public/boutique/js/b-modal-product.js, public/boutique/js/b-modal-suggestions.js'
);

// Le signal modal:product-changed n'a plus aucun producteur. Il est redondant :
// openModal() appelle setupSocialProof() après chaque changement de state.modalProduct.
const socialFile = 'public/boutique/js/b-modal-social-proof.js';
replaceOnce(
  socialFile,
  " * Point d'entrée : setupSocialProof().\n * Câblé sur bus.on('modal:product-changed') (pas modal:opened — le social proof\n * doit se rejouer à chaque changement de produit affiché, y compris navigation\n * précédent/suivant sans fermeture de la modal).\n",
  " * Point d'entrée : setupSocialProof(). openModal() le rappelle après chaque\n * changement de state.modalProduct, y compris la navigation précédent/suivant.\n"
);
replaceOnce(socialFile, "import { bus }       from './b-bus.js';\n", '');
replaceOnce(socialFile, "let _installed = false;\n\nexport function setupSocialProof() {\n  requestAnimationFrame(injectSocialProof);\n\n  if (!_installed) {\n    _installed = true;\n    // Réinjecter si le produit change sans fermer la modal (navigation nav-btn)\n    bus.on('modal:product-changed', injectSocialProof);\n  }\n}\n", "export function setupSocialProof() {\n  requestAnimationFrame(injectSocialProof);\n}\n");

// Tests : le contrat réel est désormais le rappel explicite par openModal(), pas un bus mort.
const testFile = 'public/boutique/tests/unit/b-modal-social-proof.test.js';
replaceOnce(testFile, '  let bus, state, dom, setupSocialProof;\n', '  let state, dom, setupSocialProof;\n');
replaceOnce(testFile, "    ({ bus } = require('../../js/b-bus.js'));\n", '');
replaceOnce(
  testFile,
  " * jest.resetModules() par test : `_installed` est un flag module-level qui\n * doit repartir à zéro pour tester l'idempotence de l'abonnement bus.\n",
  " * jest.resetModules() par test garde l'isolation d'état des modules Boutique.\n"
);
replaceOnce(
  testFile,
  "  test('ré-injecte au bus \"modal:product-changed\" (navigation nav-btn sans fermer la modal)', () => {\n    state.modalProduct = { rank: 1 };\n    setupSocialProof();\n    state.modalProduct = { sold_count: 20 };\n    bus.emit('modal:product-changed');\n    const meta = document.querySelector('.k-modal-meta');\n    expect(meta.querySelector('.k-modal-meta-rank')).toBeNull();\n    expect(meta.textContent).toContain('vendus');\n  });\n\n  test('setupSocialProof() appelé deux fois -> un seul abonnement bus (pas de double injection)', () => {\n    state.modalProduct = { rank: 1 };\n    setupSocialProof();\n    setupSocialProof();\n    const metaBefore = document.querySelector('.k-modal-meta').children.length;\n    bus.emit('modal:product-changed');\n    // Toujours une seule injection à la fois (innerHTML vidé avant réinjection),\n    // pas d'accumulation même si setupSocialProof a été appelé 2x.\n    expect(document.querySelector('.k-modal-meta').children.length).toBe(metaBefore);\n  });\n",
  "  test('ré-injecte quand openModal rappelle setupSocialProof après changement de produit', () => {\n    state.modalProduct = { rank: 1 };\n    setupSocialProof();\n    state.modalProduct = { sold_count: 20 };\n    setupSocialProof();\n    const meta = document.querySelector('.k-modal-meta');\n    expect(meta.querySelector('.k-modal-meta-rank')).toBeNull();\n    expect(meta.textContent).toContain('vendus');\n  });\n\n  test('setupSocialProof() appelé deux fois ne duplique pas ses nœuds', () => {\n    state.modalProduct = { rank: 1 };\n    setupSocialProof();\n    setupSocialProof();\n    expect(document.querySelectorAll('[data-social-proof]').length).toBe(1);\n  });\n"
);
replaceOnce(
  testFile,
  "  test('ne détruit jamais #k-modal-cat / #k-modal-stock sur un changement de produit (modal:product-changed)', () => {",
  "  test('ne détruit jamais #k-modal-cat / #k-modal-stock sur un changement de produit', () => {"
);
replaceOnce(testFile, "    bus.emit('modal:product-changed');\n", "    setupSocialProof();\n");
replaceOnce(
  testFile,
  "    state.modalProduct = { rank: 1, sold_count: 5, rating: 4.2 };\n    bus.emit('modal:product-changed');\n",
  "    state.modalProduct = { rank: 1, sold_count: 5, rating: 4.2 };\n    setupSocialProof();\n"
);

console.log('Debt Zero: Dashboard/Boutique structural residuals closed');
