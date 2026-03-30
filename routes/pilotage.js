/**
 * KOMERCE — Route Pilotage Coûts & Marges
 * GET /api/pilotage          → snapshot mensuel agrégé pour le dashboard HTML
 * GET /api/pilotage/history  → historique mensuel sur N mois
 *
 * Authentification : JWT Bearer token (role admin uniquement)
 *
 * Intégration :
 *   Dans server.js, ajouter :
 *     const pilotageRouter = require('./routes/pilotage');
 *     app.use('/api/pilotage', pilotageRouter);
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// Toutes les routes pilotage nécessitent authentification admin
router.use(authenticate, requireRole(['admin']));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Taux de change actifs — lus depuis exchange_rates
 */
async function getRates() {
  const { rows } = await db.query(
    'SELECT eur_kmf, aed_kmf FROM exchange_rates ORDER BY valid_from DESC LIMIT 1'
  );
  return rows[0] || { eur_kmf: 495, aed_kmf: 139 };
}

/**
 * Moteur de pricing simplifié — reproduit la logique du simulateur v7
 * pour calculer le coût de revient théorique d'un produit.
 *
 * @param {object} p       - ligne produit (price_aed, category, weight_kg, dimensions_cm)
 * @param {object} rates   - { eur_kmf, aed_kmf }
 * @param {number} douanePctOverride - taux effectif terrain si connu (ex: 0.42)
 */
function calcCoutRevient(p, rates, douanePctOverride = null) {
  const TAUX_AED     = rates.aed_kmf;
  const TAUX_EUR     = rates.eur_kmf;
  const EMBARK_KMF   = 3 * TAUX_AED;         // 3 AED emballage
  const HUB_CMD_KMF  = 1000 + 150 + 100;      // contrôle + étiquette + SMS
  const FRET_M3_KMF  = 180 * TAUX_EUR;        // 180 EUR/m³

  // Dimensions par défaut selon catégorie
  const DIMS_CAT = {
    telephones:     [17, 12, 11],
    electronique:   [20, 15, 12],
    vetements:      [25, 22, 10],
    ceremonie:      [30, 25, 11],
    electromenager: [35, 30, 16],
    cosmetiques:    [20, 15, 11],
    mariage:        [30, 25, 12],
    bebe:           [25, 20, 9],
    construction:   [40, 30, 20],
    bricolage:      [30, 20, 15],
    rentree:        [25, 20, 10],
  };

  // Taux douane théoriques par catégorie (SH Comores)
  const DOUANE_CAT = {
    telephones:     { droits: 0.10, taxeAdd: 0.00, tva: 0.10 },
    electronique:   { droits: 0.15, taxeAdd: 0.00, tva: 0.10 },
    vetements:      { droits: 0.20, taxeAdd: 0.025, tva: 0.10 },
    ceremonie:      { droits: 0.20, taxeAdd: 0.025, tva: 0.10 },
    electromenager: { droits: 0.15, taxeAdd: 0.00, tva: 0.10 },
    cosmetiques:    { droits: 0.20, taxeAdd: 0.01, tva: 0.10 },
    mariage:        { droits: 0.15, taxeAdd: 0.00, tva: 0.10 },
    bebe:           { droits: 0.10, taxeAdd: 0.00, tva: 0.10 },
    construction:   { droits: 0.15, taxeAdd: 0.00, tva: 0.10 },
    bricolage:      { droits: 0.15, taxeAdd: 0.00, tva: 0.10 },
    rentree:        { droits: 0.10, taxeAdd: 0.00, tva: 0.10 },
  };

  const cat     = (p.category || 'electronique').toLowerCase();
  const dims    = DIMS_CAT[cat] || [25, 20, 15];
  const douane  = DOUANE_CAT[cat] || { droits: 0.15, taxeAdd: 0, tva: 0.10 };

  // Prix achat
  const prixAed = parseFloat(p.price_aed) || (parseFloat(p.price_kmf) / TAUX_AED);
  const prixAchatKmf = prixAed * TAUX_AED;

  // Fret
  const volM3 = (dims[0] * dims[1] * dims[2]) / 1e6;
  const fretKmf = volM3 * FRET_M3_KMF;

  // Couverture maritime (0.4% valeur marchandise)
  const couvertureKmf = prixAchatKmf * 0.004;

  // Valeur CIF
  const valCIF = prixAchatKmf + fretKmf;

  // Dédouanement
  let douaneKmf, tvaKmf, taxeAddKmf;
  if (douanePctOverride !== null) {
    // Mode taux effectif terrain (ex: 42%)
    douaneKmf  = valCIF * douanePctOverride;
    tvaKmf     = 0; // inclus dans le taux effectif
    taxeAddKmf = 0;
  } else {
    douaneKmf  = valCIF * douane.droits;
    tvaKmf     = valCIF * douane.tva;
    taxeAddKmf = valCIF * douane.taxeAdd;
  }

  const transKmf = valCIF * 0.02 + 450; // transitaire 2% + forfait

  // Distribution
  const portKmf   = 1200;
  const relaisKmf = 840 + 500; // transport + commission

  // Total coût de revient
  const cdr = prixAchatKmf + EMBARK_KMF + HUB_CMD_KMF
            + fretKmf + couvertureKmf
            + transKmf + portKmf + douaneKmf + tvaKmf + taxeAddKmf
            + relaisKmf;

  return {
    cdr_kmf:          Math.round(cdr),
    prix_achat_kmf:   Math.round(prixAchatKmf),
    fret_kmf:         Math.round(fretKmf),
    douane_kmf:       Math.round(douaneKmf + tvaKmf + taxeAddKmf),
    distrib_kmf:      Math.round(relaisKmf + portKmf),
  };
}

