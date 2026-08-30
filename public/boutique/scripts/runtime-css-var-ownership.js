'use strict';

/**
 * Machine-readable ownership contract for CSS custom properties written by JS.
 *
 * Doctrine:
 * - one semantic principal producer per runtime variable;
 * - only explicitly named contextual producers may write it;
 * - each declared producer currently owns one write path (maxWrites=1);
 * - removing an optional contextual producer is allowed, adding/duplicating one is not.
 */
const RUNTIME_CSS_VAR_OWNERSHIP = Object.freeze({
  '--pager-top': Object.freeze({
    principal: 'js/b-pager.js',
    producers: Object.freeze({
      'js/b-pager.js': Object.freeze({ maxWrites: 1 }),
      'js/hero-bootstrap.js': Object.freeze({ maxWrites: 1 }),
    }),
  }),
  '--pager-h': Object.freeze({
    principal: 'js/b-pager.js',
    producers: Object.freeze({
      'js/b-pager.js': Object.freeze({ maxWrites: 1 }),
      'js/b-subcat.js': Object.freeze({ maxWrites: 1 }),
      'js/hero-bootstrap.js': Object.freeze({ maxWrites: 1 }),
    }),
  }),
  '--pager-w': Object.freeze({
    principal: 'js/b-pager.js',
    producers: Object.freeze({
      'js/b-pager.js': Object.freeze({ maxWrites: 1 }),
    }),
  }),
  '--bnav-h': Object.freeze({
    principal: 'js/b-pager.js',
    producers: Object.freeze({
      'js/b-pager.js': Object.freeze({ maxWrites: 1 }),
    }),
  }),
  '--modal-scroll-y': Object.freeze({
    principal: 'js/b-modal-core.js',
    producers: Object.freeze({
      'js/b-modal-core.js': Object.freeze({ maxWrites: 1 }),
    }),
  }),
});

function evaluateRuntimeCssVarOwnership(observedMap, trackedVars = Object.keys(RUNTIME_CSS_VAR_OWNERSHIP)) {
  const errors = [];
  const rows = [];
  const tracked = new Set(trackedVars);
  const contracted = new Set(Object.keys(RUNTIME_CSS_VAR_OWNERSHIP));

  for (const variable of tracked) {
    if (!contracted.has(variable)) {
      errors.push({
        type: 'missing-contract',
        variable,
        message: `${variable}: variable runtime suivie sans contrat d'ownership`,
      });
    }
  }
  for (const variable of contracted) {
    if (!tracked.has(variable)) {
      errors.push({
        type: 'untracked-contract',
        variable,
        message: `${variable}: contrat runtime non suivi par le LIVE`,
      });
    }
  }

  for (const variable of trackedVars) {
    const contract = RUNTIME_CSS_VAR_OWNERSHIP[variable];
    if (!contract) continue;

    const observedRows = observedMap[variable] || [];
    const observedByFile = new Map(observedRows.map(row => [row.file, row.count]));
    const allowedFiles = new Set(Object.keys(contract.producers));

    if (!observedByFile.has(contract.principal)) {
      errors.push({
        type: 'missing-principal',
        variable,
        file: contract.principal,
        message: `${variable}: producteur principal absent (${contract.principal})`,
      });
    }

    for (const row of observedRows) {
      if (!allowedFiles.has(row.file)) {
        errors.push({
          type: 'unauthorized-producer',
          variable,
          file: row.file,
          message: `${variable}: producteur JS non autorisé (${row.file})`,
        });
        continue;
      }
      const maxWrites = contract.producers[row.file].maxWrites;
      if (row.count > maxWrites) {
        errors.push({
          type: 'too-many-write-paths',
          variable,
          file: row.file,
          count: row.count,
          maxWrites,
          message: `${variable}: ${row.file} possède ${row.count} chemins d'écriture, maximum autorisé ${maxWrites}`,
        });
      }
    }

    rows.push({
      variable,
      principal: contract.principal,
      allowed: Object.entries(contract.producers).map(([file, policy]) => ({
        file,
        maxWrites: policy.maxWrites,
      })),
      observed: observedRows.map(row => ({ ...row })),
    });
  }

  return { errors, rows, ok: errors.length === 0 };
}

module.exports = {
  RUNTIME_CSS_VAR_OWNERSHIP,
  evaluateRuntimeCssVarOwnership,
};
