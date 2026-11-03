'use strict';
/**
 * @feature       dashboard
 * @layer         service
 * @owner         dashboard
 * @purpose       Mode dégradé : une confirmation faite depuis l'interface (sans scan matériel) passe par le MÊME writer
 *                (scan-engine.processScan) ; ce module ne fait que valider le motif et marquer l'événement
 *                `entry_mode = manual_confirmation`. Aucune gate n'est contournée, aucune écriture directe.
 * @inputs        reason (liste fermée), note facultative
 * @outputs       metadata à fusionner dans processScan, notes lisibles
 * @db-read       none
 * @db-write      none
 */

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
