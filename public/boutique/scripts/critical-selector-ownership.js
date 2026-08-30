'use strict';

/**
 * Machine-readable ownership contract for critical Boutique CSS selectors.
 *
 * Doctrine: one semantic principal owner; only explicitly named contextual
 * adaptations may touch the same literal selector. Reducing adaptations is
 * allowed. Adding a new owner is not.
 */
const CRITICAL_SELECTOR_OWNERSHIP = Object.freeze({
  '.k-chip': Object.freeze({
    principal: 'categories.css',
    allowed: Object.freeze(['categories.css', 'interactions.css']),
  }),
  '.k-cats-shell': Object.freeze({
    principal: 'categories.css',
    allowed: Object.freeze(['categories.css', 'boutique-desktop.css']),
  }),
  '.k-hero-cats-sticky': Object.freeze({
    principal: 'hero.css',
    allowed: Object.freeze(['hero.css', 'categories.css']),
  }),
  '#k-subcats-wrap': Object.freeze({
    principal: 'boutique-desktop.css',
    allowed: Object.freeze(['boutique-desktop.css', 'categories.css']),
  }),
  '.k-subchip': Object.freeze({
    principal: 'boutique-desktop.css',
    allowed: Object.freeze(['boutique-desktop.css', 'categories.css']),
  }),
  '.k-grid': Object.freeze({
    principal: 'products.css',
    allowed: Object.freeze(['products.css', 'cart.css', 'layout.css']),
  }),
  '.k-card': Object.freeze({
    principal: 'products.css',
    allowed: Object.freeze(['products.css', 'categories.css', 'boutique-desktop.css']),
  }),
  '.k-card-add': Object.freeze({
    principal: 'products.css',
    allowed: Object.freeze(['products.css', 'cart.css']),
  }),
  '.k-card-fav': Object.freeze({
    principal: 'products.css',
    allowed: Object.freeze(['products.css', 'cart.css']),
  }),
  '.k-side-cart': Object.freeze({
    principal: 'layout.css',
    allowed: Object.freeze(['layout.css', 'boutique-desktop.css']),
  }),
  '#k-desktop-catalog-wrap': Object.freeze({
    principal: 'layout.css',
    allowed: Object.freeze(['layout.css']),
  }),
  '.k-header': Object.freeze({
    principal: 'layout.css',
    allowed: Object.freeze(['layout.css', 'mobile-shell-convergence.css']),
  }),
  '.k-hero-media': Object.freeze({
    principal: 'hero.css',
    allowed: Object.freeze(['hero.css', 'hero-ultra-mobile.css', 'mobile-catalog-convergence.css']),
  }),
  '.k-modal': Object.freeze({
    principal: 'modal-shell.css',
    allowed: Object.freeze(['modal-shell.css', 'modal-product.css']),
  }),
});

function evaluateSelectorOwnership(selectorMap, trackedSelectors = Object.keys(CRITICAL_SELECTOR_OWNERSHIP)) {
  const errors = [];
  const rows = [];
  const tracked = new Set(trackedSelectors);
  const contracted = new Set(Object.keys(CRITICAL_SELECTOR_OWNERSHIP));

  for (const selector of tracked) {
    if (!contracted.has(selector)) {
      errors.push({ type: 'missing-contract', selector, message: `${selector}: sélecteur suivi sans contrat d'ownership` });
    }
  }
  for (const selector of contracted) {
    if (!tracked.has(selector)) {
      errors.push({ type: 'untracked-contract', selector, message: `${selector}: contrat d'ownership non suivi par le LIVE` });
    }
  }

  for (const selector of trackedSelectors) {
    const contract = CRITICAL_SELECTOR_OWNERSHIP[selector];
    if (!contract) continue;
    const observed = (selectorMap[selector] || []).map(row => row.file);
    const observedSet = new Set(observed);
    const allowedSet = new Set(contract.allowed);

    if (!observedSet.has(contract.principal)) {
      errors.push({
        type: 'missing-principal',
        selector,
        file: contract.principal,
        message: `${selector}: owner principal absent (${contract.principal})`,
      });
    }

    for (const file of observed) {
      if (!allowedSet.has(file)) {
        errors.push({
          type: 'unauthorized-owner',
          selector,
          file,
          message: `${selector}: owner non autorisé (${file})`,
        });
      }
    }

    rows.push({ selector, principal: contract.principal, allowed: [...contract.allowed], observed });
  }

  return { errors, rows, ok: errors.length === 0 };
}

module.exports = { CRITICAL_SELECTOR_OWNERSHIP, evaluateSelectorOwnership };
