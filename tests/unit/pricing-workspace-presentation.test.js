'use strict';

const presentation = require('../../public/dashboards/canonical/js/pricing-workspace-presentation');

describe('Pricing workshop presentation', () => {
  test('classe les coûts selon les étages N1/N2/N3 sans recalcul métier', () => {
    expect(presentation.groupKey({ family: 'landed_relay', category: 'freight' })).toBe('n1');
    expect(presentation.groupKey({ family: 'business', category: 'payment' })).toBe('n2');
    expect(presentation.groupKey({ family: 'business', category: 'fixed_overhead' })).toBe('n3');
    expect(presentation.groupKey({ family: 'exceptional', category: 'incident' })).toBe('exceptional');
  });

  test('présente des libellés métier lisibles', () => {
    expect(presentation.categoryLabel('port_transitary')).toBe('Port & transitaire');
    expect(presentation.categoryLabel('risk_provision')).toBe('Provision de risque');
    expect(presentation.unitLabel('kmf_per_order')).toBe('KMF / commande');
    expect(presentation.unitLabel('pct')).toBe('% du montant');
  });

  test('groupe les composants dans l’ordre pédagogique N1, N2, N3, exceptionnel', () => {
    const groups = presentation.groupComponents([
      { key: 'fixed', family: 'business', category: 'fixed_overhead' },
      { key: 'freight', family: 'landed_relay', category: 'freight' },
      { key: 'risk', family: 'business', category: 'risk_provision' },
      { key: 'incident', family: 'exceptional', category: 'incident' },
    ]);

    expect(groups.map(group => group.key)).toEqual(['n1', 'n2', 'n3', 'exceptional']);
    expect(groups.map(group => group.components[0].key)).toEqual(['freight', 'risk', 'fixed', 'incident']);
  });
});
