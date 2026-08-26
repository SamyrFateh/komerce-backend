'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const service = require('../../services/cost-component-admin-service');

beforeEach(() => jest.clearAllMocks());

test('résout un composant Canonical par sa clé métier', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-cc', key: 'freight_air' }] });
  await expect(service.resolveComponent({ key: 'freight_air' })).resolves.toEqual({ id: 'internal-cc', key: 'freight_air' });
  expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM cost_components WHERE key = $1', ['freight_air']);
});

test('création valide famille/catégorie avant toute écriture', async () => {
  await expect(service.createComponent({
    key: 'bad', label: 'Bad', family: 'business', category: 'freight', default_value: 1, unit: 'kmf',
  })).rejects.toMatchObject({ status: 400, code: 'cost_component_category_invalid' });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('mise à jour par clé conserve audit et acteur', async () => {
  const oldComp = {
    id: 'internal-cc', key: 'freight_air', family: 'landed_relay', category: 'freight',
    default_value: 1000, is_active: true, scope: 'global',
  };
  const updated = { ...oldComp, default_value: 1200 };
  mockQuery
    .mockResolvedValueOnce({ rows: [oldComp] })
    .mockResolvedValueOnce({ rows: [updated] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(service.updateComponent({ key: 'freight_air' }, { default_value: 1200 }, 'admin-1'))
    .resolves.toEqual(updated);
  expect(mockQuery.mock.calls[1][0]).toContain('UPDATE cost_components');
  expect(mockQuery.mock.calls[2][0]).toContain('INSERT INTO cost_component_events');
  expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['value_changed', 'admin-1']));
});

test('hard delete reste interdit pour un composant non supprimable', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-cc', key: 'freight_air', is_deletable: false }] });
  await expect(service.hardDeleteComponent({ key: 'freight_air' }, 'admin-1'))
    .rejects.toMatchObject({ status: 403, code: 'cost_component_not_deletable' });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});
