/**
 * @komerce-arch
 * @role          authkey-whatsapp-adapter
 * @domain        notification
 * @layer         external-adapter
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       utils/logger.js
 * @used-by       services/notifications/internals.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  whatsapp, otp, notifications
 * @version       2026-07
 * @rehomed       O7.1 (2026-07) — depuis auth-identity ; "AuthKey" est le
 *                fournisseur tiers d'API WhatsApp (authkey.io), collision de
 *                nom avec "auth". Aucune logique d'authentification. Voir
 *                docs/O7_1_OWNERSHIP_ANALYSIS.md, CAS A.
 * @o7_2          Cycle A (2026-07) — la construction du lien de facture
 *                publique a été déplacée vers services/invoice-service.js
 *                (orders), qui envoie désormais un message déjà prêt via
 *                notifyText. Ce fichier ne dépend plus d'invoice-public-token.js
 *                — cycle runtime notifications<->orders cassé côté notifications.
 *                Voir docs/O7_2_CYCLE_ANALYSIS.md.
 */

'use strict';

/**
 * KOMERCE — services/authkey-client.js
 * ═══════════════════════════════════════════════════════════════════════
 * Client bas niveau pour l'API WhatsApp Business de authkey.io
 * Appelé uniquement par services/notification-service.js
 *
 * Docs : https://authkey.io/whatsapp-api-docs
 * ═══════════════════════════════════════════════════════════════════════
 */

const AUTHKEY_URL = 'https://authkey.io/restapi/requestjson.php';
const API_KEY = process.env.AUTHKEY_API_KEY;
const log = require('../utils/logger').child({ module: 'authkey-client' });
// O7.2 (Cycle A) : l'import de invoice-public-token.js a été retiré — c'était la
// seule preuve cross-feature notifications -> orders. Voir docs/O7_2_CYCLE_ANALYSIS.md.

// ── Staging whitelist guard ────────────────────────────────────────────────
// En dehors de production, les notifications WhatsApp ne partent que vers
// les numéros listés dans AUTHKEY_ALLOWED_PHONES (séparés par virgule).
// Ex : AUTHKEY_ALLOWED_PHONES="+2693301234,+33612345678"
// Si la variable est absente en staging, AUCUN message ne part (fail-safe).
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const _allowedPhones = IS_PRODUCTION
  ? null  // prod : pas de filtre
  : new Set(
      (process.env.AUTHKEY_ALLOWED_PHONES || '')
        .split(',')
        .map(p => p.trim().replace(/\D/g, ''))
        .filter(Boolean)
    );

/**
 * Vérifie si un numéro est autorisé à recevoir un message en staging.
 * Normalise en digits purs pour la comparaison (insensible au format).
 * En production, retourne toujours true.
 */
function _isStagingAllowed(rawPhone) {
  if (IS_PRODUCTION) return true;
  if (!_allowedPhones || _allowedPhones.size === 0) return false;
  const digits = String(rawPhone || '').replace(/\D/g, '');
  // Tente la correspondance sur le suffixe (ex: "3301234" matche "+2693301234")
  for (const allowed of _allowedPhones) {
    if (allowed.endsWith(digits) || digits.endsWith(allowed)) return true;
  }
  return false;
}

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

