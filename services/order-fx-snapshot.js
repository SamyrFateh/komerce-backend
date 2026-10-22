/**
 * @komerce-arch
 * @role          order-fx-snapshot
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        total_kmf, market, client, order, refund_kmf
 * @outputs       fx_snapshot, total_eur, refund_eur
 * @depends       db, services/fx-authority.js
 * @used-by       services/order-checkout-service.js, routes/orders/cancel.js, services/parcel-operations.js, services/payment-mobile-money.js
 * @db-read       refunds
 * @db-write      none
 * @db-txn        none
 * @doctrine      eur_is_the_pivot, one_transaction_truth, snapshot_is_read_never_reconverted, refund_from_captured_amount
 * @impact-areas  orders, payments, refunds, finance
 * @version       2026-10
 *
 * Une seule vérité monétaire de transaction, figée à la commande :
 *   origin : montant d'origine en base du moteur économique (KMF, contrat historique *_kmf)
 *   market : montant confirmé dans la devise commerciale du MARCHÉ DU RELAIS (serveur), pas la navigation du client
 *   eur    : montant EUR autorisé/encaissé (Stripe, PayPal)
 *   legs   : taux sourcés (parités, observation, peg) utilisés pour ces conversions
 * Les paiements et remboursements LISENT ce snapshot ; aucune reconversion au taux du jour.
 * Remboursement = part du montant EUR réellement encaissé (prorata exact, dernier remboursement = solde exact),
 * plafonné au capturé, sans repli de taux.
 */
'use strict';

const fx = require('./fx-authority');

const BASE = 'KMF';

function refundError(message, code, statusCode = 409) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

async function buildOrderFxSnapshot({ totalKmf, marketId, marketCurrency, client }) {
  const mc = String(marketCurrency || '').trim().toUpperCase();
  if (!mc) throw refundError('Devise du marché inconnue : commande refusée.', 'ORDER_MARKET_CURRENCY_MISSING');
  const eur = await fx.convert({ amount: String(totalKmf), from: BASE, to: 'EUR', client });
  const market = mc === 'EUR' ? eur : await fx.convert({ amount: String(totalKmf), from: BASE, to: mc, client });
  const snapshot = {
    version: 1,
    pivot_currency: 'EUR',
    origin: { currency: BASE, amount: Number(totalKmf), role: 'economic_engine_base' },
    market: {
      market_id: marketId || null, currency: mc, amount: market.amount, amount_text: market.amount_text,
      minor_unit: market.rounding.minor_unit, legs: market.legs,
    },
    eur: { currency: 'EUR', amount: eur.amount, amount_text: eur.amount_text, legs: eur.legs },
    rounding: { mode: 'half_even' },
  };
  return { snapshot, totalEur: eur.amount, marketAmount: market.amount };
}

// Cumul déjà remboursé (completed + pending) pour les autres types que celui en cours (idempotence du même type).
async function loadPriorRefunds(client, orderId, excludeType = null) {
  const { rows: [row] } = await client.query(
    `SELECT COALESCE(SUM(amount_kmf), 0)::text AS kmf, COALESCE(SUM(amount_eur), 0)::text AS eur
       FROM refunds
      WHERE order_id = $1 AND status IN ('completed', 'pending')
        AND ($2::text IS NULL OR refund_type <> $2)`,
    [orderId, excludeType]
  );
  return { kmf: row?.kmf ?? '0', eur: row?.eur ?? '0' };
}

/**
 * Montant EUR à rembourser pour `refundKmf`, depuis le montant EUR encaissé de la commande (aucune reconversion).
 * - total_eur/total_kmf absents : refus (plus de repli 492).
 * - refund > reste remboursable : refus.
 * - remboursement du reste complet : solde EUR exact (la somme des remboursements = total_eur, sans dérive d'arrondi).
 */
