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

const adminOnly = [authenticate, requireRole(['admin'])];

const { getRates } = require('../utils/rates');

// ── Service métier centralisé (doctrine économique Komerce) ──
// Voir : services/pricing-engine.js + docs/DOCTRINE_ECONOMIQUE_KOMERCE.md
const pricingEngine = require('../services/pricing-engine');

// POST /api/pricing/calculate
router.post('/calculate', async (req, res, next) => {
  try {
    const { product_id, qty=1, is_diaspora=false, relais_type='standard' } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id requis' });

    const p = await db.query('SELECT * FROM products WHERE id=$1', [product_id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Produit introuvable' });

    const prod   = p.rows[0];
    const rates  = await getRates();

    // calcPrix supprimée (I-08) — passer par pricingEngine.recommend()
    const channel = is_diaspora ? 'diaspora' : 'cash_relais';
    const result = await pricingEngine.recommend({
      product_id,
      qty:      parseInt(qty),
      channel,
      relais_type,
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

    // calcPrixTenue supprimée (I-08) — passer par pricingEngine.recommend()
    const fabric = f.rows[0];
    const model  = m.rows[0];
    const channel = is_diaspora ? 'diaspora' : 'cash_relais';
    const prixAchatAed = parseFloat(fabric.price_per_meter_aed) * parseFloat(model.fabric_meters)
      + parseFloat(model.making_cost_aed);
    const result = await pricingEngine.recommend({
      virtual:   true,
      price_aed: prixAchatAed,
      category:  'couture',
      qty:       parseInt(qty),
      channel,
    });

    res.json({ ...result, fabric: fabric.name, model: model.name });
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
  const client = await db.getClient();
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

router.post('/recommend', authenticate, async (req, res, next) => {
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
    // products.cost_aed n'existe pas — on utilise b.prix_aed du body, ou on dérive depuis cost_kmf
    let prixAed = Number(b.prix_aed) || 0;
    if (!prixAed && product?.cost_kmf) {
      // Dérive : si on a un cost_kmf en BDD, on le reconvertit en AED via le taux courant
      // (sera surchargé par taxAED ci-dessous en lisant finance_config)
      const fcRow = await db.query('SELECT taux_aed_kmf FROM finance_config WHERE id = 1').catch(() => null);
      const taux = Number(fcRow?.rows?.[0]?.taux_aed_kmf) || 138;
      prixAed = Number(product.cost_kmf) / taux;
    }
    const volumeM3 = Number(b.volume_m3) || 0.005;
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
    // ── Enrichissement doctrine économique Komerce ──
    // Le service pricing-engine.js produit les champs business (health_status,
    // sourcing_decision, market_confidence, 4 prix doctrinaux, reason).
    // On les ajoute en parallèle des champs legacy (niveau1/2/3) pour ne rien casser.
    let doctrine = null;
    try {
      doctrine = await pricingEngine.recommend({
        product_id: b.product_id || null,
        category,
        channel,
        cost_kmf: product?.cost_kmf,
        weight_kg: poidsKg,
        volume_m3: volumeM3,
        current_price_kmf: product?.price_kmf,
      });
    } catch (errDoctrine) {
      warnings.push('pricing-engine indisponible : ' + errDoctrine.message);
    }

    res.json({
      // ─── CHAMPS LEGACY (compatibilité Atelier / Dashboard / Stratégie existants) ───
      prix_recommande_kmf: prixRecommande,
      prix_recommande_brut_kmf: Math.round(prixRecommandeBrut),
      cout_total_kmf: coutTotal,
      marge_cible_pct: Number((margeCiblePct * 100).toFixed(1)),
      marge_atteinte_pct: Number(margeAtteintePct.toFixed(2)),

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

      // ─── CHAMPS DOCTRINE (langage business §9) ───
      // Ajoutés en surface pour les nouveaux consommateurs UI.
      // Si le service est indisponible, doctrine = null et les champs restent à null.
      ...(doctrine ? {
        // ── Lot G : décomposition landed cost rendu relais ──
        subject_type: doctrine.subject_type,
        candidate_id: doctrine.candidate_id,
        landed_relay_cost_kmf: doctrine.landed_relay_cost_kmf,
        business_complete_cost_kmf: doctrine.business_complete_cost_kmf,
        cost_breakdown: doctrine.cost_breakdown,
        data_quality: doctrine.data_quality,

        // ── Prix doctrine ──
        survival_price_kmf: doctrine.survival_price_kmf,
        minimum_safe_price_kmf: doctrine.minimum_safe_price_kmf,
        recommended_price_kmf: doctrine.recommended_price_kmf,
        test_price_kmf: doctrine.test_price_kmf,
        cost_complete_estimated_kmf: doctrine.cost_complete_estimated_kmf,
        variable_cost_estimated_kmf: doctrine.variable_cost_estimated_kmf,
        fixed_cost_allocation_kmf: doctrine.fixed_cost_allocation_kmf,
        risk_provision_estimated_kmf: doctrine.risk_provision_estimated_kmf,
        target_margin_pct: doctrine.target_margin_pct,
        estimated_margin_pct: doctrine.estimated_margin_pct,
        estimated_contribution_kmf: doctrine.estimated_contribution_kmf,
        monthly_fixed_costs_kmf: doctrine.monthly_fixed_costs_kmf,
        target_orders_per_month: doctrine.target_orders_per_month,
        monthly_break_even_orders: doctrine.monthly_break_even_orders,
        health_status: doctrine.health_status,
        market_confidence: doctrine.market_confidence,
        sourcing_decision: doctrine.sourcing_decision,
        reason: doctrine.reason,
        recommended_action: doctrine.recommended_action,
        market_signals: doctrine.market_signals,
        details: doctrine.details,
        alerts: doctrine.alerts,
      } : {}),

      warnings: doctrine ? [...warnings, ...doctrine.warnings] : warnings,
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

router.post('/recommend-batch', authenticate, async (req, res, next) => {
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
              p.cost_kmf, p.weight_kg
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
      const poidsKg = Number(product.weight_kg) || 1;
      const volumeM3 = 0.005;  // défaut 5L (à enrichir avec dim produits plus tard)

      const margeCiblePct = cat?.default_margin_pct
        ? Number(cat.default_margin_pct) / 100
        : margeGlobalePct;

      // Niveau 1
      // Note : la table products ne stocke pas cost_aed, seulement cost_kmf
      // (prix d'achat déjà converti). On part directement de cost_kmf.
      const prixAchatKmf = Number(product.cost_kmf) || 0;
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
        // ── Caractéristiques produit (pour alimenter la colonne Objet de l'Atelier) ──
        cost_kmf: prixAchatKmf,
        weight_kg: poidsKg,
        volume_m3: volumeM3,
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

    // ── Enrichissement doctrine (Lot A) ──
    // Pour chaque item, on appelle le service en réutilisant la config déjà
    // chargée — pas de re-fetch BDD coûteux. Si le service échoue pour un produit,
    // on garde l'item legacy intact.
    let doctrineConfig = null;
    try {
      doctrineConfig = await pricingEngine.loadGlobalConfig();
    } catch (errCfg) {
      // Service indisponible : on garde le format legacy
    }
    if (doctrineConfig) {
      for (let i = 0; i < items.length; i++) {
        try {
          const it = items[i];
          const doctrine = await pricingEngine.recommend({
            product_id: it.product_id,
            category: it.category,
            current_price_kmf: it.current_price_kmf,
          }, { config: doctrineConfig });
          // On enrichit l'item existant sans casser les champs legacy
          items[i] = {
            ...it,
            survival_price_kmf: doctrine.survival_price_kmf,
            minimum_safe_price_kmf: doctrine.minimum_safe_price_kmf,
            test_price_kmf: doctrine.test_price_kmf,
            cost_complete_estimated_kmf: doctrine.cost_complete_estimated_kmf,
            estimated_margin_pct: doctrine.estimated_margin_pct,
            estimated_contribution_kmf: doctrine.estimated_contribution_kmf,
            health_status: doctrine.health_status,
            market_confidence: doctrine.market_confidence,
            sourcing_decision: doctrine.sourcing_decision,
            reason: doctrine.reason,
          };
        } catch (errOne) {
          // On laisse l'item legacy tel quel
        }
      }
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
    const { price_kmf, source, scenario_id, scenario_label, levier } = req.body;

    if (!price_kmf || price_kmf <= 0) {
      return res.status(400).json({ error: 'price_kmf invalide' });
    }

    // Charger le produit pour vérifier
    const { rows: [product] } = await db.query(
      'SELECT id, name, price_kmf FROM products WHERE id = $1', [product_id]
    );
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });

    const oldPrice = Number(product.price_kmf) || 0;

    // ── Garde-fou doctrine V3 : refuser un prix sous survival ──
    // Si le scénario fourni a un survival_price_kmf, on vérifie.
    // (L'humain doit avoir consciemment choisi un scénario "selectable")
    if (req.body.survival_price_kmf && price_kmf < Number(req.body.survival_price_kmf)) {
      return res.status(400).json({
        error: 'Prix sous le seuil de survie : refusé par doctrine.',
        code: 'below_survival',
        survival_price_kmf: Number(req.body.survival_price_kmf),
        attempted_price_kmf: price_kmf,
      });
    }

    // Update
    const { rows: [updated] } = await db.query(
      `UPDATE products
          SET price_kmf = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, name, price_kmf`,
      [price_kmf, product_id]
    );

    // Audit enrichi : on stocke le scénario choisi pour traçabilité Phase 3b
    try {
      await db.query(
        `INSERT INTO price_history (
           product_id, old_price_kmf, new_price_kmf, source, applied_by, applied_at,
           scenario_id, scenario_label, levier
         ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
        [
          product_id, oldPrice, price_kmf,
          source || 'manual',
          req.user?.id || null,
          scenario_id || null,
          scenario_label || null,
          levier || null,
        ]
      );
    } catch(_) {
      // Fallback : si les colonnes scenario_* n'existent pas encore,
      // on retombe sur l'audit minimal (pour rétrocompat).
      try {
        await db.query(
          `INSERT INTO price_history (product_id, old_price_kmf, new_price_kmf, source, applied_by, applied_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [product_id, oldPrice, price_kmf, source || 'manual', req.user?.id || null]
        );
      } catch(_) { /* table optionnelle */ }
    }

    res.json({
      ok: true,
      product: updated,
      old_price_kmf: oldPrice,
      new_price_kmf: price_kmf,
      scenario_id: scenario_id || null,
      levier: levier || null,
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
  const client = await db.getClient();
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

// ═══════════════════════════════════════════════════════════════════
// GET /api/pricing/benchmarks-gap
//
// Compare la config actuelle (pricing_components + risk_provisions)
// avec le catalogue pricing_benchmarks pour identifier ce qui manque.
//
// Query (optionnel) :
//   ?importance=critical       → ne renvoyer que les manques critiques
//   ?category=sourcing         → filtrer par categorie
//   ?include_optional=true     → inclure aussi les optionnels (sinon caches)
//
// Reponse :
//   {
//     summary: { critical_missing, recommended_missing, optional_missing,
//                present_count, total_benchmarks },
//     by_category: {
//       sourcing: {
//         label: 'Sourcing', emoji: '🏭',
//         present: [{ key, label, current_value, ... }],
//         missing: [{
//           key, label, emoji, importance, why,
//           benchmark_median, benchmark_min, benchmark_max,
//           unit, suggested_applies_to
//         }]
//       },
//       transit: { ... }, ...
//     }
//   }
// ═══════════════════════════════════════════════════════════════════

router.get('/benchmarks-gap', authenticate, async (req, res, next) => {
  try {
    const filterImportance = req.query.importance || null;
    const filterCategory   = req.query.category || null;
    const includeOptional  = req.query.include_optional === 'true';

    // 1. Tous les benchmarks (filtres optionnels)
    const benchClauses = ['is_active = TRUE'];
    const benchParams = [];
    let bi = 1;
    if (filterImportance) {
      benchClauses.push(`importance = $${bi++}`);
      benchParams.push(filterImportance);
    }
    if (filterCategory) {
      benchClauses.push(`category = $${bi++}`);
      benchParams.push(filterCategory);
    }
    if (!includeOptional && !filterImportance) {
      benchClauses.push(`importance != 'optional'`);
    }
    const benchRes = await db.query(
      `SELECT * FROM pricing_benchmarks
        WHERE ${benchClauses.join(' AND ')}
        ORDER BY category, display_order, label`,
      benchParams
    );

    // 2. Composants et provisions actuels (peu importe is_active)
    const [compRes, provRes] = await Promise.all([
      db.query('SELECT key, label, category, default_value, unit, is_active FROM pricing_components'),
      db.query('SELECT key, label, rate_pct, is_active FROM risk_provisions'),
    ]);

    // 3. Index par key (composants + provisions = tous les "actifs config")
    const presentKeys = new Map();
    for (const c of compRes.rows) {
      presentKeys.set(c.key, { ...c, type: 'component' });
    }
    for (const p of provRes.rows) {
      presentKeys.set(p.key, { ...p, type: 'provision', category: 'distribution' });
    }

    // 4. Construire la reponse par categorie
    const cats = {
      sourcing:     { label: 'Sourcing',     emoji: '🏭', present: [], missing: [] },
      transit:      { label: 'Transit',      emoji: '🚢', present: [], missing: [] },
      douane:       { label: 'Douane',       emoji: '📋', present: [], missing: [] },
      hub:          { label: 'Hub',          emoji: '🏢', present: [], missing: [] },
      distribution: { label: 'Distribution', emoji: '📦', present: [], missing: [] },
      paiement:     { label: 'Paiement',     emoji: '💳', present: [], missing: [] },
    };

    const summary = {
      critical_missing: 0,
      recommended_missing: 0,
      optional_missing: 0,
      present_count: 0,
      total_benchmarks: benchRes.rows.length,
    };

    for (const b of benchRes.rows) {
      const cat = cats[b.category] || cats.sourcing;
      const existing = presentKeys.get(b.key);

      if (existing) {
        cat.present.push({
          key: b.key,
          label: b.label,
          current_value: Number(existing.default_value || existing.rate_pct || 0),
          unit: existing.unit || (existing.type === 'provision' ? 'pct' : 'kmf'),
          benchmark_median: Number(b.benchmark_median),
          deviation_pct: Number(b.benchmark_median) > 0
            ? Math.round((Number(existing.default_value || existing.rate_pct || 0) - Number(b.benchmark_median))
                / Number(b.benchmark_median) * 100)
            : 0,
          is_active: existing.is_active,
        });
        summary.present_count++;
      } else {
        cat.missing.push({
          key: b.key,
          label: b.label,
          emoji: b.emoji,
          unit: b.unit,
          importance: b.importance,
          why: b.why,
          benchmark_median: Number(b.benchmark_median),
          benchmark_min: b.benchmark_min !== null ? Number(b.benchmark_min) : null,
          benchmark_max: b.benchmark_max !== null ? Number(b.benchmark_max) : null,
          source: b.source_benchmark,
          suggested_applies_to: b.applies_to,
        });
        if (b.importance === 'critical') summary.critical_missing++;
        else if (b.importance === 'recommended') summary.recommended_missing++;
        else summary.optional_missing++;
      }
    }

    res.json({
      summary,
      filters: {
        importance: filterImportance,
        category: filterCategory,
        include_optional: includeOptional,
      },
      by_category: cats,
      generated_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/pricing/benchmarks
// Liste des benchmarks sectoriels pour l'Atelier de composition.
// Query : ?category=sourcing&importance=critical
// ═══════════════════════════════════════════════════════════════════
router.get('/benchmarks', authenticate, async (req, res, next) => {
  try {
    const where = ['is_active = TRUE'];
    const params = [];
    let pi = 0;
    if (req.query.category) {
      params.push(req.query.category);
      where.push(`category = $${++pi}`);
    }
    if (req.query.importance) {
      params.push(req.query.importance);
      where.push(`importance = $${++pi}`);
    }
    const sql = `
      SELECT id, key, label, emoji, category, unit,
             benchmark_median, benchmark_min, benchmark_max,
             importance, why, source_benchmark, applies_to, display_order
      FROM pricing_benchmarks
      WHERE ${where.join(' AND ')}
      ORDER BY category, display_order, label
    `;
    const { rows } = await db.query(sql, params);
    res.json({ count: rows.length, benchmarks: rows });
  } catch (err) {
    // Table peut ne pas exister si migration 039 pas passée
    if (err.code === '42P01') {
      return res.json({ count: 0, benchmarks: [], warning: 'Table pricing_benchmarks absente — migration 039 requise' });
    }
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/pricing/dashboard
//
// Vue de pilotage pricing — détection des incohérences en temps réel.
// Calcule pour chaque produit actif son CDR + verdict, puis agrège
// en KPIs et alertes.
//
// Réponse :
// {
//   kpis: {
//     marge_moyenne_pct, marge_cible_pct, ecart_pct,
//     nb_aligned, nb_underpriced, nb_overpriced, nb_unset, nb_loss,
//     couverture_cost_pct,
//     last_config_change_at
//   },
//   alerts: [
//     { severity: 'critical'|'warning'|'info', code: '...', message: '...', count?, products?: [...] }
//   ]
// }
// ═══════════════════════════════════════════════════════════════════
router.get('/dashboard', authenticate, async (req, res, next) => {
  try {
    // 1. Récupérer la cible marge depuis finance_config
    const { rows: [fc] } = await db.query(
      'SELECT target_marge_brute_pct, taux_aed_kmf, taux_change_eur_kmf, fret_eur_per_m3, objectif_commandes_mois FROM finance_config WHERE id = 1'
    );
    const margeCiblePct = Number(fc?.target_marge_brute_pct) || 40;

    // 2. Charger configurations
    const [catsRes, compRes, provRes, chargesRes] = await Promise.all([
      db.query('SELECT * FROM customs_categories WHERE is_active = TRUE'),
      db.query('SELECT * FROM pricing_components WHERE is_active = TRUE'),
      db.query('SELECT * FROM risk_provisions WHERE is_active = TRUE'),
      db.query('SELECT * FROM charges WHERE is_active = TRUE'),
    ]);
    const cats = {};
    catsRes.rows.forEach(c => { cats[c.key] = c; });

    // 3. Niveau 2 (constant pour tous)
    const taxAED = Number(fc?.taux_aed_kmf) || 138;
    const taxEUR = Number(fc?.taux_change_eur_kmf) || 492;
    const fretEur = Number(fc?.fret_eur_per_m3) || 180;
    const totalMensuel = chargesRes.rows
      .filter(c => c.recurrence_period === 'monthly')
      .reduce((s, c) => s + Number(c.amount_kmf), 0);
    const totalHebdo = chargesRes.rows
      .filter(c => c.recurrence_period === 'weekly')
      .reduce((s, c) => s + Number(c.amount_kmf), 0);
    const totalPerOrder = chargesRes.rows
      .filter(c => c.recurrence_period === 'per_order')
      .reduce((s, c) => s + Number(c.amount_kmf), 0);
    const volume = Number(fc?.objectif_commandes_mois) || 100;
    const niveau2 = Math.round((totalMensuel + totalHebdo * 4.33) / volume + totalPerOrder);

    // 4. Charger tous les produits actifs
    const { rows: products } = await db.query(
      `SELECT id, name, category, price_kmf, cost_kmf, weight_kg
         FROM products WHERE is_active = TRUE`
    );

    // 5. Calculer CDR + verdict pour chaque produit
    const verdicts = [];
    const productsAtLoss = [];   // prix actuel < CDR
    const productsCritical = []; // marge < 10%
    const margesByCategory = {};
    let nbAligned = 0, nbUnder = 0, nbOver = 0, nbUnset = 0;
    let totalMargeEffective = 0, totalProduitsAvecPrix = 0;

    for (const p of products) {
      const category = p.category || 'phones';
      const cat = cats[category];
      const margeCibleProd = cat?.default_margin_pct
        ? Number(cat.default_margin_pct) / 100
        : margeCiblePct / 100;

      const prixAchatKmf = Number(p.cost_kmf) || 0;
      const volM3 = 0.005;
      const fretKmf = volM3 * fretEur * taxEUR;
      let n1 = prixAchatKmf + fretKmf;

      for (const c of compRes.rows) {
        const v = Number(c.default_value);
        const a = c.applies_to || 'all';
        if (a !== 'all' && !a.startsWith('category:' + category)) continue;
        switch (c.unit) {
          case 'pct':         n1 += n1 * (v / 100); break;
          case 'kmf':         n1 += v; break;
          case 'kmf_per_kg':  n1 += v * (Number(p.weight_kg) || 1); break;
          case 'kmf_per_m3':  n1 += v * volM3; break;
          case 'aed':         n1 += v * taxAED; break;
          case 'eur':         n1 += v * taxEUR; break;
        }
      }
      if (cat) {
        const base = prixAchatKmf + fretKmf;
        n1 += base * Number(cat.douane_pct) / 100;
        n1 += base * Number(cat.tva_pct) / 100;
        n1 += base * Number(cat.taxe_add_pct) / 100;
      }

      const baseProv = n1 + niveau2;
      let n3 = 0;
      for (const pr of provRes.rows) {
        n3 += baseProv * (Number(pr.rate_pct) / 100);
      }

      const cdr = Math.round(n1 + niveau2 + n3);
      const prixCalcule = Math.round(cdr / (1 - margeCibleProd));
      const prixActuel = Number(p.price_kmf) || 0;

      // Marge effective
      let margeEff = null;
      if (prixActuel > 0) {
        margeEff = Math.round((1 - cdr / prixActuel) * 1000) / 10;
        totalMargeEffective += margeEff;
        totalProduitsAvecPrix++;

        if (!margesByCategory[category]) margesByCategory[category] = { sum: 0, count: 0 };
        margesByCategory[category].sum += margeEff;
        margesByCategory[category].count++;
      }

      // Verdict
      let status;
      if (prixActuel <= 0) { status = 'unset'; nbUnset++; }
      else {
        const ecart = (prixActuel - prixCalcule) / prixCalcule;
        if (Math.abs(ecart) <= 0.05) { status = 'aligned'; nbAligned++; }
        else if (ecart < 0) { status = 'underpriced'; nbUnder++; }
        else { status = 'overpriced'; nbOver++; }
      }

      // Détections critiques
      if (prixActuel > 0 && prixActuel < cdr) {
        productsAtLoss.push({ id: p.id, name: p.name, price_kmf: prixActuel, cdr_kmf: cdr, gap_kmf: cdr - prixActuel });
      } else if (margeEff !== null && margeEff < 10) {
        productsCritical.push({ id: p.id, name: p.name, marge_pct: margeEff, price_kmf: prixActuel });
      }

      verdicts.push({ id: p.id, name: p.name, category, prixActuel, cdr, prixCalcule, status, margeEff });
    }

    // 6. Couverture cost (% produits avec cost_kmf renseigné)
    const nbWithCost = products.filter(p => Number(p.cost_kmf) > 0).length;
    const couvertureCostPct = products.length > 0 ? Math.round(nbWithCost / products.length * 100) : 0;

    // 7. Marge moyenne effective
    const margeMoyEff = totalProduitsAvecPrix > 0
      ? Math.round((totalMargeEffective / totalProduitsAvecPrix) * 10) / 10
      : 0;

    // 8. Catégories avec marge effective sous le seuil critique
    const seuilCritiqueMargePct = 15;
    const categoriesEnDanger = [];
    Object.keys(margesByCategory).forEach(cat => {
      const m = margesByCategory[cat];
      const moy = m.sum / m.count;
      if (moy < seuilCritiqueMargePct) {
        categoriesEnDanger.push({ category: cat, marge_moyenne_pct: Math.round(moy * 10) / 10, nb_produits: m.count });
      }
    });

    // 9. Date dernière modif config (composants ou charges)
    let lastChange = null;
    try {
      const { rows } = await db.query(
        `SELECT GREATEST(
                  COALESCE((SELECT MAX(updated_at) FROM pricing_components), '1970-01-01'),
                  COALESCE((SELECT MAX(updated_at) FROM risk_provisions), '1970-01-01'),
                  COALESCE((SELECT MAX(updated_at) FROM charges), '1970-01-01'),
                  COALESCE((SELECT MAX(updated_at) FROM customs_categories), '1970-01-01')
                ) AS last_change`
      );
      lastChange = rows[0]?.last_change;
    } catch (_) { /* table peut manquer updated_at */ }

    // 10. Construire les alertes
    const alerts = [];
    if (productsAtLoss.length) {
      alerts.push({
        severity: 'critical',
        code: 'sale_at_loss',
        title: 'Produits vendus à perte',
        message: `${productsAtLoss.length} produit(s) ont un prix actuel inférieur à leur coût de revient.`,
        count: productsAtLoss.length,
        products: productsAtLoss.slice(0, 10),
      });
    }
    if (productsCritical.length) {
      alerts.push({
        severity: 'warning',
        code: 'low_margin',
        title: 'Marges faibles',
        message: `${productsCritical.length} produit(s) ont une marge effective inférieure à 10%.`,
        count: productsCritical.length,
        products: productsCritical.slice(0, 10),
      });
    }
    if (categoriesEnDanger.length) {
      alerts.push({
        severity: 'warning',
        code: 'category_low_margin',
        title: 'Catégories sous-rentables',
        message: `${categoriesEnDanger.length} catégorie(s) ont une marge moyenne inférieure à ${seuilCritiqueMargePct}%.`,
        count: categoriesEnDanger.length,
        categories: categoriesEnDanger,
      });
    }
    if (margeMoyEff < margeCiblePct - 10 && totalProduitsAvecPrix > 0) {
      alerts.push({
        severity: 'warning',
        code: 'global_margin_below_target',
        title: 'Marge globale sous la cible',
        message: `La marge moyenne effective est de ${margeMoyEff}% (cible : ${margeCiblePct}%, écart de ${Math.round((margeCiblePct - margeMoyEff) * 10) / 10}%).`,
      });
    }
    if (couvertureCostPct < 80 && products.length > 5) {
      alerts.push({
        severity: 'info',
        code: 'cost_coverage_low',
        title: 'Couverture coûts incomplète',
        message: `Seulement ${couvertureCostPct}% des produits ont un coût d'achat renseigné. Les CDR calculés peuvent être imprécis.`,
        count: products.length - nbWithCost,
      });
    }
    if (nbUnset > 0) {
      alerts.push({
        severity: 'info',
        code: 'unset_prices',
        title: 'Prix de vente non fixés',
        message: `${nbUnset} produit(s) actifs n'ont pas de prix de vente.`,
        count: nbUnset,
      });
    }

    // ── Distributions doctrine (Lot A) ──
    // On appelle le service en mode batch pour chaque produit.
    // Si le service est indisponible ou échoue, doctrine = null (dégradation propre).
    let doctrine = null;
    try {
      const config = await pricingEngine.loadGlobalConfig();
      const dist = {
        by_health: { loss: 0, danger: 0, fragile: 0, healthy: 0, strong: 0, unknown: 0 },
        by_sourcing: { PRIORITY: 0, TEST: 0, WATCH: 0, AVOID: 0, LOSS: 0, RENEGOTIATE: 0, INCREASE_PRICE: 0 },
        by_market: { unknown: 0, testing: 0, validated: 0, scaling: 0, rejected: 0 },
        sample_size: 0,
      };
      for (const p of products) {
        try {
          const reco = await pricingEngine.recommend({
            product_id: p.id,
            category: p.category,
            current_price_kmf: p.price_kmf,
          }, { config });
          if (reco.health_status && dist.by_health[reco.health_status] != null) {
            dist.by_health[reco.health_status]++;
          }
          if (reco.sourcing_decision && dist.by_sourcing[reco.sourcing_decision] != null) {
            dist.by_sourcing[reco.sourcing_decision]++;
          }
          if (reco.market_confidence && dist.by_market[reco.market_confidence] != null) {
            dist.by_market[reco.market_confidence]++;
          }
          dist.sample_size++;
        } catch (errOne) {
          // skip produit en erreur
        }
      }
      doctrine = dist;
    } catch (errCfg) {
      // Service indisponible : doctrine reste null
    }

    res.json({
      kpis: {
        marge_moyenne_pct: margeMoyEff,
        marge_cible_pct: margeCiblePct,
        ecart_cible_pct: Math.round((margeMoyEff - margeCiblePct) * 10) / 10,
        nb_total: products.length,
        nb_aligned: nbAligned,
        nb_underpriced: nbUnder,
        nb_overpriced: nbOver,
        nb_unset: nbUnset,
        nb_at_loss: productsAtLoss.length,
        couverture_cost_pct: couvertureCostPct,
        last_config_change_at: lastChange,
        niveau2_kmf: niveau2,
      },
      alerts,
      doctrine,                  // distribution par health_status / sourcing_decision / market_confidence
      generated_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

module.exports = router;
