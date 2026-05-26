'use strict';

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const engine = require('../services/shared-cart-engine');
const settlement = require('../services/shared-cart-v4-settlement');
const commitments = require('../services/shared-cart-commitment-service');

const router = express.Router();
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
const STRIPE_RETURN_SUCCESS = '/cart/shared/success';
const STRIPE_RETURN_CANCEL = '/cart/shared/cancel';
const DEFAULT_FX_KMF_TO_EUR = 1 / 491.97;

async function getFxKmfToEur() {
  try {
    const { rows } = await db.query(`SELECT eur_to_kmf FROM finance_config WHERE id = 1 LIMIT 1`);
    if (rows.length && rows[0].eur_to_kmf) return 1 / Number(rows[0].eur_to_kmf);
  } catch (_) {}
  return DEFAULT_FX_KMF_TO_EUR;
}

router.get('/public/:token/my-locked-commitment', async (req, res, next) => {
  try {
    const phone = req.query.phone || req.query.participant_phone || req.query.contributor_phone;
    const commitment = await commitments.getMyLockedCommitmentByToken(req.params.token, phone);
    res.json({ ok: true, commitment });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

router.post('/public/:token/contributions', async (req, res, next) => {
  try {
    const { token } = req.params;
    const { amount_kmf, contributor_name, contributor_email, contributor_phone, message } = req.body || {};

    if (!amount_kmf || !contributor_name || !contributor_email || !contributor_phone) {
      return res.status(400).json({
        error: 'Champs requis : amount_kmf, contributor_name, contributor_email, contributor_phone',
        code: 'missing_required_fields',
      });
    }

    await settlement.assertCanAcceptParticipantPaymentByToken(token);
    const locked = await commitments.assertLockedCommitmentPayment(token, contributor_phone, amount_kmf);

    const fxRate = await getFxKmfToEur();
    const amountEur = Math.max(0.5, Math.round(Number(amount_kmf) * fxRate * 100) / 100);

    const { contribution, cart } = await engine.startContribution(token, {
      name: contributor_name,
      email: contributor_email,
      phone: contributor_phone,
      amountKmf: amount_kmf,
      amountPaid: amountEur,
      currency: 'EUR',
      fxRate,
      message,
    });

    await commitments.markCommitmentPaymentPending(locked.id, contribution.id);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: contributor_email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Paiement Komerce — ${cart.title || 'Panier partagé'}`,
            description: 'Règlement de votre engagement verrouillé',
          },
          unit_amount: Math.round(amountEur * 100),
        },
        quantity: 1,
      }],
      metadata: {
        komerce: 'shared_cart_contribution',
        shared_cart_id: cart.id,
        contribution_id: contribution.id,
        commitment_id: locked.id,
        token: cart.token,
        amount_kmf: String(amount_kmf),
      },
      success_url: `${PUBLIC_BASE_URL}${STRIPE_RETURN_SUCCESS}?token=${cart.token}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_BASE_URL}${STRIPE_RETURN_CANCEL}?token=${cart.token}`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    await engine.attachStripeSession(contribution.id, session.id);

    res.json({
      checkout_url: session.url,
      session_id: session.id,
      contribution_id: contribution.id,
      commitment_id: locked.id,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    if (err.message && err.message.startsWith('Le panier ne nécessite plus')) {
      return res.status(400).json({ error: err.message, code: 'amount_exceeds_remaining' });
    }
    next(err);
  }
});

module.exports = { router };
