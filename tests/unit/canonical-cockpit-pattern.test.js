'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const cockpit = require('../../public/dashboards/canonical/js/cockpit-pattern');

describe('Canonical cockpit pattern V1', () => {
  test('expose la grammaire commune sans calcul métier', () => {
    expect(cockpit.contractKeys()).toEqual([
      'situation', 'flow', 'decisions', 'exceptions', 'drilldowns', 'history',
    ]);

    const decisions = [{ key: 'server-signal', value: 3, tone: 'warning' }];
    const model = cockpit.buildPresentationModel({
      domain: 'operations',
      title: 'Opérations',
      decisions,
      flow: [{ label: 'Transit' }],
    });

    expect(model.domain).toBe('operations');
    expect(model.decisions).toEqual(decisions);
    expect(model.flow).toEqual([{ label: 'Transit' }]);
    expect(model.exceptions).toEqual([]);
  });

  test.each(['pilotage', 'commerce', 'operations', 'finance', 'catalog', 'imports', 'markets'])(
    '%s possède une définition de cockpit',
    domain => {
      expect(cockpit.domainDefinition(domain)).toEqual(expect.objectContaining({
        label: expect.any(String),
        purpose: expect.any(String),
      }));
    }
  );

  test('refuse un domaine inconnu au lieu d inventer une projection', () => {
    expect(() => cockpit.buildPresentationModel({ domain: 'unknown' }))
      .toThrow(/canonical_cockpit_unknown_domain/);
  });

  test('decorateDashboard ne change pas le contenu, seulement le contrat de présentation', () => {
    const attrs = {};
    const node = {
      className: 'kmc-dashboard kmc-decision-dashboard',
      setAttribute(name, value) { attrs[name] = value; },
    };

    cockpit.decorateDashboard(node, 'finance');

    expect(node.className).toContain('kmc-domain-cockpit');
    expect(attrs).toEqual({
      'data-cockpit-pattern': 'v1',
      'data-cockpit-domain': 'finance',
      'data-cockpit-language': 'legacy',
    });
  });
});