// WID des templates.
// Railway utilise aujourd'hui AUTHKEY_WID_* ; les anciens noms WID_* restent acceptés.
const WID = {
  ordercreated: envFirst(
    'AUTHKEY_WID_ORDER_CREATED',
    'AUTHKEY_ORDER_CREATED_WID',
    'WID_ORDER_CREATED'
  ) || '32183',
  paymentconfirmed: envFirst(
    'AUTHKEY_WID_PAYMENT_CONFIRMED',
    'AUTHKEY_PAYMENT_CONFIRMED_WID',
    'WID_PAYMENT_CONFIRMED'
  ) || '32182',
  ordershipped: envFirst(
    'AUTHKEY_WID_ORDER_SHIPPED',
    'AUTHKEY_ORDER_SHIPPED_WID',
    'WID_ORDER_SHIPPED'
  ) || '32184',
  orderdelivered: envFirst(
    'AUTHKEY_WID_ORDER_DELIVERED',
    'AUTHKEY_ORDER_DELIVERED_WID',
    'WID_ORDER_DELIVERED'
  ) || '32185',
  ordercancelled: envFirst(
    'AUTHKEY_WID_ORDER_CANCELLED',
    'AUTHKEY_ORDER_CANCELLED_WID',
    'WID_ORDER_CANCELLED'
  ) || '32186',
  abandonedcart: envFirst(
    'AUTHKEY_WID_ABANDONED_CART',
    'AUTHKEY_ABANDONED_CART_WID',
    'WID_ABANDONED_CART'
  ) || '32187',
  invoiceready: envFirst(
    'AUTHKEY_WID_INVOICE_READY',
    'AUTHKEY_INVOICE_READY_WID',
    'WID_INVOICE_READY'
  ),
};

// O7.2 (Cycle A) : USE_INVOICE_READY_TEMPLATE retiré — ne pilotait plus que
// la détection d'URL de facture supprimée ci-dessous (zéro appelant réel).

// ─── Détection automatique de l'indicatif pays ──────────────────────────
// Komerce sert les Comores (269) ET la diaspora (France 33, etc.)
// On détecte l'indicatif depuis le numéro lui-même plutôt qu'une valeur fixe.
// Le COUNTRY_CODE env est utilisé uniquement comme FALLBACK pour les numéros
// locaux sans indicatif (ex: "3324567" saisi par un client comorien).

const DEFAULT_COUNTRY_CODE = process.env.AUTHKEY_COUNTRY_CODE || '269';

// Indicatifs reconnus — ordre important : les plus longs d'abord
// (ex: 269 avant 26 avant 2 pour éviter les faux positifs)
const KNOWN_PREFIXES = [
  { code: '269', length: 7  },  // Comores — 7 chiffres
  { code: '33',  length: 9  },  // France — 9 chiffres (sans le 0)
  { code: '262', length: 9  },  // Réunion/Mayotte
  { code: '1',   length: 10 },  // US/Canada
  { code: '44',  length: 10 },  // UK
  { code: '32',  length: 9  },  // Belgique
  { code: '41',  length: 9  },  // Suisse
  { code: '49',  length: 11 },  // Allemagne
  { code: '971', length: 9  },  // UAE
  { code: '966', length: 9  },  // Arabie Saoudite
  { code: '254', length: 9  },  // Kenya
  { code: '255', length: 9  },  // Tanzanie
  { code: '230', length: 7  },  // Maurice
  { code: '261', length: 9  },  // Madagascar
];

/**
 * Extrait { country_code, mobile } d'un numéro quel que soit son format.
 */
function parseMobile(raw) {
  let digits = String(raw || '').replace(/\D/g, '');

  if (!digits) return { country_code: null, mobile: null };

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  for (const { code, length } of KNOWN_PREFIXES) {
    if (digits.startsWith(code) && digits.length >= code.length + 6) {
      return {
        country_code: code,
        mobile: digits.slice(code.length),
      };
    }
  }

  if (/^0[67]\d{8}$/.test(digits)) {
    return {
      country_code: '33',
      mobile: digits.slice(1),
    };
  }

  return {
    country_code: DEFAULT_COUNTRY_CODE,
    mobile: digits,
  };
}

