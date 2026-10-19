'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { getPricingParameterStatus } = require('../../services/pricing-parameters-status');

function mkDb({ fc, parities, fx, rel }) {
  return { query: jest.fn(async (sql) => {
    if (sql.includes('FROM finance_config')) return { rows: fc ? [fc] : [] };
    if (sql.includes('FROM currency_parities')) return { rows: parities || [] };
    if (sql.includes('FROM exchange_rates')) return { rows: fx ? [fx] : [] };
    if (sql.includes('FROM cost_components')) return { rows: rel ? [rel] : [] };
    return { rows: [] };
  }) };
}
const by = (r, k) => r.items.find(i => i.key === k);
const PAR = [
  { currency: 'KMF', eur_rate: '491.96775', source_note: 'Ancrage comorien' },
  { currency: 'XAF', eur_rate: '655.957', source_note: 'CEMAC' },
];

test('défauts du schéma : AED et commission non validés, EUR divergent de la parité documentée', async () => {
  const r = await getPricingParameterStatus(mkDb({
    fc: { taux_change_eur_kmf: '491.96', taux_aed_kmf: '138.00', commission_relais_standard_kmf: 500, updated_by: null },
    parities: PAR, rel: { default_value: '500', updated_by: null },
  }));
  expect(by(r, 'eur_kmf').status).toBe('divergent');
  expect(by(r, 'aed_kmf').status).toBe('default_unvalidated');
  expect(by(r, 'relay_commission_kmf').status).toBe('default_unvalidated');
  expect(by(r, 'xaf_parity').status).toBe('documented');
  expect(r.has_unvalidated).toBe(true);
  r.items.forEach(i => { expect(i.usage).toBeTruthy(); expect(i.consequence).toBeTruthy(); expect(i.config.role).toBe('admin'); });
});

test('AED saisi par un opérateur et présent au journal : saisi, source non vérifiée', async () => {
  const r = await getPricingParameterStatus(mkDb({
    fc: { taux_change_eur_kmf: '491.96775', taux_aed_kmf: '140.00', commission_relais_standard_kmf: 500, updated_by: 'u1' },
    parities: PAR, fx: { aed_kmf: '140.00', valid_from: '2026-10-01' }, rel: { default_value: '600', updated_by: 'u1' },
  }));
  expect(by(r, 'aed_kmf').status).toBe('operator_set');
  expect(by(r, 'eur_kmf').status).toBe('documented');
  expect(by(r, 'relay_commission_kmf').status).toBe('operator_set');
});

test('parités absentes : missing, jamais une valeur inventée', async () => {
  const r = await getPricingParameterStatus(mkDb({ fc: null, parities: [] }));
  expect(by(r, 'eur_kmf').status).toBe('missing');
  expect(by(r, 'xaf_parity').status).toBe('missing');
  expect(by(r, 'aed_kmf').status).toBe('missing');
  expect(by(r, 'aed_kmf').value).toBeNull();
});