function refundEurForKmf({ order, refundKmf, prior = { kmf: '0', eur: '0' } }) {
  const totalKmf = String(order?.total_kmf ?? '');
  const totalEur = String(order?.total_eur ?? '');
  if (!(Number(totalKmf) > 0) || !(Number(totalEur) > 0)) {
    throw refundError('Montant encaissé de la commande indisponible : remboursement refusé.', 'REFUND_ORDER_FX_MISSING');
  }
  const kmf = Number(refundKmf);
  if (!(kmf > 0)) return 0;
  const remainingKmf = Number(totalKmf) - Number(prior.kmf);
  const remainingEur = Number(totalEur) - Number(prior.eur);
  if (kmf > remainingKmf + 1e-9) {
    throw refundError('Le remboursement dépasse le montant restant à rembourser.', 'REFUND_EXCEEDS_CAPTURED');
  }
  if (Math.abs(kmf - remainingKmf) < 1e-9) return Number(remainingEur.toFixed(2));
  const eur = fx.prorate(String(refundKmf), totalEur, totalKmf, 2);
  if (eur > remainingEur + 1e-9) {
    throw refundError('Le remboursement dépasse le montant EUR restant encaissé.', 'REFUND_EXCEEDS_CAPTURED');
  }
  return eur;
}

async function computeRefundEurForOrder(client, order, refundKmf, refundType) {
  const prior = await loadPriorRefunds(client, order.id, refundType);
  return refundEurForKmf({ order, refundKmf, prior });
}

// Garde de défense dans refund-service : ni le KMF ni l'EUR cumulés ne dépassent le capturé.
async function assertRefundWithinCaptured(client, order, amountKmf, amountEur, refundType) {
  const prior = await loadPriorRefunds(client, order.id, refundType);
  if (Number(prior.kmf) + Number(amountKmf) > Number(order.total_kmf) + 1e-9
      || Number(prior.eur) + Number(amountEur) > Number(order.total_eur) + 0.005) {
    throw refundError('Le cumul des remboursements dépasse le montant encaissé.', 'REFUND_EXCEEDS_CAPTURED');
  }
}

// Même (commande, type) déjà enregistré : rejouable seulement avec les MÊMES montants (idempotence) ; sinon refus
// explicite (la contrainte unique ignorerait silencieusement le second remboursement).
async function assertRefundRecordCompatible(client, order, amountKmf, amountEur, refundType) {
  const { rows: [existing] } = await client.query(
    'SELECT amount_kmf::text AS kmf, amount_eur::text AS eur FROM refunds WHERE order_id = $1 AND refund_type = $2 LIMIT 1',
    [order.id, refundType]
  );
  if (existing && (Math.abs(Number(existing.kmf) - Number(amountKmf)) > 1e-9 || Math.abs(Number(existing.eur) - Number(amountEur)) > 0.005)) {
    throw refundError('Un remboursement de ce type existe déjà pour cette commande avec un montant différent.',
      'REFUND_ALREADY_RECORDED_DIFFERENT_AMOUNT');
  }
}

// Remboursement « de clôture » (annulation client, remboursement admin) : jamais plus que le reste remboursable
// (le capturé moins tout remboursement déjà enregistré), montant EUR = part exacte du capturé.
// Le type est 'full' pour 100 % ou si un 'partial' existe déjà (contrainte unique (order_id, refund_type)).
async function computeClosingRefund(client, order, pct = 100) {
  const prior = await loadPriorRefunds(client, order.id, null);
  const totalKmf = Number(order?.total_kmf);
  const totalEur = Number(order?.total_eur);
  if (!(totalKmf > 0) || !(totalEur > 0)) {
    throw refundError('Montant encaissé de la commande indisponible : remboursement refusé.', 'REFUND_ORDER_FX_MISSING');
  }
  const remainingKmf = totalKmf - Number(prior.kmf);
  const target = Math.round(totalKmf * Number(pct) / 100);
  const kmf = Math.max(0, Math.min(target, remainingKmf));
  const { rows: [partial] } = await client.query(
    "SELECT 1 FROM refunds WHERE order_id = $1 AND refund_type = 'partial' LIMIT 1", [order.id]);
  const type = (Number(pct) >= 100 || partial) ? 'full' : 'partial';
  const eur = kmf > 0 ? refundEurForKmf({ order, refundKmf: kmf, prior }) : 0;
  return { kmf, eur, type };
}

module.exports = {
  computeClosingRefund,
  assertRefundRecordCompatible,
  buildOrderFxSnapshot, loadPriorRefunds, refundEurForKmf, computeRefundEurForOrder, assertRefundWithinCaptured,
};
