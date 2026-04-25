/**
 * KOMERCE — Supplier Catalog Scanner (LOT D)
 * ═══════════════════════════════════════════════════════════════
 *
 * Doctrine §10 — Atelier Prix & Sourcing :
 *   "Le sourcing scanner n'achète pas à la place de l'admin.
 *    Il filtre, explique et priorise."
 *
 * Pipeline :
 *   1. Ingestion       → CSV ou saisie manuelle
 *   2. Normalisation   → cat Komerce, conversion KMF, poids/volume estimés
 *   3. Scan pricing    → réutilise services/pricing-engine.js
 *   4. Décision        → sourcing_decision + reason
 *   5. Action admin    → import boutique / watchlist / rejeté
 *
 * Aucun import automatique vers products.
 * Un sourcing_candidate devient un produit UNIQUEMENT après
 * validation explicite de l'admin (POST /candidates/:id/import-product).
 *
 * Ce service expose les fonctions pures pour :
 *   - normalizeCandidate(raw)    — mapper bruts -> Komerce
 *   - scanCandidate(candidate)   — appelle pricing-engine + retourne décision
 *   - parseCSVRow(row, mapping)  — convertit ligne CSV en raw
 *
 * Les routes (routes/sourcing-scanner.js) consomment ces fonctions.
 */

'use strict';

const db = require('../db');
const pricingEngine = require('./pricing-engine');

// ═══════════════════════════════════════════════════════════════════════
// HELPERS NORMALISATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convertit un montant fournisseur en KMF.
 * Utilise les taux dans finance_config (snapshot au moment du scan).
 *
 * @param {number} amount
 * @param {string} currency  'AED' | 'EUR' | 'USD' | 'KMF'
 * @param {object} finance   { taux_aed_kmf, taux_change_eur_kmf, taux_usd_kmf? }
 * @returns {number} montant en KMF (entier)
 */
function convertToKMF(amount, currency, finance) {
  const v = Number(amount) || 0;
  if (!v) return 0;
  const cur = (currency || 'AED').toUpperCase();
  if (cur === 'KMF') return Math.round(v);
  if (cur === 'AED') return Math.round(v * (Number(finance?.taux_aed_kmf) || 138));
  if (cur === 'EUR') return Math.round(v * (Number(finance?.taux_change_eur_kmf) || 492));
  // USD fallback : ~1 USD = 0.27 EUR ~ 132 KMF (approximation, à raffiner si besoin)
  if (cur === 'USD') return Math.round(v * 0.92 * (Number(finance?.taux_change_eur_kmf) || 492));
  return Math.round(v);
}

/**
 * Mappe une catégorie fournisseur vers une catégorie Komerce.
 * Logique simple par mots-clés. Si rien ne match : fallback 'autre'.
 *
 * @param {string} supplierCat   ex: "Women's clothing", "Mobile phones", "Beauty"
 * @param {Array} komerceCats    customs_categories.rows
 * @returns {{ key: string, source: 'mapped'|'default', confidence: 'low'|'medium'|'high' }}
 */
function mapCategory(supplierCat, komerceCats) {
  const cats = Array.isArray(komerceCats) ? komerceCats : [];
  if (!supplierCat) {
    const fallback = cats.find(c => c.key === 'autre') || cats[0];
    return { key: fallback?.key || 'autre', source: 'default', confidence: 'low' };
  }
  const s = supplierCat.toLowerCase();
  // Mots-clés courants (FR + EN)
  const rules = [
    { keys: ['phone', 'mobile', 'téléphone', 'smartphone'], catKey: 'phones' },
    { keys: ['cloth', 'vetement', 'vêtement', 'robe', 'chemise', 'pantalon', 'fashion'], catKey: 'vetements' },
    { keys: ['tissu', 'fabric', 'textile'], catKey: 'tissus' },
    { keys: ['cosmetic', 'beauty', 'parfum', 'cosmétique', 'maquillage'], catKey: 'cosmetiques' },
    { keys: ['toy', 'jouet', 'enfant', 'kids'], catKey: 'enfants' },
    { keys: ['accessoire', 'accessory', 'bag', 'sac'], catKey: 'accessoires' },
    { keys: ['cuisine', 'kitchen', 'maison', 'home'], catKey: 'maison' },
    { keys: ['electronic', 'gadget', 'electrique'], catKey: 'electronique' },
  ];
  for (const r of rules) {
    if (r.keys.some(k => s.includes(k))) {
      // Vérifier que la cat existe vraiment dans Komerce
      const cat = cats.find(c => c.key === r.catKey);
      if (cat) return { key: cat.key, source: 'mapped', confidence: 'medium' };
    }
  }
  // Pas de match : fallback
  const fallback = cats.find(c => c.key === 'autre') || cats[0];
  return { key: fallback?.key || 'autre', source: 'default', confidence: 'low' };
}

