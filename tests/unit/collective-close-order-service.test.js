'use strict';

/**
 * tests/unit/collective-close-order-service.test.js
 * Couvre services/collective-close-order-service.js
 *
 * Contexte : TOMBSTONE (2026-05-30). Le système collective_workspaces a été
 * démonté (routes/collective-workspaces.js → 410, front tombstoné). Ce service
 * backend est resté en stub no-op qui DOIT lever, pour empêcher qu'une
 * éventuelle ré-exposition de route ne réintroduise silencieusement le bug
 * payment_mode='collective' (valeur absente de l'enum).
 *
 * Ces tests verrouillent ce comportement : si quelqu'un restaure une vraie
 * implémentation sans lire le commentaire TOMBSTONE, ce test échouera et
 * forcera à confirmer intentionnellement le changement.
 */

const { createOrderFromReadyWorkspace } = require('../../services/collective-close-order-service');

describe('collective-close-order-service (TOMBSTONE)', () => {
  test('createOrderFromReadyWorkspace rejette systématiquement avec collective_workspace_disabled', async () => {
    await expect(createOrderFromReadyWorkspace()).rejects.toThrow('collective_workspace_disabled');
  });

  test('rejette même si des arguments sont fournis (aucun cas particulier réactivé)', async () => {
    await expect(
      createOrderFromReadyWorkspace({ workspaceId: 'ws-1', actor: { id: 'u1' } })
    ).rejects.toThrow('collective_workspace_disabled');
  });

  test('ne fait aucun effet de bord — export limité à la seule fonction attendue', () => {
    const mod = require('../../services/collective-close-order-service');
    expect(Object.keys(mod)).toEqual(['createOrderFromReadyWorkspace']);
    expect(typeof mod.createOrderFromReadyWorkspace).toBe('function');
  });
});
