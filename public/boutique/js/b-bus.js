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
 *   cart:add         { product, qty }   — ajouter au panier
 *   cart:update      —                  — panier mis à jour (badge sync)
 *   cart:open        —                  — ouvrir tiroir panier
 *   cart:close       —                  — fermer tiroir panier
 *   view:switch      { view }           — changer d'onglet (home/favs/suivi)
 *   search:query     { q }             — lancer recherche
 *   pager:navigate   { cat }           — naviguer vers catégorie Temu
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

// Expose pour debug en dev (pas en prod)
if (typeof window !== 'undefined') window._kbus = bus;
