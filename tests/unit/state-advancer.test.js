'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/state-advancer.test.js
 * Couvre services/simulator/state-advancer.js et verrouille Debt Zero :
 * les écritures sensibles passent par leurs services owners.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../services/payment-service', () => ({
  markPaid: jest.fn(),
  markRefunded: jest.fn(),
  forcePaymentStatusForSimulation: jest.fn(),
}));
jest.mock('../../services/parcel-operations', () => ({ transitionParcelStatus: jest.fn() }));
jest.mock('../../services/wallet-service', () => ({ credit: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const db = require('../../db');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const {
  markPaid,
  markRefunded,
  forcePaymentStatusForSimulation,
} = require('../../services/payment-service');
const { transitionParcelStatus } = require('../../services/parcel-operations');
const walletService = require('../../services/wallet-service');
const { execute, executeChaosImpact } = require('../../services/simulator/state-advancer');

beforeEach(() => {
  jest.clearAllMocks();
  markPaid.mockResolvedValue({ changed: true, rowCount: 1 });
  markRefunded.mockResolvedValue({ changed: true, rowCount: 1 });
  forcePaymentStatusForSimulation.mockResolvedValue({ changed: true, rowCount: 1 });
  transitionParcelStatus.mockResolvedValue({ success: true });
  walletService.credit.mockResolvedValue({ duplicate: false, transaction: { id: 'wtx-1' } });
});

describe('Debt Zero — mutation ownership', () => {
  it('ne contient plus de write direct payment_status ni store_credits', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../services/simulator/state-advancer.js'),
      'utf8'
    );
    expect(source).not.toMatch(/UPDATE\s+orders\s+SET\s+payment_status/i);
    expect(source).not.toMatch(/INSERT\s+INTO\s+store_credits/i);
    expect(source).toMatch(/forcePaymentStatusForSimulation/);
    expect(source).toMatch(/walletService\.credit/);
  });
});

describe('execute — actions triviales', () => {
  it('action wait → no-op, statut inchangé', async () => {
    const result = await execute('o1', { currentStatus: 'preparation' }, { action: 'wait' });
    expect(result).toEqual({ success: true, from: 'preparation', to: 'preparation', action: 'wait' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('action log_only → no-op, statut inchangé', async () => {
    const result = await execute('o1', { currentStatus: 'shipped' }, { action: 'log_only' });
    expect(result).toEqual({ success: true, from: 'shipped', to: 'shipped', action: 'log_only' });
  });

  it('action inconnue → success:false avec message explicite', async () => {
    const result = await execute('o1', {}, { action: 'teleport' });
    expect(result).toEqual({ success: false, error: 'Action inconnue: teleport' });
  });
});

describe('execute — confirm_payment', () => {
  it('commande introuvable → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(result).toEqual({ success: false, error: 'Commande introuvable' });
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('commande déjà au-delà de pending → already_past_pending', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'shipped', payment_mode: 'cash_relais', payment_status: 'paid' }] });
    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(result).toEqual({ success: true, from: 'shipped', to: 'shipped', action: 'already_past_pending' });
    expect(markPaid).not.toHaveBeenCalled();
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('paiement pending passe par markPaid avant la transition', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'pending', payment_mode: 'cash_relais', payment_status: 'pending' }] });
    transitionOrderStatus
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(markPaid).toHaveBeenCalledWith('o1');
    expect(result).toEqual({ success: true, from: 'pending', to: 'ordered', action: 'confirm_payment' });
  });

  it('paiement déjà paid ne rejoue pas markPaid', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'pending', payment_mode: 'cash_relais', payment_status: 'paid' }] });
    transitionOrderStatus
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    await execute('o1', {}, { action: 'confirm_payment' });
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('markPaid refusé → stoppe avant la state machine', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'pending', payment_mode: 'cash_relais', payment_status: 'failed' }] });
    markPaid.mockResolvedValueOnce({ changed: false, rowCount: 0 });

    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/payment_status/);
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('transition pending→confirmed refusée → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'pending', payment_mode: 'cash_relais', payment_status: 'pending' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'invalide' });

    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pending→confirmed/);
  });

  it('confirmed réussit mais ordered échoue → confirm_only', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'pending', payment_status: 'pending' }] });
    transitionOrderStatus
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'stock manquant' });

    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(result).toEqual({ success: true, from: 'pending', to: 'confirmed', action: 'confirm_only' });
  });
});

