/**
 * KOMERCE — Routes pricing admin
 * POST /api/pricing/calculate  → calcul prix temps réel
 * POST /api/pricing/couture    → calcul prix tenue couture (tissu + confection)
 * GET  /api/pricing/rates      → taux actuels
 * PUT  /api/pricing/rates      → mettre à jour les taux (admin)
 */

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { calcPrix, calcPrixTenue } = require('../utils/pricing');

const adminOnly = [authenticate, requireRole(['admin'])];

const { getRates } = require('../utils/rates');

// POST /api/pricing/calculate
router.post('/calculate', async (req, res, next) => {
  try {
    const { product_id, qty=1, is_diaspora=false, relais_type='standard' } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id requis' });

    const p = await db.query('SELECT * FROM products WHERE id=$1', [product_id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Produit introuvable' });

    const prod   = p.rows[0];
    const rates  = await getRates();

    const result = calcPrix({
      prix_aed:   parseFloat(prod.price_aed || prod.price_kmf / rates.aed_kmf),
      category:   prod.category,
      source:     prod.source || 'S1',
      qty:        parseInt(qty),
      is_diaspora,
      relais_type,
      rates,
    });

    res.json(result);
  } catch(e) { next(e); }
});

// POST /api/pricing/couture
router.post('/couture', async (req, res, next) => {
  try {
    const { fabric_id, model_id, qty=1, is_diaspora=false } = req.body;
    if (!fabric_id || !model_id) return res.status(400).json({ error: 'fabric_id et model_id requis' });

    const [f, m] = await Promise.all([
      db.query('SELECT * FROM fabrics WHERE id=$1', [fabric_id]),
      db.query('SELECT * FROM garment_models WHERE id=$1', [model_id]),
    ]);
    if (!f.rows.length || !m.rows.length) return res.status(404).json({ error: 'Tissu ou modèle introuvable' });

    const rates  = await getRates();
    const result = calcPrixTenue({
      prix_tissu_aed:      parseFloat(f.rows[0].price_per_meter_aed),
      metrage:             parseFloat(m.rows[0].fabric_meters),
      cout_confection_aed: parseFloat(m.rows[0].making_cost_aed),
      qty: parseInt(qty),
      is_diaspora,
      rates,
    });

    res.json({ ...result, fabric: f.rows[0].name, model: m.rows[0].name });
  } catch(e) { next(e); }
});

// GET /api/pricing/rates
// Lit la source de vérité (finance_config). exchange_rates devient passif (historique).
router.get('/rates', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT taux_change_eur_kmf, taux_aed_kmf FROM finance_config WHERE id = 1'
    );
    const fc = rows[0];
    // Historique pour info (audit)
    const { rows: history } = await db.query(
      'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 5'
    );
    res.json({
      current: {
        eur_kmf: Number(fc?.taux_change_eur_kmf) || 492,
        aed_kmf: Number(fc?.taux_aed_kmf) || 138,
      },
      history,
    });
  } catch(e) { next(e); }
});

