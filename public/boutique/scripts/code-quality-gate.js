#!/usr/bin/env node
/**
 * code-quality-gate.js — Komerce Boutique Code Quality Gate
 *
 * Wrapper mince : toute la logique (scan, N2-STRICT, N2-NO-VAR, --fix, --strict)
 * vit dans scripts/lib/code-quality-gate-core.js, partagée avec dashboards/ et
 * public/scripts/. Ne pas dupliquer la logique ici — un correctif futur doit
 * aller dans le core pour bénéficier automatiquement aux 3 emplacements.
 *
 * Usage :
 *   node scripts/code-quality-gate.js              rapport
 *   node scripts/code-quality-gate.js --strict      exit 1 si violations
 *   node scripts/code-quality-gate.js --fix         auto-fix use strict
 */
'use strict';

const path = require('path');
const core = require('../../../scripts/lib/code-quality-gate-core.js');

if (require.main === module) {
  core.run({ root: path.join(__dirname, '..'), label: 'BOUTIQUE' });
}

module.exports = core;
