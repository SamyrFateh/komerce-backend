/**
 * @komerce-arch
 * @role          economic-engine-finance
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       exchange_rates, orders, relais, users
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

/**
 * KOMERCE — Comptabilité & Export Finance v2.0 (nettoyé)
 *
 * ⚠️  GET /summary déplacé vers /api/dashboard/finance (v11.0)
 *
 * GET /api/finance/export          → export CSV transactions du mois (query: month, year)
 * GET /api/finance/stripe-proofs   → liste PaymentIntents Stripe confirmés (query: month, year)
 * GET /api/finance/report          → rapport PDF mensuel synthèse
 *
 * Toutes les routes sont protégées : admin uniquement.
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db         = require('../db');
const PDFDocument = require('pdfkit');
const { authenticate, requireRole } = require('../middleware/auth');
const { getRates } = require('../utils/rates');

const adminOnly = [authenticate, requireRole(['admin'])];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizePeriod(month, year) {
  const now   = new Date();
  const m     = Math.max(1, Math.min(12, parseInt(month) || (now.getMonth() + 1)));
  const y     = Math.max(2024, Math.min(2099, parseInt(year) || now.getFullYear()));
  const debut = new Date(y, m - 1, 1);
  const fin   = new Date(y, m, 1);
  return { m, y, debut, fin, label: `${String(m).padStart(2, '0')}-${y}` };
}

function csvEscape(val) {
  const s = String(val ?? '').replace(/\"/g, '""');
  return /[,"\n]/.test(s) ? `"${s}"` : s;
}

function csvRow(...cols) {
  return cols.map(csvEscape).join(',') + '\r\n';
}

// ── GET /api/finance/summary → DÉPLACÉ vers /api/dashboard/finance ────────────
router.get('/summary', ...adminOnly, (req, res) => {
  res.status(301).json({
    error: 'Endpoint déplacé',
    redirect: '/api/dashboard/finance',
    message: 'Utilisez GET /api/dashboard/finance?period=30 à la place',
  });
});


// ── GET /api/finance/export ───────────────────────────────────────────────────
// Export CSV de toutes les transactions du mois avec taux de change figés.
// Query params : ?month=3&year=2026

router.get('/export', ...adminOnly, async (req, res, next) => {
  try {
    const { m, y, debut, fin, label } = sanitizePeriod(req.query.month, req.query.year);

    const { rows } = await db.query(`
      SELECT
        o.reference,
        o.created_at,
        o.status,
        o.payment_mode,
        o.payment_status,
        o.total_kmf,
        o.total_eur,
        o.cost_real_kmf,
        o.cost_estimated_kmf,
        o.margin_real_pct,
        o.order_occasion,
        u.full_name   AS client_name,
        u.phone       AS client_phone,
        r.name        AS relais_name,
        er.eur_kmf    AS taux_eur_kmf,
        er.aed_kmf    AS taux_aed_kmf
      FROM orders o
      LEFT JOIN users         u  ON u.id  = o.user_id
      LEFT JOIN relais        r  ON r.id  = o.relais_id
      -- Taux figé au moment de la commande (dernier taux avant la commande)
      -- ADR-009 : usage légitime de exchange_rates en tant qu'historique d'audit.
      -- finance_config porte le taux ACTUEL ; exchange_rates porte les taux PASSÉS.
      LEFT JOIN LATERAL (
        SELECT eur_kmf, aed_kmf
        FROM exchange_rates
        WHERE valid_from <= o.created_at::date
        ORDER BY valid_from DESC
        LIMIT 1
      ) er ON TRUE
      WHERE o.created_at >= $1
        AND o.created_at <  $2
        AND o.status != 'cancelled'
      ORDER BY o.created_at ASC
    `, [debut, fin]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="komerce-export-${label}.csv"`);

    // BOM UTF-8 pour Excel
    res.write('\uFEFF');

    // En-têtes
    res.write(csvRow(
      'Référence', 'Date', 'Statut', 'Mode paiement', 'Statut paiement',
      'Total KMF', 'Total EUR', 'Coût réel KMF', 'Coût estimé KMF',
      'Marge réelle %', 'Occasion', 'Client', 'Téléphone', 'Relais',
      'Taux EUR/KMF', 'Taux AED/KMF'
    ));

    for (const o of rows) {
      res.write(csvRow(
        o.reference,
        new Date(o.created_at).toLocaleDateString('fr-FR'),
        o.status,
        o.payment_mode,
        o.payment_status,
        o.total_kmf,
        o.total_eur,
        o.cost_real_kmf   ?? '',
        o.cost_estimated_kmf ?? '',
        o.margin_real_pct ?? '',
        o.order_occasion  ?? '',
        o.client_name     ?? '',
        o.client_phone    ?? '',
        o.relais_name     ?? '',
        o.taux_eur_kmf    ?? '',
        o.taux_aed_kmf    ?? ''
      ));
    }

    res.end();

  } catch(err) { next(err); }
});

// ── GET /api/finance/stripe-proofs ───────────────────────────────────────────
// Retourne la liste des PaymentIntents Stripe confirmés sur le mois.
// Inclut le rapprochement avec la commande Komerce correspondante.
// Query params : ?month=3&year=2026

router.get('/stripe-proofs', ...adminOnly, async (req, res, next) => {
  try {
    const { m, y, debut, fin } = sanitizePeriod(req.query.month, req.query.year);

    // Récupérer les commandes Stripe payées ce mois depuis la DB
    const { rows: orders } = await db.query(`
      SELECT
        o.reference,
        o.stripe_payment_id,
        o.total_eur,
        o.total_kmf,
        o.created_at,
        u.full_name AS client_name,
        u.email     AS client_email
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.payment_mode    = 'stripe_eur'
        AND o.payment_status  = 'paid'
        AND o.created_at     >= $1
        AND o.created_at      < $2
      ORDER BY o.created_at DESC
    `, [debut, fin]);

    if (!orders.length) {
      return res.json({ month: m, year: y, count: 0, transactions: [] });
    }

    // Enrichir avec les détails Stripe si la clé est configurée
    const transactions = [];
    for (const order of orders) {
      const tx = {
        komerce_reference:  order.reference,
        stripe_payment_id:  order.stripe_payment_id,
        amount_eur:         parseFloat(order.total_eur),
        amount_kmf:         parseInt(order.total_kmf),
        created_at:         order.created_at,
        client_name:        order.client_name,
        client_email:       order.client_email,
        stripe_dashboard_url: order.stripe_payment_id
          ? `https://dashboard.stripe.com/payments/${order.stripe_payment_id}`
          : null,
      };

      // Récupérer les détails Stripe si possible
      if (order.stripe_payment_id && process.env.STRIPE_SECRET_KEY) {
        try {
          const intent = await stripe.paymentIntents.retrieve(order.stripe_payment_id);
          tx.stripe_status        = intent.status;
          tx.stripe_amount_eur    = intent.amount / 100;
          tx.stripe_created       = new Date(intent.created * 1000).toISOString();
          tx.stripe_receipt_email = intent.receipt_email;
          tx.stripe_last4         = intent.payment_method
            ? (await stripe.paymentMethods.retrieve(intent.payment_method))?.card?.last4
            : null;
        } catch (stripeErr) {
          tx.stripe_error = stripeErr.message;
        }
      }

      transactions.push(tx);
    }

    const total_eur = transactions.reduce((s, t) => s + t.amount_eur, 0);
    const rates     = await getRates();

    res.json({
      month:        m,
      year:         y,
      count:        transactions.length,
      total_eur:    parseFloat(total_eur.toFixed(2)),
      total_kmf:    Math.round(total_eur * rates.eur_kmf),
      transactions,
    });

  } catch(err) { next(err); }
});

// ── GET /api/finance/report ───────────────────────────────────────────────────
// Rapport PDF mensuel : synthèse CA, marges, flux devises.
// Query params : ?month=3&year=2026

router.get('/report', ...adminOnly, async (req, res, next) => {
  try {
    const { m, y, debut, fin, label } = sanitizePeriod(req.query.month, req.query.year);
    const rates = await getRates();

    // Données agrégées du mois
    const { rows: [kpi] } = await db.query(`
      SELECT
        COUNT(*)                                                        AS nb_commandes,
        COUNT(*) FILTER (WHERE payment_mode = 'cash_relais')           AS nb_cash,
        COUNT(*) FILTER (WHERE payment_mode = 'stripe_eur')            AS nb_stripe,
        COALESCE(SUM(total_kmf) FILTER (WHERE status != 'cancelled'), 0)  AS ca_kmf,
        COALESCE(SUM(total_eur) FILTER (WHERE status != 'cancelled'), 0)  AS ca_eur,
        COALESCE(SUM(total_kmf) FILTER (
          WHERE payment_mode = 'cash_relais' AND status != 'cancelled'), 0) AS ca_cash_kmf,
        COALESCE(SUM(total_eur) FILTER (
          WHERE payment_mode = 'stripe_eur' AND status != 'cancelled'), 0)  AS ca_stripe_eur,
        COALESCE(SUM(cost_real_kmf) FILTER (
          WHERE cost_real_kmf IS NOT NULL AND status != 'cancelled'), 0)     AS couts_reels_kmf,
        COALESCE(AVG(margin_real_pct) FILTER (
          WHERE margin_real_pct IS NOT NULL), 0)                         AS marge_moy_pct,
        COUNT(*) FILTER (WHERE status = 'cancelled')                   AS nb_annulations,
        COUNT(*) FILTER (WHERE status = 'collected')                   AS nb_livrees
      FROM orders
      WHERE created_at >= $1 AND created_at < $2
    `, [debut, fin]);

    const moisLabel = debut.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const marge_kmf = parseFloat(kpi.ca_kmf) - parseFloat(kpi.couts_reels_kmf);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="komerce-rapport-${label}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    const bleu = '#1a3a5c';
    const or   = '#e8a020';
    const vert = '#16a34a';

    // ── En-tête ───────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(bleu);
    doc.fillColor('white')
      .fontSize(22).font('Helvetica-Bold')
      .text('KOMERCE', 50, 22)
      .fontSize(11).font('Helvetica')
      .text(`Rapport financier — ${moisLabel}`, 50, 50);
    doc.fillColor(or).circle(doc.page.width - 60, 40, 22).fill();
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
      .text('KMF', doc.page.width - 72, 36);

    doc.moveDown(4);

    // ── KPIs principaux ───────────────────────────────────────────────────────
    doc.fillColor(bleu).fontSize(13).font('Helvetica-Bold').text('Synthèse du mois', 50);
    doc.moveDown(0.4);

    const kpiData = [
      ['Commandes', kpi.nb_commandes],
      ['Livrées', kpi.nb_livrees],
      ['Annulations', kpi.nb_annulations],
      ['CA total', `${parseInt(kpi.ca_kmf).toLocaleString('fr')} KMF`],
      ['dont Espèces', `${parseInt(kpi.ca_cash_kmf).toLocaleString('fr')} KMF`],
      ['dont Stripe', `${parseFloat(kpi.ca_stripe_eur).toFixed(0)} EUR`],
      ['Coûts réels', `${parseInt(kpi.couts_reels_kmf).toLocaleString('fr')} KMF`],
      ['Marge nette', `${marge_kmf > 0 ? '+' : ''}${Math.round(marge_kmf).toLocaleString('fr')} KMF`],
      ['Marge moy. %', `${parseFloat(kpi.marge_moy_pct).toFixed(1)}%`],
    ];

    doc.font('Helvetica').fontSize(9).fillColor('#333');
    const colW = 240;
    let x = 50, yy = doc.y;

    kpiData.forEach(([label, val], i) => {
      if (i > 0 && i % 2 === 0) { x = 50; yy += 22; }
      else if (i > 0) x = 50 + colW;
      doc.rect(x, yy, colW - 10, 18).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.fillColor('#666').text(label, x + 8, yy + 4, { width: 100 });
      doc.fillColor(bleu).font('Helvetica-Bold')
        .text(String(val), x + 110, yy + 4, { width: 120, align: 'right' });
      doc.font('Helvetica');
    });

    doc.y = yy + 30;
    doc.moveDown();

    // ── Taux de change ────────────────────────────────────────────────────────
    doc.fillColor(bleu).fontSize(13).font('Helvetica-Bold').text('Taux de change utilisés');
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text(`1 EUR = ${rates.eur_kmf} KMF  ·  1 AED = ${rates.aed_kmf} KMF`, { indent: 10 });
    doc.moveDown();

    // ── Pied de page ──────────────────────────────────────────────────────────
    doc.moveDown(3);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.5);
    doc.fillColor('#aaa').fontSize(7).font('Helvetica')
      .text(
        `Généré le ${new Date().toLocaleDateString('fr-FR')} · Komerce · Document confidentiel`,
        { align: 'center' }
      );

    doc.end();

  } catch(err) { next(err); }
});

module.exports = router;
