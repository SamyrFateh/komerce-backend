/**
 * @feature       modal-product (boutique)
 * @type          feature
 * @domain        catalog
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 *
 * Couche frontend de la fiche produit (la feature backend `catalog`/`orders` la
 * nourrit en données ; ce manifeste possède son RENDU). C'est la feature qui a
 * cassé : la normalisation a supprimé le `display:grid` du product-zone, et aucun
 * gate ne l'a vu parce qu'aucun n'AFFIRMAIT le contrat de rendu. Il est ici.
 */
'use strict';

module.exports = {
  name:     'modal-product',
  type:     'feature',
  domain:   'catalog',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: 'Afficher la fiche produit en modal : image plein cadre + colonne détails/achat, en grille 2 colonnes sur desktop.',

  perimeter: {
    in:  ['layout et cascade de #k-modal et .k-modal-product-zone', 'placement grille image/détails/actions desktop'],
    out: ['données produit (feature catalog)', 'ajout panier (feature orders/shared-cart)'],
  },

  // Périmètre fichiers (relatif à ce manifeste). La carte gen-ownership.js dit :
  // modal-shell.css (14), modal-product.css (4), interactions.css (2), boutique-desktop.css (1).
  files: {
    boutique: [
      '../css/modal-shell.css',
      '../css/modal-product.css',
      '../css/modal-product-lot4-hybrid.css',
    ],
    dist: [
      '../css/dist/components.css',
    ],
  },

  contract: {
    // Pas d'API : feature de rendu pur. (interface checker → SKIP propre.)
  },

  // ── Contrats positifs exécutables ────────────────────────────────────────
  contracts: {

    // LE contrat qui manquait. Affirme que le layout grid est présent dans le
    // bundle livré. Une suppression de la règle = FAIL au commit (étage statique).
    'render-static': [
      {
        artifact: '../css/dist/components.css',
        label:    'product-zone desktop = grid',
        mustContain: [
          // Le conteneur produit DOIT établir une grille (≠ display:contents seul).
          /#k-modal\s+\.k-modal-product-zone\s*\{[^}]*display:\s*grid/m,
          // Et au moins une répartition de colonnes desktop.
          /#k-modal\s+\.k-modal-product-zone[^{]*\{[^}]*grid-template-columns/m,
        ],
      },
    ],

    // Dette de doctrine token scopée à la modal, sous cliquet (les 4 rgba du fix
    // ont été retokenisés → cliquet bas attendu). Une hausse bloque.
    doctrine: { scope: 'boutique', max: 21 },
  },
};
