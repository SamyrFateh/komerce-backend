/**
 * @komerce-arch
 * @role          live-contact-free-projection
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   medium
 * @inputs        hub_or_relay_dashboard_payload
 * @outputs       payload_without_contact_fields
 * @depends       none
 * @used-by       routes/hub-dashboard.js, routes/relay-dashboard.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      live_screens_read_only, no_contact_data_in_live_payloads
 * @impact-areas  admin-dashboard, hub, relay, privacy
 * @version       2026-10
 */

'use strict';

// Les écrans Live n'affichent aucune donnée de contact (téléphone, e-mail, code de retrait) :
// ils demandent `?projection=live` et la réponse n'en transporte plus. Les applis terrain
// (/hub, /relais) n'envoient pas ce paramètre et gardent la réponse complète.
const LIVE_PROJECTION = 'live';
const CONTACT_KEY = /phone|email|secret|pickup_code|_hash|token/i;

function wantsLiveProjection(req) {
  return Boolean(req && req.query && req.query.projection === LIVE_PROJECTION);
}

function stripContact(value) {
  if (Array.isArray(value)) return value.map(stripContact);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!CONTACT_KEY.test(key)) out[key] = stripContact(inner);
    }
    return out;
  }
  return value;
}

function applyLiveProjection(req, payload) {
  return wantsLiveProjection(req) ? stripContact(payload) : payload;
}

module.exports = { LIVE_PROJECTION, CONTACT_KEY, wantsLiveProjection, stripContact, applyLiveProjection };
