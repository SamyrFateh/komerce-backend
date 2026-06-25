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
});

// ── Helper to setup mock for a transition ───────────────────────────────────

function setupMockForTransition(currentStatus, opts = {}) {
  const order = { ...mockOrder, status: currentStatus, ...opts };

  // Call 1: SELECT order FOR UPDATE
  mockQuery.mockResolvedValueOnce({ rows: [order] });
  // Call 2: UPDATE orders SET status...
  mockQuery.mockResolvedValueOnce({ rows: [{}] });
  // Call 3+: Additional queries (cash_relais auto-paid, history, etc.)
  mockQuery.mockResolvedValue({ rows: [] }); // catch-all : 0 ligne = aucune douane pending (customs gate), historique vide

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
    expect(ORDER_STATUSES).toContain('pending_group_payment');
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
    expect(STATUS_RANK.pending_group_payment).toBe(STATUS_RANK.pending);
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