function toBodyValues(variables = {}) {
  if (!variables || typeof variables !== 'object') return {};

  // Passage direct bodyValues (escape hatch explicite)
  if (variables.bodyValues && typeof variables.bodyValues === 'object') {
    return variables.bodyValues;
  }

  // AuthKey résout {#name#}, {#order_ref#}, etc. par le NOM de la clé dans bodyValues.
  // On passe les variables nommées directement — plus de conversion var1/var2/var3
  // qui empêchait la substitution côté template.
  const bodyValues = {};

  const orderedKeys = [
    'name',
    'order_ref',
    'amount',
    'relay_point',
    'item_count',
    'invoice_number',
    'invoice_url',
    'code',
    'otp',
    'link',
    'magic_link',
    'url',
    'expiry',
  ];

  for (const key of orderedKeys) {
    if (variables[key] !== undefined && variables[key] !== null && variables[key] !== '') {
      bodyValues[key] = String(variables[key]);
    }
  }

  // Compat : si l'appelant passait déjà des clés var1/var2 explicites, on les garde
  for (const key of Object.keys(variables)) {
    if (/^var\d+$/.test(key) && variables[key] !== undefined && variables[key] !== null) {
      bodyValues[key] = String(variables[key]);
    }
  }

  return bodyValues;
}

// O7.2 (Cycle A) : extractFirstUrl / looksLikeInvoiceMessage / toPublicInvoiceUrl
// retirés — cette détection/signature d'URL de facture n'avait plus aucun
// appelant réel depuis que services/notifications/order.js construit et
// envoie désormais un lien de facture déjà public (services/invoice-service.js,
// orders). Les conserver aurait maintenu l'import de invoice-public-token.js
// (dépendance cross-feature notifications -> orders) pour du code mort, et
// une éventuelle réactivation future enverrait une URL non signée en clair
// (contraire à la doctrine lien_facture_public_non_devinable). Voir
// docs/O7_2_CYCLE_ANALYSIS.md, Cycle A.

