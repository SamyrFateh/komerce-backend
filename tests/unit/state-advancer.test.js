'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/state-advancer.test.js
 * Couvre services/simulator/state-advancer.js
 *
 * confirmPayment, createParcel, scanAdvance, cancelOrder, refundOrder ne sont
 * pas exportees : testees indirectement via execute(orderId, tracked, action).
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const db = require('../../db');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const { execute, executeChaosImpact } = require('../../services/simulator/state-advancer');

beforeEach(() => jest.clearAllMocks());

describe('execute — actions triviales', () => {
  it('action "wait" → no-op, statut inchange', async () => {
    const result = await execute('o1', { currentStatus: 'preparation' }, { action: 'wait' });
    expect(result).toEqual({ success: true, from: 'preparation', to: 'preparation', action: 'wait' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('action "log_only" → no-op, statut inchange', async () => {
    const result = await execute('o1', { currentStatus: 'shipped' }, { action: 'log_only' });
    expect(result).toEqual({ success: true, from: 'shipped', to: 'shipped', action: 'log_only' });
  });

  it('action inconnue → success:false avec message d\'erreur explicite', async () => {
    const result = await execute('o1', {}, { action: 'teleport' });
    expect(result).toEqual({ success: false, error: 'Action inconnue: teleport' });
  });
});

describe('execute — confirm_payment', () => {
  it('commande introuvable → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(result).toEqual({ success: false, error: 'Commande introuvable' });
  });

  it('commande deja au-dela de pending → already_past_pending, pas de transition', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'shipped', payment_mode: 'cash_relais', payment_status: 'paid' }] });
    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(result).toEqual({ success: true, from: 'shipped', to: 'shipped', action: 'already_past_pending' });
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('transition pending→confirmed refusee → success:false', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'pending', payment_mode: 'cash_relais', payment_status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE payment_status
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'invalide' });

    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pending→confirmed/);
  });

  it('confirmed reussit mais ordered echoue → confirm_only', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] });
    transitionOrderStatus
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'stock manquant' });

    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(result).toEqual({ success: true, from: 'pending', to: 'confirmed', action: 'confirm_only' });
  });

  it('nominal → enchaine confirmed puis ordered', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] });
    transitionOrderStatus
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    const result = await execute('o1', {}, { action: 'confirm_payment' });
    expect(result).toEqual({ success: true, from: 'pending', to: 'ordered', action: 'confirm_payment' });
  });
});

describe('execute — create_parcel', () => {
  it('commande introuvable → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await execute('o1', {}, { action: 'create_parcel' });
    expect(result.success).toBe(false);
  });

  it('colis deja existant → ne recree pas de colis, juste la transition si besoin', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'preparation', reference: 'ORD-1' }] }) // order
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-existing' }] }); // existing parcels non vide

    const result = await execute('o1', {}, { action: 'create_parcel' });
    expect(result).toEqual({ success: true, from: 'preparation', to: 'preparation', action: 'create_parcel' });
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('nominal (statut confirmed) → cree colis, items, transition vers preparation', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'confirmed', reference: 'ORD-1' }] }) // order
      .mockResolvedValueOnce({ rows: [] }) // existing parcels vide
      .mockResolvedValueOnce({ rows: [{ max_seq: 3 }] }) // seq max
      .mockResolvedValueOnce({ rows: [{ id: 'item-1', quantity: 2 }] }) // order_items
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1' }] }) // INSERT parcel
      .mockResolvedValueOnce({ rows: [] }); // INSERT parcel_items
    transitionOrderStatus.mockResolvedValueOnce({ success: true });

    const result = await execute('o1', {}, { action: 'create_parcel' });
    expect(result).toEqual({ success: true, from: 'confirmed', to: 'preparation', action: 'create_parcel' });
    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', newStatus: 'preparation' }));
  });

  it('transition vers preparation refusee → success:false', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'ordered', reference: 'ORD-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing' }] }); // colis deja existant -> pas d'insert
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'bloque' });

    const result = await execute('o1', {}, { action: 'create_parcel' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/create_parcel/);
  });
});

