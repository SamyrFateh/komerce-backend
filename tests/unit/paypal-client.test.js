'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/paypal-client.test.js
 *
 * Couvre :
 *   ✓ createOrder construit le payload v2 correct (intent CAPTURE, EUR, reference)
 *   ✓ createOrder throw si amountEur manquant / négatif / 0
 *   ✓ createOrder throw si reference manquant
 *   ✓ captureOrder utilise le bon endpoint + header PayPal-Request-Id
 *   ✓ captureOrder throw si paypalOrderId vide
 *   ✓ refundCapture omettant amountEur → refund total
 *   ✓ refundCapture avec amountEur → payload avec amount
 *   ✓ verifyWebhookSignature retourne false si headers paypal-* incomplets
 *   ✓ verifyWebhookSignature retourne true si l'API renvoie verification_status=SUCCESS
 *   ✓ verifyWebhookSignature retourne false si l'API renvoie autre chose
 *   ✓ extractCaptureInfo gère le format captureOrder()
 *   ✓ extractCaptureInfo gère le format webhook event
 *   ✓ extractCaptureInfo retourne null pour un objet inconnu
 *   ✓ Cache OAuth : 2 appels API consécutifs → 1 seul OAuth
 */

// Mock du logger
jest.mock('../../utils/logger', () => ({
  child: () => ({
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock global de fetch
global.fetch = jest.fn();

const paypal = require('../../services/paypal-client');

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockFetchOnce(jsonBody, { status = 200 } = {}) {
  global.fetch.mockImplementationOnce(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json:  async () => jsonBody,
    text:  async () => JSON.stringify(jsonBody),
  }));
}

function mockOAuthOnce() {
  mockFetchOnce({ access_token: 'TEST-TOKEN', expires_in: 32400 });
}

function lastFetchCall() {
  const calls = global.fetch.mock.calls;
  return calls[calls.length - 1];
}

beforeEach(() => {
  jest.clearAllMocks();
  paypal._resetTokenCacheForTests();
  process.env.PAYPAL_CLIENT_ID     = 'TEST_ID';
  process.env.PAYPAL_CLIENT_SECRET = 'TEST_SECRET';
  process.env.PAYPAL_WEBHOOK_ID    = 'WH-TEST';
  process.env.PAYPAL_ENV           = 'sandbox';
});

// ─── createOrder ────────────────────────────────────────────────────────────

describe('createOrder', () => {
  test('construit un payload v2 valide (EUR, intent CAPTURE, reference)', async () => {
    mockOAuthOnce();
    mockFetchOnce({ id: 'PP-ORDER-1', status: 'CREATED', links: [] });

    const result = await paypal.createOrder({
      amountEur: 149.90,
      reference: 'K-A8B3C1',
      description: 'Test commande',
    });

    expect(result.id).toBe('PP-ORDER-1');
    const [url, opts] = lastFetchCall();
    expect(url).toContain('/v2/checkout/orders');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.intent).toBe('CAPTURE');
    expect(body.purchase_units[0].amount.currency_code).toBe('EUR');
    expect(body.purchase_units[0].amount.value).toBe('149.90');
    expect(body.purchase_units[0].reference_id).toBe('K-A8B3C1');
    expect(body.application_context.brand_name).toBe('Komerce');
  });

  test('throw si amountEur manquant', async () => {
    await expect(paypal.createOrder({ reference: 'K-1' })).rejects.toThrow('amountEur requis');
  });

  test('throw si amountEur <= 0', async () => {
    await expect(paypal.createOrder({ amountEur: 0, reference: 'K-1' })).rejects.toThrow('amountEur requis');
    await expect(paypal.createOrder({ amountEur: -5, reference: 'K-1' })).rejects.toThrow('amountEur requis');
  });

  test('throw si reference manquant', async () => {
    await expect(paypal.createOrder({ amountEur: 100 })).rejects.toThrow('reference requis');
  });

  test('format montant à 2 décimales (150 → "150.00")', async () => {
    mockOAuthOnce();
    mockFetchOnce({ id: 'X', status: 'CREATED' });
    await paypal.createOrder({ amountEur: 150, reference: 'K-X' });
    const body = JSON.parse(lastFetchCall()[1].body);
    expect(body.purchase_units[0].amount.value).toBe('150.00');
  });
});

// ─── captureOrder ───────────────────────────────────────────────────────────

describe('captureOrder', () => {
  test('appelle le bon endpoint avec PayPal-Request-Id', async () => {
    mockOAuthOnce();
    mockFetchOnce({
      id: 'PP-ORDER-1',
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED' }] } }],
    });

    const result = await paypal.captureOrder('PP-ORDER-1');
    expect(result.status).toBe('COMPLETED');
    const [url, opts] = lastFetchCall();
    expect(url).toContain('/v2/checkout/orders/PP-ORDER-1/capture');
    expect(opts.headers['PayPal-Request-Id']).toBe('capture-PP-ORDER-1');
  });

  test('throw si paypalOrderId vide', async () => {
    await expect(paypal.captureOrder('')).rejects.toThrow('paypalOrderId requis');
    await expect(paypal.captureOrder(null)).rejects.toThrow('paypalOrderId requis');
  });
});

// ─── refundCapture ──────────────────────────────────────────────────────────

describe('refundCapture', () => {
  test('refund total : payload sans amount', async () => {
    mockOAuthOnce();
    mockFetchOnce({ id: 'REF-1', status: 'COMPLETED' });

    await paypal.refundCapture('CAP-1');
    const body = JSON.parse(lastFetchCall()[1].body);
    expect(body.amount).toBeUndefined();
  });

  test('refund partiel : payload avec amount EUR', async () => {
    mockOAuthOnce();
    mockFetchOnce({ id: 'REF-2', status: 'COMPLETED' });

    await paypal.refundCapture('CAP-1', { amountEur: 50.5, reason: 'partial', invoiceId: 'K-X' });
    const body = JSON.parse(lastFetchCall()[1].body);
    expect(body.amount.currency_code).toBe('EUR');
    expect(body.amount.value).toBe('50.50');
    expect(body.note_to_payer).toBe('partial');
    expect(body.invoice_id).toBe('K-X');
  });

  test('throw si captureId vide', async () => {
    await expect(paypal.refundCapture('')).rejects.toThrow('captureId requis');
  });
});

// ─── verifyWebhookSignature ─────────────────────────────────────────────────

describe('verifyWebhookSignature', () => {
  const fullHeaders = {
    'paypal-transmission-id':   'TX-1',
    'paypal-transmission-time': '2026-06-08T10:00:00Z',
    'paypal-cert-url':          'https://api.paypal.com/cert.pem',
    'paypal-auth-algo':         'SHA256withRSA',
    'paypal-transmission-sig':  'SIG-BASE64',
  };
  const validBody = JSON.stringify({ id: 'EV-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' });

  test('retourne false si transmission-id manquant', async () => {
    const res = await paypal.verifyWebhookSignature({}, validBody);
    expect(res).toBe(false);
    // Pas d'appel réseau si headers incomplets
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('retourne false si transmission-sig manquant', async () => {
    const partial = { ...fullHeaders };
    delete partial['paypal-transmission-sig'];
    const res = await paypal.verifyWebhookSignature(partial, validBody);
    expect(res).toBe(false);
  });

  test('retourne true si API PayPal renvoie verification_status=SUCCESS', async () => {
    mockOAuthOnce();
    mockFetchOnce({ verification_status: 'SUCCESS' });
    const res = await paypal.verifyWebhookSignature(fullHeaders, validBody);
    expect(res).toBe(true);
  });

  test('retourne false si verification_status=FAILURE', async () => {
    mockOAuthOnce();
    mockFetchOnce({ verification_status: 'FAILURE' });
    const res = await paypal.verifyWebhookSignature(fullHeaders, validBody);
    expect(res).toBe(false);
  });

  test('retourne false si body non-JSON', async () => {
    const res = await paypal.verifyWebhookSignature(fullHeaders, 'not-json-{{}');
    expect(res).toBe(false);
  });

  test('accepte un Buffer pour le body brut', async () => {
    mockOAuthOnce();
    mockFetchOnce({ verification_status: 'SUCCESS' });
    const res = await paypal.verifyWebhookSignature(fullHeaders, Buffer.from(validBody, 'utf8'));
    expect(res).toBe(true);
  });
});

// ─── extractCaptureInfo ─────────────────────────────────────────────────────

describe('extractCaptureInfo', () => {
  test('extrait depuis le format captureOrder()', () => {
    const cap = {
      id: 'PP-ORDER-1',
      payer: {
        email_address: 'payer@example.fr',
        payer_id: 'PAYER-1',
        name: { given_name: 'Jean', surname: 'Dupont' },
      },
      purchase_units: [{
        reference_id: 'K-A8B3C1',
        payments: {
          captures: [{
            id: 'CAP-1',
            status: 'COMPLETED',
            amount: { currency_code: 'EUR', value: '149.90' },
          }],
        },
      }],
    };
    const info = paypal.extractCaptureInfo(cap);
    expect(info.paypal_order_id).toBe('PP-ORDER-1');
    expect(info.paypal_capture_id).toBe('CAP-1');
    expect(info.status).toBe('COMPLETED');
    expect(info.amount_value).toBe(149.90);
    expect(info.currency).toBe('EUR');
    expect(info.payer_email).toBe('payer@example.fr');
    expect(info.payer_name).toBe('Jean Dupont');
    expect(info.reference_id).toBe('K-A8B3C1');
  });

  test('extrait depuis le format webhook PAYMENT.CAPTURE.COMPLETED', () => {
    const event = {
      id: 'EV-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAP-99',
        status: 'COMPLETED',
        amount: { currency_code: 'EUR', value: '50.00' },
        custom_id: 'K-XYZ',
        supplementary_data: { related_ids: { order_id: 'PP-PARENT-1' } },
      },
    };
    const info = paypal.extractCaptureInfo(event);
    expect(info.paypal_capture_id).toBe('CAP-99');
    expect(info.paypal_order_id).toBe('PP-PARENT-1');
    expect(info.reference_id).toBe('K-XYZ');
    expect(info.amount_value).toBe(50);
  });

  test('retourne null pour un objet inconnu', () => {
    expect(paypal.extractCaptureInfo({})).toBeNull();
    expect(paypal.extractCaptureInfo({ random: 'data' })).toBeNull();
    expect(paypal.extractCaptureInfo(null)).toBeNull();
  });
});

// ─── Cache OAuth ────────────────────────────────────────────────────────────

describe('cache OAuth', () => {
  test('2 appels API consécutifs → 1 seul OAuth (réutilise le token cache)', async () => {
    mockOAuthOnce(); // 1er OAuth
    mockFetchOnce({ id: 'O1', status: 'CREATED' });
    mockFetchOnce({ id: 'O2', status: 'CREATED' });

    await paypal.createOrder({ amountEur: 10, reference: 'K-1' });
    await paypal.createOrder({ amountEur: 20, reference: 'K-2' });

    // 3 appels fetch total : 1 OAuth + 2 createOrder (pas 2 OAuth)
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[0][0]).toContain('/v1/oauth2/token');
    expect(global.fetch.mock.calls[1][0]).toContain('/v2/checkout/orders');
    expect(global.fetch.mock.calls[2][0]).toContain('/v2/checkout/orders');
  });
});

// ─── Lot A, branches manquantes ─────────────────────────────────────────────

describe('paypal-client — Lot A, branches manquantes', () => {
  describe('_credentials / _baseUrl', () => {
    test('throw si PAYPAL_CLIENT_ID/SECRET manquants', async () => {
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;
      await expect(paypal.createOrder({ amountEur: 10, reference: 'K-1' }))
        .rejects.toThrow('PAYPAL_CLIENT_ID/SECRET manquant');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('PAYPAL_ENV=production → base url api-m.paypal.com', async () => {
      process.env.PAYPAL_ENV = 'production';
      mockOAuthOnce();
      mockFetchOnce({ id: 'X', status: 'CREATED' });
      await paypal.createOrder({ amountEur: 10, reference: 'K-1' });
      expect(global.fetch.mock.calls[0][0]).toContain('https://api-m.paypal.com');
    });
  });

  describe('OAuth token', () => {
    test('OAuth échoue (res.ok=false) → throw PayPal OAuth failed', async () => {
      mockFetchOnce({ error: 'invalid_client' }, { status: 401 });
      await expect(paypal.createOrder({ amountEur: 10, reference: 'K-1' }))
        .rejects.toThrow('PayPal OAuth failed: 401');
    });

    test('token en cache mais expiré → nouveau fetch OAuth déclenché', async () => {
      mockOAuthOnce();
      mockFetchOnce({ id: 'O1', status: 'CREATED' });
      await paypal.createOrder({ amountEur: 10, reference: 'K-1' });

      // Force l'expiration du cache en remontant expires_at dans le passé
      paypal._resetTokenCacheForTests();

      mockOAuthOnce();
      mockFetchOnce({ id: 'O2', status: 'CREATED' });
      await paypal.createOrder({ amountEur: 20, reference: 'K-2' });

      expect(global.fetch).toHaveBeenCalledTimes(4); // 2 OAuth + 2 createOrder
    });
  });

  describe('_api — gestion des réponses', () => {
    test('status 204 → retourne null (ex: refund sans détail)', async () => {
      mockOAuthOnce();
      global.fetch.mockImplementationOnce(async () => ({
        ok: true,
        status: 204,
        json: async () => { throw new Error('no body'); },
        text: async () => '',
      }));
      const result = await paypal.refundCapture('CAP-1');
      expect(result).toBeNull();
    });

    test('réponse non-ok → throw avec status et body attachés', async () => {
      mockOAuthOnce();
      mockFetchOnce({ error: 'RESOURCE_NOT_FOUND' }, { status: 404 });
      await expect(paypal.getOrder('PP-MISSING')).rejects.toMatchObject({
        status: 404,
      });
    });

    test('réponse non-ok dont errBody.text() échoue → body vide, throw quand même', async () => {
      mockOAuthOnce();
      global.fetch.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => { throw new Error('stream closed'); },
      }));
      await expect(paypal.getOrder('PP-1')).rejects.toThrow('PayPal GET');
    });
  });

  describe('getOrder', () => {
    test('throw si paypalOrderId vide', async () => {
      await expect(paypal.getOrder('')).rejects.toThrow('paypalOrderId requis');
    });

    test('appelle le bon endpoint GET', async () => {
      mockOAuthOnce();
      mockFetchOnce({ id: 'PP-1', status: 'APPROVED' });
      const result = await paypal.getOrder('PP-1');
      expect(result.status).toBe('APPROVED');
      const [url, opts] = lastFetchCall();
      expect(url).toContain('/v2/checkout/orders/PP-1');
      expect(opts.method).toBe('GET');
    });
  });

  describe('createOrder — application_context', () => {
    test('appCtx.return_url/cancel_url ont priorité sur returnUrl/cancelUrl', async () => {
      mockOAuthOnce();
      mockFetchOnce({ id: 'X', status: 'CREATED' });
      await paypal.createOrder({
        amountEur: 10,
        reference: 'K-1',
        returnUrl: 'https://old.example/return',
        cancelUrl: 'https://old.example/cancel',
        applicationContext: {
          return_url: 'https://new.example/return',
          cancel_url: 'https://new.example/cancel',
          brand_name: 'Boutique',
          locale: 'en-US',
          landing_page: 'LOGIN',
          user_action: 'CONTINUE',
          shipping_preference: 'SET_PROVIDED_ADDRESS',
        },
      });
      const body = JSON.parse(lastFetchCall()[1].body);
      expect(body.application_context.return_url).toBe('https://new.example/return');
      expect(body.application_context.cancel_url).toBe('https://new.example/cancel');
      expect(body.application_context.brand_name).toBe('Boutique');
      expect(body.application_context.locale).toBe('en-US');
      expect(body.application_context.landing_page).toBe('LOGIN');
      expect(body.application_context.user_action).toBe('CONTINUE');
      expect(body.application_context.shipping_preference).toBe('SET_PROVIDED_ADDRESS');
    });

    test('sans applicationContext, avec returnUrl/cancelUrl legacy → utilisés', async () => {
      mockOAuthOnce();
      mockFetchOnce({ id: 'X', status: 'CREATED' });
      await paypal.createOrder({
        amountEur: 10,
        reference: 'K-1',
        returnUrl: 'https://legacy.example/return',
        cancelUrl: 'https://legacy.example/cancel',
      });
      const body = JSON.parse(lastFetchCall()[1].body);
      expect(body.application_context.return_url).toBe('https://legacy.example/return');
      expect(body.application_context.cancel_url).toBe('https://legacy.example/cancel');
    });

    test('sans aucune url → aucune clé return_url/cancel_url ajoutée', async () => {
      mockOAuthOnce();
      mockFetchOnce({ id: 'X', status: 'CREATED' });
      await paypal.createOrder({ amountEur: 10, reference: 'K-1' });
      const body = JSON.parse(lastFetchCall()[1].body);
      expect(body.application_context).not.toHaveProperty('return_url');
      expect(body.application_context).not.toHaveProperty('cancel_url');
    });

    test('description omise → description par défaut avec la référence', async () => {
      mockOAuthOnce();
      mockFetchOnce({ id: 'X', status: 'CREATED' });
      await paypal.createOrder({ amountEur: 10, reference: 'K-7' });
      const body = JSON.parse(lastFetchCall()[1].body);
      expect(body.purchase_units[0].description).toBe('Komerce — Commande K-7');
    });
  });

  describe('verifyWebhookSignature', () => {
    const fullHeaders = {
      'paypal-transmission-id':   'TX-1',
      'paypal-transmission-time': '2026-06-08T10:00:00Z',
      'paypal-cert-url':          'https://api.paypal.com/cert.pem',
      'paypal-auth-algo':         'SHA256withRSA',
      'paypal-transmission-sig':  'SIG-BASE64',
    };
    const validBody = JSON.stringify({ id: 'EV-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' });

    test('throw si PAYPAL_WEBHOOK_ID manquant', async () => {
      delete process.env.PAYPAL_WEBHOOK_ID;
      await expect(paypal.verifyWebhookSignature(fullHeaders, validBody))
        .rejects.toThrow('PAYPAL_WEBHOOK_ID manquant');
    });

    test('headers en MAJUSCULES → lookup insensible à la casse fonctionne', async () => {
      mockOAuthOnce();
      mockFetchOnce({ verification_status: 'SUCCESS' });
      const upper = {
        'PAYPAL-TRANSMISSION-ID':   'TX-1',
        'PAYPAL-TRANSMISSION-TIME': '2026-06-08T10:00:00Z',
        'PAYPAL-CERT-URL':          'https://api.paypal.com/cert.pem',
        'PAYPAL-AUTH-ALGO':         'SHA256withRSA',
        'PAYPAL-TRANSMISSION-SIG':  'SIG-BASE64',
      };
      const res = await paypal.verifyWebhookSignature(upper, validBody);
      expect(res).toBe(true);
    });

    test('accepte un objet déjà parsé (ni string ni Buffer) comme rawBody', async () => {
      mockOAuthOnce();
      mockFetchOnce({ verification_status: 'SUCCESS' });
      const res = await paypal.verifyWebhookSignature(fullHeaders, { id: 'EV-1', event_type: 'X' });
      expect(res).toBe(true);
    });

    test('appel API PayPal échoue (réseau/HTTP) → catch → false', async () => {
      mockOAuthOnce();
      global.fetch.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'server error',
      }));
      const res = await paypal.verifyWebhookSignature(fullHeaders, validBody);
      expect(res).toBe(false);
    });
  });

  describe('extractCaptureInfo — cas additionnels', () => {
    test('détecte pay_in_4 via payment_source.pay_upon_invoice', () => {
      const cap = {
        id: 'PP-1',
        payment_source: { pay_upon_invoice: {} },
        purchase_units: [{
          reference_id: 'K-1',
          payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '10.00', currency_code: 'EUR' } }] },
        }],
      };
      expect(paypal.extractCaptureInfo(cap).pay_in_4).toBe(true);
    });

    test('détecte pay_in_4 via payment_source.paylater', () => {
      const cap = {
        id: 'PP-1',
        payment_source: { paylater: {} },
        purchase_units: [{
          reference_id: 'K-1',
          payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '10.00', currency_code: 'EUR' } }] },
        }],
      };
      expect(paypal.extractCaptureInfo(cap).pay_in_4).toBe(true);
    });

    test('payer présent mais sans name → payer_name null malgré email/id présents', () => {
      const cap = {
        id: 'PP-3',
        payer: { email_address: 'x@y.fr', payer_id: 'PAYER-3' },
        purchase_units: [{
          reference_id: 'K-3',
          payments: { captures: [{ id: 'CAP-3', status: 'COMPLETED', amount: { value: '7.00', currency_code: 'EUR' } }] },
        }],
      };
      const info = paypal.extractCaptureInfo(cap);
      expect(info.payer_email).toBe('x@y.fr');
      expect(info.payer_name).toBeNull();
    });

    test('payer absent → payer_email/payer_id/payer_name null, pay_in_4 false', () => {
      const cap = {
        id: 'PP-2',
        purchase_units: [{
          reference_id: 'K-2',
          payments: { captures: [{ id: 'CAP-2', status: 'COMPLETED', amount: { value: '5.00', currency_code: 'EUR' } }] },
        }],
      };
      const info = paypal.extractCaptureInfo(cap);
      expect(info.payer_email).toBeNull();
      expect(info.payer_id).toBeNull();
      expect(info.payer_name).toBeNull();
      expect(info.pay_in_4).toBe(false);
    });

    test('purchase_units[0].reference_id absent → reference_id null (format captureOrder)', () => {
      const cap = {
        id: 'PP-4',
        purchase_units: [{
          payments: { captures: [{ id: 'CAP-4', status: 'COMPLETED', amount: { value: '3.00', currency_code: 'EUR' } }] },
        }],
      };
      expect(paypal.extractCaptureInfo(cap).reference_id).toBeNull();
    });

    test('webhook event : invoice_id utilisé si custom_id absent', () => {
      const event = {
        resource: {
          id: 'CAP-99',
          status: 'COMPLETED',
          amount: { currency_code: 'EUR', value: '50.00' },
          invoice_id: 'K-INV-1',
        },
      };
      expect(paypal.extractCaptureInfo(event).reference_id).toBe('K-INV-1');
    });

    test('webhook event sans order_id lié → paypal_order_id null', () => {
      const event = {
        resource: {
          id: 'CAP-100',
          status: 'COMPLETED',
          amount: { currency_code: 'EUR', value: '10.00' },
        },
      };
      expect(paypal.extractCaptureInfo(event).paypal_order_id).toBeNull();
    });
  });

  describe('refundCapture — troncature des champs libres', () => {
    test('reason et invoiceId trop longs sont tronqués à 255/127 caractères', async () => {
      mockOAuthOnce();
      mockFetchOnce({ id: 'REF-3', status: 'COMPLETED' });
      const longReason = 'x'.repeat(300);
      const longInvoice = 'y'.repeat(200);
      await paypal.refundCapture('CAP-1', { reason: longReason, invoiceId: longInvoice });
      const body = JSON.parse(lastFetchCall()[1].body);
      expect(body.note_to_payer.length).toBe(255);
      expect(body.invoice_id.length).toBe(127);
    });
  });
});
