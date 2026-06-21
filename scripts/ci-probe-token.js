'use strict';
/**
 * @komerce-arch
 * @role          ci-probe-token-generator
 * @domain        governance
 * @layer         tooling
 * @criticality   low
 * @inputs        DATABASE_URL, JWT_SECRET
 * @outputs       admin_jwt (stdout)
 * @depends       tests/integration/test-harness/seed-helpers.js
 * @doctrine      ci_only_never_prod
 * @version       2026-06
 */

/**
 * Génère un token admin pour la sonde de conformité P4-1 (Schemathesis).
 * Réutilise le harness d'intégration éprouvé (createUser + tokenFor).
 * CI uniquement : insère un utilisateur de test dans la base jetable.
 * Imprime UNIQUEMENT le token sur stdout (pour capture shell).
 */
const { createUser, tokenFor } = require('../tests/integration/test-harness/seed-helpers');

(async () => {
  try {
    const admin = await createUser({ role: 'admin' });
    process.stdout.write(tokenFor(admin.id));
    process.exit(0);
  } catch (err) {
    process.stderr.write('ci-probe-token failed: ' + (err && err.message) + '\n');
    process.exit(1);
  }
})();
