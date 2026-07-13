/**
 * @komerce-arch
 * @role          modules
 * @domain        operations
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       fabrics, garment_models, products
 * @db-write      fabrics, garment_models
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  operations
 * @version       2026-06
 */

/**
 * KOMERCE — Modules Spécialisés v7.5
 *
 * Remplace ceremony.js v7.2 — logique générique, non gravée dans le marbre.
 * Un module = un besoin structurellement non couvert ou peu couvert aux Comores.
 *
 * Routes :
 *   GET  /api/modules                   → liste des modules disponibles
 *   GET  /api/modules/:type             → détail d'un module
 *   POST /api/modules/price             → calcul prix pour un module
 *   GET  /api/modules/fabrics           → catalogue tissus (module couture)
 *   GET  /api/modules/models            → catalogue modèles (module couture)
 *   POST /api/modules/fabrics  (admin)  → ajouter tissu
 *   POST /api/modules/models   (admin)  → ajouter modèle
 *
 * Modules actifs :
 *   couture       → tissu + confection sur mesure · mensurations client · atelier Deira
 *   lunettes      → ordonnance transmise → montage Dubai → livraison Mutsamudu
 *   construction  → matériaux finition · carrelage · robinetterie · enduits Dubai (Phase 3)
 *   cosmetiques   → marques Dubai exclusives · introuvables localement (Phase 2)
 *
 * Design : module_type est un champ TEXT libre en DB — aucun ENUM gravé.
 * Ajouter un module = ajouter une entrée ici + une table si nécessaire.
 * Supprimer un module = retirer l'entrée. Zéro migration destructive.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// ─── Registre des modules ─────────────────────────────────────────────────────
//
// Source de vérité des modules actifs. Pas un ENUM PostgreSQL — un objet JS
// modifiable sans migration. Phase indique la disponibilité opérationnelle.
//
const MODULES_REGISTRY = {
  couture: {
    label:       'Couture & Tenues sur mesure',
    emoji:       '✂️',
    phase:       1,
    disponible:  true,
    description: 'Tissu au choix (Wax, Bazin, Dentelle, Mousseline…) + confection Deira selon mensurations client. Retouche légère possible au relais Anjouan.',
    delai_sup_jours: 5,
    besoin_couvert: 'Couture professionnelle sur mesure · tissus haut de gamme indisponibles localement',
    inputs_requis: ['fabric_id', 'module_size'],
    inputs_optionnels: ['module_instructions', 'module_qty_meters', 'module_accessories'],
  },
  lunettes: {
    label:       'Lunettes de vue & Solaires',
    emoji:       '👓',
    phase:       2,
    disponible:  false, // Phase 2 — opticien partenaire Dubai à signer
    description: 'Ordonnance transmise via formulaire ou photo. Sélection monture catalogue Dubai. Montage verres par opticien partenaire. Livraison relais Mutsamudu.',
    delai_sup_jours: 5,
    besoin_couvert: 'Aucun opticien qualifié à Anjouan · verres correcteurs absents du marché local',
    inputs_requis: ['module_instructions'], // ordonnance
    inputs_optionnels: ['module_ref_produit'],
  },
  construction: {
    label:       'Matériaux & Finitions Construction',
    emoji:       '🏗️',
    phase:       3,
    disponible:  false, // Phase 3 — logistique volumineuse
    description: 'Carrelage, robinetterie, enduits, peintures professionnelles Dubai. Commande sur devis avec dimensions précises. Panier élevé, livraison groupée.',
    delai_sup_jours: 14,
    besoin_couvert: 'Matériaux de finition qualité absents du marché local · diaspora investit dans l\'immobilier',
    inputs_requis: ['module_instructions'], // dimensions + devis
    inputs_optionnels: [],
  },
  cosmetiques: {
    label:       'Cosmétiques & Parfums — Marques Dubai',
    emoji:       '💄',
    phase:       2,
    disponible:  false, // Phase 2 — accord exclusivité fournisseur à signer
    description: 'Marques de soins, parfums oud, cosmétiques professionnels fabriqués à Dubai. Introuvables aux Comores. Accord exclusivité distribution Comores.',
    delai_sup_jours: 0,
    besoin_couvert: 'Marché local limité aux produits génériques · marques professionnelles Dubai absentes',
    inputs_requis: [],
    inputs_optionnels: ['module_ref_produit'],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const { getRates } = require('../utils/rates');
const { validate } = require('../middleware/validate');
const { modules } = require('../validators');

// ─── GET /api/modules ─────────────────────────────────────────────────────────
// Liste tous les modules avec leur statut de disponibilité

router.get('/', (req, res) => {
  const modules = Object.entries(MODULES_REGISTRY).map(([type, m]) => ({
    type,
    label:        m.label,
    emoji:        m.emoji,
    phase:        m.phase,
    disponible:   m.disponible,
    description:  m.description,
    besoin_couvert: m.besoin_couvert,
    delai_sup_jours: m.delai_sup_jours,
  }));
  res.json({ modules, total: modules.length });
});

// ─── GET /api/modules/fabrics ─────────────────────────────────────────────────
// Catalogue tissus pour le module couture
// Filtres optionnels : ?fabric_type=Wax&available=true

router.get('/fabrics', async (req, res, next) => {
  try {
    const { fabric_type } = req.query;
    const conditions = [];
    const params     = [];
    let   pi         = 1;

    conditions.push(`(
      CASE WHEN f.is_available IS NOT NULL THEN f.is_available = TRUE
           ELSE f.active = TRUE
      END
    )`);

    if (fabric_type) {
      conditions.push(`f.fabric_type = $${pi++}`);
      params.push(fabric_type);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT
         f.id, f.name, f.material,
         f.fabric_type,
         f.price_per_meter_aed,
         f.price_per_meter_kmf,
         f.price_per_yard_kmf,
         f.min_order_meters,
         f.stock_meters,
         f.colors, f.occasions,
         f.image_url,
         f.is_available,
         f.sort_order
       FROM fabrics f
       ${where}
       ORDER BY
         COALESCE(f.sort_order, 999) ASC,
         f.name ASC`,
      params
    );

    res.json(rows);
  } catch(e) { next(e); }
});

// ─── GET /api/modules/models ──────────────────────────────────────────────────
// Catalogue modèles tenues pour le module couture

router.get('/models', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT
         id, name, making_cost_aed, fabric_meters,
         occasions, sizes_available, image_url
       FROM garment_models
       WHERE active = TRUE
       ORDER BY name ASC`
    );
    res.json(rows);
  } catch(e) { next(e); }
});

// ─── GET /api/modules/:type ───────────────────────────────────────────────────
// Détail d'un module spécifique

router.get('/:type', (req, res) => {
  const module = MODULES_REGISTRY[req.params.type];
  if (!module) {
    return res.status(404).json({
      error: `Module inconnu : ${req.params.type}`,
      modules_disponibles: Object.keys(MODULES_REGISTRY),
    });
  }
  res.json({ type: req.params.type, ...module });
});

// ─── POST /api/modules/price ──────────────────────────────────────────────────
// Calcul prix pour n'importe quel module
//
// Body commun :
//   module_type       → 'couture' | 'lunettes' | 'construction' | 'cosmetiques' | ...
//   qty               → quantité (défaut 1)
//   is_diaspora       → boolean (pour conversion EUR)
//
// Body module couture :
//   module_order_type → 'ready_made' | 'fabric_only' | 'custom_from_fabric'
//   fabric_id         → UUID tissu (fabric_only, custom_from_fabric)
//   model_id          → UUID modèle (custom_from_fabric)
//   product_id        → UUID produit (ready_made)
//   qty_meters        → quantité mètres (fabric_only)
//   accessories       → [] (fabric_only)
//
// Body module lunettes :
//   module_instructions → description ordonnance (texte libre)
//   module_ref_produit  → référence monture si connue
//
// Body module construction / cosmetiques :
//   module_instructions → description besoin / dimensions
//   Prix = devis — retourne estimation indicative

router.post('/price', validate(modules.calculatePrice), async (req, res, next) => {
  try {
    const {
      module_type,
      qty          = 1,
      is_diaspora  = false,
      // Couture
      module_order_type,
      fabric_id,
      model_id,
      product_id,
      qty_meters,
      accessories  = [],
      // Tous modules
      module_instructions,
    } = req.body;

    if (!module_type) {
      return res.status(400).json({
        error: 'module_type requis',
        valeurs_acceptees: Object.keys(MODULES_REGISTRY),
      });
    }

    const moduleDef = MODULES_REGISTRY[module_type];
    if (!moduleDef) {
      return res.status(400).json({
        error: `module_type invalide : ${module_type}`,
        valeurs_acceptees: Object.keys(MODULES_REGISTRY),
      });
    }

    const rates = await getRates();

    // ── Module COUTURE ────────────────────────────────────────────────────────
    if (module_type === 'couture') {
      if (!module_order_type) {
        return res.status(400).json({
          error: 'module_order_type requis pour le module couture',
          valeurs: ['ready_made', 'fabric_only', 'custom_from_fabric'],
        });
      }

      // Sous-type : ready_made → prix produit fixe
      if (module_order_type === 'ready_made') {
        if (!product_id) return res.status(400).json({ error: 'product_id requis pour ready_made' });
        const { rows: [product] } = await db.query(
          'SELECT id, name, price_kmf FROM products WHERE id = $1 AND is_active = TRUE',
          [product_id]
        );
        if (!product) return res.status(404).json({ error: 'Produit introuvable' });
        const total_kmf = product.price_kmf * qty;
        return res.json({
          module_type,
          module_order_type,
          unit_price_kmf: product.price_kmf,
          total_kmf,
          total_eur: parseFloat((total_kmf / rates.eur_kmf).toFixed(2)),
          qty,
          delai_sup_jours: moduleDef.delai_sup_jours,
          detail: { product_name: product.name },
        });
      }

      // Sous-type : fabric_only → tissu × mètres + accessoires
      if (module_order_type === 'fabric_only') {
        if (!fabric_id)   return res.status(400).json({ error: 'fabric_id requis pour fabric_only' });
        if (!qty_meters)  return res.status(400).json({ error: 'qty_meters requis pour fabric_only' });
        const { rows: [fabric] } = await db.query('SELECT * FROM fabrics WHERE id = $1', [fabric_id]);
        if (!fabric) return res.status(404).json({ error: 'Tissu introuvable' });

        const price_kmf_per_m = fabric.price_per_meter_kmf
          || Math.round(parseFloat(fabric.price_per_meter_aed) * rates.aed_kmf);
        const tissu_kmf  = price_kmf_per_m * parseFloat(qty_meters);
        const acc_kmf    = accessories.length * tissu_kmf * 0.10;
        const total_kmf  = Math.round(tissu_kmf + acc_kmf);

        return res.json({
          module_type,
          module_order_type,
          price_per_meter_kmf: price_kmf_per_m,
          qty_meters:    parseFloat(qty_meters),
          tissu_kmf:     Math.round(tissu_kmf),
          accessories_kmf: Math.round(acc_kmf),
          total_kmf,
          total_eur:     parseFloat((total_kmf / rates.eur_kmf).toFixed(2)),
          delai_sup_jours: moduleDef.delai_sup_jours,
          detail: { fabric_name: fabric.name, fabric_type: fabric.fabric_type },
        });
      }

      // Sous-type : custom_from_fabric → tissu + confection
      if (module_order_type === 'custom_from_fabric') {
        if (!fabric_id) return res.status(400).json({ error: 'fabric_id requis pour custom_from_fabric' });
        if (!model_id)  return res.status(400).json({ error: 'model_id requis pour custom_from_fabric' });

        const [fabricRes, modelRes] = await Promise.all([
          db.query('SELECT * FROM fabrics WHERE id = $1', [fabric_id]),
          db.query('SELECT * FROM garment_models WHERE id = $1', [model_id]),
        ]);
        const fabric = fabricRes.rows[0];
        const model  = modelRes.rows[0];
        if (!fabric) return res.status(404).json({ error: 'Tissu introuvable' });
        if (!model)  return res.status(404).json({ error: 'Modèle introuvable' });

        // calcPrixTenue supprimée (I-08) — passer par pricingEngine.recommend()
        const prixAchatAed = parseFloat(fabric.price_per_meter_aed) * parseFloat(model.fabric_meters)
          + parseFloat(model.making_cost_aed);
        const channel = is_diaspora ? 'diaspora' : 'cash_relais';
        // O7.3 (provider economic-engine) : import nommé minimal — seule
        // recommend() est consommée (ownership confirmé O7.1, boundary
        // formalisée O7.3). Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
        const { recommend } = require('../services/pricing-engine');
        const result = await recommend({
          virtual:   true,
          price_aed: prixAchatAed,
          category:  'couture',
          qty:       parseInt(qty),
          channel,
        });

        return res.json({
          module_type,
          module_order_type,
          ...result,
          delai_sup_jours: moduleDef.delai_sup_jours,
          detail: {
            fabric_name:       fabric.name,
            fabric_type:       fabric.fabric_type,
            model_name:        model.name,
            metrage_par_tenue: model.fabric_meters,
            confection_aed:    model.making_cost_aed,
            qty,
          },
        });
      }

      return res.status(400).json({
        error: 'module_order_type invalide pour couture',
        valeurs: ['ready_made', 'fabric_only', 'custom_from_fabric'],
      });
    }

    // ── Module LUNETTES ───────────────────────────────────────────────────────
    if (module_type === 'lunettes') {
      // Prix indicatif — devis réel à établir après réception ordonnance
      // Fourchette estimée : monture 80-200 AED + verres selon correction
      const fourchette_min_kmf = Math.round(80  * rates.aed_kmf);
      const fourchette_max_kmf = Math.round(250 * rates.aed_kmf);
      return res.json({
        module_type,
        disponible:       moduleDef.disponible,
        phase:            moduleDef.phase,
        fourchette_min_kmf,
        fourchette_max_kmf,
        fourchette_min_eur: parseFloat((fourchette_min_kmf / rates.eur_kmf).toFixed(2)),
        fourchette_max_eur: parseFloat((fourchette_max_kmf / rates.eur_kmf).toFixed(2)),
        delai_sup_jours:  moduleDef.delai_sup_jours,
        note: 'Prix définitif après réception et analyse de l\'ordonnance. Fourchette indicative sans verres progressifs.',
        instructions: module_instructions || null,
      });
    }

    // ── Module CONSTRUCTION ───────────────────────────────────────────────────
    if (module_type === 'construction') {
      return res.json({
        module_type,
        disponible:  moduleDef.disponible,
        phase:       moduleDef.phase,
        note:        'Commande sur devis. Transmettez dimensions et références souhaitées. Délai devis : 48-72h.',
        delai_sup_jours: moduleDef.delai_sup_jours,
        instructions: module_instructions || null,
      });
    }

    // ── Module COSMETIQUES ────────────────────────────────────────────────────
    if (module_type === 'cosmetiques') {
      return res.json({
        module_type,
        disponible:  moduleDef.disponible,
        phase:       moduleDef.phase,
        note:        'Catalogue marques Dubai en cours de constitution. Disponible Phase 2.',
        delai_sup_jours: moduleDef.delai_sup_jours,
      });
    }

    // ── Module inconnu mais dans le registre → retour générique ──────────────
    return res.json({
      module_type,
      disponible:  moduleDef.disponible,
      phase:       moduleDef.phase,
      note:        `Module ${module_type} — calcul de prix non encore implémenté.`,
      delai_sup_jours: moduleDef.delai_sup_jours,
    });

  } catch(e) { next(e); }
});

// ─── POST /api/modules/fabrics (admin) ───────────────────────────────────────
// Ajouter un tissu au catalogue couture

router.post('/fabrics', authenticate, requireRole(['admin']), validate(modules.createFabric), async (req, res, next) => {
  try {
    const {
      name,
      material,
      price_per_meter_aed,
      fabric_type,
      min_order_meters = 1.0,
      stock_meters,
      colors           = [],
      occasions        = [],
      image_url,
      sort_order       = 0,
    } = req.body;

    if (!name)                return res.status(400).json({ error: 'name requis' });
    if (!price_per_meter_aed) return res.status(400).json({ error: 'price_per_meter_aed requis' });

    const parsedPrice = parseFloat(price_per_meter_aed);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ error: 'price_per_meter_aed doit être un nombre positif' });
    }

    const rates = await getRates();
    const price_per_meter_kmf  = Math.round(parsedPrice * rates.aed_kmf);
    const price_per_yard_kmf   = Math.round(price_per_meter_kmf * 0.9144);

    const { rows: [fabric] } = await db.query(
      `INSERT INTO fabrics (
         name, material, price_per_meter_aed,
         fabric_type, price_per_meter_kmf, price_per_yard_kmf,
         min_order_meters, stock_meters,
         colors, occasions, image_url,
         is_available, sort_order, active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,TRUE)
       RETURNING *`,
      [
        name, material || null, parsedPrice,
        fabric_type || null, price_per_meter_kmf, price_per_yard_kmf,
        min_order_meters, stock_meters || null,
        colors, occasions, image_url || null,
        sort_order,
      ]
    );

    res.status(201).json(fabric);
  } catch(e) { next(e); }
});

// ─── POST /api/modules/models (admin) ────────────────────────────────────────
// Ajouter un modèle de tenue au catalogue couture

router.post('/models', authenticate, requireRole(['admin']), validate(modules.createModel), async (req, res, next) => {
  try {
    const {
      name,
      making_cost_aed,
      fabric_meters,
      occasions       = [],
      sizes_available = ['S', 'M', 'L', 'XL', 'XXL'],
      image_url,
    } = req.body;

    if (!name || !making_cost_aed || !fabric_meters) {
      return res.status(400).json({ error: 'name, making_cost_aed et fabric_meters requis' });
    }

    const { rows: [model] } = await db.query(
      `INSERT INTO garment_models
         (name, making_cost_aed, fabric_meters, occasions, sizes_available, image_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [name, making_cost_aed, fabric_meters, occasions, sizes_available, image_url || null]
    );

    res.status(201).json(model);
  } catch(e) { next(e); }
});

module.exports = router;
module.exports.MODULES_REGISTRY = MODULES_REGISTRY;
