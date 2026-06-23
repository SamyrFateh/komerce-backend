/**
 * Tests unitaires — collective-payment-orchestrator.js (tombstone)
 *
 * Le modèle Collectif/Workspace est désactivé (doctrine Boutique First).
 * Ce module reste exporté pour compatibilité server.js mais toutes les
 * fonctions sont des no-ops ou renvoient HTTP 410.
 *
 * E3 — Bloc E (Tests & couverture), BACKEND_GOLIVE_ROADMAP.md
 */

'use strict';

const orchestrator = require('../../services/collective-payment-orchestrator');

describe('collective-payment-orchestrator (tombstone)', () => {

  describe('startExpirationCron', () => {
    it('retourne null sans lancer de cron', () => {
      const result = orchestrator.startExpirationCron();
      expect(result).toBeNull();
    });
  });

  describe('createOrGetPaymentIntent', () => {
    it('throw 410 collective_workspace_disabled', async () => {
      await expect(orchestrator.createOrGetPaymentIntent())
        .rejects
        .toThrow('collective_workspace_disabled');

      try {
        await orchestrator.createOrGetPaymentIntent();
      } catch (err) {
        expect(err.statusCode).toBe(410);
      }
    });
  });

  describe('handlePaymentIntentCapturable', () => {
    it('retourne null (webhook ignoré)', async () => {
      const result = await orchestrator.handlePaymentIntentCapturable();
      expect(result).toBeNull();
    });
  });

  describe('handlePaymentIntentCanceled', () => {
    it('retourne null (webhook ignoré)', async () => {
      const result = await orchestrator.handlePaymentIntentCanceled();
      expect(result).toBeNull();
    });
  });

  describe('expireOldSessions', () => {
    it('retourne { expired: 0, disabled: true }', async () => {
      const result = await orchestrator.expireOldSessions();
      expect(result).toEqual({ expired: 0, disabled: true });
    });
  });

  describe('exports exhaustifs', () => {
    it('exporte exactement les 5 fonctions attendues', () => {
      const keys = Object.keys(orchestrator).sort();
      expect(keys).toEqual([
        'createOrGetPaymentIntent',
        'expireOldSessions',
        'handlePaymentIntentCanceled',
        'handlePaymentIntentCapturable',
        'startExpirationCron',
      ]);
    });
  });
});
