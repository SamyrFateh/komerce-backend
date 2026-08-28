/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires: order-status-machine.js (V2.5)
 *
 * Couvre:
 *   ✅ Matrice de transitions valides (patch)
 *   ✅ Transitions invalides rejetées
 *   ✅ Forward-only pour scan/system
 *   ✅ Idempotence (same status = noop)
 *   ✅ Rôles autorisés/refusés
 *   ✅ Pickup code generation on 'available'
 *   ✅ Paiement cash relais : pending → confirmed
 *   ✅ Cancel effects (wallet + stock)
 *   ✅ History logging (D6)
 *
 * Run: npx jest tests/unit/order-status-machine.test.js
 */

jest.mock('../../utils/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child, forModule: child };
});

// wallet-service et cancel-order-purchase-orders sont require()-és paresseusement
// (à l'intérieur de la fonction, uniquement sur la branche 'cancelled') — on les
// mocke pour isoler order-status-machine.js de leur logique propre.
// customs-shipment-service reste RÉEL (comportement simulé via les réponses
// mockQuery, cf. tests existants sur 'in_transit' → 'available').
jest.mock('../../services/wallet-service', () => ({
  removeFromOrder: jest.fn(),
  credit: jest.fn(),
}));
jest.mock('../../services/cancel-order-purchase-orders', () => ({
  syncPurchaseOrdersOnOrderCancel: jest.fn().mockResolvedValue({ cancelled: 0, alerted: 0 }),
}));

const walletService = require('../../services/wallet-service');
const { syncPurchaseOrdersOnOrderCancel } = require('../../services/cancel-order-purchase-orders');

const {
  transitionOrderStatus,
  ORDER_STATUSES,
  VALID_TRANSITIONS,
  TRANSITION_ROLES,
  STATUS_RANK,
  isForwardTransition,
} = require('../../services/order-status-machine');

// ── Mock DB ─────────────────────────────────────────────────────────────────

const mockOrder = {
  id: '00000000-0000-0000-0000-000000000001',
  status: 'confirmed',
  payment_mode: 'cash_relais',
  pickup_code: null,
};

const mockQuery = jest.fn();
const mockDb = { query: mockQuery };

// Reset mocks before each test
beforeEach(() => {
  mockQuery.mockReset();
  walletService.removeFromOrder.mockReset();
  walletService.credit.mockReset();
  syncPurchaseOrdersOnOrderCancel.mockReset();
  syncPurchaseOrdersOnOrderCancel.mockResolvedValue({ cancelled: 0, alerted: 0 });
});

// ── Helper to setup mock for a transition ───────────────────────────────────