// ─── GET /api/pilotage ────────────────────────────────────────────────────────
// Snapshot du mois courant (ou mois passé en query ?mois=2026-02)
// Retourne toutes les métriques nécessaires au dashboard HTML

router.get('/', async (req, res) => {
  try {
    const mois = req.query.mois || new Date().toISOString().slice(0, 7); // YYYY-MM
    const [annee, moisNum] = mois.split('-').map(Number);

    const debutMois = `${mois}-01`;
    const finMois   = new Date(annee, moisNum, 1).toISOString().split('T')[0];

    const rates = await getRates();

    // ── 1. Volume & CA ───────────────────────────────────────────────────────
    const { rows: [volumeRow] } = await db.query(`
      SELECT
        COUNT(*)                                              AS total_commandes,
        COUNT(*) FILTER (WHERE status = 'collected')         AS livrees,
        COUNT(*) FILTER (WHERE status = 'cancelled')         AS annulees,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled')) AS en_cours,
        COALESCE(SUM(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS ca_kmf,
        COALESCE(SUM(total_eur) FILTER (WHERE status != 'cancelled'), 0) AS ca_eur,
        COALESCE(SUM(total_kmf) FILTER (WHERE payment_mode = 'cash_relais' AND status != 'cancelled'), 0) AS ca_cash_kmf,
        COALESCE(SUM(total_kmf) FILTER (WHERE payment_mode = 'stripe_eur' AND status != 'cancelled'), 0) AS ca_stripe_kmf
      FROM orders
      WHERE created_at >= $1 AND created_at < $2
    `, [debutMois, finMois]);

    // ── 2. Volume par catégorie ───────────────────────────────────────────────
    const { rows: catRows } = await db.query(`
      SELECT
        p.category,
        COUNT(oi.id)               AS nb_articles,
        COUNT(DISTINCT oi.order_id) AS nb_commandes,
        COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS ca_categorie_kmf
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN orders o   ON o.id = oi.order_id
      WHERE o.created_at >= $1 AND o.created_at < $2
        AND o.status != 'cancelled'
      GROUP BY p.category
      ORDER BY nb_commandes DESC
    `, [debutMois, finMois]);

    // ── 3. Taux douane effectif réel (si la table customs_history existe) ────
    // Sinon, on retourne null → le dashboard utilise le taux simulateur
    let douaneEffectif = null;
    try {
      const { rows: customsRows } = await db.query(`
        SELECT
          ROUND(
            COALESCE(SUM(droits_payes_kmf), 0) /
            NULLIF(COALESCE(SUM(valeur_cif_kmf), 0), 0) * 100
          , 1) AS taux_effectif_pct
        FROM customs_history
        WHERE date_dedouanement >= $1 AND date_dedouanement < $2
      `, [debutMois, finMois]);
      if (customsRows[0]?.taux_effectif_pct !== null) {
        douaneEffectif = parseFloat(customsRows[0].taux_effectif_pct);
      }
    } catch {
      // Table customs_history pas encore créée — normal en Phase 1
    }

    // ── 4. Coût de revient estimé par commande ────────────────────────────────
    // On calcule le CDR moyen pondéré sur les produits commandés ce mois
    const { rows: prodRows } = await db.query(`
      SELECT
        p.id, p.name, p.category,
        p.price_aed, p.price_kmf,
        SUM(oi.quantity) AS qte_totale,
        COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS ca_produit_kmf
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN orders o   ON o.id = oi.order_id
      WHERE o.created_at >= $1 AND o.created_at < $2
        AND o.status != 'cancelled'
      GROUP BY p.id, p.name, p.category, p.price_aed, p.price_kmf
    `, [debutMois, finMois]);

    // CDR moyen pondéré (en utilisant taux effectif si disponible)
    const douaneTaux = douaneEffectif ? douaneEffectif / 100 : null;
    let totalCdrKmf = 0, totalQte = 0;
    const cdrParProduit = [];

    for (const p of prodRows) {
      const { cdr_kmf, prix_achat_kmf, fret_kmf, douane_kmf, distrib_kmf } = calcCoutRevient(p, rates, douaneTaux);
      const qte = parseInt(p.qte_totale);
      totalCdrKmf += cdr_kmf * qte;
      totalQte    += qte;
      cdrParProduit.push({
        produit:     p.name,
        categorie:   p.category,
        qte,
        cdr_kmf,
        prix_achat_kmf,
        fret_kmf,
        douane_kmf,
        distrib_kmf,
        prix_vente_kmf: Math.round(parseFloat(p.ca_produit_kmf) / qte),
      });
    }

    const cdrMoyenKmf = totalQte > 0 ? Math.round(totalCdrKmf / totalQte) : 0;

    // ── 5. Marge estimée ─────────────────────────────────────────────────────
    const caKmf              = parseFloat(volumeRow.ca_kmf);
    const cdrTotalEstimeKmf  = totalQte > 0 ? totalCdrKmf : 0;
    const margeEstimeeKmf    = caKmf - cdrTotalEstimeKmf;
    const margeBrutePct      = caKmf > 0 ? (margeEstimeeKmf / caKmf * 100) : 0;

    // Hub fixe (Phase 2 par défaut — pourrait être en base)
    const hubMensuelKmf   = (3000 + 4000) * rates.aed_kmf; // 7000 AED × taux
    const margeNettKmf    = margeEstimeeKmf - hubMensuelKmf;
    const margeNettePct   = caKmf > 0 ? (margeNettKmf / caKmf * 100) : 0;

    // ── 6. Taux de change effectif utilisé ───────────────────────────────────
    const { rows: ratesHistory } = await db.query(
      'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 6'
    );

    // ── 7. Top produits ───────────────────────────────────────────────────────
    const topProduits = [...cdrParProduit]
      .sort((a, b) => b.qte - a.qte)
      .slice(0, 10);

    // ── 8. Commandes par statut (pipeline) ───────────────────────────────────
    const { rows: pipelineRows } = await db.query(`
      SELECT status, COUNT(*) AS nb
      FROM orders
      WHERE status != 'cancelled'
      GROUP BY status
      ORDER BY nb DESC
    `);

    // ── Réponse finale ────────────────────────────────────────────────────────
    res.json({
      periode:      mois,
      genere_le:    new Date().toISOString(),

      taux:         rates,
      taux_history: ratesHistory,

      volume: {
        total_commandes: parseInt(volumeRow.total_commandes),
        livrees:         parseInt(volumeRow.livrees),
        annulees:        parseInt(volumeRow.annulees),
        en_cours:        parseInt(volumeRow.en_cours),
      },

      ca: {
        total_kmf:    Math.round(parseFloat(volumeRow.ca_kmf)),
        total_eur:    Math.round(parseFloat(volumeRow.ca_eur)),
        cash_kmf:     Math.round(parseFloat(volumeRow.ca_cash_kmf)),
        stripe_kmf:   Math.round(parseFloat(volumeRow.ca_stripe_kmf)),
      },

      categories: catRows.map(r => ({
        categorie:   r.category,
        nb_commandes: parseInt(r.nb_commandes),
        nb_articles:  parseInt(r.nb_articles),
        ca_kmf:       Math.round(parseFloat(r.ca_categorie_kmf)),
        pct_ca:       caKmf > 0
          ? parseFloat((parseFloat(r.ca_categorie_kmf) / caKmf * 100).toFixed(1))
          : 0,
      })),

      couts: {
        cdr_moyen_kmf:         cdrMoyenKmf,
        cdr_total_estime_kmf:  Math.round(cdrTotalEstimeKmf),
        hub_fixe_mensuel_kmf:  Math.round(hubMensuelKmf),
        douane_effectif_pct:   douaneEffectif,   // null si pas encore historisé
        mode_douane:           douaneEffectif ? 'terrain' : 'theorique',
      },

      marges: {
        brute_kmf:    Math.round(margeEstimeeKmf),
        brute_pct:    parseFloat(margeBrutePct.toFixed(1)),
        nette_kmf:    Math.round(margeNettKmf),
        nette_pct:    parseFloat(margeNettePct.toFixed(1)),
        hub_couvert:  margeNettKmf >= 0,
        alerte:       margeNettePct < 3
          ? `⚠️ Marge nette faible (${margeNettePct.toFixed(1)}%) — vérifier volume et coûts`
          : null,
      },

      top_produits: topProduits,
      pipeline:     pipelineRows.map(r => ({ statut: r.status, nb: parseInt(r.nb) })),
    });

  } catch (err) {
    console.error('Pilotage error:', err.message);
    res.status(500).json({ error: 'Erreur pilotage' });
  }
});