describe('execute — create_parcel', () => {
  it('commande introuvable → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await execute('o1', {}, { action: 'create_parcel' });
    expect(result.success).toBe(false);
  });

  it('colis déjà existant → ne recrée pas de colis', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'preparation', reference: 'ORD-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-existing' }] });

    const result = await execute('o1', {}, { action: 'create_parcel' });
    expect(result).toEqual({ success: true, from: 'preparation', to: 'preparation', action: 'create_parcel' });
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('nominal confirmed → crée colis/items et transitionne vers preparation', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'confirmed', reference: 'ORD-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ max_seq: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'item-1', quantity: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    transitionOrderStatus.mockResolvedValueOnce({ success: true });

    const result = await execute('o1', {}, { action: 'create_parcel' });
    expect(result).toEqual({ success: true, from: 'confirmed', to: 'preparation', action: 'create_parcel' });
    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', newStatus: 'preparation' }));
  });

  it('transition vers preparation refusée → success:false', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'ordered', reference: 'ORD-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'bloque' });

    const result = await execute('o1', {}, { action: 'create_parcel' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/create_parcel/);
  });
});

describe('execute — scan advance', () => {
  it('commande introuvable → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await execute('o1', {}, { action: 'ship' });
    expect(result.success).toBe(false);
  });

  it('pas de colis → success:false', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await execute('o1', {}, { action: 'ship' });
    expect(result.error).toMatch(/Pas de colis/);
  });

  it('nominal ship → parcel owner + scan + order state machine', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', reference: 'PCL-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    transitionOrderStatus.mockResolvedValueOnce({ success: true });

    const result = await execute('o1', {}, { action: 'ship' });
    expect(transitionParcelStatus).toHaveBeenCalledWith(db, 'parcel-1', 'shipped', { skipValidation: true });
    expect(result).toEqual({ success: true, from: 'preparation', to: 'shipped', action: 'scan_shipped' });
  });

  it('transition order refusée → success:false, statut inchangé', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'shipped' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'sequence invalide' });

    const result = await execute('o1', {}, { action: 'transit' });
    expect(result.success).toBe(false);
    expect(result.to).toBe('shipped');
  });

  it('exception du parcel owner → catch contrôlé', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'available' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1' }] });
    transitionParcelStatus.mockRejectedValueOnce(new Error('connexion perdue'));

    const result = await execute('o1', {}, { action: 'collect' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/connexion perdue/);
  });
});

describe('execute — cancel', () => {
  it('commande introuvable → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await execute('o1', {}, { action: 'cancel' });
    expect(result.success).toBe(false);
  });

  it('nominal → transition vers cancelled', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'preparation' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: true });
    const result = await execute('o1', {}, { action: 'cancel' });
    expect(result).toEqual({ success: true, from: 'preparation', to: 'cancelled', action: 'cancel' });
  });

  it('transition refusée → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'collected' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'commande déjà collectée' });
    const result = await execute('o1', {}, { action: 'cancel' });
    expect(result.success).toBe(false);
    expect(result.to).toBe('collected');
  });
});