describe('execute — scan advance (ship/transit/arrive/collect)', () => {
  it('commande introuvable → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await execute('o1', {}, { action: 'ship' });
    expect(result.success).toBe(false);
  });

  it('pas de colis → success:false, message explicite', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [] }); // pas de colis
    const result = await execute('o1', {}, { action: 'ship' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Pas de colis/);
  });

  it('nominal "ship" → met a jour le colis, insere un scan, transitionne vers shipped', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'preparation' }] }) // order
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', reference: 'PCL-1' }] }) // parcel
      .mockResolvedValueOnce({ rows: [] }) // UPDATE parcel status
      .mockResolvedValueOnce({ rows: [] }); // INSERT scan
    transitionOrderStatus.mockResolvedValueOnce({ success: true });

    const result = await execute('o1', {}, { action: 'ship' });
    expect(result).toEqual({ success: true, from: 'preparation', to: 'shipped', action: 'scan_shipped' });
  });

  it('transition refusee par la state machine → success:false, statut inchange', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'shipped' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'sequence invalide' });

    const result = await execute('o1', {}, { action: 'transit' });
    expect(result.success).toBe(false);
    expect(result.to).toBe('shipped');
    expect(result.error).toMatch(/in_transit/);
  });

  it('exception DB pendant le scan → catch, success:false avec message d\'erreur', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'available' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1' }] })
      .mockRejectedValueOnce(new Error('connexion perdue'));

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

  it('transition refusee → success:false', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'collected' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'commande deja collectee' });
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

  it('transition vers refunded refusee → success:false, pas de credit wallet ni annulation colis', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'shipped', total_kmf: 5000, user_id: 'u1' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'refund impossible apres expedition' });

    const result = await execute('o1', {}, { action: 'refund' });
    expect(result.success).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1); // uniquement le SELECT initial
  });

  it('nominal avec user_id et total_kmf → credite le wallet et annule les colis', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'confirmed', total_kmf: 10000, user_id: 'u1' }] })
      .mockResolvedValueOnce({ rows: [] }) // INSERT store_credits
      .mockResolvedValueOnce({ rows: [] }); // UPDATE parcels cancelled
    transitionOrderStatus.mockResolvedValueOnce({ success: true });

    const result = await execute('o1', {}, { action: 'refund' });
    expect(result).toEqual({ success: true, from: 'confirmed', to: 'refunded', action: 'refund' });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO store_credits'), ['u1', 10000, 'o1']);
  });

  it('sans user_id → ne tente pas de crediter le wallet', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'confirmed', total_kmf: 10000, user_id: null }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE parcels cancelled uniquement
    transitionOrderStatus.mockResolvedValueOnce({ success: true });

    await execute('o1', {}, { action: 'refund' });
    const storeCreditCalls = db.query.mock.calls.filter(c => String(c[0]).includes('store_credits'));
    expect(storeCreditCalls).toHaveLength(0);
  });
});

describe('executeChaosImpact', () => {
  it('impact "skip" (ou absent) → applied:true, message du chaos', async () => {
    const result = await executeChaosImpact('o1', {}, { description: 'pause aleatoire' });
    expect(result).toEqual({ applied: true, message: 'pause aleatoire' });
  });

  it('impact "duplicate_scan" sans colis → applied:true, mention "pas de colis"', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await executeChaosImpact('o1', {}, { impact: 'duplicate_scan', description: 'double scan' });
    expect(result.applied).toBe(true);
    expect(result.message).toMatch(/pas de colis/);
  });

  it('impact "duplicate_scan" avec colis → insere un scan duplique', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'p1', status: 'shipped' }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await executeChaosImpact('o1', {}, { impact: 'duplicate_scan', description: 'double scan' });
    expect(result.applied).toBe(true);
    expect(result.message).toContain('p1');
  });

  it('impact "add_wait" → accumule jusqu\'au seuil puis se resout', async () => {
    const tracked = {};
    const r1 = await executeChaosImpact('o1', tracked, { impact: 'add_wait', description: 'attente chaos', waitTicks: 2 });
    expect(r1.message).toMatch(/1\/2/);
    const r2 = await executeChaosImpact('o1', tracked, { impact: 'add_wait', description: 'attente chaos', waitTicks: 2 });
    expect(r2.message).toMatch(/résolu après 2 ticks/);
    expect(tracked._chaosWait).toBe(0);
  });

  it('impact "desync_payment" → inverse le statut de paiement', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ payment_status: 'paid' }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await executeChaosImpact('o1', {}, { impact: 'desync_payment', description: 'desync' });
    expect(result.applied).toBe(true);
    expect(result.message).toMatch(/paid → pending/);
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE orders SET payment_status'), ['pending', 'o1']);
  });

  it('impact "desync_payment" commande introuvable → applied:true sans crash', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await executeChaosImpact('o1', {}, { impact: 'desync_payment', description: 'desync' });
    expect(result).toEqual({ applied: true, message: 'desync' });
  });

  it('impact "log_incident" → insere une notification systeme', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await executeChaosImpact('o1', {}, { impact: 'log_incident', description: 'incident simule' });
    expect(result).toEqual({ applied: true, message: 'incident simule' });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_log'), expect.any(Array));
  });

  it('impact inconnu → applied:true par defaut, pas de crash', async () => {
    const result = await executeChaosImpact('o1', {}, { impact: 'inconnu', description: 'mystere' });
    expect(result).toEqual({ applied: true, message: 'mystere' });
  });
});