// PUT /api/pricing/rates — admin
// Écrit dans finance_config + log dans exchange_rates pour audit.
router.put('/rates', ...adminOnly, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { eur_kmf, aed_kmf } = req.body;
    if (!eur_kmf || !aed_kmf) return res.status(400).json({ error: 'eur_kmf et aed_kmf requis' });

    await client.query('BEGIN');

    // 1. Update finance_config (source de vérité)
    await client.query(
      `UPDATE finance_config
          SET taux_change_eur_kmf = $1,
              taux_aed_kmf = $2,
              updated_at = NOW(),
              updated_by = $3
        WHERE id = 1`,
      [eur_kmf, aed_kmf, req.user?.id || null]
    );

    // 2. Log dans exchange_rates pour historique/audit
    await client.query(
      'INSERT INTO exchange_rates (eur_kmf, aed_kmf, valid_from) VALUES ($1, $2, CURRENT_DATE)',
      [eur_kmf, aed_kmf]
    );

    await client.query('COMMIT');

    // 3. Invalider le cache global
    try {
      const { invalidateCache } = require('../utils/rates');
      invalidateCache();
    } catch(_) {}

    res.json({
      message: 'Taux mis à jour dans finance_config + log historique',
      rate: { eur_kmf, aed_kmf },
    });
  } catch(e) {
    await client.query('ROLLBACK').catch(()=>{});
    next(e);
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/pricing/recommend (ADR-011 — moteur unifié 3 niveaux)
//
// Calcule le prix recommandé d'un produit en intégrant :
//   Niveau 1 : composants unitaires (pricing_components)
//   Niveau 2 : part charges fixes (charges ÷ volume)
//   Niveau 3 : provisions risques (risk_provisions)
//   + marge cible par catégorie (customs_categories.default_margin_pct)
//     ou cible globale (finance_config.target_marge_brute_pct)
//
// Body :
//   {
//     product_id?: UUID,             // Si fourni, charge le produit
//     category: 'phones'|'electro'|...,  // Sinon, fournir manuellement
//     prix_aed?: number,             // Prix d'achat fournisseur en AED
//     volume_m3?: number,            // Volume en m3
//     poids_kg?: number,
//     is_diaspora?: bool,            // Pour Stripe
//     channel?: 'cash_relais'|'stripe',
//     verbose?: bool                 // Si true, retourne le détail des 3 niveaux
//   }
//
// Réponse :
//   {
//     prix_recommande_kmf: 13990,
//     prix_recommande_brut_kmf: 13845,    // avant arrondi psycho
//     marge_pct_atteinte: 40.2,
//     niveau1: { total: 7800, components: [...] },
//     niveau2: { total: 3000, charges_mensuelles: 300000, volume_cible: 100 },
//     niveau3: { total: 600, provisions: [...] },
//     warnings: []
//   }
// ═══════════════════════════════════════════════════════════════════

router.post('/recommend', async (req, res, next) => {
  try {
    const b = req.body || {};
    const verbose = !!b.verbose;
    const warnings = [];

    // ── 1. Charger le produit si product_id fourni ──
    let product = null;
    if (b.product_id) {
      const r = await db.query('SELECT * FROM products WHERE id = $1', [b.product_id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Produit introuvable' });
      product = r.rows[0];
    }

    const category = b.category || product?.category || 'phones';
    const prixAed  = Number(b.prix_aed) || (product ? Number(product.cost_aed) || 0 : 0);
    const volumeM3 = Number(b.volume_m3) || 0.005;  // défaut 5L
    const poidsKg  = Number(b.poids_kg) || 1;
    const isDiaspora = !!b.is_diaspora;
    const channel = b.channel || 'cash_relais';

    if (!prixAed || prixAed <= 0) {
      warnings.push('prix_aed manquant ou nul → prix recommandé non significatif');
    }

    // ── 2. Charger en parallèle tous les paramètres ──
    const [fcRes, catRes, compRes, provRes, chargesRes] = await Promise.all([
      db.query('SELECT * FROM finance_config WHERE id = 1'),
      db.query('SELECT * FROM customs_categories WHERE key = $1 AND is_active = TRUE', [category]),
      db.query('SELECT * FROM pricing_components WHERE is_active = TRUE ORDER BY display_order'),
      db.query('SELECT * FROM risk_provisions WHERE is_active = TRUE ORDER BY display_order'),
      db.query('SELECT * FROM charges WHERE is_active = TRUE'),
    ]);

    const fc = fcRes.rows[0] || {};
    const cat = catRes.rows[0];
    if (!cat) {
      warnings.push('Catégorie "' + category + '" introuvable → utilisation valeurs par défaut');
    }

    const taxAED = Number(fc.taux_aed_kmf) || 138;
    const taxEUR = Number(fc.taux_change_eur_kmf) || 492;
    const fretEurM3 = Number(fc.fret_eur_per_m3) || 180;

    // Marge cible (par catégorie ou globale)
    const margeCiblePct = (cat?.default_margin_pct
      ? Number(cat.default_margin_pct)
      : Number(fc.target_marge_brute_pct) || 40) / 100;

    // ── 3. NIVEAU 1 : composants unitaires ──
    const prixAchatKmf = prixAed * taxAED;
    const fretKmf = volumeM3 * fretEurM3 * taxEUR;
    let valCIF = prixAchatKmf + fretKmf;  // sera enrichi avec embarq, agent...

    const niveau1Items = [];

    function applies(comp) {
      const a = comp.applies_to || 'all';
      if (a === 'all') return true;
      if (a === 'is_diaspora:true')  return isDiaspora;
      if (a === 'is_diaspora:false') return !isDiaspora;
      if (a.startsWith('channel:'))  return channel === a.substring(8);
      if (a.startsWith('category:')) return category === a.substring(9);
      return true;  // par défaut on applique
    }

    function computeComponent(comp, baseKmf) {
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

    // Pour chaque composant actif et applicable
    for (const comp of compRes.rows) {
      if (!applies(comp)) continue;
      // Pour les pourcentages, la base = valCIF (valeur CIF du moment)
      const valeurKmf = computeComponent(comp, valCIF);
      if (verbose || true) {  // Toujours détailler si vide
        niveau1Items.push({
          key: comp.key,
          label: comp.label,
          category: comp.category,
          unit: comp.unit,
          rate: comp.default_value,
          valeur_kmf: Math.round(valeurKmf),
        });
      }
      valCIF += valeurKmf;
    }

    // Ajouter douane/TVA/taxe additionnelle DEPUIS customs_categories
    if (cat) {
      const douaneKmf  = (prixAchatKmf + fretKmf) * (Number(cat.douane_pct) / 100);
      const tvaKmf     = (prixAchatKmf + fretKmf) * (Number(cat.tva_pct) / 100);
      const taxeAddKmf = (prixAchatKmf + fretKmf) * (Number(cat.taxe_add_pct) / 100);

      niveau1Items.push({
        key: 'douane_pct', label: 'Droits douane (' + cat.douane_pct + '%)',
        category: 'douane', unit: 'pct', rate: cat.douane_pct,
        valeur_kmf: Math.round(douaneKmf)
      });
      niveau1Items.push({
        key: 'tva_pct', label: 'TVA (' + cat.tva_pct + '%)',
        category: 'douane', unit: 'pct', rate: cat.tva_pct,
        valeur_kmf: Math.round(tvaKmf)
      });
      if (Number(cat.taxe_add_pct) > 0) {
        niveau1Items.push({
          key: 'taxe_add_pct', label: 'Taxe additionnelle (' + cat.taxe_add_pct + '%)',
          category: 'douane', unit: 'pct', rate: cat.taxe_add_pct,
          valeur_kmf: Math.round(taxeAddKmf)
        });
      }
      valCIF += douaneKmf + tvaKmf + taxeAddKmf;
    }

    const niveau1Total = Math.round(valCIF);

    // ── 4. NIVEAU 2 : charges fixes / volume cible ──
    const totalChargesMensuelles = chargesRes.rows
      .filter(c => c.recurrence_period === 'monthly')
      .reduce((s, c) => s + Number(c.amount_kmf), 0);

    const totalChargesHebdo = chargesRes.rows
      .filter(c => c.recurrence_period === 'weekly')
      .reduce((s, c) => s + Number(c.amount_kmf), 0);

    const totalChargesParOrder = chargesRes.rows
      .filter(c => c.recurrence_period === 'per_order')
      .reduce((s, c) => s + Number(c.amount_kmf), 0);

    const totalMensuel = totalChargesMensuelles + Math.round(totalChargesHebdo * 4.33);
    const volumeCible = Number(fc.objectif_commandes_mois) || 100;
    const partFixeParCmd = volumeCible > 0 ? totalMensuel / volumeCible : 0;
    const niveau2Total = Math.round(partFixeParCmd + totalChargesParOrder);

    if (volumeCible === 0) warnings.push('objectif_commandes_mois = 0 → niveau 2 ignoré');
    if (totalMensuel === 0) warnings.push('Aucune charge fixe mensuelle dans la table charges');

    // ── 5. NIVEAU 3 : provisions risques (% sur subtotal niveau 1+2) ──
    const baseProvisions = niveau1Total + niveau2Total;
    let niveau3Total = 0;
    const niveau3Items = [];

    for (const prov of provRes.rows) {
      if (!applies(prov)) continue;
      const valeurKmf = baseProvisions * (Number(prov.rate_pct) / 100);
      niveau3Items.push({
        key: prov.key,
        label: prov.label,
        rate_pct: Number(prov.rate_pct),
        valeur_kmf: Math.round(valeurKmf),
      });
      niveau3Total += valeurKmf;
    }
    niveau3Total = Math.round(niveau3Total);

    // ── 6. Calcul du prix recommandé ──
    const coutTotal = niveau1Total + niveau2Total + niveau3Total;
    const prixRecommandeBrut = coutTotal / (1 - margeCiblePct);

    // Arrondi psychologique simple : .990 si > 1000 sinon arrondi entier
    function arrondiPsycho(x) {
      if (x < 500) return Math.ceil(x / 10) * 10;
      if (x < 1000) return Math.ceil(x / 100) * 100 - 10;  // ex 990
      // pour les valeurs > 1000 : arrondir à la centaine au-dessus puis -10
      const k = Math.ceil(x / 1000) * 1000;
      return k - 10;  // ex 13990
    }

    const prixRecommande = arrondiPsycho(prixRecommandeBrut);
    const margeAtteintePct = prixRecommande > 0
      ? ((prixRecommande - coutTotal) / prixRecommande * 100)
      : 0;

    // ── 7. Réponse ──
    res.json({
      // Réponse synthétique
      prix_recommande_kmf: prixRecommande,
      prix_recommande_brut_kmf: Math.round(prixRecommandeBrut),
      cout_total_kmf: coutTotal,
      marge_cible_pct: Number((margeCiblePct * 100).toFixed(1)),
      marge_atteinte_pct: Number(margeAtteintePct.toFixed(2)),

      // Détail des 3 niveaux
      niveau1: {
        total: niveau1Total,
        items: niveau1Items,
        description: 'Coûts unitaires variables par commande (composants pricing_components + douane/TVA)'
      },
      niveau2: {
        total: niveau2Total,
        charges_mensuelles_kmf: totalMensuel,
        charges_per_order_kmf: totalChargesParOrder,
        volume_cible: volumeCible,
        part_fixe_par_cmd: Math.round(partFixeParCmd),
        description: 'Charges fixes business amorties sur le volume cible mensuel'
      },
      niveau3: {
        total: niveau3Total,
        items: niveau3Items,
        description: 'Provisions de risques en % du subtotal (Niveau 1+2)'
      },

      context: {
        product_id: b.product_id || null,
        category,
        channel,
        is_diaspora: isDiaspora,
        taux_aed_kmf: taxAED,
        taux_eur_kmf: taxEUR,
      },
      warnings,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/pricing/recommend-batch
//
// Calcule les prix recommandés pour TOUS les produits actifs en une
// seule requête. Évite N appels HTTP au /recommend.
//
// Body (optionnel) :
//   { product_ids: ["uuid1", "uuid2"], category: "phones", limit: 100 }
//
// Réponse :
//   {
//     count: 42,
//     items: [
//       {
//         product_id, name, category, current_price_kmf,
//         recommended_price_kmf, gap_kmf, gap_pct,
//         status: 'aligned' | 'underpriced' | 'overpriced',
//         niveau1, niveau2, niveau3
//       }
//     ],
//     summary: { aligned, underpriced, overpriced, total_gap_kmf }
//   }
// ═══════════════════════════════════════════════════════════════════

router.post('/recommend-batch', async (req, res, next) => {
  try {
    const b = req.body || {};
    const limit = Math.min(parseInt(b.limit) || 200, 500);

    // ── 1. Charger les produits ──
    const conditions = ['p.is_active = TRUE'];
    const params = [];
    let pi = 1;
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
      `SELECT p.id, p.name, p.category, p.price_kmf,
              p.cost_aed, p.cost_kmf, p.weight_kg
         FROM products p
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.category, p.name
        LIMIT $${pi}`,
      params
    );

    if (!productsRes.rows.length) {
      return res.json({ count: 0, items: [], summary: {
        aligned: 0, underpriced: 0, overpriced: 0, total_gap_kmf: 0
      } });
    }

    // ── 2. Charger UNE FOIS les paramètres globaux ──
    const [fcRes, catsRes, compRes, provRes, chargesRes] = await Promise.all([
      db.query('SELECT * FROM finance_config WHERE id = 1'),
      db.query('SELECT * FROM customs_categories WHERE is_active = TRUE'),
      db.query('SELECT * FROM pricing_components WHERE is_active = TRUE ORDER BY display_order'),
      db.query('SELECT * FROM risk_provisions WHERE is_active = TRUE ORDER BY display_order'),
      db.query('SELECT * FROM charges WHERE is_active = TRUE'),
    ]);

    const fc = fcRes.rows[0] || {};
    const cats = {};
    catsRes.rows.forEach(c => { cats[c.key] = c; });

    const taxAED = Number(fc.taux_aed_kmf) || 138;
    const taxEUR = Number(fc.taux_change_eur_kmf) || 492;
    const fretEurM3 = Number(fc.fret_eur_per_m3) || 180;
    const margeGlobalePct = (Number(fc.target_marge_brute_pct) || 40) / 100;

    // ── 3. Calculer charges fixes amorties (constant pour tous) ──
    const totalChargesMensuelles = chargesRes.rows
      .filter(c => c.recurrence_period === 'monthly')
      .reduce((s, c) => s + Number(c.amount_kmf), 0);
    const totalChargesHebdo = chargesRes.rows
      .filter(c => c.recurrence_period === 'weekly')
      .reduce((s, c) => s + Number(c.amount_kmf), 0);
    const totalChargesParOrder = chargesRes.rows
      .filter(c => c.recurrence_period === 'per_order')
      .reduce((s, c) => s + Number(c.amount_kmf), 0);
    const totalMensuel = totalChargesMensuelles + Math.round(totalChargesHebdo * 4.33);
    const volumeCible = Number(fc.objectif_commandes_mois) || 100;
    const partFixeParCmd = volumeCible > 0 ? totalMensuel / volumeCible : 0;
    const niveau2Total = Math.round(partFixeParCmd + totalChargesParOrder);

    // ── 4. Boucle sur produits ──
    const items = [];
    let counters = { aligned: 0, underpriced: 0, overpriced: 0, total_gap_kmf: 0 };

    for (const product of productsRes.rows) {
      const category = product.category || 'phones';
      const cat = cats[category];
      const prixAed = Number(product.cost_aed) || 0;
      const poidsKg = Number(product.weight_kg) || 1;
      const volumeM3 = 0.005;  // défaut 5L (à enrichir avec dim produits plus tard)

      const margeCiblePct = cat?.default_margin_pct
        ? Number(cat.default_margin_pct) / 100
        : margeGlobalePct;

      // Niveau 1
      const prixAchatKmf = prixAed * taxAED;
      const fretKmf = volumeM3 * fretEurM3 * taxEUR;
      let valCIF = prixAchatKmf + fretKmf;

      for (const comp of compRes.rows) {
        if (!_applies(comp, { category, channel: 'cash_relais', isDiaspora: false })) continue;
        const v = Number(comp.default_value);
        switch (comp.unit) {
          case 'pct':         valCIF += valCIF * (v / 100); break;
          case 'kmf':         valCIF += v; break;
          case 'kmf_per_kg':  valCIF += v * poidsKg; break;
          case 'kmf_per_m3':  valCIF += v * volumeM3; break;
          case 'aed':         valCIF += v * taxAED; break;
          case 'eur':         valCIF += v * taxEUR; break;
        }
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
      let niveau3Total = 0;
      for (const prov of provRes.rows) {
        if (!_applies(prov, { category, channel: 'cash_relais', isDiaspora: false })) continue;
        niveau3Total += baseProvisions * (Number(prov.rate_pct) / 100);
      }
      niveau3Total = Math.round(niveau3Total);

      // Prix
      const coutTotal = niveau1Total + niveau2Total + niveau3Total;
      const prixRecommandeBrut = coutTotal / (1 - margeCiblePct);
      const prixRecommande = _arrondiPsycho(prixRecommandeBrut);
      const currentPrice = Number(product.price_kmf) || 0;
      const gap = prixRecommande - currentPrice;
      const gapPct = currentPrice > 0 ? (gap / currentPrice * 100) : 0;

      // Status
      let status = 'aligned';
      if (currentPrice <= 0) status = 'unset';
      else if (Math.abs(gapPct) <= 5) status = 'aligned';
      else if (gap > 0) status = 'underpriced';
      else status = 'overpriced';

      counters[status === 'unset' ? 'underpriced' : status]++;
      counters.total_gap_kmf += gap;

      items.push({
        product_id: product.id,
        name: product.name,
        category,
        current_price_kmf: currentPrice,
        recommended_price_kmf: prixRecommande,
        gap_kmf: gap,
        gap_pct: Number(gapPct.toFixed(1)),
        status,
        cost_total_kmf: coutTotal,
        margin_target_pct: Number((margeCiblePct * 100).toFixed(1)),
        niveau1_kmf: niveau1Total,
        niveau2_kmf: niveau2Total,
        niveau3_kmf: niveau3Total,
      });
    }

    res.json({
      count: items.length,
      items,
      summary: counters,
      computed_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// Helper extrait pour le batch (réplique la logique applies du recommend)
function _applies(item, ctx) {
  const a = item.applies_to || 'all';
  if (a === 'all') return true;
  if (a === 'is_diaspora:true')  return ctx.isDiaspora;
  if (a === 'is_diaspora:false') return !ctx.isDiaspora;
  if (a.startsWith('channel:'))  return ctx.channel === a.substring(8);
  if (a.startsWith('category:')) return ctx.category === a.substring(9);
  return true;
}

function _arrondiPsycho(x) {
  if (x < 500) return Math.ceil(x / 10) * 10;
  if (x < 1000) return Math.ceil(x / 100) * 100 - 10;
  const k = Math.ceil(x / 1000) * 1000;
  return k - 10;
}

// ═══════════════════════════════════════════════════════════════════
// PUT /api/pricing/apply-price/:product_id
//
// Applique le prix recommandé au produit (admin/founder uniquement).
// Body : { price_kmf: number, source: 'manual' | 'reco' | 'batch' }
// Audit : insère une ligne dans price_history
// ═══════════════════════════════════════════════════════════════════

router.put('/apply-price/:product_id', ...adminOnly, async (req, res, next) => {
  try {
    const { product_id } = req.params;
    const { price_kmf, source } = req.body;

    if (!price_kmf || price_kmf <= 0) {
      return res.status(400).json({ error: 'price_kmf invalide' });
    }

    // Charger le produit pour vérifier
    const { rows: [product] } = await db.query(
      'SELECT id, name, price_kmf FROM products WHERE id = $1', [product_id]
    );
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });

    const oldPrice = Number(product.price_kmf) || 0;

    // Update
    const { rows: [updated] } = await db.query(
      `UPDATE products
          SET price_kmf = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, name, price_kmf`,
      [price_kmf, product_id]
    );

    // Audit (best effort, ne casse pas si la table n'existe pas)
    try {
      await db.query(
        `INSERT INTO price_history (product_id, old_price_kmf, new_price_kmf, source, applied_by, applied_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [product_id, oldPrice, price_kmf, source || 'manual', req.user?.id || null]
      );
    } catch(_) { /* table optionnelle */ }

    res.json({
      ok: true,
      product: updated,
      old_price_kmf: oldPrice,
      new_price_kmf: price_kmf,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/pricing/apply-all
//
// Applique en masse les prix recommandés. Verrouillé admin/founder.
// Body : { items: [{ product_id, price_kmf }], source: 'batch' }
// ═══════════════════════════════════════════════════════════════════

router.put('/apply-all', ...adminOnly, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const items = req.body?.items || [];
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'items array requis' });
    }
    if (items.length > 500) {
      return res.status(400).json({ error: 'max 500 items par batch' });
    }

    await client.query('BEGIN');
    const applied = [];
    for (const it of items) {
      if (!it.product_id || !it.price_kmf || it.price_kmf <= 0) continue;
      const { rows: [updated] } = await client.query(
        `UPDATE products SET price_kmf = $1, updated_at = NOW()
          WHERE id = $2 RETURNING id, name, price_kmf`,
        [it.price_kmf, it.product_id]
      );
      if (updated) applied.push(updated);
    }
    await client.query('COMMIT');

    res.json({
      ok: true,
      count: applied.length,
      products: applied,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
