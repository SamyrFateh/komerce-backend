'use strict';

/**
 * tests/unit/collective-ready-to-order-orchestrator.test.js
 *
 * Module #25 — js/collective-ready-to-order-orchestrator.js (38L)
 * TOMBSTONE (PR #486) : flow collectif legacy désactivé, stubs no-op.
 * require('../utils/logger') pointe hors du repo boutique (backend/utils/logger) →
 * mock virtuel obligatoire pour pouvoir require() le module en isolation.
 */

jest.mock(
  '../../utils/logger',
  () => ({
    child: jest.fn(() => ({ warn: jest.fn() })),
  }),
  { virtual: true }
);

describe('collective-ready-to-order-orchestrator (tombstone)', () => {
  let orchestrator;
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    const logger = require('../../utils/logger');
    warnSpy = jest.fn();
    logger.child.mockReturnValue({ warn: warnSpy });
    orchestrator = require('../../js/collective-ready-to-order-orchestrator.js');
  });

  it('exporte les 4 fonctions stub attendues', () => {
    expect(typeof orchestrator.onPaymentAuthorized).toBe('function');
    expect(typeof orchestrator.confirmCashContribution).toBe('function');
    expect(typeof orchestrator.markSessionReadyToOrder).toBe('function');
    expect(typeof orchestrator.closeReadyToOrderByCreator).toBe('function');
  });

  it('onPaymentAuthorized(...) → { ignored: true, reason } sans appeler de logique métier', async () => {
    const result = await orchestrator.onPaymentAuthorized({ sessionId: 'x' });
    expect(result).toEqual({ ignored: true, reason: 'collective_workspace_disabled' });
  });

  it('confirmCashContribution(...) → no-op identique', async () => {
    const result = await orchestrator.confirmCashContribution('a', 'b', 'c');
    expect(result).toEqual({ ignored: true, reason: 'collective_workspace_disabled' });
  });

  it('markSessionReadyToOrder(...) → no-op identique', async () => {
    const result = await orchestrator.markSessionReadyToOrder({});
    expect(result).toEqual({ ignored: true, reason: 'collective_workspace_disabled' });
  });

  it('closeReadyToOrderByCreator(...) → no-op identique', async () => {
    const result = await orchestrator.closeReadyToOrderByCreator({});
    expect(result).toEqual({ ignored: true, reason: 'collective_workspace_disabled' });
  });

  it('chaque appel logge un warn via logger.child(...).warn avec le nom de la fonction', async () => {
    await orchestrator.markSessionReadyToOrder();
    expect(warnSpy).toHaveBeenCalledWith(
      { fn: 'markSessionReadyToOrder' },
      'collective workspace disabled — no-op'
    );
  });

  it('ignore silencieusement les arguments fournis (aucun ne doit faire throw)', async () => {
    await expect(orchestrator.onPaymentAuthorized(undefined)).resolves.toBeDefined();
    await expect(orchestrator.confirmCashContribution(1, 2, 3, 4)).resolves.toBeDefined();
  });
});
