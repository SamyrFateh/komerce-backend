'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/orderParcelLinkRules.test.js
 * Couvre utils/orderParcelLinkRules.js
 */

jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/parcels', () => ({ computeOrderStatus: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
  forModule: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const { transitionOrderStatus } = require('../../services/order-status-machine');
const { computeOrderStatus } = require('../../utils/parcels');
const { evaluateOrderParcelLinkRules } = require('../../utils/orderParcelLinkRules');

function makeDb(script) {
  const queue = [...script];
  return { query: jest.fn(async () => queue.shift()) };
}

describe('orderParcelLinkRules', () => {
  beforeEach(() => jest.clearAllMocks());

  it('aucun colis pour la commande → retourne null sans aller plus loin', async () => {
    const db = makeDb([{ rows: [] }]);
    const result = await evaluateOrderParcelLinkRules('order-1', db);
    expect(result).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('commande introuvable → retourne null', async () => {
    const db = makeDb([
      { rows: [{ status: 'shipped' }] }, // parcels
      { rows: [] }, // orders
    ]);
    const result = await evaluateOrderParcelLinkRules('order-x', db);
    expect(result).toBeNull();
  });

  it('statut calcule = collected et transition reussie → R1_ALL_COLLECTED', async () => {
    const db = makeDb([
      { rows: [{ status: 'collected' }] },
      { rows: [{ id: 'order-1', status: 'available' }] },
    ]);
    computeOrderStatus.mockReturnValue('collected');
    transitionOrderStatus.mockResolvedValue({ success: true, noop: false });

    const result = await evaluateOrderParcelLinkRules('order-1', db);
    expect(result).toBe('R1_ALL_COLLECTED');
    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-1',
      newStatus: 'collected',
      source: 'system',
    }));
  });

  it('statut calcule different et transition reussie (non-collected) → R3_STATUS_ADVANCED', async () => {
    const db = makeDb([
      { rows: [{ status: 'shipped' }] },
      { rows: [{ id: 'order-1', status: 'preparation' }] },
    ]);
    computeOrderStatus.mockReturnValue('shipped');
    transitionOrderStatus.mockResolvedValue({ success: true, noop: false });

    const result = await evaluateOrderParcelLinkRules('order-1', db);
    expect(result).toBe('R3_STATUS_ADVANCED');
  });

  it('transition retourne noop:true → ne compte pas comme avancement, continue vers R2/null', async () => {
    const db = makeDb([
      { rows: [{ status: 'cancelled' }] },
      { rows: [{ id: 'order-1', status: 'preparation' }] },
    ]);
    computeOrderStatus.mockReturnValue('cancelled');
    transitionOrderStatus.mockResolvedValue({ success: true, noop: true });

    const result = await evaluateOrderParcelLinkRules('order-1', db);
    // computedStatus 'cancelled' !== order.status, noop → pas de R1/R3
    // tous les colis sont cancelled mais order.status n'est pas 'collected' → R2
    expect(result).toBe('R2_ALL_PARCELS_CANCELLED');
  });

  it('transition refusee (success:false) → ne renvoie pas R1/R3, evalue R2', async () => {
    const db = makeDb([
      { rows: [{ status: 'cancelled' }, { status: 'cancelled' }] },
      { rows: [{ id: 'order-1', status: 'preparation' }] },
    ]);
    computeOrderStatus.mockReturnValue('cancelled');
    transitionOrderStatus.mockResolvedValue({ success: false, error: 'refuse' });

    const result = await evaluateOrderParcelLinkRules('order-1', db);
    expect(result).toBe('R2_ALL_PARCELS_CANCELLED');
  });

  it('tous les colis cancelled mais commande deja collected → pas de R2, retourne null', async () => {
    const db = makeDb([
      { rows: [{ status: 'cancelled' }] },
      { rows: [{ id: 'order-1', status: 'collected' }] },
    ]);
    computeOrderStatus.mockReturnValue('collected');
    transitionOrderStatus.mockResolvedValue({ success: true, noop: true });

    const result = await evaluateOrderParcelLinkRules('order-1', db);
    expect(result).toBeNull();
  });

  it('statut calcule identique au statut actuel et colis non tous cancelled → retourne null', async () => {
    const db = makeDb([
      { rows: [{ status: 'shipped' }] },
      { rows: [{ id: 'order-1', status: 'shipped' }] },
    ]);
    computeOrderStatus.mockReturnValue('shipped');

    const result = await evaluateOrderParcelLinkRules('order-1', db);
    expect(result).toBeNull();
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });
});
