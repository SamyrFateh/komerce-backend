'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));
const { verifyRefundEvidence } = require('../../services/refund-evidence-verifier');
const base = {
  id: '11111111-2222-4333-8444-555555555555',
  provider: 'stripe', amount_eur: '12.50', capture_ref: 'pi_demo',
};
const stripeEvidence = { id: 're_demo', payment_intent: 'pi_demo', amount: 1250,
  currency: 'eur', status: 'succeeded' };
const paypalEvidence = { id: 'RF-DEMO', status: 'COMPLETED',
  amount: { currency_code: 'EUR', value: '12.50' },
  supplementary_data: { related_ids: { capture_id: 'CAP-DEMO' } } };

const readStripe = (value = stripeEvidence) => ({
  refunds: { retrieve: jest.fn().mockResolvedValue(value) },
});
const readPaypal = (value = paypalEvidence) => ({
  getRefund: jest.fn().mockResolvedValue(value),
});
const optsStripe = (provider = readStripe()) => ({
  intent: base, providerRefundId: 're_demo', stripe: provider,
});
const optsPaypal = (provider = readPaypal()) => ({
  intent: { ...base, provider: 'paypal', capture_ref: 'CAP-DEMO' },
  providerRefundId: 'RF-DEMO', paypal: provider,
});

test('Stripe GET : valide montant, devise, capture, ID et statut succès', async () => {
  const stripe = readStripe();
  const result = await verifyRefundEvidence(optsStripe(stripe));
  expect(result).toEqual({ verdict: 'VERIFIED_SUCCESS', verified: true,
    provider: 'stripe', providerRefundId: 're_demo' });
  expect(stripe.refunds.retrieve).toHaveBeenCalledWith('re_demo');
});
test('PayPal GET : valide chaîne capture et montant exact', async () => {
  const paypal = readPaypal();
  const result = await verifyRefundEvidence(optsPaypal(paypal));
  expect(result).toEqual({ verdict: 'VERIFIED_SUCCESS', verified: true,
    provider: 'paypal', providerRefundId: 'RF-DEMO' });
  expect(paypal.getRefund).toHaveBeenCalledWith('RF-DEMO');
});
test.each([
  ['status pending', { status: 'pending' }, 'PROVIDER_REFUND_PENDING'],
  ['pas de capture', { payment_intent: null }, 'PROVIDER_CAPTURE_LINK_UNVERIFIABLE'],
  ['reference incorrecte', { id: 're_other' }, 'PROVIDER_REFERENCE_UNVERIFIABLE'],
  ['status inconnu', { status: 'MYSTERY' }, 'PROVIDER_STATUS_UNRECOGNIZED'],
])('Stripe non concluant : %s', async (_label, fields, reason) => {
  const out = await verifyRefundEvidence(optsStripe(readStripe({ ...stripeEvidence, ...fields })));
  expect(out).toEqual({ verdict: 'UNKNOWN', reason, verified: false });
});
test.each([
  [{ payment_intent: 'pi_other' }, 'REFUND_EVIDENCE_CAPTURE_MISMATCH'],
  [{ amount: 1300 }, 'REFUND_EVIDENCE_AMOUNT_MISMATCH'],
  [{ currency: 'usd' }, 'REFUND_EVIDENCE_AMOUNT_MISMATCH'],
])('Stripe mismatch est une alerte explicite, jamais un succès', async (fields, code) => {
  await expect(verifyRefundEvidence(optsStripe(readStripe({ ...stripeEvidence, ...fields }))))
    .rejects.toMatchObject({ code });
});
test.each([
  [{ supplementary_data: undefined }, 'PROVIDER_CAPTURE_LINK_UNVERIFIABLE'],
  [{ status: 'PENDING' }, 'PROVIDER_REFUND_PENDING'],
])('PayPal incomplete / attente ne confirme pas', async (fields, reason) => {
  expect(await verifyRefundEvidence(optsPaypal(readPaypal({ ...paypalEvidence, ...fields }))))
    .toEqual({ verdict: 'UNKNOWN', reason, verified: false });
});
test.each([
  [{ amount: { currency_code: 'USD', value: '12.50' } }, 'REFUND_EVIDENCE_AMOUNT_MISMATCH'],
  [{ amount: { currency_code: 'EUR', value: '12.49' } }, 'REFUND_EVIDENCE_AMOUNT_MISMATCH'],
  [{ supplementary_data: { related_ids: { capture_id: 'CAP-OTHER' } } }, 'REFUND_EVIDENCE_CAPTURE_MISMATCH'],
])('PayPal preuves contradictoires sont rejetées', async (fields, code) => {
  await expect(verifyRefundEvidence(optsPaypal(readPaypal({ ...paypalEvidence, ...fields }))))
    .rejects.toMatchObject({ code });
});
test('PayPal état DENIED vérifié n est pas un remboursement confirmé', async () => {
  const value = { ...paypalEvidence, status: 'DENIED' };
  expect(await verifyRefundEvidence(optsPaypal(readPaypal(value))))
    .toMatchObject({ verdict: 'VERIFIED_FAILURE', verified: true });
});
test('Stripe failed vérifié n est pas un remboursement confirmé', async () => {
  expect(await verifyRefundEvidence(optsStripe(readStripe({ ...stripeEvidence, status: 'failed' }))))
    .toMatchObject({ verdict: 'VERIFIED_FAILURE', verified: true });
});
test('erreur réseau PSP devient UNKNOWN, jamais FAILED ni confirmé', async () => {
  const stripe = { refunds: { retrieve: jest.fn().mockRejectedValue(new Error('timeout')) } };
  expect(await verifyRefundEvidence(optsStripe(stripe)))
    .toEqual({ verdict: 'UNKNOWN', reason: 'PROVIDER_LOOKUP_UNAVAILABLE', verified: false });
});
test('adaptateur manquant refuse au lieu de simuler un succès', async () => {
  await expect(verifyRefundEvidence(optsStripe(null))).rejects.toMatchObject({
    code: 'REFUND_PROVIDER_ADAPTER_MISSING',
  });
});
test('montant de la demande invalide interdit un GET provider', async () => {
  const stripe = readStripe();
  await expect(verifyRefundEvidence({ ...optsStripe(stripe), intent: { ...base, amount_eur: '12.345' } }))
    .rejects.toMatchObject({ code: 'REFUND_AMOUNT_INVALID' });
  expect(stripe.refunds.retrieve).not.toHaveBeenCalled();
});
