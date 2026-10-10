'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/markets-decision-bootstrap.js'), 'utf8');

describe('markets-decision-bootstrap — ordre de la page Accès pays', () => {
  test('la vue décision (Hero) ouvre la page : elle est préposée, pas insérée après l’en-tête d’accès', () => {
    expect(SRC).toContain('root.prepend(host)');
    expect(SRC).not.toContain('insertAfter(hero, host)');
  });

  test('le bootstrap reste en lecture seule (aucune mutation)', () => {
    expect(SRC).not.toMatch(/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  });
});
