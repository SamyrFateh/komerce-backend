'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/email.test.js
 * Couvre utils/email.js
 *
 * Bug de prod corrigé avant l'écriture de ce test : `log` était utilisé
 * partout dans ce fichier sans jamais être require() — chaque appel à
 * sendOrderEmail (toute branche confondue) plantait avec
 * ReferenceError: log is not defined. Voir utils/email.js ligne 29.
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
  forModule: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const ORIGINAL_ENV = { ...process.env };

function loadEmailModule({ brevoKey = 'xkeysib-test-key' } = {}) {
  let mod;
  jest.isolateModules(() => {
    process.env.BREVO_API_KEY = brevoKey;
    mod = require('../../utils/email');
  });
  return mod;
}

function baseOrder(overrides = {}) {
  return {
    reference: 'ORD-1',
    customer_email: 'client@example.km',
    customer_name: 'Jean Client',
    total_kmf: 50000,
    payment_mode: 'cash_relais',
    relay_name: 'Relais Moroni',
    ...overrides,
  };
}

describe('sendOrderEmail', () => {
  let originalFetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('pas d\'email client → skip sans appeler fetch', async () => {
    const { sendOrderEmail } = loadEmailModule();
    const result = await sendOrderEmail(baseOrder({ customer_email: null }), 'confirmed');
    expect(result).toEqual({ skipped: true, reason: 'no_email' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('statut sans template correspondant → skip sans appeler fetch', async () => {
    const { sendOrderEmail } = loadEmailModule();
    const result = await sendOrderEmail(baseOrder(), 'statut_inconnu');
    expect(result).toEqual({ skipped: true, reason: 'no_template' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('BREVO_API_KEY non configurée → skip sans appeler fetch', async () => {
    const { sendOrderEmail } = loadEmailModule({ brevoKey: '' });
    const result = await sendOrderEmail(baseOrder(), 'confirmed');
    expect(result).toEqual({ skipped: true, reason: 'no_api_key' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('nominal → appelle l\'API Brevo et retourne sent:true avec messageId', async () => {
    global.fetch.mockResolvedValue({
      json: async () => ({ messageId: 'msg-123' }),
    });
    const { sendOrderEmail } = loadEmailModule();

    const result = await sendOrderEmail(baseOrder(), 'confirmed');

    expect(result).toEqual({ sent: true, messageId: 'msg-123' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(opts.method).toBe('POST');
    expect(opts.headers['api-key']).toBe('xkeysib-test-key');
    const body = JSON.parse(opts.body);
    expect(body.to).toEqual([{ email: 'client@example.km', name: 'Jean Client' }]);
    expect(body.subject).toContain('ORD-1');
    expect(body.htmlContent).toContain('ORD-1');
  });

  it('reponse Brevo sans messageId → sent:false avec error', async () => {
    global.fetch.mockResolvedValue({
      json: async () => ({ message: 'Invalid sender' }),
    });
    const { sendOrderEmail } = loadEmailModule();

    const result = await sendOrderEmail(baseOrder(), 'confirmed');

    expect(result).toEqual({ sent: false, error: 'Invalid sender' });
  });

  it('fetch leve une exception → catch, sent:false avec error.message (pas de crash)', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    const { sendOrderEmail } = loadEmailModule();

    const result = await sendOrderEmail(baseOrder(), 'confirmed');

    expect(result).toEqual({ sent: false, error: 'network down' });
  });

  it('customer_name absent → fallback "Client" dans le destinataire', async () => {
    global.fetch.mockResolvedValue({ json: async () => ({ messageId: 'msg-1' }) });
    const { sendOrderEmail } = loadEmailModule();

    await sendOrderEmail(baseOrder({ customer_name: undefined }), 'confirmed');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.to[0].name).toBe('Client');
  });
});

describe('templates', () => {
  let templates;

  beforeAll(() => {
    process.env.BREVO_API_KEY = 'xkeysib-test-key';
    ({ templates } = require('../../utils/email'));
  });

  const order = {
    reference: 'ORD-42',
    customer_name: 'Jean',
    total_kmf: 12345,
    payment_mode: 'card',
    relay_name: 'Relais Moroni',
    relay_code: 'RLM',
    cash_ref_code: '7788',
    payment_status: 'paid',
  };

  it('expose un template pour chaque statut du cycle de vie commande', () => {
    const expectedStatuses = [
      'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit',
      'available', 'collected', 'cancelled', 'cash_reminder',
    ];
    expect(Object.keys(templates).sort()).toEqual(expectedStatuses.sort());
  });

  it.each([
    'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit',
    'available', 'collected', 'cancelled', 'cash_reminder',
  ])('template %s → retourne subject (string) et html (string) contenant la reference', (status) => {
    const { subject, html } = templates[status](order);
    expect(typeof subject).toBe('string');
    expect(typeof html).toBe('string');
    expect(subject).toContain('ORD-42');
    expect(html).toContain('ORD-42');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('template "available" sans cash_ref_code → pas de bloc code de retrait', () => {
    const { html } = templates.available({ ...order, cash_ref_code: undefined });
    expect(html).not.toContain('Code de retrait');
  });

  it('template "available" avec cash_ref_code → affiche le code', () => {
    const { html } = templates.available(order);
    expect(html).toContain('7788');
  });

  it('montant absent (total_kmf et total) → toLocaleString sur 0, pas de crash', () => {
    expect(() => templates.confirmed({ reference: 'ORD-0' })).not.toThrow();
    const { html } = templates.confirmed({ reference: 'ORD-0' });
    expect(html).toContain('0 KMF');
  });
});
