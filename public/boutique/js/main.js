/**
 * @module main
 * @brief Point d'entrée ES module de la boutique Komerce.
 *
 * Ordre de chargement :
 *   1. b-utils.js   → expose window.KUtils (compat) + named exports
 *   2. b-bus.js     → event bus partagé
 *   3. b-store.js   → state + SUBCATS + dom
 *   4. boutique.js  → logique applicative (en cours de migration)
 *
 * Architecture cible (après toutes les phases) :
 *   main.js importe tous les modules b-*.js
 *   boutique.js = §13 INIT uniquement (~150 lignes)
 *
 * Feuille de route :
 *   Phase 1 ✅  Fondations (ce fichier)
 *   Phase 2     boutique.js → retire IIFE, ajoute imports
 *   Phase 3     b-cart-core.js extrait (§3)
 *   Phase 4     b-catalog.js extrait (§4+6+8)
 *   Phase 5     b-modal.js extrait (§9)
 *   Phase 6     b-cart.js + b-pager.js extraits (§7+10+14+15)
 *   Phase 7     boutique.js = §13 INIT seulement
 */

// ── IMPORTS FONDATIONS ────────────────────────────────────
import './b-utils.js';        // helpers purs + window.KUtils compat
import { bus }       from './b-bus.js';
import { initDom, updateMobileScrollTop } from './b-store.js';

// ── IMPORTS MODULES (activés au fur et à mesure des phases) ─
// Phase 3  → import './b-cart-core.js';
// Phase 4  → import './b-catalog.js';
// Phase 5  → import './b-modal.js';
// Phase 6  → import './b-cart.js';
// Phase 6  → import './b-pager.js';

// ── BOOT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 1. Cache DOM
  initDom();

  // 2. Scroll top mobile (hero fixed)
  updateMobileScrollTop();
  window.addEventListener('resize', updateMobileScrollTop, { passive: true });

  // 3. Broadcast boot (modules peuvent s'y abonner)
  bus.emit('app:boot');
});

// Expose bus globalement pour debug + usage depuis attributs HTML inline
if (typeof window !== 'undefined') window._kbus = bus;
