/**
 * @komerce-arch
 * @role          catalog-product-sku-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, variant_combo, sku_payload
 * @outputs       product_sku_row, sku_candidates, sku_readiness_audit
 * @depends       none
 * @used-by       services/product-admin-service.js, routes/orders/create.js (via product-admin-service.js), routes/products.js (via product-admin-service.js)
 * @db-read       product_skus, product_variants, products
 * @db-write      product_skus
 * @db-txn        none
 * @doctrine      docs/specs/DECISION_MODELE_STOCK_SKU.md
 * @impact-areas  catalog, admin-dashboard, orders
 * @version       2026-08 (extrait de product-admin-service.js, domaine 3/5)
 */

'use strict';

/**
 * product-sku-service.js
 *
 * Sous-domaine SKU extrait de services/product-admin-service.js (domaine
 * 3/5). Cf. docs/specs/DECISION_MODELE_STOCK_SKU.md. Ces fonctions
 * lisent/écrivent EXCLUSIVEMENT product_skus. Elles ne touchent jamais
 * products.stock ni product_variants.stock, et n'exigent PAS
 * inventory_model = 'SKU' — un produit prépare ses SKU pendant qu'il reste
 * LEGACY_VARIANTS ; la bascule (Lot 5) est un acte séparé, atomique, jamais
 * déduit d'ici.
 *
 * ⚠️ resolveSellableUnit() N'A PAS bougé : il reste dans
 * product-admin-service.js (primitive canonique GAP-07 utilisée par
 * routes/orders/create.js et services/shared-cart-creation.js — contrat
 * protégé). product-admin-service.js importe resolveActiveSku et
 * canonicalizeVariantCombo depuis ce module pour l'implémenter ; ce module,
 * lui, ne dépend d'aucune fonction de product-admin-service.js (aucune
 * dépendance circulaire).
 *
 * Exports :
 *   canonicalizeVariantCombo(combo)         → objet normalisé ou null
 *   resolveActiveSku(dbClient, productId, comboRaw) → sku row | null
 *   getSkuCandidates(dbPool, productId)     → { axes, candidates, ... }
 *   upsertProductSku(dbPool, productId, payload) → { message, sku }
 *   deactivateProductSku(dbPool, productId, skuId) → { status, body }
 *   auditProductSkuReadiness(dbPool, productId)    → { ready, reasons, ... }
 */

// ── SKU (Lot 1 — préparation/déclaration) ───────────────────────────────────
// Cf. docs/specs/DECISION_MODELE_STOCK_SKU.md. Ces fonctions lisent/écrivent
// EXCLUSIVEMENT product_skus. Elles ne touchent jamais products.stock ni
// product_variants.stock, et n'exigent PAS inventory_model = 'SKU' — un
// produit prépare ses SKU pendant qu'il reste LEGACY_VARIANTS ; la bascule
// (Lot 5) est un acte séparé, atomique, jamais déduit d'ici.

/**
 * Normalise un variant_combo : clés triées, valeurs non vides, ou null
 * pour le SKU par défaut. Lève une erreur 400 sur toute forme invalide.
 */
function _canonicalCombo(combo) {
  if (combo === null || combo === undefined) return null;
  if (typeof combo !== 'object' || Array.isArray(combo)) {
    const e = new Error('variant_combo doit être un objet {type: value} ou null'); e.status = 400; throw e;
  }
  const keys = Object.keys(combo);
  if (keys.length === 0) {
    const e = new Error('variant_combo ne peut pas être un objet vide — utilisez null pour un SKU par défaut');
    e.status = 400; throw e;
  }
  const out = {};
  for (const k of keys.sort()) {
    const v = combo[k];
    if (typeof v !== 'string' || v.trim().length === 0) {
      const e = new Error(`variant_combo.${k} doit être une chaîne non vide`); e.status = 400; throw e;
    }
    out[k.trim()] = v.trim();
  }
  return out;
}

/**
 * Résout le SKU actif correspondant à une combinaison (ou au SKU par défaut
 * si combo est null/undefined) pour un produit. Lecture seule.
 *
 * Lot 3 (cf. DECISION_MODELE_STOCK_SKU.md §D) : point d'entrée unique utilisé
 * par la création de commande pour les produits en inventory_model = 'SKU'.
 * Ne fait AUCUNE supposition sur inventory_model — c'est à l'appelant de
 * décider s'il doit passer par ce chemin (la bascule reste explicite, portée
 * par l'appelant, jamais déduite ici).
 *
 * @returns {object|null} { id, sku, stock, price_kmf } ou null si aucun SKU
 *   actif ne correspond à cette combinaison pour ce produit.
 */
async function resolveActiveSku(dbClient, productId, comboRaw) {
  const combo = _canonicalCombo(comboRaw ?? null);

  const { rows: [row] } = await dbClient.query(
    combo === null
      ? `SELECT id, sku, stock, price_kmf FROM product_skus
          WHERE product_id = $1 AND variant_combo IS NULL AND is_active = true`
      : `SELECT id, sku, stock, price_kmf FROM product_skus
          WHERE product_id = $1 AND variant_combo = $2::jsonb AND is_active = true`,
    combo === null ? [productId] : [productId, JSON.stringify(combo)]
  );

  return row || null;
}

