'use strict';

/**
 * Invariant (P5-N2/N3) — transcrit depuis la revue N2, non redéduit du code :
 *
 *   1. refunded → paid  est BLOQUÉ (état terminal financier).
 *   2. failed → paid    n'est autorisé que via un événement de paiement
 *                        identifiable { type, externalId } — jamais un
 *                        markPaid(orderId) nu.
 *   3. → failed          n'est autorisé que depuis 'pending', sans bypass.
 *   4. partially_paid    n'est JAMAIS une cible valide et n'est écrit nulle
 *                        part dans orders.payment_status (enum PostgreSQL
 *                        vestige — libellé d'affichage calculé, pas un état
 *                        réel de la colonne).
 *
 * Testé à deux niveaux :
 *   - unitairement sur payment-status-validator.js (la source unique) ;
 *   - par détection statique : aucun fichier de services/ ne doit contenir
 *     un UPDATE littéral posant payment_status = 'partially_paid'.
 */

const fs = require('fs');
const path = require('path');
const {
  validateTransition,
  sourceStatusesFor,
} = require('../../services/payment-status-validator');

describe('invariant payment_status — matrice de transitions (validateTransition)', () => {
  test('refunded → paid : bloqué', () => {
    expect(validateTransition('refunded', 'paid').allowed).toBe(false);
  });

  test('failed → paid : bloqué sans événement de paiement identifiable', () => {
    expect(validateTransition('failed', 'paid').allowed).toBe(false);
    expect(validateTransition('failed', 'paid', { paymentEvent: {} }).allowed).toBe(false);
    expect(validateTransition('failed', 'paid', { paymentEvent: { type: 'stripe_retry' } }).allowed).toBe(false);
  });

  test('failed → paid : autorisé avec un événement de paiement identifiable', () => {
    const r = validateTransition('failed', 'paid', {
      paymentEvent: { type: 'stripe_retry', externalId: 'pi_123' },
    });
    expect(r.allowed).toBe(true);
  });

  test('pending → paid : toujours autorisé', () => {
    expect(validateTransition('pending', 'paid').allowed).toBe(true);
  });

  test('pending → failed : autorisé ; toute autre source → failed est bloquée', () => {
    expect(validateTransition('pending', 'failed').allowed).toBe(true);
    expect(validateTransition('paid', 'failed').allowed).toBe(false);
    expect(validateTransition('refunded', 'failed').allowed).toBe(false);
  });

  test('partially_paid : jamais une cible valide, avec ou sans événement', () => {
    expect(validateTransition('pending', 'partially_paid').allowed).toBe(false);
    expect(validateTransition('paid', 'partially_paid').allowed).toBe(false);
    expect(sourceStatusesFor('partially_paid')).toEqual([]);
  });

  test('même statut → même statut : no-op idempotent, jamais bloquant', () => {
    expect(validateTransition('paid', 'paid').allowed).toBe(true);
    expect(validateTransition('refunded', 'refunded').allowed).toBe(true);
  });
});

describe('invariant payment_status — détection statique : partially_paid jamais écrit', () => {
  const SERVICES_DIR = path.join(__dirname, '../../services');
  const WRITE_PATTERN = /payment_status\s*=\s*'partially_paid'/;

  function jsFilesRecursive(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return jsFilesRecursive(full);
      return entry.name.endsWith('.js') ? [full] : [];
    });
  }

  test("aucun fichier de services/ ne pose payment_status = 'partially_paid'", () => {
    const offenders = jsFilesRecursive(SERVICES_DIR)
      .filter((file) => WRITE_PATTERN.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
