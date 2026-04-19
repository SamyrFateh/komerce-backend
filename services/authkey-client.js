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

// WID des templates — surchargeable via env au cas où Meta regénère les IDs
const WID = {
  ordercreated:     process.env.WID_ORDER_CREATED     || '32183',
  paymentconfirmed: process.env.WID_PAYMENT_CONFIRMED || '32182',
  ordershipped:     process.env.WID_ORDER_SHIPPED     || '32184',
  orderdelivered:   process.env.WID_ORDER_DELIVERED   || '32185',
  ordercancelled:   process.env.WID_ORDER_CANCELLED   || '32186',
  abandonedcart:    process.env.WID_ABANDONED_CART    || '32187',
};

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
 *
 * Exemples :
 *   "+269 3324567"       → { country_code: "269", mobile: "3324567" }
 *   "06 12 34 56 78"     → { country_code: "33",  mobile: "612345678" }  (0 retiré)
 *   "0033612345678"      → { country_code: "33",  mobile: "612345678" }
 *   "+33 6 12 34 56 78"  → { country_code: "33",  mobile: "612345678" }
 *   "3324567"            → { country_code: "269", mobile: "3324567" }  (fallback)
 */
function parseMobile(raw) {
  let digits = String(raw || '').replace(/\D/g, '');

  if (!digits) return { country_code: null, mobile: null };

  // Format "00XX..." → retire le 00 (notation internationale européenne)
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Cherche un indicatif connu au début
  for (const { code, length } of KNOWN_PREFIXES) {
    if (digits.startsWith(code) && digits.length >= code.length + 6) {
      return {
        country_code: code,
        mobile: digits.slice(code.length),
      };
    }
  }

  // Numéro français sans indicatif : "06..." ou "07..." → 0 retiré + indicatif 33
  if (/^0[67]\d{8}$/.test(digits)) {
    return {
      country_code: '33',
      mobile: digits.slice(1),
    };
  }

  // Fallback : pas d'indicatif détectable, on suppose le pays par défaut (Comores)
  return {
    country_code: DEFAULT_COUNTRY_CODE,
    mobile: digits,
  };
}

// ─── Appel générique ───────────────────────────────────────────────────
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

  const body = {
    country_code,
    mobile: cleanMobile,
    wid: String(wid),
    type: 'text',
    ...variables,
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

    if (!response.ok || data.Status === 'error' || data.status === 'error') {
      console.error('[authkey] ❌', { status: response.status, data, wid, country_code, mobile: cleanMobile });
      return { ok: false, error: data.Message || data.message || `http_${response.status}`, data };
    }

    console.log('[authkey] ✅', { wid, country_code, mobile: cleanMobile, messageId: data.MessageID || data.messageId });
    return { ok: true, messageId: data.MessageID || data.messageId, data };
  } catch (err) {
    console.error('[authkey] exception', err.message);
    return { ok: false, error: 'network_error', details: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Helpers métier — un par template
//  Les clés des variables doivent correspondre aux noms utilisés dans
//  les templates AuthKey (ex: {{#name#}}, {{#order_ref#}}).
//  Si les templates utilisent {{1}}, {{2}} (syntaxe Meta standard),
//  AuthKey les mappe automatiquement par ordre d'apparition.
// ═══════════════════════════════════════════════════════════════════════

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

async function notifyOrderDelivered({ mobile, name, orderRef }) {
  return callAuthKey({
    wid: WID.orderdelivered,
    mobile,
    variables: { name, order_ref: orderRef },
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

module.exports = {
  callAuthKey,
  notifyOrderCreated,
  notifyPaymentConfirmed,
  notifyOrderShipped,
  notifyOrderDelivered,
  notifyOrderCancelled,
  notifyAbandonedCart,
  parseMobile,
  WID,
};