/**
 * Liste les combinaisons possibles (produit cartésien des axes déclarés dans
 * product_variants) croisées avec les SKU déjà déclarés dans product_skus.
 * Lecture seule.
 */
async function getSkuCandidates(dbPool, productId) {
  const { rows: [product] } = await dbPool.query(
    'SELECT id, name, has_variants, inventory_model FROM products WHERE id = $1',
    [productId]
  );
  if (!product) { const e = new Error('Produit introuvable'); e.status = 404; throw e; }

  const { rows: declared } = await dbPool.query(
    `SELECT id, sku, variant_combo, stock, price_kmf, is_active, created_at, updated_at
       FROM product_skus WHERE product_id = $1
       ORDER BY variant_combo NULLS FIRST, created_at`,
    [productId]
  );

  if (!product.has_variants) {
    const existing = declared.find(s => s.variant_combo === null) || null;
    return {
      product_id: product.id, product_name: product.name,
      has_variants: false, inventory_model: product.inventory_model,
      axes: [], candidates: [{ variant_combo: null, declared: !!existing, sku: existing }],
      declared_count: declared.length,
    };
  }

  const { rows: variantRows } = await dbPool.query(
    `SELECT variant_type, variant_value FROM product_variants
      WHERE product_id = $1 ORDER BY variant_type, display_order, variant_value`,
    [productId]
  );

  const axesMap = new Map();
  for (const r of variantRows) {
    if (!axesMap.has(r.variant_type)) axesMap.set(r.variant_type, []);
    axesMap.get(r.variant_type).push(r.variant_value);
  }
  const axes = [...axesMap.entries()].map(([type, values]) => ({ type, values }));

  // Produit cartésien des axes — garde-fou anti-explosion combinatoire.
  let combos = [{}];
  for (const axis of axes) {
    const next = [];
    for (const base of combos) {
      for (const value of axis.values) next.push({ ...base, [axis.type]: value });
    }
    combos = next;
    if (combos.length > 500) {
      const e = new Error(
        `Trop de combinaisons possibles (${combos.length}+) — réduisez le nombre d'axes/valeurs avant de préparer les SKU`
      );
      e.status = 409; throw e;
    }
  }

  const declaredByKey = new Map();
  for (const row of declared) {
    if (row.variant_combo !== null) {
      declaredByKey.set(JSON.stringify(_canonicalCombo(row.variant_combo)), row);
    }
  }

  const candidates = combos.map(combo => {
    const canonical = _canonicalCombo(combo);
    const existing = declaredByKey.get(JSON.stringify(canonical)) || null;
    return { variant_combo: canonical, declared: !!existing, sku: existing };
  });

  return {
    product_id: product.id, product_name: product.name,
    has_variants: true, inventory_model: product.inventory_model,
    axes, candidates,
    candidate_count: candidates.length,
    declared_count: declared.filter(s => s.variant_combo !== null).length,
  };
}

/**
 * Déclare ou met à jour un SKU (upsert par combinaison, ou SKU par défaut
 * si variant_combo est null). N'exige pas inventory_model = 'SKU'.
 */
async function upsertProductSku(dbPool, productId, payload = {}) {
  const { rows: [product] } = await dbPool.query(
    'SELECT id, name, has_variants FROM products WHERE id = $1',
    [productId]
  );
  if (!product) { const e = new Error('Produit introuvable'); e.status = 404; throw e; }

  const combo = _canonicalCombo(payload.variant_combo ?? null);

  if (product.has_variants && combo === null) {
    const e = new Error("Ce produit a des variantes déclarées — variant_combo est obligatoire (pas de SKU par défaut)");
    e.status = 400; throw e;
  }
  if (!product.has_variants && combo !== null) {
    const e = new Error("Ce produit n'a pas de variantes — variant_combo doit être null (SKU par défaut uniquement)");
    e.status = 400; throw e;
  }

  if (typeof payload.stock !== 'number' || !Number.isInteger(payload.stock) || payload.stock < 0) {
    const e = new Error('stock est obligatoire — entier >= 0'); e.status = 400; throw e;
  }
  if (payload.price_kmf !== undefined && payload.price_kmf !== null &&
      (typeof payload.price_kmf !== 'number' || payload.price_kmf < 0)) {
    const e = new Error('price_kmf invalide — entier >= 0 ou null'); e.status = 400; throw e;
  }

  // Un combo précis ne peut référencer que des couples type/valeur qui
  // existent réellement dans les axes déclarés — on ne peut pas inventer
  // un SKU hors du catalogue de variantes.
  if (combo !== null) {
    for (const [type, value] of Object.entries(combo)) {
      const { rows: [match] } = await dbPool.query(
        `SELECT 1 FROM product_variants
          WHERE product_id = $1 AND variant_type = $2 AND variant_value = $3`,
        [productId, type, value]
      );
      if (!match) {
        const e = new Error(`variant_combo invalide : ${type}=${value} n'existe pas dans les axes déclarés pour ce produit`);
        e.status = 400; throw e;
      }
    }
  }

  const isActive = payload.is_active !== undefined ? !!payload.is_active : true;
  const skuLabel = payload.sku ? (String(payload.sku).trim() || null) : null;
  const conflictClause = combo === null
    ? 'ON CONFLICT (product_id) WHERE variant_combo IS NULL'
    : 'ON CONFLICT (product_id, variant_combo) WHERE variant_combo IS NOT NULL';

  const { rows: [row] } = await dbPool.query(
    `INSERT INTO product_skus (product_id, sku, variant_combo, stock, price_kmf, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ${conflictClause}
     DO UPDATE SET sku = EXCLUDED.sku, stock = EXCLUDED.stock,
                   price_kmf = EXCLUDED.price_kmf, is_active = EXCLUDED.is_active
     RETURNING *`,
    [productId, skuLabel, combo === null ? null : JSON.stringify(combo), payload.stock, payload.price_kmf ?? null, isActive]
  );

  return { message: `SKU ${row.sku || row.id} enregistré pour "${product.name}"`, sku: row };
}

