'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Mobile Money provider adapters — contrats purs sans réseau réel.
 * Vérifie notamment que montant/devise/référence viennent des paramètres
 * serveur et que les credentials ne sortent jamais dans le résultat public.
 */

const crypto = require('crypto');

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const orange = require('../../services/mobile-money/orange-money-cm');
const mtn = require('../../services/mobile-money/mtn-momo-cg');
const kartapay = require('../../services/mobile-money/kartapay-km');
const registry = require('../../services/mobile-money/registry');

function response(body, status = 200) {
  const text = body == null ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

beforeEach(() => {
  orange._resetTokenCacheForTests();
  mtn._resetTokenCacheForTests();
  kartapay._resetTokenCacheForTests();
  delete process.env.KOMERCE_ENV;
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith('ORANGE_MONEY_CM_') ||
      key.startsWith('MTN_MOMO_CG_') ||
      key.startsWith('KARTAPAY_')
    ) {
      delete process.env[key];
    }
  }
});

describe('Orange Money Cameroun adapter', () => {
  function configure() {
    process.env.ORANGE_MONEY_CM_CLIENT_ID = 'orange-client';
    process.env.ORANGE_MONEY_CM_CLIENT_SECRET = 'orange-secret';
    process.env.ORANGE_MONEY_CM_MERCHANT_KEY = 'merchant-key';
    process.env.ORANGE_MONEY_CM_PAYMENT_URL = 'https://orange.test/pay';
    process.env.ORANGE_MONEY_CM_STATUS_URL = 'https://orange.test/status';
  }

  test('reste fail-closed sans contrat marchand complet', () => {
    expect(orange.isConfigured()).toBe(false);
    configure();
    expect(orange.isConfigured()).toBe(true);
  });

  test('initiation utilise uniquement le montant/devise/référence serveur et renvoie une redirection', async () => {
    configure();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ access_token: 'TOKEN', expires_in: 3600 }))
      .mockResolvedValueOnce(response({
        pay_token: 'PAY-TOKEN-1',
        payment_url: 'https://orange.test/checkout/PAY-TOKEN-1',
        status: 'INITIATED',
        notif_token: 'MUST_NOT_LEAK',
      }));

    const result = await orange.initiate({
      orderReference: 'K-CM-001',
      amount: 13280,
      currency: 'XAF',
      callbackUrl: 'https://komerce.test/api/payments/mobile-money/callback/orange_money/tx-1',
      returnUrl: 'https://komerce.test/boutique/?ok=1',
      cancelUrl: 'https://komerce.test/boutique/?cancel=1',
      fetchImpl,
    });

    expect(result.externalTransactionId).toBe('PAY-TOKEN-1');
    expect(result.clientAction).toEqual({
      type: 'redirect',
      url: 'https://orange.test/checkout/PAY-TOKEN-1',
    });
    expect(JSON.stringify(result)).not.toContain('MUST_NOT_LEAK');
    expect(JSON.stringify(result)).not.toContain('orange-secret');

    const [, paymentOpts] = fetchImpl.mock.calls[1];
    const payload = JSON.parse(paymentOpts.body);
    expect(payload).toMatchObject({
      order_id: 'K-CM-001',
      amount: 13280,
      currency: 'XAF',
      merchant_key: 'merchant-key',
    });
  });

  test.each([
    ['SUCCESS', 'succeeded'],
    ['PAID', 'succeeded'],
    ['FAILED', 'failed'],
    ['EXPIRED', 'expired'],
    ['PENDING', 'pending'],
  ])('normalise statut %s → %s', (providerStatus, expected) => {
    expect(orange.normalizeStatus({ status: providerStatus })).toBe(expected);
  });
});

