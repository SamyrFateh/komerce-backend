'use strict';

/**
 * KOMERCE â€” services/authkey-client.js
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Client bas niveau pour l'API WhatsApp Business de authkey.io
 * AppelÃ© uniquement par services/notification-service.js
 *
 * Docs : https://authkey.io/whatsapp-api-docs
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

const AUTHKEY_URL = 'https://authkey.io/restapi/requestjson.php';
const API_KEY = process.env.AUTHKEY_API_KEY;
const log = require('../utils/logger').child({ module: 'authkey-client' });

// WID des templates â€” surchargeable via env au cas oÃ¹ Meta regÃ©nÃ¨re les IDs
const WID = {
  ordercreated:     process.env.WID_ORDER_CREATED     || '32183',
  paymentconfirmed: process.env.WID_PAYMENT_CONFIRMED || '32182',
  ordershipped:     process.env.WID_ORDER_SHIPPED     || '32184',
  orderdelivered:   process.env.WID_ORDER_DELIVERED   || '32185',
  ordercancelled:   process.env.WID_ORDER_CANCELLED   || '32186',
  abandonedcart:    process.env.WID_ABANDONED_CART    || '32187',
};

// â”€â”€â”€ DÃ©tection automatique de l'indicatif pays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Komerce sert les Comores (269) ET la diaspora (France 33, etc.)
// On dÃ©tecte l'indicatif depuis le numÃ©ro lui-mÃªme plutÃ´t qu'une valeur fixe.
// Le COUNTRY_CODE env est utilisÃ© uniquement comme FALLBACK pour les numÃ©ros
// locaux sans indicatif (ex: "3324567" saisi par un client comorien).

const DEFAULT_COUNTRY_CODE = process.env.AUTHKEY_COUNTRY_CODE || '269';

// Indicatifs reconnus â€” ordre important : les plus longs d'abord
// (ex: 269 avant 26 avant 2 pour Ã©viter les faux positifs)
const KNOWN_PREFIXES = [
  { code: '269', length: 7  },  // Comores â€” 7 chiffres
  { code: '33',  length: 9  },  // France â€” 9 chiffres (sans le 0)
  { code: '262', length: 9  },  // RÃ©union/Mayotte
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
 * Extrait { country_code, mobile } d'un numÃ©ro quel que soit son format.
 *
 * Exemples :
 *   "+269 3324567"       â†’ { country_code: "269", mobile: "3324567" }
 *   "06 12 34 56 78"     â†’ { country_code: "33",  mobile: "612345678" }  (0 retirÃ©)
 *   "0033612345678"      â†’ { country_code: "33",  mobile: "612345678" }
 *   "+33 6 12 34 56 78"  â†’ { country_code: "33",  mobile: "612345678" }
 *   "3324567"            â†’ { country_code: "269", mobile: "3324567" }  (fallback)
 */
function parseMobile(raw) {
  let digits = String(raw || '').replace(/\D/g, '');

  if (!digits) return { country_code: null, mobile: null };

  // Format "00XX..." â†’ retire le 00 (notation internationale europÃ©enne)
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Cherche un indicatif connu au dÃ©but
  for (const { code, length } of KNOWN_PREFIXES) {
    if (digits.startsWith(code) && digits.length >= code.length + 6) {
      return {
        country_code: code,
        mobile: digits.slice(code.length),
      };
    }
  }

  // NumÃ©ro franÃ§ais sans indicatif : "06..." ou "07..." â†’ 0 retirÃ© + indicatif 33
  if (/^0[67]\d{8}$/.test(digits)) {
    return {
      country_code: '33',
      mobile: digits.slice(1),
    };
  }

  // Fallback : pas d'indicatif dÃ©tectable, on suppose le pays par dÃ©faut (Comores)
  return {
    country_code: DEFAULT_COUNTRY_CODE,
    mobile: digits,
  };
}

// â”€â”€â”€ Mapping variables templates AuthKey â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AuthKey requestjson.php attend les variables template dans bodyValues.var1,
// bodyValues.var2, etc. Les helpers mÃ©tier gardent des noms lisibles,
// puis ce helper transforme dans l'ordre attendu par les templates.
function toBodyValues(variables = {}) {
  if (!variables || typeof variables !== 'object') return {};

  if (variables.bodyValues && typeof variables.bodyValues === 'object') {
    return variables.bodyValues;
  }

  const orderedKeys = [
    'name',
    'order_ref',
    'amount',
    'relay_point',
    'item_count',
    'code',
    'otp',
    'link',
    'magic_link',
    'url',
    'expiry',
  ];

  const bodyValues = {};
  let index = 1;

  for (const key of orderedKeys) {
    if (variables[key] !== undefined && variables[key] !== null && variables[key] !== '') {
      bodyValues['var' + index] = String(variables[key]);
      index++;
    }
  }

  // Compat directe si un appelant fournit dÃ©jÃ  var1/var2/var3.
  for (const key of Object.keys(variables)) {
    if (/^var\d+$/.test(key) && variables[key] !== undefined && variables[key] !== null) {
      bodyValues[key] = String(variables[key]);
    }
  }

  return bodyValues;
}

// â”€â”€â”€ Appel gÃ©nÃ©rique â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    };
  } catch (err) {
    log.error({ err, wid }, 'AuthKey request failed');
    return { ok: false, error: 'network_error', details: err.message };
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Helpers mÃ©tier â€” un par template
//  Les clÃ©s des variables doivent correspondre aux noms utilisÃ©s dans
//  les templates AuthKey (ex: {{#name#}}, {{#order_ref#}}).
//  Si les templates utilisent {{1}}, {{2}} (syntaxe Meta standard),
//  AuthKey les mappe automatiquement par ordre d'apparition.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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


