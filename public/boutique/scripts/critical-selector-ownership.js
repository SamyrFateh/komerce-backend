'use strict';

/**
 * Machine-readable ownership contract for critical Boutique CSS selectors.
 *
 * Doctrine: one semantic principal owner; only explicitly named contextual
 * adaptations may touch the same literal selector. Contexts are capabilities:
 * removing an adaptation/context is allowed, adding one is not.
 */
const BASE = 'base';
const DESKTOP = 'desktop';

const CRITICAL_SELECTOR_OWNERSHIP = Object.freeze({
  '.k-chip': Object.freeze({
    principal: 'categories.css',
    owners: Object.freeze({
      'categories.css': Object.freeze([BASE, DESKTOP]),
      'interactions.css': Object.freeze([BASE]),
    }),
  }),
  '.k-cats-shell': Object.freeze({
    principal: 'categories.css',
    owners: Object.freeze({
      'categories.css': Object.freeze([BASE, DESKTOP]),
      'boutique-desktop.css': Object.freeze([DESKTOP]),
    }),
  }),
  '.k-hero-cats-sticky': Object.freeze({
    principal: 'hero.css',
    owners: Object.freeze({
      'hero.css': Object.freeze([BASE, DESKTOP]),
      'categories.css': Object.freeze([DESKTOP]),
    }),
  }),
  '#k-subcats-wrap': Object.freeze({
    principal: 'boutique-desktop.css',
    owners: Object.freeze({
      'boutique-desktop.css': Object.freeze([BASE, DESKTOP]),
      'categories.css': Object.freeze([BASE]),
      'responsive-desktop-matrix.css': Object.freeze([DESKTOP]),
    }),
  }),
  '.k-subchip': Object.freeze({
    principal: 'boutique-desktop.css',
    owners: Object.freeze({
      'boutique-desktop.css': Object.freeze([BASE, DESKTOP]),
      'categories.css': Object.freeze([BASE]),
    }),
  }),
  '.k-grid': Object.freeze({
    principal: 'products.css',
    owners: Object.freeze({
      'products.css': Object.freeze([BASE, DESKTOP]),
      'cart.css': Object.freeze([BASE]),
      'layout.css': Object.freeze([DESKTOP]),
      'responsive-desktop-matrix.css': Object.freeze([DESKTOP]),
    }),
  }),
  '.k-sec-grid': Object.freeze({
    principal: 'products.css',
    owners: Object.freeze({
      'products.css': Object.freeze([BASE, DESKTOP]),
      'categories.css': Object.freeze([BASE, DESKTOP]),
      'responsive-desktop-matrix.css': Object.freeze([DESKTOP]),
    }),
  }),
  '.k-card': Object.freeze({
    principal: 'products.css',
    owners: Object.freeze({
      'products.css': Object.freeze([BASE, DESKTOP]),
      'categories.css': Object.freeze([BASE]),
      'boutique-desktop.css': Object.freeze([DESKTOP]),
    }),
  }),
  '.k-card-add': Object.freeze({
    principal: 'products.css',
    owners: Object.freeze({
      'products.css': Object.freeze([BASE, DESKTOP]),
      'cart.css': Object.freeze([DESKTOP]),
    }),
  }),
  '.k-card-fav': Object.freeze({
    principal: 'products.css',
    owners: Object.freeze({
      'products.css': Object.freeze([BASE, DESKTOP]),
      'cart.css': Object.freeze([DESKTOP]),
    }),
  }),
  '.k-side-cart': Object.freeze({
    principal: 'layout.css',
    owners: Object.freeze({
      'layout.css': Object.freeze([BASE]),
      'boutique-desktop.css': Object.freeze([DESKTOP]),
      'responsive-desktop-matrix.css': Object.freeze([DESKTOP]),
    }),
  }),
  '#k-desktop-catalog-wrap': Object.freeze({
    principal: 'layout.css',
    owners: Object.freeze({
      'layout.css': Object.freeze([BASE, DESKTOP]),
    }),
  }),
  '.k-header': Object.freeze({
    principal: 'layout.css',
    owners: Object.freeze({
      'layout.css': Object.freeze([BASE, DESKTOP]),
      'mobile-shell-convergence.css': Object.freeze([BASE]),
    }),
  }),
  '.k-hero-media': Object.freeze({
    principal: 'hero.css',
    owners: Object.freeze({
      'hero.css': Object.freeze([BASE, DESKTOP]),
      'hero-ultra-mobile.css': Object.freeze([BASE]),
      'mobile-catalog-convergence.css': Object.freeze([BASE]),
    }),
  }),
  '.k-modal': Object.freeze({
    principal: 'modal-shell.css',
    owners: Object.freeze({
      'modal-shell.css': Object.freeze([BASE, DESKTOP]),
      'modal-product.css': Object.freeze([DESKTOP]),
    }),
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
    const observedRows = selectorMap[selector] || [];
    const observedFiles = observedRows.map(row => row.file);
    const observedSet = new Set(observedFiles);
    const allowedFiles = new Set(Object.keys(contract.owners));

    if (!observedSet.has(contract.principal)) {
      errors.push({
        type: 'missing-principal',
        selector,
        file: contract.principal,
        message: `${selector}: owner principal absent (${contract.principal})`,
      });
    }

    for (const row of observedRows) {
      const allowedContexts = contract.owners[row.file];
      if (!allowedFiles.has(row.file)) {
        errors.push({
          type: 'unauthorized-owner',
          selector,
          file: row.file,
          message: `${selector}: owner non autorisé (${row.file})`,
        });
        continue;
      }
      if (row.base > 0 && !allowedContexts.includes(BASE)) {
        errors.push({
          type: 'unauthorized-context',
          selector,
          file: row.file,
          context: BASE,
          message: `${selector}: ${row.file} n'est pas autorisé en contexte base`,
        });
      }
      if (row.desktop > 0 && !allowedContexts.includes(DESKTOP)) {
        errors.push({
          type: 'unauthorized-context',
          selector,
          file: row.file,
          context: DESKTOP,
          message: `${selector}: ${row.file} n'est pas autorisé en contexte desktop`,
        });
      }
    }

    rows.push({
      selector,
      principal: contract.principal,
      allowed: Object.entries(contract.owners).map(([file, contexts]) => ({ file, contexts: [...contexts] })),
      observed: observedRows.map(row => ({ ...row })),
    });
  }

  return { errors, rows, ok: errors.length === 0 };
}

module.exports = {
  BASE,
  DESKTOP,
  CRITICAL_SELECTOR_OWNERSHIP,
  evaluateSelectorOwnership,
};