// ─── GET /api/pilotage/history ────────────────────────────────────────────────
// Historique mensuel sur N mois pour les graphiques temporels
// Query params : ?mois=12 (défaut 6)

router.get('/history', async (req, res) => {
  try {
    const nbMois = Math.min(24, Math.max(1, parseInt(req.query.mois) || 6));
    const rates  = await getRates();

    const { rows } = await db.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS mois,
        COUNT(*)                                              AS total_commandes,
        COUNT(*) FILTER (WHERE status = 'collected')         AS livrees,
        COALESCE(SUM(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS ca_kmf,
        COALESCE(SUM(total_eur) FILTER (WHERE status != 'cancelled'), 0) AS ca_eur
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '${nbMois} months'
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    // Enrichir avec marge estimée (12% de marge brute par défaut)
    const history = rows.map(r => {
      const caKmf       = parseFloat(r.ca_kmf);
      const margeEst    = caKmf * 0.12;
      const hubMensuel  = (3000 + 4000) * rates.aed_kmf;
      const margeNette  = margeEst - hubMensuel;
      return {
        mois:              r.mois,
        total_commandes:   parseInt(r.total_commandes),
        livrees:           parseInt(r.livrees),
        ca_kmf:            Math.round(caKmf),
        ca_eur:            Math.round(parseFloat(r.ca_eur)),
        marge_brute_kmf:   Math.round(margeEst),
        marge_brute_pct:   12.0,
        marge_nette_kmf:   Math.round(margeNette),
        marge_nette_pct:   caKmf > 0
          ? parseFloat((margeNette / caKmf * 100).toFixed(1))
          : 0,
        hub_couvert:       margeNette >= 0,
      };
    });

    res.json({
      nb_mois:  nbMois,
      taux:     rates,
      history,
    });

  } catch (err) {
    console.error('Pilotage history error:', err.message);
    res.status(500).json({ error: 'Erreur historique pilotage' });
  }
});

module.exports = router;