function setupMockForTransition(currentStatus, opts = {}) {
  const order = { ...mockOrder, status: currentStatus, ...opts };

  // Call 1: SELECT order FOR UPDATE
  mockQuery.mockResolvedValueOnce({ rows: [order] });

  // Call 2 (in_transit only): customs gate SELECT — doit précéder l'UPDATE
  // isCustomsDeclaredForOrder() fait un SELECT supplémentaire avant l'UPDATE.
  // rows: [] = aucun colis en douane pending → allowed: true → gate passé.
  if (currentStatus === 'in_transit') {
    mockQuery.mockResolvedValueOnce({ rows: [] });
  }

  // Call 2/3: UPDATE orders SET status...
  mockQuery.mockResolvedValueOnce({ rows: [{}] });
  // Call 3+: Additional queries (cash_relais auto-paid, history, etc.)
  mockQuery.mockResolvedValue({ rows: [] }); // catch-all : historique, etc.

  return order;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pure function tests (no DB needed)
// ═══════════════════════════════════════════════════════════════════════════════

describe('isForwardTransition()', () => {
  test('confirmed → ordered is forward', () => {
    expect(isForwardTransition('confirmed', 'ordered')).toBe(true);
  });

  test('ordered → preparation is forward', () => {
    expect(isForwardTransition('ordered', 'preparation')).toBe(true);
  });

  test('preparation → confirmed is NOT forward (backward)', () => {
    expect(isForwardTransition('preparation', 'confirmed')).toBe(false);
  });

  test('collected → shipped is NOT forward (backward)', () => {
    expect(isForwardTransition('collected', 'shipped')).toBe(false);
  });

  test('any → cancelled is allowed (except collected/refunded)', () => {
    expect(isForwardTransition('confirmed', 'cancelled')).toBe(true);
    expect(isForwardTransition('shipped', 'cancelled')).toBe(true);
    expect(isForwardTransition('collected', 'cancelled')).toBe(false);
    expect(isForwardTransition('refunded', 'cancelled')).toBe(false);
  });

  test('cancelled → refunded is forward', () => {
    expect(isForwardTransition('cancelled', 'refunded')).toBe(true);
  });

  test('confirmed → refunded is NOT forward', () => {
    expect(isForwardTransition('confirmed', 'refunded')).toBe(false);
  });
});

describe('Constants integrity', () => {
  test('ORDER_STATUSES contains all expected statuses', () => {
    expect(ORDER_STATUSES).toContain('pending');
    expect(ORDER_STATUSES).toContain('confirmed');
    expect(ORDER_STATUSES).toContain('ordered');
    expect(ORDER_STATUSES).toContain('preparation');
    expect(ORDER_STATUSES).toContain('shipped');
    expect(ORDER_STATUSES).toContain('in_transit');
    expect(ORDER_STATUSES).toContain('available');
    expect(ORDER_STATUSES).toContain('collected');
    expect(ORDER_STATUSES).toContain('cancelled');
    expect(ORDER_STATUSES).toContain('refunded');
  });

  test('VALID_TRANSITIONS has entries for all statuses', () => {
    for (const status of ORDER_STATUSES) {
      expect(VALID_TRANSITIONS[status]).toBeDefined();
    }
  });

  test('Terminal statuses have no valid transitions', () => {
    expect(VALID_TRANSITIONS.collected).toEqual([]);
    expect(VALID_TRANSITIONS.refunded).toEqual([]);
  });

  test('STATUS_RANK is sequential', () => {
    expect(STATUS_RANK.pending).toBeLessThan(STATUS_RANK.confirmed);
    expect(STATUS_RANK.confirmed).toBeLessThan(STATUS_RANK.ordered);
    expect(STATUS_RANK.ordered).toBeLessThan(STATUS_RANK.preparation);
    expect(STATUS_RANK.preparation).toBeLessThan(STATUS_RANK.shipped);
    expect(STATUS_RANK.shipped).toBeLessThan(STATUS_RANK.in_transit);
    expect(STATUS_RANK.in_transit).toBeLessThan(STATUS_RANK.available);
    expect(STATUS_RANK.available).toBeLessThan(STATUS_RANK.collected);
  });

  test('Every VALID_TRANSITION target has a TRANSITION_ROLES entry', () => {
    for (const [, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const target of targets) {
        expect(TRANSITION_ROLES[target]).toBeDefined();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// transitionOrderStatus() tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('transitionOrderStatus() — patch source', () => {
  test('valid transition: confirmed → ordered (admin)', async () => {
    setupMockForTransition('confirmed');

    const result = await transitionOrderStatus({
      orderId: mockOrder.id,
      newStatus: 'ordered',
      actor: { id: 'admin-1', role: 'admin' },
      source: 'patch',
      dbClient: mockDb,
    });

    expect(result.success).toBe(true);
    expect(result.previousStatus).toBe('confirmed');
    expect(result.newStatus).toBe('ordered');
    expect(result.noop).toBeUndefined();
  });

  test('invalid transition: confirmed → shipped (skips ordered)', async () => {
    setupMockForTransition('confirmed');

    const result = await transitionOrderStatus({
      orderId: mockOrder.id,
      newStatus: 'shipped',
      actor: { id: 'admin-1', role: 'admin' },
      source: 'patch',
      dbClient: mockDb,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Transition invalide');
  });

  test('role check: agent_hub cannot set available', async () => {
    setupMockForTransition('in_transit');

    const result = await transitionOrderStatus({
      orderId: mockOrder.id,
      newStatus: 'available',
      actor: { id: 'hub-1', role: 'agent_hub' },
      source: 'patch',
      dbClient: mockDb,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Rôle');
  });

  test('role check: agent_relais can confirm cash_relais payment', async () => {
    setupMockForTransition('pending', { payment_mode: 'cash_relais' });

    const result = await transitionOrderStatus({
      orderId: mockOrder.id,
      newStatus: 'confirmed',
      actor: { id: 'relais-1', role: 'agent_relais' },
      source: 'patch',
      dbClient: mockDb,
    });

    expect(result.success).toBe(true);
    expect(result.previousStatus).toBe('pending');
    expect(result.newStatus).toBe('confirmed');
  });

  test('role check: agent_relais cannot confirm stripe payment', async () => {
    setupMockForTransition('pending', { payment_mode: 'stripe_eur' });

    const result = await transitionOrderStatus({
      orderId: mockOrder.id,
      newStatus: 'confirmed',
      actor: { id: 'relais-1', role: 'agent_relais' },
      source: 'patch',
      dbClient: mockDb,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('cash relais');
  });
});

describe('transitionOrderStatus() — idempotence', () => {
  test('same status = noop (no DB write)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'ordered' }] });

    const result = await transitionOrderStatus({
      orderId: mockOrder.id,
      newStatus: 'ordered',
      source: 'scan',
      dbClient: mockDb,
    });

    expect(result.success).toBe(true);
    expect(result.noop).toBe(true);
    // Only 1 query (SELECT), no UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('transitionOrderStatus() — scan source (forward-only)', () => {
  test('forward scan: preparation → shipped', async () => {
    setupMockForTransition('preparation');

    const result = await transitionOrderStatus({
      orderId: mockOrder.id,
      newStatus: 'shipped',
      source: 'scan',
      dbClient: mockDb,
    });

    expect(result.success).toBe(true);
    expect(result.newStatus).toBe('shipped');
  });

  test('backward scan: shipped → preparation = noop (not error)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'shipped' }] });

    const result = await transitionOrderStatus({
      orderId: mockOrder.id,
      newStatus: 'preparation',
      source: 'scan',
      dbClient: mockDb,
    });

    expect(result.success).toBe(true);
    expect(result.noop).toBe(true);
    expect(result.newStatus).toBe('shipped'); // stays at current
  });
});

describe('transitionOrderStatus() — order not found', () => {
  test('returns error for non-existent order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await transitionOrderStatus({
      orderId: 'nonexistent-uuid',
      newStatus: 'ordered',
      dbClient: mockDb,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('introuvable');
  });
});

describe('Complete transition chain', () => {
  test('full happy path: confirmed → collected', async () => {
    const chain = ['ordered', 'preparation', 'shipped', 'in_transit', 'available', 'collected'];
    let currentStatus = 'confirmed';

    for (const next of chain) {
      setupMockForTransition(currentStatus);

      const result = await transitionOrderStatus({
        orderId: mockOrder.id,
        newStatus: next,
        actor: { id: 'admin-1', role: 'admin' },
        source: 'patch',
        dbClient: mockDb,
      });

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(currentStatus);
      expect(result.newStatus).toBe(next);
      currentStatus = next;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lot A — branches non couvertes
// ═══════════════════════════════════════════════════════════════════════════════

describe('transitionOrderStatus() — sources paiement (no-op gracieux)', () => {
  test.each(['stripe_webhook', 'cash_confirm', 'wallet_full_payment', 'shared_cart_full_payment', 'paypal_capture'])(
    "source '%s' sur une commande déjà confirmed → noop gracieux, aucune écriture", async (source) => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'confirmed' }] });

      const result = await transitionOrderStatus({
        orderId: mockOrder.id, newStatus: 'confirmed', source, dbClient: mockDb,
      });

      expect(result).toEqual({ success: true, previousStatus: 'confirmed', newStatus: 'confirmed', noop: true });
      expect(mockQuery).toHaveBeenCalledTimes(1); // uniquement le SELECT
    }
  );

  test('source paiement sur pending → confirmed est bien exécutée (pas un noop)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'pending' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE orders SET status
      .mockResolvedValueOnce({ rows: [] }) // UPDATE orders SET payment_status='paid'
      .mockResolvedValueOnce({ rows: [] }); // INSERT history

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'confirmed', source: 'stripe_webhook', dbClient: mockDb,
    });

    expect(result.success).toBe(true);
    expect(result.noop).toBeUndefined();
    expect(mockQuery).toHaveBeenNthCalledWith(3,
      `UPDATE orders SET payment_status = 'paid' WHERE id = $1 AND payment_status = 'pending'`,
      [mockOrder.id]
    );
  });
});

describe('transitionOrderStatus() — gate douane (→ available)', () => {
  test('douane non déclarée → transition refusée avec code CUSTOMS_NOT_DECLARED', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'in_transit' }] }) // SELECT order
      .mockResolvedValueOnce({ rows: [{ status: 'pending', reference: 'CS-042' }] }); // customs check → bloqué

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'available',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('CUSTOMS_NOT_DECLARED');
    expect(result.error).toContain('CS-042');
    expect(mockQuery).toHaveBeenCalledTimes(2); // pas d'UPDATE — bloqué avant
  });
});

describe('transitionOrderStatus() — cancel_reason persisté', () => {
  test('cancelReason fourni → inclus dans le SET et les values de l\'UPDATE', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'ordered' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE orders SET status, cancel_reason
      .mockResolvedValueOnce({ rows: [{ wallet_applied_kmf: 0, user_id: null, reference: 'KMC-CR' }] }) // SELECT wallet fields
      .mockResolvedValueOnce({ rows: [] }) // SELECT order_items (stock restore)
      .mockResolvedValueOnce({ rows: [] }); // INSERT history

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled', cancelReason: 'Client a changé d\'avis',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.success).toBe(true);
    expect(mockQuery).toHaveBeenNthCalledWith(2,
      expect.stringContaining('cancel_reason = $2'),
      expect.arrayContaining(['cancelled', "Client a changé d'avis", mockOrder.id])
    );
  });
});

