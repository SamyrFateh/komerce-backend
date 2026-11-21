'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Contrat de sécurité des projections mises à jour en arrière-plan :
 * une erreur réseau/5xx peut conserver un instantané clairement périmé,
 * un 401/403 doit remplacer immédiatement la dernière vue sensible.
 */
const fs = require('node:fs');
const path = require('node:path');

describe.each(['pilotage', 'commerce', 'orders', 'operations', 'finance'])(
  'Dashboard canonical %s — révocation des droits au refresh',
  (name) => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../public/dashboards/canonical/js/', name + '.js'), 'utf8');
    test('propage le statut HTTP et efface une ancienne projection lors du refus', () => {
      expect(source).toContain('error.status = response.status;');
      expect(source).toContain('error.status === 401 || error.status === 403');
      expect(source).toContain('Accès expiré ou non autorisé. Rechargez votre session.');
      expect(source).toContain('hasData = false;');
      expect(source).toContain("'data-dashboard-stale'");
    });
  }
);
