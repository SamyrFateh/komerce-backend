/**
 * @komerce-arch
 * @role          boutique-taxonomy-admin-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        category_key, subcategory_key, taxonomy_payload, optional customs_category_key affinity
 * @outputs       category_config, subcategory_config, taxonomy_mutation_result
 * @depends       db.js, utils/categories-cache.js, services/catalog-taxonomy-audit.js
 * @used-by       routes/admin-boutique-categories.js, services/catalog-workspace.js
 * @db-read       boutique_categories, boutique_subcategories
 * @db-write      boutique_categories, boutique_subcategories
 * @db-write-via  catalog-taxonomy-audit -> catalog_taxonomy_audit
 * @db-txn        mutation_and_audit_atomic_when_owner_db_is_used
 * @doctrine      taxonomy_source_db, single_taxonomy_mutation_authority, admin_mutation_must_be_audited
 * @impact-areas  catalog, boutique-admin, category-navigation, customs-classification
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const { invalidateCategoriesCache } = require('../utils/categories-cache');
const { recordTaxonomyMutation } = require('./catalog-taxonomy-audit');

async function withTaxonomyMutation(q, work) {
  if (q === db && typeof db.withTransaction === 'function') {
    return db.withTransaction(work);
  }
  return work(q);
}

function sourceSurface(actor) {
  return actor && actor.source_surface ? actor.source_surface : 'catalog';
}

class TaxonomyAdminError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'TaxonomyAdminError';
    this.status = status;
    this.code = code;
  }
}

async function getCategoryWithSubcats(key, q = db) {
  const { rows: [cat] } = await q.query('SELECT * FROM boutique_categories WHERE key = $1', [key]);
  if (!cat) return null;
  const { rows: subs } = await q.query(
    'SELECT * FROM boutique_subcategories WHERE category_key = $1 ORDER BY display_order',
    [key]
  );
  cat.subcategories = subs;
  return cat;
}

async function listCategories({ active } = {}, q = db) {
  let sql = 'SELECT * FROM boutique_categories';
  const params = [];
  if (active !== undefined && active !== null) {
    sql += ' WHERE is_active = $1';
    params.push(Boolean(active));
  }
  sql += ' ORDER BY display_order';
  const { rows: categories } = await q.query(sql, params);
  const { rows: subcategories } = await q.query(
    'SELECT * FROM boutique_subcategories ORDER BY category_key, display_order'
  );
  const byCategory = new Map();
  subcategories.forEach(row => {
    if (!byCategory.has(row.category_key)) byCategory.set(row.category_key, []);
    byCategory.get(row.category_key).push(row);
  });
  categories.forEach(category => { category.subcategories = byCategory.get(category.key) || []; });
  return categories;
}

async function listSubcategories(categoryKey, q = db) {
  const { rows } = await q.query(
    'SELECT * FROM boutique_subcategories WHERE category_key = $1 ORDER BY display_order',
    [categoryKey]
  );
  return rows;
}

async function createCategory(payload = {}, q = db, actor = null) {
  return withTaxonomyMutation(q, async tx => {
    if (!payload.key || !payload.label) throw new TaxonomyAdminError(400, 'key et label obligatoires');
    const duplicate = await tx.query('SELECT 1 FROM boutique_categories WHERE key = $1', [payload.key]);
    if (duplicate.rows.length) throw new TaxonomyAdminError(409, 'Une catégorie avec cette clé existe déjà', 'category_key_conflict');

    const { rows: [row] } = await tx.query(
      `INSERT INTO boutique_categories
        (key, label, short_label, section_emoji, icon_svg, db_keys, filter_type,
         display_order, show_in_rail, show_in_sections, is_active, image_url,
         theme_token, accent_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        payload.key, payload.label, payload.short_label || payload.label,
        payload.section_emoji || '📦', payload.icon_svg || null, payload.db_keys || [],
        payload.filter_type || null, payload.display_order !== undefined ? payload.display_order : 99,
        payload.show_in_rail !== false, payload.show_in_sections !== false,
        payload.is_active !== false, payload.image_url || null, payload.theme_token || null,
        payload.accent_token || null,
      ]
    );
    row.subcategories = [];
    await recordTaxonomyMutation(tx, {
      action: 'CATEGORY_CREATED',
      entityType: 'category',
      categoryKey: row.key,
      actor,
      sourceSurface: sourceSurface(actor),
      before: null,
      after: row,
    });
    invalidateCategoriesCache();
    return row;
  });
}

async function updateCategory(key, payload = {}, q = db, actor = null) {
  return withTaxonomyMutation(q, async tx => {
    const allowed = ['label','short_label','section_emoji','icon_svg','db_keys','filter_type','display_order','show_in_rail','show_in_sections','is_active','image_url','theme_token','accent_token'];
    const fields = allowed.filter(field => payload[field] !== undefined);
    if (!fields.length) throw new TaxonomyAdminError(400, 'Aucun champ à mettre à jour');
    const { rows: [before] } = await tx.query('SELECT * FROM boutique_categories WHERE key = $1', [key]);
    if (!before) throw new TaxonomyAdminError(404, 'Catégorie introuvable', 'category_not_found');
    const values = fields.map(field => payload[field]);
    values.push(key);
    const set = fields.map((field, index) => `${field} = ${index + 1}`).join(', ');
    const { rows: [row] } = await tx.query(
      `UPDATE boutique_categories SET ${set}, updated_at = NOW() WHERE key = ${fields.length + 1} RETURNING *`,
      values
    );
    await recordTaxonomyMutation(tx, {
      action: 'CATEGORY_UPDATED',
      entityType: 'category',
      categoryKey: key,
      actor,
      sourceSurface: sourceSurface(actor),
      before,
      after: row,
    });
    invalidateCategoriesCache();
    return getCategoryWithSubcats(key, tx);
  });
}

async function deactivateCategory(key, q = db, actor = null) {
  return withTaxonomyMutation(q, async tx => {
    const { rows: [rawRow] } = await tx.query(
      `WITH before AS (
         SELECT to_jsonb(c.*) AS before_snapshot
           FROM boutique_categories c
          WHERE c.key = $1
          FOR UPDATE
       ),
       updated AS (
         UPDATE boutique_categories c
            SET is_active = FALSE, updated_at = NOW()
          FROM before
         WHERE c.key = $1
         RETURNING c.*
       )
       SELECT updated.*, before.before_snapshot
         FROM updated CROSS JOIN before`,
      [key]
    );
    if (!rawRow) throw new TaxonomyAdminError(404, 'Catégorie introuvable', 'category_not_found');
    const { before_snapshot: before, ...row } = rawRow;
    await recordTaxonomyMutation(tx, {
      action: 'CATEGORY_DEACTIVATED',
      entityType: 'category',
      categoryKey: key,
      actor,
      sourceSurface: sourceSurface(actor),
      before,
      after: row,
    });
    invalidateCategoriesCache();
    return { deactivated: true, category: row };
  });
}

async function createSubcategory(categoryKey, payload = {}, q = db, actor = null) {
  return withTaxonomyMutation(q, async tx => {
    if (!payload.key || !payload.label) throw new TaxonomyAdminError(400, 'key et label obligatoires');
    const parent = await tx.query('SELECT 1 FROM boutique_categories WHERE key = $1', [categoryKey]);
    if (!parent.rows.length) throw new TaxonomyAdminError(404, 'Catégorie parente introuvable', 'category_not_found');
    try {
      const { rows: [row] } = await tx.query(
        `INSERT INTO boutique_subcategories
          (category_key, key, label, short_label, icon, display_order, is_active, customs_category_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [categoryKey, payload.key, payload.label, payload.short_label || payload.label,
         payload.icon || '✨', payload.display_order !== undefined ? payload.display_order : 99,
         payload.is_active !== false, payload.customs_category_key || null]
      );
      await recordTaxonomyMutation(tx, {
        action: 'SUBCATEGORY_CREATED',
        entityType: 'subcategory',
        categoryKey,
        subcategoryKey: row.key,
        actor,
        sourceSurface: sourceSurface(actor),
        before: null,
        after: row,
      });
      invalidateCategoriesCache();
      return row;
    } catch (err) {
      if (err.code === '23505') throw new TaxonomyAdminError(409, 'Une sous-catégorie avec cette clé existe déjà dans cette catégorie', 'subcategory_key_conflict');
      throw err;
    }
  });
}

async function updateSubcategory(categoryKey, subcategoryKey, payload = {}, q = db, actor = null) {
  return withTaxonomyMutation(q, async tx => {
    const allowed = ['label','short_label','icon','display_order','is_active','customs_category_key'];
    const fields = allowed.filter(field => payload[field] !== undefined);
    if (!fields.length) throw new TaxonomyAdminError(400, 'Aucun champ à mettre à jour');
    const { rows: [before] } = await tx.query(
      'SELECT * FROM boutique_subcategories WHERE category_key = $1 AND key = $2',
      [categoryKey, subcategoryKey]
    );
    if (!before) throw new TaxonomyAdminError(404, 'Sous-catégorie introuvable', 'subcategory_not_found');
    const values = fields.map(field => payload[field]);
    values.push(categoryKey, subcategoryKey);
    const set = fields.map((field, index) => `${field} = ${index + 1}`).join(', ');
    const { rows: [row] } = await tx.query(
      `UPDATE boutique_subcategories SET ${set}
        WHERE category_key = ${fields.length + 1} AND key = ${fields.length + 2}
        RETURNING *`,
      values
    );
    await recordTaxonomyMutation(tx, {
      action: 'SUBCATEGORY_UPDATED',
      entityType: 'subcategory',
      categoryKey,
      subcategoryKey,
      actor,
      sourceSurface: sourceSurface(actor),
      before,
      after: row,
    });
    invalidateCategoriesCache();
    return row;
  });
}

async function deactivateSubcategory(categoryKey, subcategoryKey, { hard = false } = {}, q = db, actor = null) {
  return withTaxonomyMutation(q, async tx => {
    const mutation = hard
      ? 'DELETE FROM boutique_subcategories s USING before WHERE s.category_key = $1 AND s.key = $2 RETURNING s.*'
      : 'UPDATE boutique_subcategories s SET is_active = FALSE FROM before WHERE s.category_key = $1 AND s.key = $2 RETURNING s.*';
    const { rows: [rawRow] } = await tx.query(
      `WITH before AS (
         SELECT to_jsonb(s.*) AS before_snapshot
           FROM boutique_subcategories s
          WHERE s.category_key = $1 AND s.key = $2
          FOR UPDATE
       ),
       changed AS (
         ${mutation}
       )
       SELECT changed.*, before.before_snapshot
         FROM changed CROSS JOIN before`,
      [categoryKey, subcategoryKey]
    );
    if (!rawRow) throw new TaxonomyAdminError(404, 'Sous-catégorie introuvable', 'subcategory_not_found');
    const { before_snapshot: before, ...row } = rawRow;
    await recordTaxonomyMutation(tx, {
      action: hard ? 'SUBCATEGORY_DELETED' : 'SUBCATEGORY_DEACTIVATED',
      entityType: 'subcategory',
      categoryKey,
      subcategoryKey,
      actor,
      sourceSurface: sourceSurface(actor),
      before,
      after: hard ? null : row,
    });
    invalidateCategoriesCache();
    return hard ? { deleted: true, subcategory: row } : { deactivated: true, subcategory: row };
  });
}

module.exports = {
  TaxonomyAdminError,
  getCategoryWithSubcats,
  listCategories,
  listSubcategories,
  createCategory,
  updateCategory,
  deactivateCategory,
  createSubcategory,
  updateSubcategory,
  deactivateSubcategory,
};