describe('transitionOrderStatus() — effets annulation : wallet reversal', () => {
  function setupCancelSequence({ walletRows, itemsRows = [] }) {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'confirmed' }] }) // SELECT order
      .mockResolvedValueOnce({ rows: [] }) // UPDATE orders SET status
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Vague 2 D2 : releaseAllocationsForOrder
      .mockResolvedValueOnce({ rows: walletRows }) // SELECT wallet_applied_kmf/user_id/reference
      .mockResolvedValueOnce({ rows: itemsRows }) // SELECT order_items (stock restore)
      .mockResolvedValueOnce({ rows: [] }); // INSERT history
  }

  test('removeFromOrder réussit → wallet reversal appliqué', async () => {
    setupCancelSequence({ walletRows: [{ wallet_applied_kmf: 5000, user_id: 'user-1', reference: 'KMC-W1' }] });
    walletService.removeFromOrder.mockResolvedValueOnce({ reversed_kmf: 5000, transaction: { id: 'wtx-1' } });

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.cancelEffects.walletReversalAmount).toBe(5000);
    expect(result.cancelEffects.walletReversalTxId).toBe('wtx-1');
    expect(walletService.removeFromOrder).toHaveBeenCalledWith(mockDb, { orderId: mockOrder.id });
  });

  test('removeFromOrder échoue → fallback credit() réussit', async () => {
    setupCancelSequence({ walletRows: [{ wallet_applied_kmf: 3000, user_id: 'user-2', reference: 'KMC-W2' }] });
    walletService.removeFromOrder.mockRejectedValueOnce(new Error('reversal impossible'));
    walletService.credit.mockResolvedValueOnce({ transaction: { id: 'wtx-2' } });

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.cancelEffects.walletReversalAmount).toBe(3000);
    expect(result.cancelEffects.walletReversalTxId).toBe('wtx-2');
    expect(walletService.credit).toHaveBeenCalledWith(mockDb, expect.objectContaining({
      userId: 'user-2', amountKmf: 3000, reason: 'order_cancel',
    }));
  });

  test('removeFromOrder ET credit() échouent tous les deux → non-bloquant, cancelEffects reste à 0', async () => {
    setupCancelSequence({ walletRows: [{ wallet_applied_kmf: 1000, user_id: 'user-3', reference: 'KMC-W3' }] });
    walletService.removeFromOrder.mockRejectedValueOnce(new Error('fail 1'));
    walletService.credit.mockRejectedValueOnce(new Error('fail 2'));

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.success).toBe(true); // la transition n'échoue pas malgré le double échec wallet
    expect(result.cancelEffects.walletReversalAmount).toBe(0);
    expect(result.cancelEffects.walletReversalTxId).toBeNull();
  });

  test('wallet_applied_kmf=0 ou user_id absent → wallet non touché', async () => {
    setupCancelSequence({ walletRows: [{ wallet_applied_kmf: 0, user_id: null, reference: 'KMC-W0' }] });

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(walletService.removeFromOrder).not.toHaveBeenCalled();
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(result.cancelEffects.walletReversalAmount).toBe(0);
  });
});

