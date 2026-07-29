/**
 * @komerce-arch
 * @role          feature-boundary-composition-root
 * @domain        bootstrap
 * @layer         composition-root
 * @criticality   high
 * @inputs        business-rules, notification outcomes
 * @outputs       runtime dependency wiring
 * @depends       utils/rates.js, utils/rules.js, services/notifications/internals.js, services/signal-service.js
 * @db-write      none
 * @db-read       none
 * @used-by       server.js
 * @doctrine      feature_first, dependency_inversion, composition_root_only
 * @version       2026-07
 */
'use strict';

const { configureRatesFallbackProvider } = require('../utils/rates');
const { getRuleNumber } = require('../utils/rules');
const { setNotificationOutcomeListener } = require('../services/notifications/internals');
const signalService = require('../services/signal-service');

let wired = false;

function wireFeatureBoundaries() {
  if (wired) return false;

  // Infrastructure reçoit une fonction déjà résolue ; rates.js ne connaît pas
  // business-rules et conserve le fallback legacy sans inversion de frontière.
  configureRatesFallbackProvider(getRuleNumber);

  // Notifications émet un fait neutre. La traduction en signal de pilotage est
  // une responsabilité d'assemblage, pas du transporteur de message.
  setNotificationOutcomeListener(({ event, orderRef, orderId, error }) =>
    signalService.upsertSignal({
      signal_type: 'notification_failure',
      severity: 'warning',
      title: `Notif échouée — ${event}`,
      summary: `Commande ${orderRef || orderId || '?'} · ${String(error).substring(0, 120)}`,
      source_module: 'notification-service',
      target_shell: 'bo',
      target_view: 'orders',
      target_filters: orderId ? { order_id: orderId } : {},
      owner_role: 'admin',
      entity_type: 'order',
      entity_id: orderId || null,
      recommendation: 'Vérifier les logs notification-service et relancer manuellement si nécessaire',
      confidence: 'high',
      meta: { event, orderRef, orderId, error: String(error) },
    })
  );

  wired = true;
  return true;
}

module.exports = { wireFeatureBoundaries };