describe('execute — refund', () => {
  it('commande introuvable → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await execute('o1', {}, { action: 'refund' });
    expect(result.success).toBe(false);
  });

  it('transition vers refunded refusée → aucun crédit ni mutation financière', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'shipped', payment_status: 'paid', total_kmf: 5000, user_id: 'u1' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'refund impossible apres expedition' });

    const result = await execute('o1', {}, { action: 'refund' });
    expect(result.success).toBe(false);
    expect(markRefunded).not.toHaveBeenCalled();
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(transitionParcelStatus).not.toHaveBeenCalled();
  });

  it('nominal → markRefunded + wallet unifié idempotent + annulation colis', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'confirmed', payment_status: 'paid', total_kmf: 10000, user_id: 'u1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: true });

    const result = await execute('o1', {}, { action: 'refund' });
    expect(result).toEqual({ success: true, from: 'confirmed', to: 'refunded', action: 'refund' });
    expect(markRefunded).toHaveBeenCalledWith('o1');
    expect(walletService.credit).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: 'u1',
      amountKmf: 10000,
      referenceId: 'o1',
      idempotencyKey: 'simulator_refund_o1',
    }));
    expect(transitionParcelStatus).toHaveBeenCalledWith(db, 'parcel-1', 'cancelled', { skipValidation: true });
  });

  it('refus de markRefunded → ne crédite pas le wallet', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'confirmed', payment_status: 'paid', total_kmf: 10000, user_id: 'u1' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: true });
    markRefunded.mockResolvedValueOnce({ changed: false, rowCount: 0 });

    const result = await execute('o1', {}, { action: 'refund' });
    expect(result.success).toBe(false);
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it('sans user_id → ne tente pas de créditer le wallet', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'confirmed', payment_status: 'paid', total_kmf: 10000, user_id: null }] })
      .mockResolvedValueOnce({ rows: [] });
    transitionOrderStatus.mockResolvedValueOnce({ success: true });

    await execute('o1', {}, { action: 'refund' });
    expect(walletService.credit).not.toHaveBeenCalled();
  });
});

describe('executeChaosImpact', () => {
  it('impact skip → applied:true', async () => {
    const result = await executeChaosImpact('o1', {}, { description: 'pause aléatoire' });
    expect(result).toEqual({ applied: true, message: 'pause aléatoire' });
  });

  it('duplicate_scan sans colis → mention pas de colis', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await executeChaosImpact('o1', {}, { impact: 'duplicate_scan', description: 'double scan' });
    expect(result.message).toMatch(/pas de colis/);
  });

  it('duplicate_scan avec colis → insère le scan dupliqué', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'p1', status: 'shipped' }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await executeChaosImpact('o1', {}, { impact: 'duplicate_scan', description: 'double scan' });
    expect(result.message).toContain('p1');
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO scans'), expect.any(Array));
  });

  it('add_wait accumule jusqu’au seuil puis se résout', async () => {
    const tracked = {};
    const r1 = await executeChaosImpact('o1', tracked, { impact: 'add_wait', description: 'attente chaos', waitTicks: 2 });
    expect(r1.message).toMatch(/1\/2/);
    const r2 = await executeChaosImpact('o1', tracked, { impact: 'add_wait', description: 'attente chaos', waitTicks: 2 });
    expect(r2.message).toMatch(/résolu après 2 ticks/);
    expect(tracked._chaosWait).toBe(0);
  });

  it('desync_payment inverse le statut via payment-service', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ payment_status: 'paid' }] });
    const result = await executeChaosImpact('o1', {}, { impact: 'desync_payment', description: 'desync' });
    expect(result.applied).toBe(true);
    expect(result.message).toMatch(/paid → pending/);
    expect(forcePaymentStatusForSimulation).toHaveBeenCalledWith('o1', 'pending');
    const directWrites = db.query.mock.calls.filter(c => /UPDATE\s+orders\s+SET\s+payment_status/i.test(String(c[0])));
    expect(directWrites).toHaveLength(0);
  });

  it('desync_payment commande introuvable → no-op', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await executeChaosImpact('o1', {}, { impact: 'desync_payment', description: 'desync' });
    expect(result).toEqual({ applied: true, message: 'desync' });
    expect(forcePaymentStatusForSimulation).not.toHaveBeenCalled();
  });

  it('log_incident → insère une notification système', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await executeChaosImpact('o1', {}, { impact: 'log_incident', description: 'incident simulé' });
    expect(result).toEqual({ applied: true, message: 'incident simulé' });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_log'), expect.any(Array));
  });

  it('impact inconnu → applied:true sans crash', async () => {
    const result = await executeChaosImpact('o1', {}, { impact: 'inconnu', description: 'mystère' });
    expect(result).toEqual({ applied: true, message: 'mystère' });
  });
});
