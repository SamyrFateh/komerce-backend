/**
 * @komerce-arch
 * @role          meta-whatsapp-adapter
 * @domain        notification
 * @layer         external-adapter
 * @criticality   high
 * @inputs        phone_number_id, template_name, recipient_phone, message_payload
 * @outputs       meta_message_id, delivery_response, adapter_error
 * @depends       Meta Graph API, env META_WA_*
 * @used-by       notification-service.js, routes/meta-whatsapp.js
 * @db-read       none
 * @db-write      none
 * @db-txn        external_provider_only, secrets_env_only
 * @doctrine      whatsapp_template_trace, provider_adapter_isole, secrets_env_only
 * @impact-areas  whatsapp, otp, notifications, shared-cart, checkout
 * @version       2026-06
 */

'use strict';

const fetch = global.fetch;

const GRAPH_VERSION = process.env.META_WA_GRAPH_VERSION || 'v23.0';
const TOKEN = process.env.META_WA_TOKEN;
const PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID;

function metaUrl(path = '') {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}${path}`;
}

function normalizeWhatsAppPhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

async function sendTemplateWhatsApp({ to, templateName, lang = 'fr', components = [] }) {
  if (!TOKEN || !PHONE_NUMBER_ID) {
    return { success: false, skipped: true, reason: 'meta_not_configured' };
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: normalizeWhatsAppPhone(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: lang },
      components
    }
  };

  const res = await fetch(metaUrl('/messages'), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return {
      success: false,
      status: res.status,
      error: data?.error || data
    };
  }

  const msg = data?.messages?.[0];
  return {
    success: true,
    message_id: msg?.id || null,
    raw: data
  };
}

module.exports = {
  sendTemplateWhatsApp
};