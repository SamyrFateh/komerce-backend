/**
 * @komerce-arch
 * @role          csv-connector
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  catalog, product-discovery
 * @version       2026-06
 */

/**
 * KOMERCE — CSV Connector
 * ═══════════════════════════════════════════════════════════════════
 *
 * Connecteur fonctionnel : parse un CSV brut en NormalizedSupplierProduct[].
 *
 * Première ligne = headers. Séparateur , ou ; auto-détecté.
 * Mapping flexible : reconnait les noms de colonnes courants en FR + EN.
 * Mapping custom possible via paramètre.
 *
 * Aucune dépendance externe (pas de papaparse) — parsing simple
 * suffisant pour des catalogues d'admin (pas de virgules dans les valeurs).
 * Si tu as des CSV plus complexes (virgules dans les noms de produit,
 * échappements multi-lignes…), passer à papaparse plus tard.
 */

'use strict';

const { partitionValid } = require('../normalized-product');

// Mapping par défaut : alias -> nom canonique de NormalizedSupplierProduct
const DEFAULT_HEADER_ALIASES = {
  product_name:        ['name', 'product_name', 'titre', 'title', 'nom', 'product', 'designation'],
  supplier_category:   ['category', 'cat', 'categorie', 'catégorie', 'supplier_category', 'family', 'famille'],
  purchase_price:      ['price', 'cost', 'purchase_price', 'prix', 'prix_achat', 'unit_price'],
  currency:            ['currency', 'devise', 'cur'],
  image_url:           ['image', 'image_url', 'photo', 'img', 'picture'],
  product_url:         ['url', 'product_url', 'link', 'lien'],
  description:         ['description', 'desc', 'detail', 'details'],
  stock_available:     ['stock', 'qty', 'quantity', 'available', 'inventory'],
  min_order_qty:       ['moq', 'min_order', 'min_qty', 'minimum_order_quantity'],
  supplier_delay_days: ['delay', 'lead_time', 'delai', 'délai', 'lead_days'],
  weight_kg:           ['weight', 'poids', 'weight_kg', 'poids_kg'],
  dim_l_cm:            ['length', 'longueur', 'l', 'l_cm', 'len_cm'],
  dim_w_cm:            ['width', 'largeur', 'w', 'w_cm', 'wid_cm'],
  dim_h_cm:            ['height', 'hauteur', 'h', 'h_cm', 'hei_cm'],
  supplier_product_id: ['sku', 'ref', 'reference', 'product_id', 'supplier_product_id'],
};

const NUMERIC_FIELDS = new Set([
  'purchase_price', 'weight_kg', 'dim_l_cm', 'dim_w_cm', 'dim_h_cm',
]);
const INTEGER_FIELDS = new Set([
  'stock_available', 'min_order_qty', 'supplier_delay_days',
]);

/**
 * Parse un texte CSV en lignes brutes (objets clé/valeur).
 *
 * @param {string} csvText
 * @param {Object} [customMapping]  — { product_name: 'colA', purchase_price: 'colB', ... }
 *                                    pour forcer le mapping si le CSV a des headers exotiques.
 * @returns {Array<Object>}         — lignes { product_name, purchase_price, ... }
 */
function parseCSV(csvText, customMapping) {
  if (!csvText || typeof csvText !== 'string') return [];
  const firstLine = csvText.split(/\r?\n/)[0] || '';
  const sep = firstLine.includes(';') ? ';' : ',';
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase());

  // Index : pour chaque champ cible, l'indice de colonne CSV
  const headerIndex = {};
  Object.keys(DEFAULT_HEADER_ALIASES).forEach(field => {
    const candidates = (customMapping && customMapping[field])
      ? [customMapping[field].toLowerCase()]
      : DEFAULT_HEADER_ALIASES[field];
    for (const c of candidates) {
      const idx = headers.indexOf(c);
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
        if (NUMERIC_FIELDS.has(field)) {
          const n = parseFloat(v.replace(',', '.'));
          if (!isNaN(n)) row[field] = n;
        } else if (INTEGER_FIELDS.has(field)) {
          const n = parseInt(v, 10);
          if (!isNaN(n)) row[field] = n;
        } else {
          row[field] = v;
        }
      }
    });
    if (row.product_name) rows.push(row);
  }
  return rows;
}

/**
 * Convertit les lignes brutes en NormalizedSupplierProduct[].
 * Regroupe les dimensions dans un sous-objet.
 *
 * @param {Array<Object>} rawRows
 * @param {string} supplierName
 * @returns {Array<NormalizedSupplierProduct>}
 */
function rowsToNormalized(rawRows, supplierName) {
  return (rawRows || []).map(row => {
    const dimensions = {};
    if (row.dim_l_cm != null) dimensions.l_cm = row.dim_l_cm;
    if (row.dim_w_cm != null) dimensions.w_cm = row.dim_w_cm;
    if (row.dim_h_cm != null) dimensions.h_cm = row.dim_h_cm;
    return {
      supplier_name: supplierName,
      supplier_product_id: row.supplier_product_id || null,
      product_name: row.product_name,
      supplier_category: row.supplier_category || null,
      purchase_price: row.purchase_price != null ? Number(row.purchase_price) : null,
      currency: (row.currency || 'AED').toUpperCase(),
      image_url: row.image_url || null,
      product_url: row.product_url || null,
      description: row.description || null,
      stock_available: row.stock_available != null ? Number(row.stock_available) : null,
      min_order_qty: row.min_order_qty != null ? Number(row.min_order_qty) : null,
      supplier_delay_days: row.supplier_delay_days != null ? Number(row.supplier_delay_days) : null,
      weight_kg: row.weight_kg != null ? Number(row.weight_kg) : null,
      dimensions: Object.keys(dimensions).length ? dimensions : null,
      raw_payload: { ...row },
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// API CONNECTEUR (interface attendue par les routes)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Méthode principale : transforme un input CSV en NormalizedSupplierProduct[].
 *
 * @param {Object} input
 * @param {string} input.csv_text
 * @param {string} input.supplier_name
 * @param {Object} [input.csv_mapping]
 *
 * @returns {{ products: Array<NormalizedSupplierProduct>, invalid: Array, total: number }}
 */
function fetchProducts(input) {
  const supplierName = (input?.supplier_name || '').trim();
  const csvText = input?.csv_text || '';
  if (!supplierName) throw new Error('supplier_name requis');
  if (!csvText) throw new Error('csv_text requis');

  const rawRows = parseCSV(csvText, input.csv_mapping);
  const normalized = rowsToNormalized(rawRows, supplierName);
  const { valid, invalid } = partitionValid(normalized);
  return {
    products: valid,
    invalid,
    total: normalized.length,
  };
}

module.exports = {
  fetchProducts,
  // Helpers exposés pour tests et usages avancés
  parseCSV,
  rowsToNormalized,
  DEFAULT_HEADER_ALIASES,
};
