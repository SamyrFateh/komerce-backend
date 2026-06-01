/**
 * @module b-bus
 * @brief Event bus léger pour découpler les modules sans imports circulaires.
 *
 * Pattern :
 *   import { bus } from './b-bus.js';
 *   bus.on('modal:open', ({ id }) => openModal(id));
 *   bus.emit('modal:open', { id: 42 });
 *
 * Événements standard Komerce :
 *   modal:open       { id }              — ouvrir fiche produit
 *   modal:close      —                  — fermer modal
 *   cart:update      —                  — panier mis à jour (badge sync) [émis par updateCartBadge]
 *   side-cart:render —                  — forcer un re-rendu du side-cart desktop [ARCH-1]
 *   checkout:open    —                  — ouvrir la modale de commande [ARCH-1]
 *   product:open-from-cart { id }        — ouvrir fiche depuis le panier [ARCH-1]
 *   view:switch      { view }           — changer d'onglet (home/favs/suivi)
 *   cat:select       { cat }            — filtrer catalogue sur catégorie [b-modal → b-catalog]
 *   chip:center      { chip }           — centrer chip active dans le pager [b-pager → b-catalog]
 *   catalog:cat-changed { cat }         — catégorie active changée [b-catalog → b-desktop-upgrade]
 *
 * Événements retirés du JSDoc (déclarés mais jamais émis ni consommés) :
 *   cart:add, cart:open, cart:close, search:query, pager:navigate
 */

const _listeners = {};

export const bus = {
  /**
   * Abonne une fonction à un événement.
   * @param {string} event - Nom de l'événement
   * @param {Function} fn - Callback appelé avec les données de l'événement
   */
  on(event, fn) {
    (_listeners[event] = _listeners[event] || []).push(fn);
  },

  /**
   * Désabonne une fonction d'un événement.
   * @param {string} event - Nom de l'événement
   * @param {Function} fn - Même référence que celle passée à on()
   */
  off(event, fn) {
    if (_listeners[event]) {
      _listeners[event] = _listeners[event].filter(f => f !== fn);
    }
  },

  /**
   * Émet un événement et notifie tous les abonnés.
   * @param {string} event - Nom de l'événement
   * @param {*} [data] - Données passées aux callbacks
   */
  emit(event, data) {
    (_listeners[event] || []).forEach(fn => {
      try { fn(data); } catch(e) { console.error('[bus] handler error', event, e); }
    });
  },

  /**
   * Abonne une fonction à un seul déclenchement (one-shot).
   * @param {string} event - Nom de l'événement
   * @param {Function} fn - Callback one-shot
   */
  once(event, fn) {
    const wrapper = (data) => { fn(data); this.off(event, wrapper); };
    this.on(event, wrapper);
  },
};

// Expose pour debug en dev/local uniquement (pas en prod)
if (
  typeof window !== 'undefined' &&
  window.location &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
) {
  window._kbus = bus;
}

