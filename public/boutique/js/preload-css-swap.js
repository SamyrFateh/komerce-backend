/**
 * @komerce-arch-lite
 * @role          preload-css-swap
 * @domain        boutique
 * @layer         bootstrap
 * @purpose       Bascule <link id="k-components-preload" rel="preload" as="style">
 *                en <link rel="stylesheet"> une fois le fichier téléchargé,
 *                sans jamais bloquer le premier affichage sur components.css
 *                (GAP-F4 étape 2, docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md).
 *                Écouteur attaché par script externe plutôt qu'un attribut
 *                onload= inline : la CSP de ce site interdit scriptSrcAttr
 *                (bootstrap/security.js, FRESH-030) — un onload= inline sur
 *                le <link> ne se serait jamais exécuté, laissant
 *                components.css bloqué en preload pour toujours.
 * @version       2026-09
 */
(function () {
  'use strict';
  var link = document.getElementById('k-components-preload');
  if (!link) return;

  function activate() {
    if (link.rel !== 'stylesheet') link.rel = 'stylesheet';
  }

  // Le fichier peut avoir déjà fini de charger avant que ce script ne
  // s'exécute (cache navigateur, réseau très rapide) — un <link> déjà
  // chargé au moment de l'attachement de l'écouteur ne redéclenche pas
  // toujours l'événement 'load' selon les navigateurs : on vérifie donc
  // aussi explicitement l'état, en plus d'écouter l'événement.
  link.addEventListener('load', activate);
  link.addEventListener('error', activate); // fail-open : mieux vaut un CSS actif qu'un preload bloqué à jamais
  if (link.sheet) activate();
})();
