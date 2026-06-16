'use strict';

/**
 * services/pricing-recommend.js
 *
 * Logique métier pour les endpoints de recommandation tarifaire.
 * Extrait de routes/pricing.js (GOD-FILES-1).
 *
 * Exports :
 *   computeRecommend(body)       → POST /api/pricing/recommend
 *   computeRecommendBatch(body)  → POST /api/pricing/recommend-batch
 *
 * Doctrine : Invariant I-08 — pricing lit les composantes DB, aucun coefficient dur.
 * Voir : docs/adr/ADR-011-pricing-extensible-3-niveaux.md
 */

const db            = require('../db');
const pricingEngine = require('./pricing-engine');
const log           = require('../utils/logger').child({ module: 'pricing-recommend' });

// ─── Erreur HTTP métier ────────────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, body) {
    super(body.error || String(status));
    this.status = status;
    this.body   = body;
  }
}

// ─── Helpers privés ────────────────────────────────────────────────────────

/**
 * Teste si un composant/provision s'applique au contexte courant.
 * @param {{ applies_to?: string }} item
 * @param {{ category: string, channel: string, isDiaspora: boolean }} ctx
 */
function _applies(item, ctx) {
  const a = item.applies_to || 'all';
  if (a === 'all')                      return true;
  if (a === 'is_diaspora:true')         return ctx.isDiaspora;
  if (a === 'is_diaspora:false')        return !ctx.isDiaspora;
  if (a.startsWith('channel:'))         return ctx.channel === a.substring(8);
  if (a.startsWith('category:'))        return ctx.category === a.substring(9);
  return true;
}

/**
 * Arrondi psychologique :
 *   < 500  → multiple de 10
 *   < 1000 → centaine - 10 (ex: 990)
 *   ≥ 1000 → millier - 10  (ex: 13990)
 */
function _arrondiPsycho(x) {
  if (x < 500)  return Math.ceil(x / 10) * 10;
  if (x < 1000) return Math.ceil(x / 100) * 100 - 10;
  return Math.ceil(x / 1000) * 1000 - 10;
}

/**
 * Calcule la valeur d'un composant pricing dans l'unité donnée.
 */
function _computeComponent(comp, baseKmf, { poidsKg, volumeM3, taxAED, taxEUR }) {
  const v = Number(comp.default_value);
  switch (comp.unit) {
    case 'pct':         return baseKmf * (v / 100);
    case 'kmf':         return v;
    case 'kmf_per_kg':  return v * poidsKg;
    case 'kmf_per_m3':  return v * volumeM3;
    case 'aed':         return v * taxAED;
    case 'eur':         return v * taxEUR;
    default:            return 0;
  }
}

// ─── Chargement paramètres globaux ─────────────────────────────────────────

async function _loadGlobalParams() {
  const [fcRes, compRes, provRes, chargesRes] = await Promise.all([
    db.query('SELECT * FROM finance_config WHERE id = 1'),
    db.query('SELECT * FROM pricing_components WHERE is_active = TRUE ORDER BY display_order'),
    db.query('SELECT * FROM risk_provisions    WHERE is_active = TRUE ORDER BY display_order'),
    db.query('SELECT * FROM charges            WHERE is_active = TRUE'),
  ]);
  return {
    fc:       fcRes.rows[0]  || {},
    comps:    compRes.rows,
    provs:    provRes.rows,
    charges:  chargesRes.rows,
  };
}

// ─── Calcul niveau 2 (charges fixes amorties) ──────────────────────────────

function _computeNiveau2(charges, fc) {
  const totalMensuel = charges
    .filter(c => c.recurrence_period === 'monthly')
    .reduce((s, c) => s + Number(c.amount_kmf), 0)
    + Math.round(
        charges
          .filter(c => c.recurrence_period === 'weekly')
          .reduce((s, c) => s + Number(c.amount_kmf), 0)
        * 4.33
      );

  const totalParOrder = charges
    .filter(c => c.recurrence_period === 'per_order')
    .reduce((s, c) => s + Number(c.amount_kmf), 0);

  const volumeCible = Number(fc.objectif_commandes_mois) || 100;
  const partFixe    = volumeCible > 0 ? totalMensuel / volumeCible : 0;

  return {
    niveau2Total:     Math.round(partFixe + totalParOrder),
    totalMensuel,
    totalParOrder,
    volumeCible,
    partFixeParCmd:   Math.round(partFixe),
  };
}

// ─── computeRecommend ──────────────────────────────────────────────────────