describe('transitionOrderStatus() — effets annulation : restauration stock', () => {
  test('previousStatus >= confirmed → stock produit ET variantes restaurés', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'shipped' }] }) // SELECT order
      .mockResolvedValueOnce({ rows: [] }) // UPDATE orders SET status
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Vague 2 D2 : releaseAllocationsForOrder
      .mockResolvedValueOnce({ rows: [{ wallet_applied_kmf: 0, user_id: null, reference: 'KMC-STK' }] }) // SELECT wallet
      .mockResolvedValueOnce({
        rows: [{
          product_id: 'prod-1', quantity: 3, has_variants: true,
          variant_combo: { taille: 'M', couleur: 'rouge' },
        }],
      }) // SELECT order_items
      .mockResolvedValueOnce({ rows: [] }) // UPDATE products SET stock
      .mockResolvedValueOnce({ rows: [] }) // UPDATE product_variants (taille)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE product_variants (couleur)
      .mockResolvedValueOnce({ rows: [] }); // INSERT history

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.cancelEffects.stockItemsRestored).toBe(1);
    expect(mockQuery).toHaveBeenNthCalledWith(6,
      'UPDATE products SET stock = stock + $1 WHERE id = $2', [3, 'prod-1']
    );
    expect(mockQuery).toHaveBeenNthCalledWith(7,
      expect.stringContaining('UPDATE product_variants'),
      [3, 'prod-1', 'taille', 'M']
    );
    expect(mockQuery).toHaveBeenNthCalledWith(8,
      expect.stringContaining('UPDATE product_variants'),
      [3, 'prod-1', 'couleur', 'rouge']
    );
  });

  test('previousStatus < confirmed (pending) → stock jamais décrémenté, pas de restauration', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'pending' }] }) // SELECT order
      .mockResolvedValueOnce({ rows: [] }) // UPDATE orders SET status
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Vague 2 D2 : releaseAllocationsForOrder
      .mockResolvedValueOnce({ rows: [{ wallet_applied_kmf: 0, user_id: null, reference: 'KMC-PEND' }] }) // SELECT wallet
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE order_items SET shared_cart_item_id = NULL (D2)
      .mockResolvedValueOnce({ rows: [] }); // INSERT history — PAS de SELECT order_items

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.cancelEffects.stockItemsRestored).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(6); // SELECT, UPDATE, release allocation (D2), SELECT wallet, UPDATE claim release, INSERT history — pas de SELECT items
  });
});

