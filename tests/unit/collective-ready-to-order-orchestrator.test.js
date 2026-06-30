'use strict';

/**
 * tests/unit/collective-ready-to-order-orchestrator.test.js
 * Couvre services/collective-ready-to-order-orchestrator.js
 *
 * TOMBSTONE — le module collective_workspaces a été démonté (2026-05-30).
 * Les 4 exports sont des stubs no-op qui rejettent systématiquement
 * avec l'erreur 'collective_workspace_disabled', préservés uniquement
 * pour ne pas casser des require() résiduels.
 */
const {
  onPaymentAuthorized,
  confirmCashContribution,
  markSessionReadyToOrder,
  closeReadyToOrderByCreator,
} = require('../../services/collective-ready-to-order-orchestrator');

describe('collective-ready-to-order-orchestrator (tombstone)', () => {
  it('markSessionReadyToOrder → rejette avec collective_workspace_disabled', async () => {
    await expect(markSessionReadyToOrder()).rejects.toThrow('collective_workspace_disabled');
  });

  it('onPaymentAuthorized → rejette avec collective_workspace_disabled', async () => {
    await expect(onPaymentAuthorized()).rejects.toThrow('collective_workspace_disabled');
  });

  it('confirmCashContribution → rejette avec collective_workspace_disabled', async () => {
    await expect(confirmCashContribution()).rejects.toThrow('collective_workspace_disabled');
  });

  it('closeReadyToOrderByCreator → rejette avec collective_workspace_disabled', async () => {
    await expect(closeReadyToOrderByCreator()).rejects.toThrow('collective_workspace_disabled');
  });

  it('rejette de la meme facon quels que soient les arguments passes (stub no-op)', async () => {
    await expect(markSessionReadyToOrder('session-1', { foo: 'bar' })).rejects.toThrow('collective_workspace_disabled');
    await expect(onPaymentAuthorized('a', 'b', 'c')).rejects.toThrow('collective_workspace_disabled');
  });

  it('toutes les fonctions exportees sont async (retournent une Promise)', () => {
    const p1 = markSessionReadyToOrder().catch(() => {});
    const p2 = onPaymentAuthorized().catch(() => {});
    const p3 = confirmCashContribution().catch(() => {});
    const p4 = closeReadyToOrderByCreator().catch(() => {});
    expect(p1).toBeInstanceOf(Promise);
    expect(p2).toBeInstanceOf(Promise);
    expect(p3).toBeInstanceOf(Promise);
    expect(p4).toBeInstanceOf(Promise);
    return Promise.all([p1, p2, p3, p4]);
  });
});
