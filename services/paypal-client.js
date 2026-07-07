/**
 * @komerce-arch
 * @role          payment-paypal-client
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  payment
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/paypal-client.js
 *
 * Wrapper PayPal REST v2 — appels HTTP natifs (fetch Node 20+) sans dépendance
 * externe. Évite le @paypal/checkout-server-sdk qui est mal maintenu et dont
 * la dette de dépendances polluerait le package.json.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CONTRAT                                                              ║
 * ║                                                                      ║
 * ║  • Toutes les méthodes throw en cas d'erreur réseau ou statut HTTP.  ║
 * ║  • L'OAuth token est mis en cache mémoire (validité ≈ 9h PayPal,    ║
 * ║    on refresh à T+50min par prudence).                               ║
 * ║  • Aucune écriture DB ici — ce service est PUREMENT un wrapper SDK.  ║
 * ║  • L'idempotence et la persistance sont gérées par routes/.          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Variables d'environnement requises :
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *   PAYPAL_WEBHOOK_ID  (utilisé par verifyWebhookSignature)
 *   PAYPAL_ENV         = 'sandbox' | 'production' (défaut 'sandbox')
 *
 * Réf doc : https://developer.paypal.com/api/rest/
 */

const log = require('../utils/logger').child({ module: 'paypal-client' });

// ─── Configuration ──────────────────────────────────────────────────────────

function _baseUrl() {
  return (process.env.PAYPAL_ENV === 'production')
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function _credentials() {
  const id     = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('PAYPAL_CLIENT_ID/SECRET manquant — vérifier env');
  }
  return { id, secret };
}

// ─── OAuth token (cache mémoire) ────────────────────────────────────────────

let _tokenCache = null; // { access_token, expires_at }

