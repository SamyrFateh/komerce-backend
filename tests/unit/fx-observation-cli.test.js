'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const mockSvc = { enterObservation: jest.fn(), approveObservation: jest.fn(), listObservations: jest.fn() };
jest.mock('../../services/fx-observation-service', () => mockSvc);
const { main } = require('../../scripts/fx-observation-cli');

beforeEach(() => Object.values(mockSvc).forEach(f => f.mockReset().mockResolvedValue({ ok: true })));

describe('fx-observation-cli', () => {
  test('enter : transmet taux, source, date et identité explicites (aucun défaut)', async () => {
    await main(['enter', '--by', 'alice@komerce.km', '--rate', '1.0850', '--as-of', '2026-10-21T14:15:00Z', '--source', 'BCE', '--ref', 'ecb:1']);
    expect(mockSvc.enterObservation).toHaveBeenCalledWith({
      rate: '1.0850', sourceLabel: 'BCE', sourceRef: 'ecb:1', asOf: '2026-10-21T14:15:00Z', enteredBy: 'alice@komerce.km',
    });
  });

  test('enter sans arguments : le service reçoit undefined et refuse (pas de taux par défaut)', async () => {
    await main(['enter']);
    expect(mockSvc.enterObservation).toHaveBeenCalledWith(expect.objectContaining({ rate: undefined, asOf: undefined, enteredBy: undefined }));
  });

  test('approve et list', async () => {
    await main(['approve', '--by', 'bob@komerce.km', '--id', 'o1']);
    expect(mockSvc.approveObservation).toHaveBeenCalledWith({ id: 'o1', approvedBy: 'bob@komerce.km' });
    await main(['list']);
    expect(mockSvc.listObservations).toHaveBeenCalled();
  });

  test('commande inconnue : erreur d\'usage', async () => {
    await expect(main(['purge'])).rejects.toThrow(/Usage/);
  });
});