/**
 * Désactive un SKU (soft — jamais de DELETE, cohérent avec la doctrine
 * "produit désactivé, non supprimé" appliquée ailleurs au catalogue).
 */
async function deactivateProductSku(dbPool, productId, skuId) {
  const { rows: [row] } = await dbPool.query(
    `UPDATE product_skus SET is_active = false
      WHERE id = $1 AND product_id = $2
      RETURNING id, sku, variant_combo, is_active`,
    [skuId, productId]
  );
  if (!row) return { status: 404, body: { error: 'SKU introuvable pour ce produit' } };
  return { status: 200, body: { message: 'SKU désactivé', sku: row } };
}

/**
 * Audit READY / NOT_READY — conditions nécessaires avant que le Lot 5 puisse
 * basculer products.inventory_model vers 'SKU'. Lecture seule, ne modifie
 * jamais inventory_model (la bascule reste un acte explicite séparé).
 */
async function auditProductSkuReadiness(dbPool, productId) {
  const { rows: [product] } = await dbPool.query(
    'SELECT id, name, has_variants, inventory_model FROM products WHERE id = $1',
    [productId]
  );
  if (!product) { const e = new Error('Produit introuvable'); e.status = 404; throw e; }

  if (product.inventory_model === 'SKU') {
    return { product_id: product.id, ready: true, already_sku: true, reasons: ['Déjà en mode SKU'] };
  }

  const reasons = [];

  if (!product.has_variants) {
    const { rows: [defaultSku] } = await dbPool.query(
      `SELECT id, stock, is_active FROM product_skus WHERE product_id = $1 AND variant_combo IS NULL`,
      [productId]
    );
    if (!defaultSku) reasons.push('Aucun SKU par défaut déclaré pour ce produit sans variantes');
    else if (!defaultSku.is_active) reasons.push('Le SKU par défaut existe mais est désactivé');
    return {
      product_id: product.id, ready: reasons.length === 0, reasons,
      active_sku_count: (defaultSku && defaultSku.is_active) ? 1 : 0,
    };
  }

  const { rows: activeSkus } = await dbPool.query(
    `SELECT id, variant_combo FROM product_skus
      WHERE product_id = $1 AND is_active = true AND variant_combo IS NOT NULL`,
    [productId]
  );
  if (activeSkus.length === 0) {
    reasons.push('Aucun SKU actif déclaré pour ce produit à variantes');
  }

  // SKU actifs qui référencent des couples type/valeur qui n'existent plus
  // dans product_variants (axe modifié après déclaration du SKU).
  const { rows: axisRows } = await dbPool.query(
    `SELECT variant_type, variant_value FROM product_variants WHERE product_id = $1`,
    [productId]
  );
  const axisSet = new Set(axisRows.map(r => `${r.variant_type}::${r.variant_value}`));
  const orphaned = [];
  for (const row of activeSkus) {
    for (const [type, value] of Object.entries(row.variant_combo || {})) {
      if (!axisSet.has(`${type}::${value}`)) orphaned.push({ sku_id: row.id, type, value });
    }
  }
  if (orphaned.length > 0) {
    reasons.push(`${orphaned.length} SKU actif(s) référencent des valeurs d'axe qui n'existent plus`);
  }

  return {
    product_id: product.id,
    ready: reasons.length === 0,
    reasons,
    active_sku_count: activeSkus.length,
    orphaned,
  };
}

module.exports = {
  canonicalizeVariantCombo: _canonicalCombo,
  resolveActiveSku,
  getSkuCandidates,
  upsertProductSku,
  deactivateProductSku,
  auditProductSkuReadiness,
};