/**
 * Estime le poids si non fourni, par défaut catégorie.
 *
 * @param {number|null} suppliedWeight
 * @param {string} categoryKey
 * @param {Array} komerceCats
 * @returns {{ value: number, source: string, confidence: string }}
 */
function estimateWeight(suppliedWeight, categoryKey, komerceCats) {
  if (suppliedWeight != null && Number(suppliedWeight) > 0) {
    return { value: Number(suppliedWeight), source: 'supplier', confidence: 'high' };
  }
  // Défauts par catégorie (observations terrain Komerce, à ajuster)
  const defaults = {
    phones: 0.3, vetements: 0.4, tissus: 0.6, cosmetiques: 0.2,
    enfants: 0.5, accessoires: 0.3, maison: 1.5, electronique: 1.0,
    autre: 0.5,
  };
  const cat = (komerceCats || []).find(c => c.key === categoryKey);
  if (cat?.default_weight_kg) {
    return { value: Number(cat.default_weight_kg), source: 'category', confidence: 'medium' };
  }
  if (defaults[categoryKey]) {
    return { value: defaults[categoryKey], source: 'category', confidence: 'low' };
  }
  return { value: 0.5, source: 'default', confidence: 'low' };
}

/**
 * Estime le volume en m³ depuis dimensions ou défaut catégorie.
 */
function estimateVolume(l, w, h, categoryKey) {
  const lcm = Number(l) || 0, wcm = Number(w) || 0, hcm = Number(h) || 0;
  if (lcm > 0 && wcm > 0 && hcm > 0) {
    return { value: (lcm * wcm * hcm) / 1_000_000, source: 'supplier', confidence: 'high' };
  }
  const defaults = {
    phones: 0.001, vetements: 0.005, tissus: 0.008, cosmetiques: 0.0008,
    enfants: 0.006, accessoires: 0.003, maison: 0.020, electronique: 0.010,
    autre: 0.005,
  };
  return {
    value: defaults[categoryKey] || 0.005,
    source: 'category',
    confidence: 'low',
  };
}

/**
 * Calcule la confidence globale d'un candidat à partir des sources de ses champs.
 * Si tout est 'supplier' ou 'real' → high
 * Si majoritairement 'category' → medium
 * Sinon → low
 */
function computeConfidence(dataSources) {
  const values = Object.values(dataSources || {});
  if (!values.length) return 'low';
  const high = values.filter(s => s === 'supplier' || s === 'real').length;
  const medium = values.filter(s => s === 'category' || s === 'mapped' || s === 'manual').length;
  const ratio = high / values.length;
  if (ratio >= 0.6) return 'high';
  if ((high + medium) / values.length >= 0.6) return 'medium';
  return 'low';
}

// ═══════════════════════════════════════════════════════════════════════
// NORMALISATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Normalise un candidat brut en données Komerce exploitables par pricing-engine.
 *
 * @param {object} raw  — données brutes (depuis CSV ou form manuel)
 * @returns {object}    — candidat normalisé prêt à être inséré ou scanné
 */
