'use strict';

const presentation = require('../../public/dashboards/canonical/js/pricing-workspace-presentation');

describe('Pricing workshop presentation', () => {
  // Contrat canonique (commit 3930f8d4a, refactor(ui): present atelier by
  // variable fixed and mutualized charges) : le modèle à 3 étages
  // N1/N2/N3 a été remplacé par une classification nature (variable/fixed)
  // × périmètre d'allocation (direct/mutualized), cf. doctrine
  // charge_nature_is_distinct_from_allocation_perimeter dans l'en-tête du
  // module. landed_relay et business (hors fixed_overhead) sont désormais
  // tous deux "variable" ; seul fixed_overhead avec périmètre mutualisé
  // devient un groupe à part.
  test('classe les coûts selon nature (variable/fixe) et périmètre (direct/mutualisé), sans recalcul métier', () => {
    expect(presentation.groupKey({ family: 'landed_relay', category: 'freight' })).toBe('variable');
    expect(presentation.groupKey({ family: 'business', category: 'payment' })).toBe('variable');
    expect(presentation.groupKey({ family: 'business', category: 'fixed_overhead' })).toBe('fixed_direct');
    expect(presentation.groupKey({
      family: 'business', category: 'fixed_overhead',
      economic_nature: 'fixed', allocation_perimeter: 'mutualized',
    })).toBe('fixed_mutualized');
    expect(presentation.groupKey({ family: 'exceptional', category: 'incident' })).toBe('exceptional');
  });

  test('présente des libellés métier lisibles', () => {
    expect(presentation.categoryLabel('port_transitary')).toBe('Port & transitaire');
    expect(presentation.categoryLabel('risk_provision')).toBe('Provision de risque');
    expect(presentation.unitLabel('kmf_per_order')).toBe('KMF / commande');
    expect(presentation.unitLabel('pct')).toBe('% du montant');
  });

  test('groupe les composants dans l’ordre pédagogique variable, fixe direct, fixe mutualisé, exceptionnel', () => {
    const groups = presentation.groupComponents([
      { key: 'fixed', family: 'business', category: 'fixed_overhead' },
      { key: 'freight', family: 'landed_relay', category: 'freight' },
      { key: 'risk', family: 'business', category: 'risk_provision' },
      {
        key: 'hub', family: 'business', category: 'hub',
        economic_nature: 'fixed', allocation_perimeter: 'mutualized',
      },
      { key: 'incident', family: 'exceptional', category: 'incident' },
    ]);

    expect(groups.map(group => group.key)).toEqual(['variable', 'fixed_direct', 'fixed_mutualized', 'exceptional']);
    expect(groups.map(group => group.components[0].key)).toEqual(['freight', 'fixed', 'hub', 'incident']);
  });
});