async function callAuthKeyText({ mobile, message }) {
  if (!API_KEY) {
    return { ok: false, error: 'missing_api_key' };
  }

  if (!message) {
    return { ok: false, error: 'missing_message' };
  }

  const { country_code, mobile: cleanMobile } = parseMobile(mobile);

  if (!cleanMobile || !country_code) {
    return { ok: false, error: 'invalid_mobile', raw: mobile };
  }

  if (!_isStagingAllowed(mobile)) {
    log.warn({ mobile, event: 'free_text' }, '[authkey] staging: numéro non autorisé — message bloqué');
    return { ok: false, reason: 'staging_not_allowed', mobile };
  }

  const body = {
    country_code,
    mobile: cleanMobile,
    type: 'text',
    message: String(message),
  };

  try {
    const response = await fetch(AUTHKEY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    const providerStatus = String(data.Status ?? data.status ?? '').trim().toLowerCase();
    const providerMessage = data.Message || data.message || data.Error || data.error || null;
    const messageId = data.MessageID || data.messageId || data.LogID || data.logId || data.log_id || data.id || null;

    const providerFailed =
      ['error', 'fail', 'failed', 'failure'].includes(providerStatus) ||
      /invalid authkey|insufficient balance|wid|required|template/i.test(String(providerMessage || ''));

    if (!response.ok || providerFailed) {
      log.error({
        status: response.status,
        provider_status: providerStatus,
        provider_message: providerMessage,
        data,
        country_code,
        mobile: cleanMobile,
      }, 'AuthKey free-text provider rejected request');

      return {
        ok: false,
        error: providerMessage || `http_${response.status}`,
        providerStatus,
        messageId,
        data,
      };
    }

    log.info({
      country_code,
      mobile: cleanMobile,
      message_id: messageId,
      provider_status: providerStatus,
    }, 'AuthKey free-text message accepted');

    return {
      ok: true,
      messageId,
      providerStatus,
      data,
    };
  } catch (err) {
    log.error({ err }, 'AuthKey free-text request failed');
    return { ok: false, error: 'network_error', details: err.message };
  }
}

async function callAuthKey({ wid, mobile, variables = {} }) {
  if (!API_KEY) {
    return { ok: false, error: 'missing_api_key' };
  }
  if (!wid) {
    return { ok: false, error: 'missing_wid' };
  }

  const { country_code, mobile: cleanMobile } = parseMobile(mobile);
  if (!cleanMobile || !country_code) {
    return { ok: false, error: 'invalid_mobile', raw: mobile };
  }

  if (!_isStagingAllowed(mobile)) {
    log.warn({ mobile, wid }, '[authkey] staging: numéro non autorisé — WID bloqué');
    return { ok: false, reason: 'staging_not_allowed', mobile, wid };
  }

  const bodyValues = toBodyValues(variables);

  const body = {
    country_code,
    mobile: cleanMobile,
    wid: String(wid),
    type: 'text',
  };

  if (Object.keys(bodyValues).length > 0) {
    body.bodyValues = bodyValues;
  }

  try {
    const response = await fetch(AUTHKEY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    const providerStatus = String(data.Status ?? data.status ?? '').trim().toLowerCase();
    const providerMessage = data.Message || data.message || data.Error || data.error || null;
    const messageId = data.MessageID || data.messageId || data.LogID || data.logId || data.log_id || data.id || null;

    const providerFailed =
      ['error', 'fail', 'failed', 'failure'].includes(providerStatus) ||
      /invalid authkey|insufficient balance/i.test(String(providerMessage || ''));

    if (!response.ok || providerFailed) {
      log.error({
        status: response.status,
        provider_status: providerStatus,
        provider_message: providerMessage,
        data,
        wid,
        country_code,
        mobile: cleanMobile,
      }, 'AuthKey provider rejected request');

      return {
        ok: false,
        error: providerMessage || `http_${response.status}`,
        providerStatus,
        messageId,
        data,
        wid: String(wid),
      };
    }

    log.info({
      wid,
      country_code,
      mobile: cleanMobile,
      message_id: messageId,
      provider_status: providerStatus,
    }, 'AuthKey message accepted');

    return {
      ok: true,
      messageId,
      providerStatus,
      data,
      wid: String(wid),
    };
  } catch (err) {
    log.error({ err, wid }, 'AuthKey request failed');
    return { ok: false, error: 'network_error', details: err.message, wid: String(wid) };
  }
}

async function notifyOrderCreated({ mobile, name, orderRef, amount }) {
  return callAuthKey({
    wid: WID.ordercreated,
    mobile,
    variables: { name, order_ref: orderRef, amount },
  });
}

async function notifyPaymentConfirmed({ mobile, name, orderRef }) {
  return callAuthKey({
    wid: WID.paymentconfirmed,
    mobile,
    variables: { name, order_ref: orderRef },
  });
}

async function notifyOrderShipped({ mobile, name, orderRef, relayPoint }) {
  return callAuthKey({
    wid: WID.ordershipped,
    mobile,
    variables: { name, order_ref: orderRef, relay_point: relayPoint },
  });
}

async function notifyOrderDelivered({ mobile, name, orderRef, relayPoint }) {
  return callAuthKey({
    wid: WID.orderdelivered,
    mobile,
    variables: { name, order_ref: orderRef, relay_point: relayPoint },
  });
}
async function notifyOrderCancelled({ mobile, name, orderRef }) {
  return callAuthKey({
    wid: WID.ordercancelled,
    mobile,
    variables: { name, order_ref: orderRef },
  });
}

async function notifyAbandonedCart({ mobile, name, itemCount }) {
  return callAuthKey({
    wid: WID.abandonedcart,
    mobile,
    variables: { name, item_count: String(itemCount) },
  });
}

// O7.2 (Cycle A) : notifyInvoiceReady retiré — zéro appelant réel dans le
// repo (services/notifications/order.js construit désormais le message
// facture lui-même via services/invoice-service.js/notifyText). Le conserver
// aurait maintenu l'import de invoice-public-token.js pour du code mort.

module.exports = {
  callAuthKey,
  callAuthKeyText,
  notifyOrderCreated,
  notifyPaymentConfirmed,
  notifyOrderShipped,
  notifyOrderDelivered,
  notifyOrderCancelled,
  notifyAbandonedCart,
  parseMobile,
  WID,
};