describe('transitionOrderStatus() — effets annulation : libération du claim liste partagée (D2)', () => {
  // Gap identifié à l'audit CLAIM (2026-08) : le test « pending → cancelled »
  // ci-dessus vérifie déjà l'APPEL de la requête UPDATE order_items SET
  // shared_cart_item_id = NULL, mais aucun test n'affirmait jusqu'ici le
  // contenu de cancelEffects.sharedListClaimsReleased (ni le cas rowCount>0,
  // ni la branche catch en cas d'échec de la requête). Or c'est exactement
  // ce champ qu'un appelant (route/admin) inspecterait pour savoir si la
  // libération a réellement eu lieu — un bug silencieux ici (ex. rowCount
  // toujours retourné à 0 même quand une ligne est libérée) serait invisible
  // sans cette assertion dédiée.
  test('rowCount > 0 → cancelEffects.sharedListClaimsReleased reflète le nombre de lignes libérées', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'pending' }] }) // SELECT order
      .mockResolvedValueOnce({ rows: [] }) // UPDATE orders SET status
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Vague 2 D2 : releaseAllocationsForOrder
      .mockResolvedValueOnce({ rows: [{ wallet_applied_kmf: 0, user_id: null, reference: 'KMC-CLAIM' }] }) // SELECT wallet
      .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // UPDATE order_items SET shared_cart_item_id = NULL (D2) — 2 lignes libérées
      .mockResolvedValueOnce({ rows: [] }); // INSERT history

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.cancelEffects.sharedListClaimsReleased).toBe(2);
    expect(mockQuery).toHaveBeenNthCalledWith(5,
      expect.stringContaining('UPDATE order_items'),
      [mockOrder.id]
    );
  });

  test('rowCount = 0 (commande hors contexte liste partagée) → sharedListClaimsReleased vaut 0', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Vague 2 D2 : releaseAllocationsForOrder
      .mockResolvedValueOnce({ rows: [{ wallet_applied_kmf: 0, user_id: null, reference: 'KMC-NOCLAIM' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.cancelEffects.sharedListClaimsReleased).toBe(0);
  });

  test('échec de la requête de libération → catch défensif, cancelEffects.sharedListClaimsReleased.error posé, annulation non bloquée', async () => {
    // La libération du claim est protégée par son propre try/catch
    // (services/order-status-machine.js) : une panne isolée de cette étape
    // ne doit jamais faire échouer toute l'annulation (stock déjà restauré,
    // wallet déjà remboursé à ce stade). On vérifie ici que l'échec est
    // capturé plutôt que propagé, et que l'INSERT history a quand même lieu.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Vague 2 D2 : releaseAllocationsForOrder
      .mockResolvedValueOnce({ rows: [{ wallet_applied_kmf: 0, user_id: null, reference: 'KMC-ERR' }] })
      .mockRejectedValueOnce(new Error('connection lost')) // UPDATE order_items SET shared_cart_item_id = NULL échoue
      .mockResolvedValueOnce({ rows: [] }); // INSERT history — doit quand même s'exécuter

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.cancelEffects.sharedListClaimsReleased).toMatchObject({
      error: 'connection lost',
    });
    // 6 appels attendus : SELECT, UPDATE status, release allocation (D2),
    // SELECT wallet, UPDATE claim (échoue mais est comptée), INSERT
    // history — l'échec n'a pas coupé la chaîne.
    expect(mockQuery).toHaveBeenCalledTimes(6);
  });
});