/**
 * Calcule le prix recommandé pour un produit (3 niveaux + doctrine).
 *
 * @param {object} b - req.body
 * @throws {HttpError} 400 si params invalides, 404 si produit introuvable
 * @returns {Promise<object>} réponse JSON complète
 */
async function computeRecommend(b = {}) {
  const warnings = [];

  // ── 1. Charger le produit si product_id fourni ──
  let product = null;
  if (b.product_id) {
    const r = await db.query('SELECT * FROM products WHERE id = $1', [b.product_id]);
    if (!r.rows.length) throw new HttpError(404, { error: 'Produit introuvable' });
    product = r.rows[0];
  }

  const category   = b.category || product?.category || 'phones';
  const isDiaspora = !!b.is_diaspora;
  const channel    = b.channel || 'cash_relais';
  const poidsKg    = Number(b.poids_kg)  || 1;
  const volumeM3   = Number(b.volume_m3) || 0.005;
  const ctx        = { category, channel, isDiaspora };

  // Dériver prix AED
  let prixAed = Number(b.prix_aed) || 0;
  if (!prixAed && product?.cost_kmf) {
    const fcRow = await db.query('SELECT taux_aed_kmf FROM finance_config WHERE id = 1').catch(() => null);
    const taux  = Number(fcRow?.rows?.[0]?.taux_aed_kmf) || 138;
    prixAed     = Number(product.cost_kmf) / taux;
  }
  if (!prixAed || prixAed <= 0) {
    warnings.push('prix_aed manquant ou nul → prix recommandé non significatif');
  }

  // ── 2. Charger paramètres globaux en parallèle ──
  const [{ fc, comps, provs, charges }, catRes] = await Promise.all([
    _loadGlobalParams(),
    db.query('SELECT * FROM customs_categories WHERE key = $1 AND is_active = TRUE', [category]),
  ]);

  const cat = catRes.rows[0];
  if (!cat) warnings.push('Catégorie "' + category + '" introuvable → valeurs par défaut');

  const taxAED        = Number(fc.taux_aed_kmf)         || 138;
  const taxEUR        = Number(fc.taux_change_eur_kmf)   || 492;
  const fretEurM3     = Number(fc.fret_eur_per_m3)       || 180;
  const margeCiblePct = (cat?.default_margin_pct
    ? Number(cat.default_margin_pct)
    : Number(fc.target_marge_brute_pct) || 40) / 100;

  const unitCtx = { poidsKg, volumeM3, taxAED, taxEUR };

  // ── 3. NIVEAU 1 : composants unitaires ──
  const prixAchatKmf = prixAed * taxAED;
  const fretKmf      = volumeM3 * fretEurM3 * taxEUR;
  let valCIF         = prixAchatKmf + fretKmf;

  const niveau1Items = [];

  for (const comp of comps) {
    if (!_applies(comp, ctx)) continue;
    const valeurKmf = _computeComponent(comp, valCIF, unitCtx);
    niveau1Items.push({
      key:        comp.key,
      label:      comp.label,
      category:   comp.category,
      unit:       comp.unit,
      rate:       comp.default_value,
      valeur_kmf: Math.round(valeurKmf),
    });
    valCIF += valeurKmf;
  }

  if (cat) {
    const base       = prixAchatKmf + fretKmf;
    const douaneKmf  = base * (Number(cat.douane_pct) / 100);
    const tvaKmf     = base * (Number(cat.tva_pct) / 100);
    const taxeAddKmf = base * (Number(cat.taxe_add_pct) / 100);

    niveau1Items.push({ key: 'douane_pct',   label: `Droits douane (${cat.douane_pct}%)`,   category: 'douane', unit: 'pct', rate: cat.douane_pct,   valeur_kmf: Math.round(douaneKmf) });
    niveau1Items.push({ key: 'tva_pct',      label: `TVA (${cat.tva_pct}%)`,                category: 'douane', unit: 'pct', rate: cat.tva_pct,      valeur_kmf: Math.round(tvaKmf) });
    if (Number(cat.taxe_add_pct) > 0) {
      niveau1Items.push({ key: 'taxe_add_pct', label: `Taxe additionnelle (${cat.taxe_add_pct}%)`, category: 'douane', unit: 'pct', rate: cat.taxe_add_pct, valeur_kmf: Math.round(taxeAddKmf) });
    }
    valCIF += douaneKmf + tvaKmf + taxeAddKmf;
  }

  const niveau1Total = Math.round(valCIF);

  // ── 4. NIVEAU 2 : charges fixes ──
  const n2 = _computeNiveau2(charges, fc);
  if (n2.volumeCible === 0) warnings.push('objectif_commandes_mois = 0 → niveau 2 ignoré');
  if (n2.totalMensuel === 0) warnings.push('Aucune charge fixe mensuelle dans la table charges');

  // ── 5. NIVEAU 3 : provisions risques ──
  const baseProvisions = niveau1Total + n2.niveau2Total;
  let niveau3Total     = 0;
  const niveau3Items   = [];

  for (const prov of provs) {
    if (!_applies(prov, ctx)) continue;
    const valeurKmf = baseProvisions * (Number(prov.rate_pct) / 100);
    niveau3Items.push({ key: prov.key, label: prov.label, rate_pct: Number(prov.rate_pct), valeur_kmf: Math.round(valeurKmf) });
    niveau3Total += valeurKmf;
  }
  niveau3Total = Math.round(niveau3Total);

  // ── 6. Prix recommandé ──
  const coutTotal          = niveau1Total + n2.niveau2Total + niveau3Total;
  const prixRecommandeBrut = coutTotal / (1 - margeCiblePct);
  const prixRecommande     = _arrondiPsycho(prixRecommandeBrut);
  const margeAtteintePct   = prixRecommande > 0
    ? (prixRecommande - coutTotal) / prixRecommande * 100
    : 0;

  // ── 7. Enrichissement doctrine (pricing-engine) ──
  let doctrine = null;
  try {
    doctrine = await pricingEngine.recommend({
      product_id:        b.product_id || null,
      category,
      channel,
      cost_kmf:          product?.cost_kmf,
      weight_kg:         poidsKg,
      volume_m3:         volumeM3,
      current_price_kmf: product?.price_kmf,
    });
  } catch (errDoctrine) {
    warnings.push('pricing-engine indisponible : ' + errDoctrine.message);
  }

  return {
    // ─── Champs de décision : RELAYÉS depuis le moteur (doctrine §13) ───
    //   Les noms legacy restent pour compatibilité mais ne portent plus une
    //   vérité parallèle : quand le moteur a répondu, ce sont SES chiffres.
    //   La décomposition niveau1/2/3 ci-dessous reste la vue composant de
    //   l'Atelier (informative), pas une source de prix concurrente.
    prix_recommande_kmf:       doctrine ? doctrine.recommended_price_kmf : prixRecommande,
    prix_recommande_brut_kmf:  Math.round(prixRecommandeBrut),
    cout_total_kmf:            doctrine ? doctrine.cdr_complete_kmf : coutTotal,
    marge_cible_pct:           Number((margeCiblePct * 100).toFixed(1)),
    marge_atteinte_pct:        Number(margeAtteintePct.toFixed(2)),
    source_of_truth:           doctrine ? 'pricing-engine' : 'legacy-fallback',

    niveau1: {
      total:       niveau1Total,
      items:       niveau1Items,
      description: 'Coûts unitaires variables par commande (composants pricing_components + douane/TVA)',
    },
    niveau2: {
      total:                   n2.niveau2Total,
      charges_mensuelles_kmf:  n2.totalMensuel,
      charges_per_order_kmf:   n2.totalParOrder,
      volume_cible:            n2.volumeCible,
      part_fixe_par_cmd:       n2.partFixeParCmd,
      description: 'Charges fixes business amorties sur le volume cible mensuel',
    },
    niveau3: {
      total:       niveau3Total,
      items:       niveau3Items,
      description: 'Provisions de risques en % du subtotal (Niveau 1+2)',
    },

    context: {
      product_id:   b.product_id || null,
      category,
      channel,
      is_diaspora:  isDiaspora,
      taux_aed_kmf: taxAED,
      taux_eur_kmf: taxEUR,
    },

    // ─── Champs doctrine (pricing-engine) ───
    ...(doctrine ? {
      subject_type:                     doctrine.subject_type,
      candidate_id:                     doctrine.candidate_id,
      // ─── Contrat doctrinal canonique (noms de vérité) ───
      n1_landed_relay_cost_kmf:         doctrine.n1_landed_relay_cost_kmf,
      n2_business_variable_cost_kmf:    doctrine.n2_business_variable_cost_kmf,
      variable_cost_complete_kmf:       doctrine.variable_cost_complete_kmf,
      contribution_kmf:                 doctrine.contribution_kmf,
      n3_fixed_overhead_allocation_kmf: doctrine.n3_fixed_overhead_allocation_kmf,
      n3_allocation_unit:               doctrine.n3_allocation_unit,
      n3_formula:                       doctrine.n3_formula,
      cdr_complete_kmf:                 doctrine.cdr_complete_kmf,
      final_price_kmf:                  doctrine.final_price_kmf,
      pricing_strategy:                 doctrine.pricing_strategy,
      strategy_risk:                    doctrine.strategy_risk,
      strategies:                       doctrine.strategies,
      safety_margin_pct:                doctrine.safety_margin_pct,
      allocations:                      doctrine.allocations,
      allocation_averages:              doctrine.allocation_averages,
      scenarios:                        doctrine.scenarios,
      landed_relay_cost_kmf:            doctrine.landed_relay_cost_kmf,
      business_complete_cost_kmf:       doctrine.business_complete_cost_kmf,
      cost_breakdown:                   doctrine.cost_breakdown,
      data_quality:                     doctrine.data_quality,
      survival_price_kmf:               doctrine.survival_price_kmf,
      minimum_safe_price_kmf:           doctrine.minimum_safe_price_kmf,
      recommended_price_kmf:            doctrine.recommended_price_kmf,
      test_price_kmf:                   doctrine.test_price_kmf,
      cost_complete_estimated_kmf:      doctrine.cost_complete_estimated_kmf,
      variable_cost_estimated_kmf:      doctrine.variable_cost_estimated_kmf,
      fixed_cost_allocation_kmf:        doctrine.fixed_cost_allocation_kmf,
      risk_provision_estimated_kmf:     doctrine.risk_provision_estimated_kmf,
      target_margin_pct:                doctrine.target_margin_pct,
      estimated_margin_pct:             doctrine.estimated_margin_pct,
      estimated_contribution_kmf:       doctrine.estimated_contribution_kmf,
      monthly_fixed_costs_kmf:          doctrine.monthly_fixed_costs_kmf,
      target_orders_per_month:          doctrine.target_orders_per_month,
      monthly_break_even_orders:        doctrine.monthly_break_even_orders,
      health_status:                    doctrine.health_status,
      market_confidence:                doctrine.market_confidence,
      sourcing_decision:                doctrine.sourcing_decision,
      reason:                           doctrine.reason,
      recommended_action:               doctrine.recommended_action,
      market_signals:                   doctrine.market_signals,
      details:                          doctrine.details,
      alerts:                           doctrine.alerts,
    } : {}),

    warnings: doctrine ? [...warnings, ...doctrine.warnings] : warnings,
  };
}

