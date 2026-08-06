/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * Tests unitaires — services/notification-service.js
 * FRESH-103 : couverture minimale des fonctions critiques modifiées
 */
'use strict';

jest.mock('../../db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));
jest.mock('../../services/authkey-client', () => ({
  callAuthKeyText: jest.fn().mockResolvedValue({ ok: true }),
  sendSMS:         jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const db = require('../../db');
const authkeyClient = require('../../services/authkey-client');
const { callAuthKeyText } = authkeyClient;
const svc = require('../../services/notification-service');

describe('notification-service — sendOtpMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('appelle authkeyClient.sendWhatsApp avec le bon format', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await svc.sendOtpMessage({ phone: '+2690600000000', code: '123456', expiryMin: 10 });
    expect(callAuthKeyText).toHaveBeenCalledTimes(1);
    const [{ mobile: phone, message }] = callAuthKeyText.mock.calls[0];
    expect(phone).toBe('+2690600000000');
    expect(message).toContain('123456');
  });

  it('ne lève pas d\'exception si authkey échoue', async () => {
    callAuthKeyText.mockRejectedValueOnce(new Error('timeout'));
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(svc.sendOtpMessage({ phone: '+2690600000000', code: '000000', expiryMin: 10 })).resolves.not.toThrow();
  });
});

describe('notification-service — notifyText', () => {
  beforeEach(() => jest.clearAllMocks());

  it('envoie un message WhatsApp libre', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await svc.notifyText('+2690600000001', 'Message test', 'test_event');
    expect(callAuthKeyText).toHaveBeenCalledTimes(1);
    const { mobile } = callAuthKeyText.mock.calls[0][0];
    expect(mobile).toBe('+2690600000001');
  });

  it('retourne {ok:false} si le numéro est vide', async () => {
    const result = await svc.notifyText('', 'Test');
    expect(result).toMatchObject({ ok: false });
    expect(callAuthKeyText).not.toHaveBeenCalled();
  });
});

describe('notification-service — _loadOrderFromParcel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retourne null si le colis n\'existe pas', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await svc._loadOrderFromParcel('nonexistent-ref');
    expect(result).toBeNull();
  });

  it('retourne la commande si le colis est trouvé', async () => {
    const fakeOrder = { id: 'order-1', reference: 'KMC-001', customer_phone: '+2690600000000' };
    db.query.mockResolvedValueOnce({ rows: [fakeOrder] });
    const result = await svc._loadOrderFromParcel('PAR-001');
    expect(result).toEqual(fakeOrder);
  });
});