describe('transitionOrderStatus() — effets annulation : sync purchase orders', () => {
  test('sync réussie → cancelEffects.purchaseOrders reflète le résultat', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'confirmed' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Vague 2 D2 : releaseAllocationsForOrder
      .mockResolvedValueOnce({ rows: [{ wallet_applied_kmf: 0, user_id: null, reference: 'KMC-PO' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    syncPurchaseOrdersOnOrderCancel.mockResolvedValueOnce({ cancelled: 2, alerted: 1 });

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled', cancelReason: 'rupture fournisseur',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.cancelEffects.purchaseOrders).toEqual({ cancelled: 2, alerted: 1 });
    expect(syncPurchaseOrdersOnOrderCancel).toHaveBeenCalledWith(mockDb, expect.objectContaining({
      orderId: mockOrder.id, orderReference: 'KMC-PO', reason: 'rupture fournisseur',
    }));
  });

  test('sync échoue → capturé dans cancelEffects.purchaseOrders.error, transition reste success', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'confirmed' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Vague 2 D2 : releaseAllocationsForOrder
      .mockResolvedValueOnce({ rows: [{ wallet_applied_kmf: 0, user_id: null, reference: 'KMC-POERR' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    syncPurchaseOrdersOnOrderCancel.mockRejectedValueOnce(new Error('PO service down'));

    const result = await transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'cancelled',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    });

    expect(result.success).toBe(true);
    expect(result.cancelEffects.purchaseOrders).toEqual({ error: 'PO service down' });
  });
});

describe('transitionOrderStatus() — échec insertion historique (D6)', () => {
  test('INSERT order_status_history échoue → l\'erreur est propagée (throw)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...mockOrder, status: 'confirmed' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE orders SET status
      .mockRejectedValueOnce(new Error('history table locked')); // INSERT history échoue

    await expect(transitionOrderStatus({
      orderId: mockOrder.id, newStatus: 'ordered',
      actor: { id: 'admin-1', role: 'admin' }, source: 'patch', dbClient: mockDb,
    })).rejects.toThrow('history table locked');
  });
});
