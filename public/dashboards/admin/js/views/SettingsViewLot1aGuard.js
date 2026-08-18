/**
 * LOT 1A — guard additif de migration Settings
 *
 * `SettingsView` garde temporairement son code legacy jusqu'à la purge LOT 11,
 * mais les onglets Taxes/Dimensions ne doivent plus être exposés : leurs tables
 * ne sont pas consommées par le moteur de pricing runtime.
 *
 * Le backend fail-close déjà les PUT en 410. Ce guard masque les deux éditeurs
 * sans réécrire la vue historique et les remasque après chaque rerender interne.
 */
(function (global) {
  'use strict';

  const original = global.SettingsView;
  if (typeof original !== 'function') return;

  const RETIRED_SELECTOR = '.sv-tab[data-tab="taxes"],.sv-tab[data-tab="dims"]';
  const ACTIVE_RETIRED_SELECTOR = '.sv-tab.active[data-tab="taxes"],.sv-tab.active[data-tab="dims"]';

  function scrubRetiredEditors(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    // Cas défensif : si l'état privé de SettingsView était resté sur un onglet
    // legacy, revenir sur Règles avant de retirer le bouton actif.
    const activeRetired = root.querySelector(ACTIVE_RETIRED_SELECTOR);
    const rulesButton = root.querySelector('.sv-tab[data-tab="rules"]');
    if (activeRetired && rulesButton) {
      rulesButton.click();
      return;
    }

    root.querySelectorAll(RETIRED_SELECTOR).forEach((button) => button.remove());
  }

  global.SettingsView = async function SettingsViewLot1aGuarded(root) {
    if (root.__lot1aSettingsObserver) {
      root.__lot1aSettingsObserver.disconnect();
    }

    const observer = new global.MutationObserver(() => scrubRetiredEditors(root));
    observer.observe(root, { childList: true, subtree: true });
    root.__lot1aSettingsObserver = observer;

    try {
      await original(root);
      scrubRetiredEditors(root);
    } catch (err) {
      observer.disconnect();
      delete root.__lot1aSettingsObserver;
      throw err;
    }
  };
})(window);