describe('MTN MoMo Congo adapter', () => {
  function configure({
    baseUrl = 'https://mtn.test',
    targetEnv = 'mtncongo',
  } = {}) {
    process.env.MTN_MOMO_CG_BASE_URL = baseUrl;
    process.env.MTN_MOMO_CG_SUBSCRIPTION_KEY = 'subscription-key';
    process.env.MTN_MOMO_CG_API_USER = 'api-user';
    process.env.MTN_MOMO_CG_API_KEY = 'api-key';
    process.env.MTN_MOMO_CG_TARGET_ENVIRONMENT = targetEnv;
  }

  function configureSandbox() {
    process.env.KOMERCE_ENV = 'staging';
    configure({
      baseUrl: 'https://sandbox.momodeveloper.mtn.com',
      targetEnv: 'sandbox',
    });
  }

  test('reste fail-closed tant que les credentials Collections sont incomplets', () => {
    expect(mtn.isConfigured()).toBe(false);
    configure();
    expect(mtn.isConfigured()).toBe(true);
  });

  test('refuse de rendre un credential Sandbox disponible sur le runtime métier production', () => {
    configureSandbox();
    process.env.KOMERCE_ENV = 'production';
    expect(mtn.isConfigured()).toBe(false);
  });

  test('RequestToPay production-like envoie montant XAF, X-Reference-Id, callback et MSISDN normalisé', async () => {
    configure();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ access_token: 'MTN-TOKEN', expires_in: 3600 }))
      .mockResolvedValueOnce(response(null, 202));

    const result = await mtn.initiate({
      orderReference: 'K-CG-001',
      amount: 26560,
      currency: 'XAF',
      msisdn: '+242 06 123 45 67',
      callbackUrl: 'https://komerce.test/api/payments/mobile-money/callback/mtn_momo/tx-2',
      fetchImpl,
    });

    expect(result.status).toBe('pending');
    expect(result.externalTransactionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.clientAction.type).toBe('approval');

    const [url, opts] = fetchImpl.mock.calls[1];
    expect(url).toBe('https://mtn.test/collection/v1_0/requesttopay');
    expect(opts.headers['Ocp-Apim-Subscription-Key']).toBe('subscription-key');
    expect(opts.headers['X-Target-Environment']).toBe('mtncongo');
    expect(opts.headers['X-Reference-Id']).toBe(result.externalTransactionId);
    expect(opts.headers['X-Callback-Url']).toContain('/callback/mtn_momo/tx-2');
    const payload = JSON.parse(opts.body);
    expect(payload.amount).toBe('26560');
    expect(payload.currency).toBe('XAF');
    expect(payload.externalId).toBe('K-CG-001');
    expect(payload.payer).toEqual({ partyIdType: 'MSISDN', partyId: '242061234567' });
    expect(JSON.stringify(result)).not.toContain('api-key');
  });

  test('Sandbox garde la commande en XAF mais transporte une valeur synthétique 1000 EUR vers MTN', async () => {
    configureSandbox();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ access_token: 'MTN-TOKEN', expires_in: 3600 }))
      .mockResolvedValueOnce(response(null, 202))
      .mockResolvedValueOnce(response({
        status: 'SUCCESSFUL',
        amount: '1000',
        currency: 'EUR',
        externalId: 'K-CG-STAGING-001',
      }));

    const initiated = await mtn.initiate({
      orderReference: 'K-CG-STAGING-001',
      amount: 26560,
      currency: 'XAF',
      msisdn: '+242 06 123 45 67',
      callbackUrl: 'https://komerce.co/api/payments/mobile-money/callback/mtn_momo/tx-staging',
      fetchImpl,
    });

    const [, paymentOpts] = fetchImpl.mock.calls[1];
    const payload = JSON.parse(paymentOpts.body);
    expect(payload.amount).toBe('1000');
    expect(payload.currency).toBe('EUR');
    expect(initiated.safePayload).toEqual({
      sandbox_transport: true,
      amount: 1000,
      currency: 'EUR',
    });
    expect(initiated.clientAction.message).toMatch(/Sandbox/);

    const status = await mtn.getStatus({
      externalTransactionId: initiated.externalTransactionId,
      fetchImpl,
    });
    expect(status.status).toBe('succeeded');
    expect(status.providerStatus).toBe('SUCCESSFUL');
    // Le contrat économique reste celui de la transaction Komerce XAF ; le
    // couple EUR/1000 n'est conservé que dans le payload d'audit provider.
    expect(status.amount).toBeNull();
    expect(status.currency).toBeNull();
    expect(status.safePayload).toMatchObject({
      amount: '1000',
      currency: 'EUR',
      sandbox_transport: true,
    });
  });

  test('Sandbox fail-closed si MTN renvoie un autre montant ou une autre devise de transport', async () => {
    configureSandbox();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ access_token: 'MTN-TOKEN', expires_in: 3600 }))
      .mockResolvedValueOnce(response({
        status: 'SUCCESSFUL',
        amount: '999',
        currency: 'EUR',
      }));

    await expect(mtn.getStatus({
      externalTransactionId: '11111111-1111-4111-8111-111111111111',
      fetchImpl,
    })).rejects.toMatchObject({ code: 'mtn_momo_sandbox_contract_mismatch' });
  });

  test.each([
    ['SUCCESSFUL', 'succeeded'],
    ['FAILED', 'failed'],
    ['EXPIRED', 'expired'],
    ['PENDING', 'pending'],
  ])('normalise statut %s → %s', (providerStatus, expected) => {
    expect(mtn.normalizeStatus({ status: providerStatus })).toBe(expected);
  });
});

