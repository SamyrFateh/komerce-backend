/**
 * @komerce-arch-lite
 * @role          preload-css-swap
 * @domain        boutique
 * @layer         bootstrap
 * @owner         public/boutique/index.html
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

  // Le fichier a-t-il DÉJÀ fini de charger ? Un <link rel="preload"> n'a
  // jamais de .sheet (seul un stylesheet en a) : l'ancien test `link.sheet`
  // ne pouvait donc jamais être vrai. Mesuré avant correctif : ~1 chargement
  // sur 8 en production (cache chaud) restait bloqué en preload, boutique
  // quasi sans styles. La Resource Timing API, elle, voit le fichier chargé.
  function alreadyLoaded() {
    try {
      var entries = window.performance && performance.getEntriesByName
        ? performance.getEntriesByName(link.href) : [];
      return entries.length > 0 && entries[entries.length - 1].responseEnd > 0;
    } catch (_) {
      return false;
    }
  }

  link.addEventListener('load', activate);
  link.addEventListener('error', activate); // fail-open : mieux vaut un CSS actif qu'un preload bloqué à jamais
  if (link.sheet || alreadyLoaded()) activate();
  // Filets : si l'événement 'load' du lien a été manqué, on bascule au plus
  // tard quand le document est prêt, puis au 'load' de la fenêtre (qui ne
  // survient qu'une fois toutes les ressources préchargées terminées).
  document.addEventListener('DOMContentLoaded', function () {
    if (alreadyLoaded()) activate();
  });
  window.addEventListener('load', activate);
})();
