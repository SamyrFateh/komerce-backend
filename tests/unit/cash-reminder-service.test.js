'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../../utils/rules', () => ({ getRuleNumber: jest.fn() }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../services/notification-service', () => ({ notifyText: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const db = require('../../db');
const { getRuleNumber } = require('../../utils/rules');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const { notifyText } = require('../../services/notification-service');
const { processCashRelaisReminders, processBackorderReminders } = require('../../services/cash-reminder-service');

describe('cash-reminder-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRuleNumber.mockResolvedValue(36);
  });

  function txClient() {
    return { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }), release: jest.fn() };
  }

  it('processCashRelaisReminders envoie H+12 puis marque reminder_h12_sent', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'order-h12', reference: 'CMD-12', cash_ref_code: 'CASH12', user_phone: '+269000' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    await processCashRelaisReminders();

    expect(getRuleNumber).toHaveBeenCalledWith('CASH_PAYMENT_TIMEOUT_HOURS', 36);
    expect(db.query.mock.calls[0][1]).toEqual([12]);
    expect(notifyText).toHaveBeenCalledWith('+269000', expect.stringContaining('CMD-12'), 'reminder_h12', 'order-h12');
    expect(db.query.mock.calls[1][0]).toContain('reminder_h12_sent = TRUE');
  });

  it('processCashRelaisReminders annule H+36 via machine detat transactionnelle puis notifie apres commit', async () => {
    const client = txClient();
    db.pool.connect.mockResolvedValueOnce(client);
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-h36', reference: 'CMD-36', user_phone: '+269111' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: true, cancelEffects: { walletReversalAmount: 1000, stockItemsRestored: 2 } });

    await processCashRelaisReminders();

    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-h36', newStatus: 'cancelled', source: 'system', dbClient: client,
      cancelReason: 'Non-paiement cash relais après 36h',
    }));
    expect(client.query.mock.calls.map(c => c[0])).toEqual(['BEGIN', expect.stringContaining('reminder_h36_sent = TRUE'), 'COMMIT']);
    expect(notifyText).toHaveBeenCalledWith('+269111', expect.stringContaining('a été annulée'), 'reminder_h36', 'order-h36');
    expect(client.release).toHaveBeenCalled();
  });

  it('processCashRelaisReminders rollback si transition H+36 refuse', async () => {
    const client = txClient();
    db.pool.connect.mockResolvedValueOnce(client);
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-h36', reference: 'CMD-36', user_phone: '+269111' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'bad' });

    await processCashRelaisReminders();

    expect(client.query.mock.calls.map(c => c[0])).toContain('ROLLBACK');
    expect(notifyText).not.toHaveBeenCalledWith('+269111', expect.stringContaining('a été annulée'), 'reminder_h36', 'order-h36');
  });

  it('processCashRelaisReminders rollback si transaction H+36 throw', async () => {
    const client = txClient();
    client.query.mockImplementation(async (sql) => {
      if (String(sql).includes('reminder_h36_sent')) throw new Error('db_down');
      return { rows: [], rowCount: 1 };
    });
    db.pool.connect.mockResolvedValueOnce(client);
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-h36', reference: 'CMD-36', user_phone: '+269111' }] });
    transitionOrderStatus.mockResolvedValueOnce({ success: true });

    await processCashRelaisReminders();

    expect(client.query.mock.calls.map(c => c[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('processBackorderReminders notifie et marque les backorders expires', async () => {
    getRuleNumber.mockResolvedValueOnce(45);
    db.query
      .mockResolvedValueOnce({ rows: [
        { sub_order_id: 'parcel-1', tracking_ref: 'BO-1', order_reference: 'CMD-1', parent_order_id: 'order-1', user_phone: '+269001' },
        { sub_order_id: 'parcel-2', tracking_ref: 'BO-2', order_reference: 'CMD-2', parent_order_id: 'order-2', user_phone: null },
      ] })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(processBackorderReminders()).resolves.toEqual({ processed: 2, sms_sent: 1 });
    expect(db.query.mock.calls[0][1]).toEqual([45]);
    expect(notifyText).toHaveBeenCalledWith('+269001', expect.stringContaining('BO-1'), 'backorder_reminder', 'order-1');
    expect(db.query.mock.calls[1][0]).toContain('backorder_reminder_sent = TRUE');
    expect(db.query.mock.calls[2][1]).toEqual(['parcel-2']);
  });

  it('processBackorderReminders retourne erreur non bloquante si DB echoue', async () => {
    getRuleNumber.mockResolvedValueOnce(45);
    db.query.mockRejectedValueOnce(new Error('db_down'));

    await expect(processBackorderReminders()).resolves.toEqual({ processed: 0, sms_sent: 0, error: 'db_down' });
  });
});
