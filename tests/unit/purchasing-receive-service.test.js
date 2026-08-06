'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — purchasing-receive-service (A-BE-05)
 *
 * Extrait de tests/unit/purchasing.test.js (audit 2026-07-07, gap
 * files.tests/features/orders.feature.js) : le fichier était déjà couvert
 * par ces tests, mais sous un nom de fichier ("purchasing.test.js") que la
 * convention testBaseKey() de feature-guard.js ne rattache pas à
 * "purchasing-receive-service" — d'où le faux "pas de test déclaré".
 * Extraction en fichier dédié pour aligner avec la convention déjà en
 * place pour purchasing-trigger-service.test.js, plutôt que dupliquer.
 *
 * Chemins couverts :
 *   processReceive :
 *     □ PO introuvable → httpError 404
 *     □ déjà reçue en totalité → httpError 400
 *     □ réception partielle → po_status partially_received, order reste ordered
 *     □ réception totale → transitionOrderStatus appelé, ready_to_prepare = true
 *     □ transitionOrderStatus échoue → httpError 409
 *     □ transitionOrderStatus noop → réception validée quand même
 *     □ triggerScan3 échoue (SMS) → réception validée quand même
 */

// ─── Mocks globaux ────────────────────────────────────────────────────────────

let mockDbQuery = jest.fn();

jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

// O7.2 (Cycle C) : le service importe directement services/scan-operations.js.
// Le mock exporte donc la même fonction jest.fn que celle observée par les
// assertions, sans module virtuel ni wrapper intermédiaire.
jest.mock('../../services/scan-operations', () => ({
  triggerScan3: jest.fn(),
}));
const { triggerScan3: mockTriggerScan3 } = require('../../services/scan-operations');

// ─── Require service après les mocks ─────────────────────────────────────────
const { processReceive } = require('../../services/purchasing-receive-service');

beforeEach(() => {
  jest.clearAllMocks();
  mockTriggerScan3.mockResolvedValue({});
});

describe('processReceive', () => {
  test('PO introuvable → httpError 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const result = await processReceive({ id: 'unknown', qty_recue: null, actor: null });
    expect(result.httpError).toEqual({ error: 'PO introuvable', status: 404 });
  });

  test('déjà reçue en totalité → httpError 400', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'po-1', order_id: 'ord-1', qty: 2, received_qty: 2, status: 'received', hub_received_at: new Date() }],
    });
    const result = await processReceive({ id: 'po-1', qty_recue: null, actor: null });
    expect(result.httpError).toEqual({ error: 'Quantité déjà reçue en totalité', status: 400 });
  });

  test('réception partielle → partially_received, order reste ordered, transitionOrderStatus non appelé', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', order_id: 'ord-1', qty: 3, received_qty: 0, status: 'pending', hub_received_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', status: 'partially_received' }] })
      .mockResolvedValueOnce({ rows: [{ total: '2', recus: '0', qty_totale: '6', qty_recue: '1' }] });

    const result = await processReceive({ id: 'po-1', qty_recue: 1, actor: { id: 'u1', role: 'admin' } });

    expect(result.httpError).toBeUndefined();
    expect(result.ready_to_prepare).toBe(false);
    expect(result.order_status).toBe('ordered');
    expect(mockTransitionOrderStatus).not.toHaveBeenCalled();
  });

  test('réception totale → received, transitionOrderStatus appelé, ready_to_prepare = true', async () => {
    mockTransitionOrderStatus.mockResolvedValue({ success: true });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', order_id: 'ord-1', qty: 2, received_qty: 0, status: 'pending', hub_received_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', status: 'received' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1', recus: '1', qty_totale: '2', qty_recue: '2' }] });

    const result = await processReceive({ id: 'po-1', qty_recue: null, actor: { id: 'u1', role: 'admin' } });

    expect(result.ready_to_prepare).toBe(true);
    expect(result.order_status).toBe('preparation');
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'ord-1',
      newStatus: 'preparation',
    }));
    expect(mockTriggerScan3).toHaveBeenCalledWith('ord-1', 'u1');
  });

  test('transitionOrderStatus échoue (non-noop) → httpError 409', async () => {
    mockTransitionOrderStatus.mockResolvedValue({ success: false, noop: false, error: 'Transition invalide' });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', order_id: 'ord-1', qty: 2, received_qty: 0, status: 'pending', hub_received_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', status: 'received' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1', recus: '1', qty_totale: '2', qty_recue: '2' }] });

    const result = await processReceive({ id: 'po-1', qty_recue: null, actor: null });
    expect(result.httpError).toEqual({ error: 'Transition invalide', status: 409 });
  });

  test('transitionOrderStatus noop (déjà au bon statut) → pas de httpError, réception validée quand même', async () => {
    mockTransitionOrderStatus.mockResolvedValue({ success: false, noop: true });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', order_id: 'ord-1', qty: 2, received_qty: 0, status: 'pending', hub_received_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', status: 'received' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1', recus: '1', qty_totale: '2', qty_recue: '2' }] });

    const result = await processReceive({ id: 'po-1', qty_recue: null, actor: { id: 'u1', role: 'admin' } });

    expect(result.httpError).toBeUndefined();
    expect(result.ready_to_prepare).toBe(true);
    expect(mockTriggerScan3).toHaveBeenCalledWith('ord-1', 'u1');
  });

  test('triggerScan3 échoue (SMS) → réception validée quand même, erreur SMS avalée', async () => {
    mockTransitionOrderStatus.mockResolvedValue({ success: true });
    mockTriggerScan3.mockRejectedValueOnce(new Error('SMS gateway down'));
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', order_id: 'ord-1', qty: 2, received_qty: 0, status: 'pending', hub_received_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', status: 'received' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1', recus: '1', qty_totale: '2', qty_recue: '2' }] });

    const result = await processReceive({ id: 'po-1', qty_recue: null, actor: { id: 'u1', role: 'admin' } });

    expect(result.httpError).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.ready_to_prepare).toBe(true);
  });
});