// ─── computeRecommendBatch ─────────────────────────────────────────────────

/**
 * Calcule les prix recommandés pour un lot de produits actifs.
 *
 * @param {object} b - req.body (product_ids?, category?, limit?)
 * @returns {Promise<object>} { count, items, summary, computed_at }
 */
async function computeRecommendBatch(b = {}) {
  const limit = Math.min(parseInt(b.limit) || 200, 500);

  // ── 1. Charger les produits ──
  const conditions = ['p.is_active = TRUE'];
  const params     = [];
  let pi           = 1;

  if (Array.isArray(b.product_ids) && b.product_ids.length) {
    conditions.push(`p.id = ANY($${pi++}::uuid[])`);
    params.push(b.product_ids);
  }
  if (b.category) {
    conditions.push(`p.category = $${pi++}`);
    params.push(b.category);
  }
  params.push(limit);

  const productsRes = await db.query(
    `SELECT p.id, p.name, p.category, p.price_kmf, p.cost_kmf, p.weight_kg
       FROM products p
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.category, p.name
      LIMIT $${pi}`,
    params
  );

  if (!productsRes.rows.length) {
    return { count: 0, items: [], summary: { aligned: 0, underpriced: 0, overpriced: 0, total_gap_kmf: 0 } };
  }

  // ── 2. Charger une fois les paramètres globaux ──
  const [{ fc, comps, provs, charges }, catsRes] = await Promise.all([
    _loadGlobalParams(),
    db.query('SELECT * FROM customs_categories WHERE is_active = TRUE'),
  ]);

  const cats      = {};
  catsRes.rows.forEach(c => { cats[c.key] = c; });

  const taxAED    = Number(fc.taux_aed_kmf)         || 138;
  const taxEUR    = Number(fc.taux_change_eur_kmf)   || 492;
  const fretEurM3 = Number(fc.fret_eur_per_m3)       || 180;
  const margeGlob = (Number(fc.target_marge_brute_pct) || 40) / 100;

  // ── 3. Niveau 2 constant pour tous les produits ──
  const { niveau2Total } = _computeNiveau2(charges, fc);

  // ── 4. Boucle produits ──
  const items    = [];
  const counters = { aligned: 0, underpriced: 0, overpriced: 0, total_gap_kmf: 0 };
  const ctx      = { channel: 'cash_relais', isDiaspora: false };

  for (const product of productsRes.rows) {
    const category     = product.category || 'phones';
    const cat          = cats[category];
    const poidsKg      = Number(product.weight_kg) || 1;
    const volumeM3     = 0.005;
    const margeCible   = cat?.default_margin_pct
      ? Number(cat.default_margin_pct) / 100
      : margeGlob;
    const unitCtx      = { poidsKg, volumeM3, taxAED, taxEUR };
    const itemCtx      = { ...ctx, category };

    // Niveau 1
    const prixAchatKmf = Number(product.cost_kmf) || 0;
    const fretKmf      = volumeM3 * fretEurM3 * taxEUR;
    let valCIF         = prixAchatKmf + fretKmf;

    for (const comp of comps) {
      if (!_applies(comp, itemCtx)) continue;
      valCIF += _computeComponent(comp, valCIF, unitCtx);
    }

    if (cat) {
      const base = prixAchatKmf + fretKmf;
      valCIF += base * (Number(cat.douane_pct) / 100);
      valCIF += base * (Number(cat.tva_pct) / 100);
      valCIF += base * (Number(cat.taxe_add_pct) / 100);
    }
    const niveau1Total = Math.round(valCIF);

    // Niveau 3
    const baseProvisions = niveau1Total + niveau2Total;
    let niveau3Total     = 0;
    for (const prov of provs) {
      if (!_applies(prov, itemCtx)) continue;
      niveau3Total += baseProvisions * (Number(prov.rate_pct) / 100);
    }
    niveau3Total = Math.round(niveau3Total);

    // Prix
    const coutTotal          = niveau1Total + niveau2Total + niveau3Total;
    const prixRecommandeBrut = coutTotal / (1 - margeCible);
    const prixRecommande     = _arrondiPsycho(prixRecommandeBrut);
    const currentPrice       = Number(product.price_kmf) || 0;
    const gap                = prixRecommande - currentPrice;
    const gapPct             = currentPrice > 0 ? (gap / currentPrice * 100) : 0;

    let status = 'aligned';
    if (currentPrice <= 0)        status = 'unset';
    else if (Math.abs(gapPct) <= 5) status = 'aligned';
    else if (gap > 0)             status = 'underpriced';
    else                          status = 'overpriced';

    counters[status === 'unset' ? 'underpriced' : status]++;
    counters.total_gap_kmf += gap;

    items.push({
      product_id:            product.id,
      name:                  product.name,
      category,
      cost_kmf:              prixAchatKmf,
      weight_kg:             poidsKg,
      volume_m3:             volumeM3,
      current_price_kmf:     currentPrice,
      recommended_price_kmf: prixRecommande,
      gap_kmf:               gap,
      gap_pct:               Number(gapPct.toFixed(1)),
      status,
      cost_total_kmf:        coutTotal,
      margin_target_pct:     Number((margeCible * 100).toFixed(1)),
      niveau1_kmf:           niveau1Total,
      niveau2_kmf:           niveau2Total,
      niveau3_kmf:           niveau3Total,
    });
  }

  // ── 5. Enrichissement doctrine par produit (best-effort) ──
  let doctrineConfig = null;
  try {
    doctrineConfig = await pricingEngine.loadGlobalConfig();
  } catch (errCfg) {
    log.warn({ err: errCfg }, 'pricing-engine config indisponible — enrichissement doctrine skippé');
  }

  if (doctrineConfig) {
    for (let i = 0; i < items.length; i++) {
      try {
        const it      = items[i];
        const doctrine = await pricingEngine.recommend(
          { product_id: it.product_id, category: it.category, current_price_kmf: it.current_price_kmf },
          { config: doctrineConfig }
        );
        items[i] = {
          ...it,
          survival_price_kmf:          doctrine.survival_price_kmf,
          minimum_safe_price_kmf:      doctrine.minimum_safe_price_kmf,
          test_price_kmf:              doctrine.test_price_kmf,
          cost_complete_estimated_kmf: doctrine.cost_complete_estimated_kmf,
          estimated_margin_pct:        doctrine.estimated_margin_pct,
          estimated_contribution_kmf:  doctrine.estimated_contribution_kmf,
          health_status:               doctrine.health_status,
          market_confidence:           doctrine.market_confidence,
          sourcing_decision:           doctrine.sourcing_decision,
          reason:                      doctrine.reason,
        };
      } catch (_) {
        // Item laissé en format legacy si doctrine échoue
      }
    }
  }

  return {
    count:       items.length,
    items,
    summary:     counters,
    computed_at: new Date().toISOString(),
  };
}

module.exports = { computeRecommend, computeRecommendBatch, _applies, _arrondiPsycho };