async function normalizeCandidate(raw, options = {}) {
  // Charger config Komerce (categories + finance)
  const config = options.config || (await pricingEngine.loadGlobalConfig());
  const komerceCats = Object.values(config.categories || {});

  const dataSources = { ...(raw.data_sources || {}) };

  // Catégorie
  const catMap = mapCategory(raw.supplier_category, komerceCats);
  const komerceCategory = raw.komerce_category || catMap.key;
  dataSources.category = raw.komerce_category ? 'manual' : catMap.source;

  // Prix achat KMF
  const purchasePriceKmf = convertToKMF(raw.purchase_price, raw.currency, config.finance);
  dataSources.purchase_price = raw.purchase_price ? 'supplier' : 'missing';

  // Poids
  const w = estimateWeight(raw.weight_kg, komerceCategory, komerceCats);
  dataSources.weight = w.source;

  // Volume
  const v = estimateVolume(raw.dim_l_cm, raw.dim_w_cm, raw.dim_h_cm, komerceCategory);
  dataSources.volume = v.source;

  // Marge cible : héritée catégorie ou défaut config
  const cat = config.categories[komerceCategory];
  const targetMarginPct = cat?.default_margin_pct
    ? Number(cat.default_margin_pct)
    : Number(config.finance?.target_marge_brute_pct) || 40;
  dataSources.target_margin = cat?.default_margin_pct ? 'category' : 'default';

  return {
    ...raw,
    komerce_category: komerceCategory,
    purchase_price_kmf: purchasePriceKmf,
    estimated_weight_kg: w.value,
    estimated_volume_m3: v.value,
    target_margin_pct: targetMarginPct,
    data_sources: dataSources,
    confidence: computeConfidence(dataSources),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SCAN (réutilise pricing-engine)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Scanne un candidat normalisé via pricing-engine.recommend().
 * Retourne le résultat doctrine complet (4 prix, decision, alerts, etc.)
 * + override la sourcing_decision si on est sans données marché (TEST par défaut).
 *
 * @param {object} candidate  — candidat normalisé
 * @returns {object}          — { scan_result, sourcing_decision, reason, recommended_action }
 */
async function scanCandidate(candidate, options = {}) {
  const config = options.config || (await pricingEngine.loadGlobalConfig());

  // Construire l'input pour pricing-engine
  const input = {
    product_id: null,                              // pas un produit Komerce
    category: candidate.komerce_category || 'autre',
    cost_kmf: candidate.purchase_price_kmf || 0,
    weight_kg: candidate.estimated_weight_kg || 0.5,
    volume_m3: candidate.estimated_volume_m3 || 0.005,
    current_price_kmf: 0,                          // pas encore vendu, donc pas de prix actuel
    channel: candidate.channel || 'cash_relais',
  };

  const reco = await pricingEngine.recommend(input, { config });

  // Sans données marché, on force market_confidence = 'unknown'
  // et on contraint sourcing_decision selon doctrine §10 :
  //   - bonne marge + unknown → TEST (pas PRIORITY)
  //   - marge fragile → WATCH
  //   - vendu à perte → LOSS
  let sourcingDecision = reco.sourcing_decision;
  let reason = reco.reason || '';
  if (reco.health_status === 'loss') {
    sourcingDecision = 'LOSS';
    reason = reason || 'Coût supérieur au prix recommandé — produit non rentabilisable.';
  } else if (reco.health_status === 'danger') {
    sourcingDecision = 'AVOID';
    reason = reason || 'Marge dangereusement faible. Renégocier ou éviter.';
  } else if (reco.health_status === 'fragile') {
    sourcingDecision = 'WATCH';
    reason = reason || 'Marge fragile. Surveiller les coûts terrain avant sourcing massif.';
  } else if (reco.health_status === 'healthy' || reco.health_status === 'strong') {
    // Sans signal marché on ne dit JAMAIS PRIORITY
    sourcingDecision = 'TEST';
    reason = 'Marge satisfaisante mais demande marché inconnue. Tester en faible quantité avant sourcing massif.';
  } else {
    sourcingDecision = 'WATCH';
    reason = 'Données insuffisantes pour décider. Compléter prix achat / poids / catégorie.';
  }

  // Action recommandée en langage admin
  const recommendedAction = ({
    PRIORITY: 'Importer comme produit test à fort potentiel',
    TEST:     'Importer comme produit test en faible quantité',
    WATCH:    'Mettre en watchlist, ne pas importer pour l\'instant',
    AVOID:    'Ne pas importer. Renégocier le prix fournisseur ou changer de produit.',
    LOSS:     'Ne pas importer. Coût supérieur au prix possible.',
  })[sourcingDecision] || 'À examiner manuellement';

  return {
    scan_result: reco,                  // résultat brut pricing-engine
    sourcing_decision: sourcingDecision,
    reason,
    recommended_action: recommendedAction,
    market_confidence: 'unknown',       // pas de données marché par défaut
    confidence: candidate.confidence || 'low',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PARSE CSV
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse un CSV simple (texte brut, séparateur , ou ;) en array d'objets.
 * Première ligne = headers. Mapping flexible.
 *
 * @param {string} csvText
 * @param {object} mapping  — clés Komerce -> noms de colonnes CSV (optionnel, auto si absent)
 * @returns {Array<object>} — lignes brutes prêtes à être normalisées
 */
function parseCSV(csvText, mapping) {
  if (!csvText || typeof csvText !== 'string') return [];
  // Détecter séparateur
  const firstLine = csvText.split(/\r?\n/)[0] || '';
  const sep = firstLine.includes(';') ? ';' : ',';
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase());

  // Mapping par défaut : matchers sur noms de colonnes courants
  const defaultMap = {
    product_name:    ['name', 'product_name', 'titre', 'title', 'nom', 'product'],
    supplier_category: ['category', 'cat', 'categorie', 'supplier_category'],
    purchase_price:  ['price', 'cost', 'purchase_price', 'prix', 'prix_achat'],
    currency:        ['currency', 'devise', 'cur'],
    image_url:       ['image', 'image_url', 'photo', 'img'],
    product_url:     ['url', 'product_url', 'link', 'lien'],
    description:     ['description', 'desc', 'detail'],
    stock_available: ['stock', 'qty', 'quantity', 'available'],
    min_order_qty:   ['moq', 'min_order', 'min_qty'],
    supplier_delay_days: ['delay', 'lead_time', 'delai'],
    weight_kg:       ['weight', 'poids', 'weight_kg', 'poids_kg'],
    dim_l_cm:        ['length', 'longueur', 'l', 'l_cm'],
    dim_w_cm:        ['width', 'largeur', 'w', 'w_cm'],
    dim_h_cm:        ['height', 'hauteur', 'h', 'h_cm'],
    supplier_product_id: ['sku', 'ref', 'reference', 'product_id'],
  };

  // Construire l'index des headers
  const headerIndex = {};
  Object.keys(defaultMap).forEach(field => {
    const candidates = (mapping && mapping[field]) ? [mapping[field]] : defaultMap[field];
    for (const c of candidates) {
      const idx = headers.indexOf(c.toLowerCase());
      if (idx !== -1) {
        headerIndex[field] = idx;
        break;
      }
    }
  });

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(sep);
    const row = {};
    Object.keys(headerIndex).forEach(field => {
      const v = (cells[headerIndex[field]] || '').trim().replace(/^"|"$/g, '');
      if (v !== '') {
        if (['purchase_price','weight_kg','dim_l_cm','dim_w_cm','dim_h_cm'].includes(field)) {
          row[field] = parseFloat(v.replace(',', '.'));
        } else if (['stock_available','min_order_qty','supplier_delay_days'].includes(field)) {
          row[field] = parseInt(v, 10);
        } else {
          row[field] = v;
        }
      }
    });
    if (row.product_name) rows.push(row);
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  // Pipeline principal
  normalizeCandidate,
  scanCandidate,
  parseCSV,

  // Helpers exposés (utiles pour tests)
  convertToKMF,
  mapCategory,
  estimateWeight,
  estimateVolume,
  computeConfidence,
};
