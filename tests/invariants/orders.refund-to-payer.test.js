'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Invariant #5 (P1) — transcrit tel quel depuis features/orders.feature.js :
 *
 *   « tout remboursement retourne au payeur, jamais au destinataire »
 *
 * Approche : test mixte statique + dynamique sur services/refund-service.js,
 * le service qui décide effectivement à qui va le remboursement.
 *
 * - Statique : vérification que userId dérive de order.user_id dans le code
 *   source de refund-service.js — jamais de recipient_* ni d'autre colonne.
 * - Dynamique : injecter un order avec user_id distinct du recipient simulé,
 *   vérifier que walletService.credit reçoit userId = order.user_id.
 *
 * Périmètre : services/refund-service.js (files.services du manifeste
 * payments, et couche de sortie du manifeste orders pour les remboursements).
 */

const fs   = require('fs');
const path = require('path');

const REFUND_SVC = path.join(__dirname, '../../services/refund-service.js');
const ADMIN_REFUND = path.join(__dirname, '../../services/admin-order-refund.js');

// ── A. Vérification statique — quelle colonne est utilisée comme userId ──────
describe('invariant orders — remboursement au payeur (statique)', () => {
  test('refund-service.js utilise order.user_id, jamais recipient_id ni order.recipient', () => {
    const src = fs.readFileSync(REFUND_SVC, 'utf8');
    // La clé userId passée à walletService.credit DOIT pointer vers order.user_id
    expect(src).toMatch(/userId\s*:\s*order\.user_id/);
    // Aucune variante recipient comme cible de remboursement
    expect(src).not.toMatch(/userId\s*:\s*order\.recipient|userId\s*:\s*recipient_id/i);
  });

  test('admin-order-refund.js ne substitue pas de userId destinataire avant processRefund', () => {
    const src = fs.readFileSync(ADMIN_REFUND, 'utf8');
    // Le service passe l'objet order complet à processRefund (pas de override userId)
    expect(src).toMatch(/processRefund\s*\(/);
    expect(src).not.toMatch(/userId\s*:\s*(?:order\.)?recipient/i);
  });

  test('les deux chemins (Stripe ET wallet) utilisent order.user_id — pas un champ destinataire', () => {
    const src = fs.readFileSync(REFUND_SVC, 'utf8');
    // Extraire les sections où userId est attribué dans processRefund
    const userIdMatches = [...src.matchAll(/userId\s*:\s*([^\s,\n]+)/g)]
      .map(m => m[1].trim());
    const nonPayer = userIdMatches.filter(
      v => !['order.user_id'].includes(v) && !v.startsWith('//') && v !== ''
    );
    // Seuls order.user_id est autorisé comme source de userId dans ce fichier
    expect(nonPayer).toHaveLength(0);
  });
});

// ── B. Vérification dynamique — walletService.credit reçoit user_id ──────────
describe('invariant orders — remboursement au payeur (dynamique)', () => {
  const PAYER_ID     = 11;
  const RECIPIENT_ID = 99; // simulé — personne différente du payeur

  jest.mock('../../utils/logger', () => ({
    child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  }));
  jest.mock('stripe', () =>
    jest.fn(() => ({ refunds: { create: jest.fn().mockResolvedValue({ id: 'rf_test' }) } }))
  );
  jest.mock('../../services/wallet-service', () => ({
    credit: jest.fn().mockResolvedValue({ transaction: { id: 1 } }),
  }));
  jest.mock('../../services/documents/refund-receipt', () => ({ issue: jest.fn() }));

  const { makeClient } = require('../integration/test-harness/mock-db');

  beforeEach(() => jest.clearAllMocks());

  function makePayerOrder() {
    return {
      id: 42, reference: 'K-42', user_id: PAYER_ID,  // ← payeur
      payment_mode: 'wallet_credit',      // wallet → appelle walletService.credit
      stripe_payment_id: null,
      total_kmf: 25000, total_eur: 0,
    };
  }

  test('wallet credit va à order.user_id (le payeur), jamais à recipient_id', async () => {
    const { processRefund } = require('../../services/refund-service');
    const walletService = require('../../services/wallet-service');
    const order = makePayerOrder();

    // Mock des queries DB dans l'ordre d'appel de processRefund :
    //   1. INSERT refunds pending (ON CONFLICT → RETURNING id)
    //   2. SELECT refunds (fallback si conflict)
    //   3. UPDATE refunds SET completed
    const dbClient = makeClient([
      { rows: [{ id: 1 }] },   // INSERT refunds RETURNING id
      { rows: [] },             // SELECT refunds (fallback, non atteint ici)
      { rows: [], rowCount: 1 }, // UPDATE refunds SET completed
    ]);

    await processRefund(
      dbClient, order,
      25000, 0,
      'full', 'Annulation test', 5 /* initiatedBy = admin.id */
    );

    // walletService.credit DOIT avoir été appelé avec userId = PAYER_ID
    expect(walletService.credit).toHaveBeenCalled();
    const callArgs = walletService.credit.mock.calls[0][1]; // second arg = opts
    expect(callArgs.userId).toBe(PAYER_ID);
    expect(callArgs.userId).not.toBe(RECIPIENT_ID);
  });
});
