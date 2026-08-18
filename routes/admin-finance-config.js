/**
 * @komerce-arch
 * @role          economic-engine-admin-finance-config
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       finance_config
 * @db-write      exchange_rates, finance_config
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
const { resolveFxRates, resolvePricingViewCurrentCompatRates } = require('../utils/rates');

const adminOnly = [authenticate, requireAdmin];

// ── Définition des champs variabilisables ────────────────────────────────────
// Chaque champ a : type, validation, label, group, unit
const FIELD_SCHEMA = {
  // — Coûts fixes par commande —
  cost_fixed_sourcing_kmf:     { type: 'int',     group: 'costs',    label: 'Coût fixe sourcing',        unit: 'KMF', min: 0 },
  cost_fixed_transit_kmf:      { type: 'int',     group: 'costs',    label: 'Coût fixe transit',         unit: 'KMF', min: 0 },
  cost_fixed_hub_kmf:          { type: 'int',     group: 'costs',    label: 'Coût fixe hub',             unit: 'KMF', min: 0 },
  cost_fixed_relais_kmf:       { type: 'int',     group: 'costs',    label: 'Coût fixe relais',          unit: 'KMF', min: 0 },
  cost_fixed_support_kmf:      { type: 'int',     group: 'costs',    label: 'Coût fixe support',         unit: 'KMF', min: 0 },

  // — Objectifs & pilotage —
  target_marge_brute_pct:      { type: 'decimal', group: 'targets',  label: 'Marge brute cible',         unit: '%',   min: 0, max: 100 },
  target_panier_moyen_kmf:     { type: 'int',     group: 'targets',  label: 'Panier moyen cible',        unit: 'KMF', min: 0 },
  objectif_commandes_mois:     { type: 'int',     group: 'targets',  label: 'Objectif commandes/mois',   unit: '',    min: 0 },
  objectif_ca_mensuel_kmf:     { type: 'int',     group: 'targets',  label: 'Objectif CA mensuel',       unit: 'KMF', min: 0 },

  // — Paramètres sourcing —
  taux_change_eur_kmf:         { type: 'decimal', group: 'sourcing', label: 'Taux de change EUR→KMF',    unit: 'KMF/€', min: 1 },
  markup_cible_pct:            { type: 'decimal', group: 'sourcing', label: 'Markup cible',              unit: '%',   min: 0, max: 1000 },
  cout_achat_moyen_eur:        { type: 'decimal', group: 'sourcing', label: 'Coût achat moyen',          unit: '€',   min: 0 },
  delai_transit_jours:         { type: 'int',     group: 'sourcing', label: 'Délai transit moyen',       unit: 'jours', min: 0 },

  // — Paramètres opérationnels —
  frais_livraison_defaut_kmf:  { type: 'int',     group: 'ops',      label: 'Frais livraison défaut',    unit: 'KMF', min: 0 },
  seuil_livraison_gratuite_kmf:{ type: 'int',     group: 'ops',      label: 'Seuil livraison gratuite',  unit: 'KMF', min: 0 },
  taux_conversion_pct:         { type: 'decimal', group: 'ops',      label: 'Taux de conversion',        unit: '%',   min: 0, max: 100 },
  taux_retour_pct:             { type: 'decimal', group: 'ops',      label: 'Taux de retour',            unit: '%',   min: 0, max: 100 },

  // — Fidélité —
  loyalty_active:              { type: 'bool',    group: 'loyalty',  label: 'Fidélité activée',          unit: '' },
  loyalty_threshold_kmf:       { type: 'int',     group: 'loyalty',  label: 'Seuil gros panier',         unit: 'KMF', min: 0 },
  loyalty_trigger_count:       { type: 'int',     group: 'loyalty',  label: 'Paniers pour cadeau',       unit: '',    min: 1, max: 100 },
};

const ALLOWED_FIELDS = Object.keys(FIELD_SCHEMA);

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
      return res.json(formatConfig(cfg2));
    }

    res.json(formatConfig(cfg));
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

    // Invalider le cache des taux de change si les taux ont été modifiés
    try {
      const { invalidateCache } = require('../utils/rates');
      invalidateCache();
    } catch(_) {}

    // Si les taux ont changé : log historique dans exchange_rates
    if (updates.taux_change_eur_kmf !== undefined || updates.taux_aed_kmf !== undefined) {
      try {
        await db.query(
          'INSERT INTO exchange_rates (eur_kmf, aed_kmf, valid_from) VALUES ($1, $2, CURRENT_DATE)',
          [
            Number(updated.taux_change_eur_kmf) || 492,
            Number(updated.taux_aed_kmf) || 138,
          ]
        );
      } catch(_) { /* historique non bloquant */ }
    }

    log.info({ updated_by: req.user.id, fields: Object.keys(updates) }, 'Finance config updated');

    res.json(formatConfig(updated));
  } catch (err) { next(err); }
});

// ── Formatter la réponse avec calculs dérivés ────────────────────────────────
function formatConfig(cfg) {
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

  const tauxChange = Number(cfg.taux_change_eur_kmf || 491.96);
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
  const currentFx = resolveFxRates(cfg);
  const pricingViewCurrentCompatFx = resolvePricingViewCurrentCompatRates();

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
      pricing_view_current_compat: pricingViewCurrentCompatFx,
      usd_nature: 'DERIVED_CURRENT',
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
