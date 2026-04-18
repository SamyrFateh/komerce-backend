/**
 * KOMERCE — Moteur de Pricing v6.6
 * Formule officielle spec v6.4 — 16 étapes
 * Triple devise : AED (Dubai) · KMF (Comores) · EUR (France)
 *
 * v6.5 : Migration vers getRuleNumber() — tous les paramètres pricing
 *        sont configurables via business_rules (admin UI).
 *        Les fonctions sont désormais async.
 *
 * v6.6 : Migration des matrices TAXES et DIMS vers tables dédiées
 *        (pricing_category_taxes, pricing_category_dims). Cache 60s,
 *        fallback sur les valeurs hardcodées en cas d'erreur DB.
 *        UI d'édition dans Control Tower > Paramètres.
 */

const db = require('../db');
const { getRuleNumber } = require('./rules');

const DEFAULT_RATES = { eur_kmf: 492, aed_kmf: 138, fret_eur_m3: 180 };

// ── Valeurs fallback (si DB vide ou inaccessible) ───────────────────────────
// Ces valeurs correspondent exactement à ce qui était hardcodé en v6.5.
// Elles garantissent qu'aucune commande ne peut casser, même si les tables
// pricing_category_{taxes,dims} sont absentes ou vidées par accident.

const FALLBACK_DIMS = Object.freeze({
  electronique: { l: 17, w: 12, h: 11 },
  maison:       { l: 35, w: 30, h: 16 },
  mariage:      { l: 30, w: 25, h: 11 },
  mode_beaute:  { l: 22, w: 18, h: 10 },
  enfants:      { l: 25, w: 20, h:  9 },
});

const FALLBACK_TAXES = Object.freeze({
  electronique: { douane: 0.10, tva: 0.10, taxe_add: 0.00 },
  maison:       { douane: 0.15, tva: 0.10, taxe_add: 0.00 },
  mariage:      { douane: 0.20, tva: 0.10, taxe_add: 0.025 },
  mode_beaute:  { douane: 0.20, tva: 0.10, taxe_add: 0.01 },
  enfants:      { douane: 0.10, tva: 0.10, taxe_add: 0.00 },
});

// ── Cache mémoire 60s pour les matrices pricing ─────────────────────────────
const MATRICES_CACHE_TTL_MS = 60_000;
let _dimsCache = null, _dimsCacheAt = 0;
let _taxesCache = null, _taxesCacheAt = 0;

/**
 * Charge les DIMS depuis la DB (ou fallback si erreur).
 * Retourne un objet { category: { l, w, h } } identique à FALLBACK_DIMS.
 */
async function loadDims() {
  if (_dimsCache && Date.now() - _dimsCacheAt < MATRICES_CACHE_TTL_MS) {
    return _dimsCache;
  }
  try {
    const { rows } = await db.query(
      'SELECT category, length_cm, width_cm, height_cm FROM pricing_category_dims'
    );
    if (rows.length === 0) {
      console.warn('[PRICING] pricing_category_dims vide, fallback utilisé.');
      _dimsCache = FALLBACK_DIMS;
    } else {
      const cache = {};
      for (const r of rows) {
        cache[r.category] = { l: r.length_cm, w: r.width_cm, h: r.height_cm };
      }
      _dimsCache = cache;
    }
    _dimsCacheAt = Date.now();
    return _dimsCache;
  } catch (err) {
    console.error('[PRICING] loadDims error (fallback):', err.message);
    return FALLBACK_DIMS;
  }
}

/**
 * Charge les TAXES depuis la DB (ou fallback si erreur).
 * Retourne un objet { category: { douane, tva, taxe_add } }.
 */
async function loadTaxes() {
  if (_taxesCache && Date.now() - _taxesCacheAt < MATRICES_CACHE_TTL_MS) {
    return _taxesCache;
  }
  try {
    const { rows } = await db.query(
      'SELECT category, douane_pct, tva_pct, taxe_add_pct FROM pricing_category_taxes'
    );
    if (rows.length === 0) {
      console.warn('[PRICING] pricing_category_taxes vide, fallback utilisé.');
      _taxesCache = FALLBACK_TAXES;
    } else {
      const cache = {};
      for (const r of rows) {
        cache[r.category] = {
          douane:   Number(r.douane_pct),
          tva:      Number(r.tva_pct),
          taxe_add: Number(r.taxe_add_pct),
        };
      }
      _taxesCache = cache;
    }
    _taxesCacheAt = Date.now();
    return _taxesCache;
  } catch (err) {
    console.error('[PRICING] loadTaxes error (fallback):', err.message);
    return FALLBACK_TAXES;
  }
}

/**
 * Invalide les caches matrices — appelé par admin-pricing-matrices.js après update.
 */
function invalidatePricingMatricesCache() {
  _dimsCache = null;
  _dimsCacheAt = 0;
  _taxesCache = null;
  _taxesCacheAt = 0;
}

// ── getDefaultRates : taux FX fallback depuis business_rules ────────────────
async function getDefaultRates() {
  return {
    eur_kmf: await getRuleNumber('EUR_KMF_FALLBACK', 492),
    aed_kmf: await getRuleNumber('AED_KMF_FALLBACK', 138),
    fret_eur_m3: 180, // rarement changé, reste hardcodé
  };
}

