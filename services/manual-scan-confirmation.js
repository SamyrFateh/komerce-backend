/**
 * @komerce-arch
 * @role          manual-scan-confirmation
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        reason_closed_list, optional_note
 * @outputs       degraded_mode_metadata_for_scan_engine
 * @depends       none
 * @used-by       services/operations-workspace.js, services/shipping-customs-workspace.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_scan_writer, degraded_mode_traced, no_gate_bypass
 * @impact-areas  logistics, relay, hub
 * @version       2026-11
 */
'use strict';

const MANUAL_REASONS = Object.freeze({
  scanner_unavailable: 'Scanner indisponible',
  label_unreadable: 'Étiquette illisible',
  offline: 'Hors ligne',
  other: 'Autre (précisez)',
});

class ManualConfirmationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ManualConfirmationError';
    this.code = code;
    this.status = 400;
  }
}

function buildManualConfirmation(input) {
  const body = input && typeof input === 'object' ? input : {};
  const reason = String(body.reason || '').trim();
  if (!Object.prototype.hasOwnProperty.call(MANUAL_REASONS, reason)) {
    throw new ManualConfirmationError('manual_reason_required', 'Motif de confirmation manuelle requis');
  }
  const note = body.note ? String(body.note).trim().slice(0, 500) : '';
  if (reason === 'other' && !note) {
    throw new ManualConfirmationError('manual_note_required', 'Précisez le motif de la confirmation manuelle');
  }
  return Object.freeze({
    metadata: { entry_mode: 'manual_confirmation', manual_reason: reason, ...(note ? { manual_note: note } : {}) },
    notes: `Confirmation manuelle · ${MANUAL_REASONS[reason]}${note ? ` · ${note}` : ''}`,
  });
}

module.exports = { MANUAL_REASONS, ManualConfirmationError, buildManualConfirmation };
