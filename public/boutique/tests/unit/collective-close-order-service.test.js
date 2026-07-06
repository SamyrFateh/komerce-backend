'use strict';

/**
 * tests/unit/collective-close-order-service.test.js
 *
 * Lot 3 — js/collective-close-order-service.js (28L)
 * TOMBSTONE (PR #486) : flow collectif legacy désactivé. Un seul export,
 * `createOrderFromReadyWorkspace`, réduit à un throw systématique. Pas de
 * dépendance externe (contrairement à collective-ready-to-order-orchestrator.js
 * qui require('../utils/logger')) → pas de jest.mock nécessaire ici.
 */

const { createOrderFromReadyWorkspace } = require('../../js/collective-close-order-service.js');

describe('collective-close-order-service (tombstone)', () => {
  it('exporte createOrderFromReadyWorkspace comme fonction', () => {
    expect(typeof createOrderFromReadyWorkspace).toBe('function');
  });

  it('rejette systématiquement avec collective_workspace_disabled, sans argument', async () => {
    await expect(createOrderFromReadyWorkspace()).rejects.toThrow('collective_workspace_disabled');
  });

  it('rejette de la même façon quels que soient les arguments passés', async () => {
    await expect(
      createOrderFromReadyWorkspace({ workspaceId: 'w1' }, 'extra', 42)
    ).rejects.toThrow('collective_workspace_disabled');
  });
});