// ── calcPrix : calcul du prix de vente KMF à partir du prix achat AED ───────
async function calcPrix(prixAchatAed, category, options = {}) {
  const rates = options.rates || await getDefaultRates();
  const DIMS_NOW  = await loadDims();
  const TAXES_NOW = await loadTaxes();

  const catDims  = options.dims  || DIMS_NOW[category]  || DIMS_NOW.electronique;
  const taxes    = options.taxes || TAXES_NOW[category] || TAXES_NOW.electronique;

  // Paramètres pricing depuis business_rules (v6.5)
  const commissionAgentPct   = await getRuleNumber('COMMISSION_AGENT_PCT', 5) / 100;
  const transportDxbKmf      = await getRuleNumber('TRANSPORT_DXB_KMF', 500);
  const transitairePct       = await getRuleNumber('TRANSITAIRE_PCT', 2) / 100;
  const transitaireFixedKmf  = await getRuleNumber('TRANSITAIRE_FIXED_KMF', 450);
  const portuairesKmf        = await getRuleNumber('PORTUAIRES_KMF', 1200);
  const transportRelaisKmf   = await getRuleNumber('TRANSPORT_RELAIS_KMF', 840);
  const commRelaisStd        = await getRuleNumber('COMMISSION_RELAIS_STANDARD_KMF', 500);
  const commRelaisShowroom   = await getRuleNumber('COMMISSION_RELAIS_SHOWROOM_KMF', 750);
  const fraisStripePct       = await getRuleNumber('FRAIS_STRIPE_PCT', 2.5) / 100;
  const margePct             = await getRuleNumber('MARGE_PCT', 12) / 100;

  // 1. Prix achat en KMF
  const achatKmf = Math.round(prixAchatAed * rates.aed_kmf);

  // 2. Commission agent
  const commissionAgent = Math.round(achatKmf * commissionAgentPct);

  // 3. Emballage (forfait)
  const emballage = 50;

  // 4. Volume (m³)
  const volumeM3 = (catDims.l * catDims.w * catDims.h) / 1_000_000;

  // 5. Fret Dubai→Comores
  const fretKmf = Math.round(volumeM3 * rates.fret_eur_m3 * rates.eur_kmf);

  // 6. CIF = Achat + Commission + Fret + Emballage + Transport DXB
  const cif = achatKmf + commissionAgent + fretKmf + emballage + transportDxbKmf;

  // 7. Transitaire
  const transitaire = Math.round(cif * transitairePct) + transitaireFixedKmf;

  // 8. Douane / TVA / Taxe additionnelle
  const douane       = Math.round(cif * taxes.douane);
  const tva          = Math.round(cif * taxes.tva);
  const taxe_add     = Math.round(cif * taxes.taxe_add);

  // 9. Coût hub Comores
  const coutHubKmf = cif + transitaire + douane + tva + taxe_add + portuairesKmf;

  // 10. Coût rendu relais
  const coutRelaisStd      = coutHubKmf + transportRelaisKmf + commRelaisStd;
  const coutRelaisShowroom = coutHubKmf + transportRelaisKmf + commRelaisShowroom;

  // 11. Prix avant marge = coût relais standard (par défaut)
  const coutTotalKmf = coutRelaisStd;

  // 12. Marge
  const marge = Math.round(coutTotalKmf * margePct);

  // 13. Prix vente KMF
  const prixVenteKmfAvantStripe = coutTotalKmf + marge;

  // 14. Frais Stripe (quand paiement EUR)
  const fraisStripe = Math.round(prixVenteKmfAvantStripe * fraisStripePct);

  // 15. Prix final KMF
  const prixVenteKmf = prixVenteKmfAvantStripe + fraisStripe;

  // 16. Prix vente EUR
  const prixVenteEur = parseFloat((prixVenteKmf / rates.eur_kmf).toFixed(2));

  return {
    prix_achat_aed: prixAchatAed,
    achat_kmf: achatKmf,
    commission_agent: commissionAgent,
    fret_kmf: fretKmf,
    cif,
    transitaire,
    douane, tva, taxe_add,
    portuaires_kmf: portuairesKmf,
    cout_hub_kmf: coutHubKmf,
    cout_relais_std: coutRelaisStd,
    cout_relais_showroom: coutRelaisShowroom,
    cout_total_kmf: coutTotalKmf,
    marge,
    frais_stripe: fraisStripe,
    prix_vente_kmf: prixVenteKmf,
    prix_vente_eur: prixVenteEur,
    volume_m3: volumeM3,
    category,
    // Metadata v6.6 (sources)
    _sources: {
      dims_source: DIMS_NOW === FALLBACK_DIMS ? 'fallback' : 'db',
      taxes_source: TAXES_NOW === FALLBACK_TAXES ? 'fallback' : 'db',
    }
  };
}

// ── calcFret : calcul simple du fret à partir du poids ──────────────────────
async function calcFret(weightGrams, options = {}) {
  const rates = options.rates || await getDefaultRates();
  const freightPerKg = await getRuleNumber('FREIGHT_KMF_PER_KG', 65);
  return Math.round((weightGrams / 1000) * freightPerKg);
}

// ── calcPrixTenue : variante pour produits sur-mesure (couture) ─────────────
async function calcPrixTenue(prixAchatAed, options = {}) {
  // Même logique que calcPrix mais avec catégorie mariage par défaut
  return calcPrix(prixAchatAed, 'mariage', options);
}

module.exports = {
  calcPrix,
  calcPrixTenue,
  calcFret,
  DEFAULT_RATES,
  FALLBACK_DIMS,
  FALLBACK_TAXES,
  getDefaultRates,
  loadDims,
  loadTaxes,
  invalidatePricingMatricesCache,
};
