/**
 * @komerce-arch
 * @role          economic-engine-admin-finance-config
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/fx-observation-service.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       finance_config
 * @db-write      finance_config, fx_rate_observations
 * @db-txn        resolve_before_behavior_change
 * @doctrine      lot1a_relay_commission_one_runtime_truth
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — routes/admin-finance-config.js
 * ═══════════════════════════════════════════════════════════════════════
 * Configuration centrale des paramètres métier — TOUT est variabilisable.
 *
 * GET  /api/admin/finance-config          → lire la config courante
 * PUT  /api/admin/finance-config          → modifier (audité)
 * GET  /api/admin/finance-config/schema   → liste des champs avec métadonnées
 *
 * Philosophie : "j'entre peu, le moteur comprend beaucoup"
 * Chaque paramètre modifiable recalcule les indicateurs dérivés automatiquement.
 * ═══════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const log     = require('../utils/logger').forModule('admin-finance-config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { invalidateConfigCache } = require('../services/loyalty-service');
const { getRates } = require('../utils/rates');
const fxObservations = require('../services/fx-observation-service');

const adminOnly = [authenticate, requireAdmin];

// ── Définition des champs variabilisables ────────────────────────────────────
// Chaque champ a : type, validation, label, group, unit
const FIELD_SCHEMA = {
  // — Coûts fixes par commande —
  cost_fixed_sourcing_kmf:     { type: 'decimal', group: 'costs',    label: 'Coût fixe sourcing',        unit: 'KMF', min: 0 },
  cost_fixed_transit_kmf:      { type: 'decimal', group: 'costs',    label: 'Coût fixe transit',         unit: 'KMF', min: 0 },
  cost_fixed_hub_kmf:          { type: 'decimal', group: 'costs',    label: 'Coût fixe hub',             unit: 'KMF', min: 0 },
  cost_fixed_relais_kmf:       { type: 'decimal', group: 'costs',    label: 'Coût fixe relais',          unit: 'KMF', min: 0 },
  cost_fixed_support_kmf:      { type: 'decimal', group: 'costs',    label: 'Coût fixe support',         unit: 'KMF', min: 0 },

  // — Objectifs & pilotage —
  target_marge_brute_pct:      { type: 'decimal', group: 'targets',  label: 'Marge brute cible',         unit: '%',   min: 0, max: 100 },
  target_panier_moyen_kmf:     { type: 'decimal', group: 'targets',  label: 'Panier moyen cible',        unit: 'KMF', min: 0 },
  objectif_commandes_mois:     { type: 'int',     group: 'targets',  label: 'Objectif commandes/mois',   unit: '',    min: 0 },
  objectif_ca_mensuel_kmf:     { type: 'decimal', group: 'targets',  label: 'Objectif CA mensuel',       unit: 'KMF', min: 0 },

  // — Modèle économique canonique (LOT 1A-4) —
  hub_monthly_cost_aed:           { type: 'int',     group: 'model',    label: 'Coût Hub mensuel',          unit: 'AED', min: 0 },
  customs_rate_default_pct:       { type: 'decimal', group: 'model',    label: 'Douane terrain défaut',     unit: '%', min: 0, max: 100 },
  mix_rail_a:                     { type: 'decimal', group: 'model',    label: 'Mix CA Rail A',             unit: '%', min: 0, max: 100 },
  mix_rail_b:                     { type: 'decimal', group: 'model',    label: 'Mix CA Rail B',             unit: '%', min: 0, max: 100 },
  mix_rail_c:                     { type: 'decimal', group: 'model',    label: 'Mix CA Rail C',             unit: '%', min: 0, max: 100 },
  mix_rail_d:                     { type: 'decimal', group: 'model',    label: 'Mix CA Rail D',             unit: '%', min: 0, max: 100 },
  margin_rail_a:                  { type: 'decimal', group: 'model',    label: 'Marge Rail A',              unit: '%', min: 0, max: 100 },
  margin_rail_b:                  { type: 'decimal', group: 'model',    label: 'Marge Rail B',              unit: '%', min: 0, max: 100 },
  margin_rail_c:                  { type: 'decimal', group: 'model',    label: 'Marge Rail C',              unit: '%', min: 0, max: 100 },
  margin_rail_d:                  { type: 'decimal', group: 'model',    label: 'Marge Rail D',              unit: '%', min: 0, max: 100 },

  // — Paramètres sourcing —
  taux_pln_kmf: { type: 'decimal', group: 'sourcing', label: 'Taux de change PLN→KMF', unit: 'KMF/PLN', min: 0.000001 },
  markup_cible_pct:            { type: 'decimal', group: 'sourcing', label: 'Markup cible',              unit: '%',   min: 0, max: 1000 },
  cout_achat_moyen_eur:        { type: 'decimal', group: 'sourcing', label: 'Coût achat moyen',          unit: '€',   min: 0 },
  delai_transit_jours:         { type: 'int',     group: 'sourcing', label: 'Délai transit moyen',       unit: 'jours', min: 0 },

  // — Paramètres opérationnels —
  frais_livraison_defaut_kmf:  { type: 'decimal', group: 'ops',      label: 'Frais livraison défaut',    unit: 'KMF', min: 0 },
  seuil_livraison_gratuite_kmf:{ type: 'decimal', group: 'ops',      label: 'Seuil livraison gratuite',  unit: 'KMF', min: 0 },
  taux_conversion_pct:         { type: 'decimal', group: 'ops',      label: 'Taux de conversion',        unit: '%',   min: 0, max: 100 },
  taux_retour_pct:             { type: 'decimal', group: 'ops',      label: 'Taux de retour',            unit: '%',   min: 0, max: 100 },

  // — Fidélité —
  loyalty_active:              { type: 'bool',    group: 'loyalty',  label: 'Fidélité activée',          unit: '' },
  loyalty_threshold_kmf:       { type: 'decimal', group: 'loyalty',  label: 'Seuil gros panier',         unit: 'KMF', min: 0 },
  loyalty_trigger_count:       { type: 'int',     group: 'loyalty',  label: 'Paniers pour cadeau',       unit: '',    min: 1, max: 100 },
};

const ALLOWED_FIELDS = Object.keys(FIELD_SCHEMA);

// Taux de change : plus aucune écriture ici (autorité FX unique, pivot EUR). EUR/KMF = currency_parities ;
// EUR/USD = observation saisie puis approuvée par deux personnes (routes /fx-observations ci-dessous).
const RETIRED_FX_RATE_FIELDS = new Set(['taux_change_eur_kmf', 'taux_aed_kmf', 'taux_usd_kmf']);

const RETIRED_RELAY_COMMISSION_FIELDS = new Set([
  'commission_relais_pct',
  'commission_relais_standard_kmf',
  'commission_relais_showroom_kmf',
]);

// ── GET schema (pour le front — auto-génère le formulaire) ───────────────────
router.get('/schema', adminOnly, async (req, res) => {
  const schema = {};
  for (const [key, meta] of Object.entries(FIELD_SCHEMA)) {
    schema[key] = { ...meta };
  }
  res.json(schema);
});

// ── GET config courante ──────────────────────────────────────────────────────
router.get('/', adminOnly, async (req, res, next) => {
  try {
    const { rows: [cfg] } = await db.query('SELECT * FROM finance_config WHERE id = 1');

    if (!cfg) {
      await db.query('INSERT INTO finance_config (id) VALUES (1) ON CONFLICT DO NOTHING');
      const { rows: [cfg2] } = await db.query('SELECT * FROM finance_config WHERE id = 1');
      return res.json(await formatConfig(cfg2));
    }

    res.json(await formatConfig(cfg));
  } catch (err) { next(err); }
});

// ── PUT (mise à jour partielle — tout champ variabilisable accepté) ──────────
router.put('/', adminOnly, async (req, res, next) => {
  try {
    const body = req.body || {};
    const retiredRelayFields = Object.keys(body).filter((field) => RETIRED_RELAY_COMMISSION_FIELDS.has(field));
    if (retiredRelayFields.length) {
      return res.status(410).json({
        error: 'relay_commission_editor_retired',
        retired_fields: retiredRelayFields,
        source_of_truth: 'cost_components.commission_relais_kmf',
        component_key: 'commission_relais_kmf',
        message: 'LOT 1A-3 : la commission relais est éditée via le composant de coût canonique.',
      });
    }

    const retiredFxFields = Object.keys(body).filter((field) => RETIRED_FX_RATE_FIELDS.has(field));
    if (retiredFxFields.length) {
      return res.status(410).json({
        error: 'fx_rate_editor_retired',
        retired_fields: retiredFxFields,
        source_of_truth: 'services/fx-authority.js (currency_parities + fx_rate_observations)',
        message: 'Les taux de change ne sont plus éditables dans finance_config : parité fixe EUR/KMF ou observation EUR/USD approuvée par deux personnes (POST /api/admin/finance-config/fx-observations).',
      });
    }

    const updates = {};

    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Aucun champ autorisé fourni', allowed: ALLOWED_FIELDS });
    }

    // Validation dynamique
    for (const [field, val] of Object.entries(updates)) {
      const meta = FIELD_SCHEMA[field];
      if (!meta) continue;

      if (meta.type === 'bool') {
        if (typeof val !== 'boolean') {
          return res.status(400).json({ error: `${field} doit être un booléen` });
        }
      } else if (meta.type === 'int') {
        if (typeof val !== 'number' || !Number.isInteger(val) || (meta.min !== undefined && val < meta.min) || (meta.max !== undefined && val > meta.max)) {
          return res.status(400).json({ error: `${field} doit être un entier${meta.min !== undefined ? ' >= ' + meta.min : ''}${meta.max !== undefined ? ' et <= ' + meta.max : ''}` });
        }
      } else if (meta.type === 'decimal') {
        if (typeof val !== 'number' || (meta.min !== undefined && val < meta.min) || (meta.max !== undefined && val > meta.max)) {
          return res.status(400).json({ error: `${field} doit être un nombre${meta.min !== undefined ? ' >= ' + meta.min : ''}${meta.max !== undefined ? ' et <= ' + meta.max : ''}` });
        }
      }
    }

    // Construire le SET dynamique
    const cols = Object.keys(updates);
    const setClauses = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const values = cols.map(c => updates[c]);
    values.push(req.user.id);

    const { rows: [updated] } = await db.query(
      `UPDATE finance_config
       SET ${setClauses}, updated_at = NOW(), updated_by = $${values.length}
       WHERE id = 1
       RETURNING *`,
      values
    );

    // Invalider le cache du service loyalty
    invalidateConfigCache();

    log.info({ updated_by: req.user.id, fields: Object.keys(updates) }, 'Finance config updated');

    res.json(await formatConfig(updated));
  } catch (err) { next(err); }
});

// ── Observation EUR/USD (seule entrée flottante de l'autorité FX) — saisie puis approbation par deux personnes ──
// Identité = session authentifiée normalisée (email sinon id) : le saisissant ne peut pas approuver.
function sessionIdentity(req) {
  return (req.user && (req.user.email || req.user.id)) || '';
}
function fxObservationErrorHandler(err, res, next) {
  if (err && err.name === 'FxObservationError') return res.status(err.statusCode).json({ error: err.message, code: err.code });
  return next(err);
}

router.get('/fx-observations', adminOnly, async (req, res, next) => {
  try { res.json({ observations: await fxObservations.listObservations({ limit: req.query.limit }) }); } catch (e) { next(e); }
});

router.post('/fx-observations', adminOnly, async (req, res, next) => {
  try {
    const { rate, source_label, source_ref, as_of } = req.body || {};
    const row = await fxObservations.enterObservation({
      rate, sourceLabel: source_label, sourceRef: source_ref, asOf: as_of, enteredBy: sessionIdentity(req),
    });
    res.status(201).json({ observation: row, next_step: 'approbation par une autre personne : POST /fx-observations/:id/approve' });
  } catch (e) { fxObservationErrorHandler(e, res, next); }
});

router.post('/fx-observations/:id/approve', adminOnly, async (req, res, next) => {
  try {
    res.json({ observation: await fxObservations.approveObservation({ id: req.params.id, approvedBy: sessionIdentity(req) }) });
  } catch (e) { fxObservationErrorHandler(e, res, next); }
});

// ── Formatter la réponse avec calculs dérivés ────────────────────────────────
async function formatConfig(cfg) {
  if (!cfg) return null;

  const totalFixedCost =
    Number(cfg.cost_fixed_sourcing_kmf || 0) +
    Number(cfg.cost_fixed_transit_kmf || 0)  +
    Number(cfg.cost_fixed_hub_kmf || 0)      +
    Number(cfg.cost_fixed_relais_kmf || 0)   +
    Number(cfg.cost_fixed_support_kmf || 0);

  const margePct = Number(cfg.target_marge_brute_pct || 0);
  const seuilRentabilite = margePct > 0
    ? Math.round(totalFixedCost / (margePct / 100))
    : 0;

  const authorityRates = await getRates();
  const tauxChange = authorityRates.eur_kmf; // parité fixe EUR/KMF (currency_parities), pas finance_config
  const coutAchatMoyen = Number(cfg.cout_achat_moyen_eur || 5);
  const markupPct = Number(cfg.markup_cible_pct || 250);

  // Prix de vente estimé = coût achat × taux change × (1 + markup%)
  const prixVenteEstime = Math.round(coutAchatMoyen * tauxChange * (1 + markupPct / 100));

  // Marge brute estimée par article = prix vente - coût achat en KMF
  const coutAchatKmf = Math.round(coutAchatMoyen * tauxChange);
  const margeBruteArticle = prixVenteEstime - coutAchatKmf;

  // Objectif mensuel
  const objCommandes = Number(cfg.objectif_commandes_mois || 100);
  const objCA = Number(cfg.objectif_ca_mensuel_kmf || 1500000);
  const currentFx = authorityRates.toJSON();

  return {
    // Valeurs brutes (variabilisables)
    costs: {
      sourcing_kmf: Number(cfg.cost_fixed_sourcing_kmf || 0),
      transit_kmf:  Number(cfg.cost_fixed_transit_kmf || 0),
      hub_kmf:      Number(cfg.cost_fixed_hub_kmf || 0),
      relais_kmf:   Number(cfg.cost_fixed_relais_kmf || 0),
      support_kmf:  Number(cfg.cost_fixed_support_kmf || 0),
      total_kmf:    totalFixedCost,
    },
    targets: {
      marge_brute_pct:          margePct,
      panier_moyen_kmf:         Number(cfg.target_panier_moyen_kmf || 0),
      seuil_rentabilite_kmf:    seuilRentabilite,
      objectif_commandes_mois:  objCommandes,
      objectif_ca_mensuel_kmf:  objCA,
    },
    fx: {
      current: currentFx,
      pricing_view_current_compat: null,
      usd_nature: 'APPROVED_OBSERVATION',
    },
    sourcing: {
      taux_change_eur_kmf:  tauxChange,
      markup_cible_pct:     markupPct,
      cout_achat_moyen_eur: coutAchatMoyen,
      delai_transit_jours:  Number(cfg.delai_transit_jours || 25),
    },
    ops: {
      // Lecture legacy conservée pour compat/forensic ; ce champ n'est plus éditable.
      commission_relais_pct:        Number(cfg.commission_relais_pct || 0),
      frais_livraison_defaut_kmf:   Number(cfg.frais_livraison_defaut_kmf || 0),
      seuil_livraison_gratuite_kmf: Number(cfg.seuil_livraison_gratuite_kmf || 0),
      taux_conversion_pct:          Number(cfg.taux_conversion_pct || 0),
      taux_retour_pct:              Number(cfg.taux_retour_pct || 0),
    },
    loyalty: {
      active:         Boolean(cfg.loyalty_active),
      threshold_kmf:  Number(cfg.loyalty_threshold_kmf || 0),
      trigger_count:  Number(cfg.loyalty_trigger_count || 3),
    },

    // Calculs dérivés (lecture seule — recalculés automatiquement)
    derived: {
      total_fixed_cost_kmf:     totalFixedCost,
      seuil_rentabilite_kmf:    seuilRentabilite,
      prix_vente_estime_kmf:    prixVenteEstime,
      cout_achat_kmf:           coutAchatKmf,
      marge_brute_article_kmf:  margeBruteArticle,
      panier_moyen_requis_kmf:  seuilRentabilite,
    },

    updated_at: cfg.updated_at,
    updated_by: cfg.updated_by,
  };
}

module.exports = router;