async function _getAccessToken() {
  // Cache valide : retourner sans appel réseau
  if (_tokenCache && _tokenCache.expires_at > Date.now() + 60_000) {
    return _tokenCache.access_token;
  }

  const { id, secret } = _credentials();
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');

  const res = await fetch(`${_baseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    log.error({ status: res.status, body: errBody.slice(0, 200) }, '[PAYPAL] OAuth token failed');
    throw new Error(`PayPal OAuth failed: ${res.status}`);
  }

  const data = await res.json();
  // PayPal renvoie expires_in en secondes (≈ 32400 = 9h). On rafraîchit à T-10min.
  _tokenCache = {
    access_token: data.access_token,
    expires_at:   Date.now() + (data.expires_in - 600) * 1000,
  };
  return _tokenCache.access_token;
}

// Helper privé : exécuter une requête API authentifiée
async function _api(method, path, { body, headers = {}, parseJson = true } = {}) {
  const token = await _getAccessToken();
  const res = await fetch(`${_baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // PayPal renvoie 204 No Content sur les refunds réussis sans détail
  if (res.status === 204) return null;

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    log.warn({ method, path, status: res.status, body: errBody.slice(0, 300) },
      '[PAYPAL] API error');
    const err = new Error(`PayPal ${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.body   = errBody;
    throw err;
  }

  return parseJson ? res.json() : res.text();
}

// ─── 1. Create Order ─────────────────────────────────────────────────────────

/**
 * Crée une PayPal Order (intent: CAPTURE).
 *
 * @param {object} opts
 * @param {number} opts.amountEur    — Montant en EUR (decimal, ex: 149.90)
 * @param {string} opts.reference    — Référence commande Komerce (ex: K-A8B3C1)
 * @param {string} [opts.description] — Description visible payeur (ex: "Commande K-A8B3C1 — Komerce")
 * @param {string} [opts.returnUrl]  — URL de retour après approval
 * @param {string} [opts.cancelUrl]  — URL de retour après cancel
 * @returns {Promise<{ id: string, status: string, links: Array }>}
 */
async function createOrder({ amountEur, reference, description, returnUrl, cancelUrl, applicationContext }) {
  if (!amountEur || amountEur <= 0) throw new Error('amountEur requis et > 0');
  if (!reference)                   throw new Error('reference requis');

  // FIX: applicationContext (objet passé par payments-paypal.js) a priorité sur les
  // anciens paramètres returnUrl/cancelUrl. landing_page forcé à BILLING pour éviter
  // la page blanche / about:blank dans la popup du SDK Buttons.
  const appCtx = applicationContext || {};
  const payload = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: reference,
      description:  description || `Komerce — Commande ${reference}`,
      amount: {
        currency_code: 'EUR',
        value:         amountEur.toFixed(2),
      },
    }],
    application_context: {
      brand_name:          appCtx.brand_name          || 'Komerce',
      locale:              appCtx.locale               || 'fr-FR',
      landing_page:        appCtx.landing_page         || 'BILLING', // BILLING évite la page blanche dans la popup
      user_action:         appCtx.user_action          || 'PAY_NOW',
      shipping_preference: appCtx.shipping_preference  || 'NO_SHIPPING',
      ...(appCtx.return_url ? { return_url: appCtx.return_url } : returnUrl ? { return_url: returnUrl } : {}),
      ...(appCtx.cancel_url ? { cancel_url: appCtx.cancel_url } : cancelUrl ? { cancel_url: cancelUrl } : {}),
    },
  };

  return _api('POST', '/v2/checkout/orders', { body: payload });
}

// ─── 2. Capture Order ────────────────────────────────────────────────────────

/**
 * Capture une PayPal Order après approval du payeur.
 *
 * @param {string} paypalOrderId — ID retourné par createOrder
 * @returns {Promise<{
 *   id: string,
 *   status: 'COMPLETED' | 'PENDING' | ...,
 *   payer: { email_address, payer_id, name },
 *   purchase_units: Array<{ payments: { captures: Array } }>,
 * }>}
 */
async function captureOrder(paypalOrderId) {
  if (!paypalOrderId) throw new Error('paypalOrderId requis');
  return _api('POST', `/v2/checkout/orders/${paypalOrderId}/capture`, {
    // PayPal Request-Id permet l'idempotence côté PayPal (rejouer la capture = pas de double charge)
    headers: { 'PayPal-Request-Id': `capture-${paypalOrderId}` },
    body: {},
  });
}

// ─── 3. Get Order (lecture) ──────────────────────────────────────────────────

async function getOrder(paypalOrderId) {
  if (!paypalOrderId) throw new Error('paypalOrderId requis');
  return _api('GET', `/v2/checkout/orders/${paypalOrderId}`);
}

// ─── 4. Refund Capture ───────────────────────────────────────────────────────

/**
 * Refund (partiel ou total) sur une capture déjà encaissée.
 *
 * @param {string} captureId — ID de la capture (orders.paypal_capture_id)
 * @param {object} [opts]
 * @param {number} [opts.amountEur] — Montant partiel (omettre = refund total)
 * @param {string} [opts.reason]    — Raison libre, visible payeur
 * @param {string} [opts.invoiceId] — Référence interne (orders.reference)
 * @returns {Promise<{ id: string, status: 'COMPLETED' | ... }>}
 */
async function refundCapture(captureId, { amountEur, reason, invoiceId } = {}) {
  if (!captureId) throw new Error('captureId requis');

  const payload = {};
  if (typeof amountEur === 'number' && amountEur > 0) {
    payload.amount = { currency_code: 'EUR', value: amountEur.toFixed(2) };
  }
  if (reason)    payload.note_to_payer = reason.slice(0, 255);
  if (invoiceId) payload.invoice_id    = invoiceId.slice(0, 127);

  return _api('POST', `/v2/payments/captures/${captureId}/refund`, {
    headers: { 'PayPal-Request-Id': `refund-${captureId}-${Date.now()}` },
    body: payload,
  });
}

// ─── 5. Verify Webhook Signature ─────────────────────────────────────────────

/**
 * Vérifie la signature d'un webhook PayPal via l'API officielle.
 *
 * Stratégie : on délègue à PayPal (POST /v1/notifications/verify-webhook-signature)
 * plutôt que de faire la crypto locale. C'est l'approche recommandée et c'est
 * 100% à jour avec les rotations de certificats côté PayPal.
 *
 * @param {object} headers — req.headers (case-insensitive)
 * @param {object|string} rawBody — Le body brut (Buffer ou string JSON)
 * @returns {Promise<boolean>} — true si signature valide
 */
async function verifyWebhookSignature(headers, rawBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error('PAYPAL_WEBHOOK_ID manquant — impossible de vérifier la signature');

  // Headers : insensitive lookup
  const h = (name) => headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];

  const transmission_id   = h('paypal-transmission-id');
  const transmission_time = h('paypal-transmission-time');
  const cert_url          = h('paypal-cert-url');
  const auth_algo         = h('paypal-auth-algo');
  const transmission_sig  = h('paypal-transmission-sig');

  if (!transmission_id || !transmission_sig) {
    log.warn('[PAYPAL] verify: headers paypal-* incomplets — rejet');
    return false;
  }

  // Reconstruire le webhook_event depuis le body brut
  let webhookEvent;
  try {
    webhookEvent = typeof rawBody === 'string'
      ? JSON.parse(rawBody)
      : (Buffer.isBuffer(rawBody) ? JSON.parse(rawBody.toString('utf8')) : rawBody);
  } catch (e) {
    log.warn({ err: e.message }, '[PAYPAL] verify: body non-JSON — rejet');
    return false;
  }

  try {
    const result = await _api('POST', '/v1/notifications/verify-webhook-signature', {
      body: {
        transmission_id,
        transmission_time,
        cert_url,
        auth_algo,
        transmission_sig,
        webhook_id: webhookId,
        webhook_event: webhookEvent,
      },
    });
    return result?.verification_status === 'SUCCESS';
  } catch (e) {
    log.error({ err: e.message }, '[PAYPAL] verify: API call failed');
    return false;
  }
}

// ─── 6. Helpers de parsing des réponses ──────────────────────────────────────

/**
 * Extrait les infos utiles d'une capture (compatible avec le format retourné par
 * captureOrder() ET par l'event webhook PAYMENT.CAPTURE.COMPLETED).
 *
 * Retourne null si la structure ne correspond à aucun format connu.
 */
function extractCaptureInfo(captureOrEvent) {
  // Format 1 : retour direct de captureOrder()
  if (captureOrEvent?.purchase_units?.[0]?.payments?.captures?.[0]) {
    const capture = captureOrEvent.purchase_units[0].payments.captures[0];
    const payer   = captureOrEvent.payer || {};
    return {
      paypal_order_id:   captureOrEvent.id,
      paypal_capture_id: capture.id,
      status:            capture.status,
      amount_value:      parseFloat(capture.amount?.value),
      currency:          capture.amount?.currency_code,
      payer_email:       payer.email_address || null,
      payer_id:          payer.payer_id      || null,
      payer_name:        [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(' ') || null,
      reference_id:      captureOrEvent.purchase_units[0].reference_id || null,
      // Détecter Pay-in-4 : la source de financement est dans payment_source
      pay_in_4:          !!(captureOrEvent.payment_source?.pay_upon_invoice
                          || captureOrEvent.payment_source?.paylater),
    };
  }

  // Format 2 : event webhook PAYMENT.CAPTURE.COMPLETED → resource est directement la capture
  if (captureOrEvent?.resource?.id && captureOrEvent?.resource?.amount) {
    const r = captureOrEvent.resource;
    // Le supplementary_data.related_ids.order_id peut indiquer le paypal_order_id parent
    return {
      paypal_order_id:   r.supplementary_data?.related_ids?.order_id || null,
      paypal_capture_id: r.id,
      status:            r.status,
      amount_value:      parseFloat(r.amount?.value),
      currency:          r.amount?.currency_code,
      payer_email:       null, // pas dans le webhook capture-only
      payer_id:          null,
      payer_name:        null,
      reference_id:      r.custom_id || r.invoice_id || null,
      pay_in_4:          false, // info absente côté webhook
    };
  }

  return null;
}

// ─── Test helpers (exposés UNIQUEMENT pour les tests unitaires) ──────────────

function _resetTokenCacheForTests() {
  _tokenCache = null;
}

module.exports = {
  createOrder,
  captureOrder,
  getOrder,
  refundCapture,
  verifyWebhookSignature,
  extractCaptureInfo,
  // Internals pour tests
  _resetTokenCacheForTests,
};