describe('KartaPay Comores adapter', () => {
  const merchantId = 'f66d217e-22be-4e8c-a461-bcf9a355190a';
  const webhookSecret = 'kartapay-webhook-secret';

  function configureStaging() {
    process.env.KOMERCE_ENV = 'staging';
    process.env.KARTAPAY_ENV = 'staging';
    process.env.KARTAPAY_CLIENT_ID = 'kartapay-client';
    process.env.KARTAPAY_CLIENT_SECRET = 'kartapay-secret';
    process.env.KARTAPAY_MERCHANT_ID = merchantId;
    process.env.KARTAPAY_WEBHOOK_SECRET = webhookSecret;
  }

  test('reste fail-closed sans credentials complets et refuse staging en production', () => {
    expect(kartapay.isConfigured()).toBe(false);
    configureStaging();
    expect(kartapay.isConfigured()).toBe(true);
    process.env.KOMERCE_ENV = 'production';
    expect(kartapay.isConfigured()).toBe(false);
  });

  test('crée un paiement KMF staging et renvoie le submitUrl sans exposer les secrets', async () => {
    configureStaging();
    const expectedClientId = kartapay._stableClientIdForTests('K-KM-001');
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ access_token: 'KP-TOKEN', expires_in: 3600 }))
      .mockResolvedValueOnce(response({
        next: 'https://checkout-staging.kartapay.me/payment/submit/67928bcc4c9deaf5696a0942',
        data: {
          id: '67928bcc4c9deaf5696a0942',
          status: 'pending',
          captured: false,
          clientId: expectedClientId,
          purchase: { total: { value: '1475', currency: 'KMF' } },
          billing: {
            submitUrl: 'https://checkout-staging.kartapay.me/payment/submit/67928bcc4c9deaf5696a0942',
          },
        },
      }, 201));

    const result = await kartapay.initiate({
      orderReference: 'K-KM-001',
      amount: 1475,
      currency: 'KMF',
      returnUrl: 'https://komerce.co/boutique/?mobile_money=return&order=K-KM-001',
      cancelUrl: 'https://komerce.co/boutique/?mobile_money=cancel&order=K-KM-001',
      fetchImpl,
    });

    expect(fetchImpl.mock.calls[0][0]).toBe('https://auth.kartapay.me/staging/token');
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api-staging.kartapay.me/v1/payments');
    const payload = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(payload.purchase.total).toEqual({ value: '1475', currency: 'KMF' });
    expect(payload.clientId).toBe(expectedClientId);
    expect(payload.type).toBe('instant');
    expect(result.externalTransactionId).toBe('67928bcc4c9deaf5696a0942');
    expect(result.clientAction).toEqual({
      type: 'redirect',
      url: 'https://checkout-staging.kartapay.me/payment/submit/67928bcc4c9deaf5696a0942',
    });
    expect(result.safePayload.client_id).toBe(expectedClientId);
    expect(JSON.stringify(result)).not.toContain('kartapay-secret');
    expect(JSON.stringify(result)).not.toContain(webhookSecret);
  });

  test('relit le paiement par API authentifiée et expose montant/devise pour le contrôle Komerce', async () => {
    configureStaging();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ access_token: 'KP-TOKEN', expires_in: 3600 }))
      .mockResolvedValueOnce(response({
        id: '67928bcc4c9deaf5696a0942',
        status: 'completed',
        captured: true,
        purchase: { total: { value: '1475', currency: 'KMF' } },
        completedAt: '2026-09-10T18:37:17.115Z',
      }));

    const result = await kartapay.getStatus({
      externalTransactionId: '67928bcc4c9deaf5696a0942',
      fetchImpl,
    });

    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://api-staging.kartapay.me/v1/payments/67928bcc4c9deaf5696a0942'
    );
    expect(result).toMatchObject({
      status: 'succeeded',
      providerStatus: 'completed',
      amount: 1475,
      currency: 'KMF',
    });
  });

  test('vérifie HMAC webhook sur les 7 champs KartaPay et refuse toute altération', () => {
    configureStaging();
    const clientId = kartapay._stableClientIdForTests('K-KM-001');
    const payload = {
      topic: 'payment.completed',
      data: {
        id: '67928bcc4c9deaf5696a0942',
        status: 'completed',
        captured: true,
        total: { value: '1475', currency: 'KMF' },
        submittedAt: '2026-09-10T18:34:58.846Z',
        clientId,
        source: 'MVK',
      },
    };
    const message = [
      payload.data.id,
      merchantId,
      clientId,
      payload.data.total.value,
      payload.data.total.currency,
      payload.data.submittedAt,
      payload.data.status,
    ].join(',');
    const signature = crypto.createHmac('sha256', webhookSecret).update(message).digest('hex');

    expect(kartapay.verifyWebhook({
      payload,
      signature,
      expectedClientId: clientId,
      expectedExternalTransactionId: payload.data.id,
    })).toBe(true);

    const tampered = JSON.parse(JSON.stringify(payload));
    tampered.data.total.value = '1476';
    expect(kartapay.verifyWebhook({
      payload: tampered,
      signature,
      expectedClientId: clientId,
      expectedExternalTransactionId: payload.data.id,
    })).toBe(false);
  });

  test.each([
    ['completed', 'succeeded'],
    ['captured', 'succeeded'],
    ['failed', 'failed'],
    ['cancelled', 'failed'],
    ['expired', 'expired'],
    ['pending', 'pending'],
    ['init', 'pending'],
  ])('normalise statut %s → %s', (providerStatus, expected) => {
    expect(kartapay.normalizeStatus({ status: providerStatus })).toBe(expected);
  });
});

describe('provider registry', () => {
  test('expose les providers techniques sans encoder le pays dans payment_mode', () => {
    expect(registry.getAdapter('orange_money')).toBe(orange);
    expect(registry.getAdapter('mtn_momo')).toBe(mtn);
    expect(registry.getAdapter('kartapay')).toBe(kartapay);
    expect(registry.listAdapters().map(a => a.name).sort()).toEqual([
      'kartapay', 'mtn_momo', 'orange_money',
    ]);
  });
});
