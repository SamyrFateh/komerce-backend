/**
 * @komerce-arch
 * @role          invoice-public-token
 * @domain        orders
 * @layer         service
 * @criticality   high
 * @inputs        order_id, invoice_url, runtime_secret
 * @outputs       signed_public_invoice_token, verified_order_id
 * @depends       crypto
 * @used-by       routes/invoices.js, services/authkey-client.js
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        none
 * @doctrine      lien_facture_public_non_devinable, facture_apres_paiement_confirme
 * @impact-areas  orders, invoices, whatsapp, customer-support
 * @version       2026-06
 */

'use strict';

const crypto = require('crypto');

const ORDER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64url(input) {
  return Buffer.from(String(input), 'utf8').toString('base64url');
}

function fromBase64url(input) {
  return Buffer.from(String(input), 'base64url').toString('utf8');
}

function getSecret() {
  return process.env.INVOICE_PUBLIC_LINK_SECRET
      || process.env.JWT_SECRET
      || process.env.SESSION_SECRET
      || null;
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function timingSafeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function createInvoicePublicToken(orderId) {
  if (!ORDER_ID_RE.test(String(orderId || ''))) {
    throw new Error('invalid_order_id');
  }

  const secret = getSecret();
  if (!secret) {
    throw new Error('missing_invoice_public_link_secret');
  }

  const payload = base64url(orderId);
  const sig = signPayload(payload, secret);
  return `${payload}.${sig}`;
}

function verifyInvoicePublicToken(token) {
  const secret = getSecret();
  if (!secret || !token || !String(token).includes('.')) return null;

  const [payload, sig] = String(token).split('.', 2);
  if (!payload || !sig) return null;

  const expected = signPayload(payload, secret);
  if (!timingSafeEqual(sig, expected)) return null;

  let orderId;
  try {
    orderId = fromBase64url(payload);
  } catch (_) {
    return null;
  }

  return ORDER_ID_RE.test(orderId) ? orderId : null;
}

function publicInvoiceUrlFromOrderUrl(invoiceUrl) {
  const url = new URL(invoiceUrl);
  const match = url.pathname.match(/^\/api\/invoices\/([0-9a-f-]{36})(?:\/download)?$/i);
  if (!match) return invoiceUrl;

  const token = createInvoicePublicToken(match[1]);
  url.pathname = `/api/invoices/public/${token}`;
  url.search = '';
  return url.toString();
}

module.exports = {
  createInvoicePublicToken,
  verifyInvoicePublicToken,
  publicInvoiceUrlFromOrderUrl,
};
