/**
 * @komerce-arch
 * @role          golden-product-seed
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        none
 * @outputs       products, catalog_media, product_variants, product_skus,
 *                product_sku_media, product_content_profile,
 *                product_content_sections, product_attributes
 * @depends       db.js, tests/fixtures/catalog/golden-elite-pro.js,
 *                services/catalog-promotion.js, services/product-admin-service.js
 * @used-by       chantier GPM (modal mobile enrichie), Raffinerie E2E,
 *                E-PDC, E-CONTENT-LIVE
 * @db-read       products, product_variants, product_skus
 * @db-write      products, catalog_media, product_variants, product_skus,
 *                product_sku_media, product_content_profile,
 *                product_content_sections, product_attributes
 * @db-txn        yes (BEGIN/COMMIT, ROLLBACK sur toute incohérence)
 * @doctrine      AUDIT_v2_RAFFINERIE_GATES_MODALE.md §1, PLAN_GOLDEN_CHAIN.md
 * @version       2026-07-v2
 *
 * SEED v2 — deux owners officiels, dans l'ordre de la chaîne réelle :
 *
 *   1. upsertProductParent      → products (promoteCatalog n'écrit PAS products)
 *   2. promoteCatalog           → OWNER 1 : vérité fournisseur
 *      catalog_media · product_variants · product_skus (supplier_sku, source, stock)
 *      product_sku_media · product_content_profile · product_content_sections
 *      product_attributes
 *   3. upsertProductSku ×N      → OWNER 2 : décision commerciale
 *      sku · price_kmf · is_active (JAMAIS supplier_sku ni source)
 *   4. auditProductSkuReadiness → THROW si !ready
 *   5. bascule inventory_model='SKU'
 *
 * IDEMPOTENT : peut être rejoué sans dupliquer de lignes.
 * TRANSACTIONNEL : ROLLBACK intégral à la moindre incohérence.
 * BRUYANT : échoue sur toute erreur, jamais de catch silencieux.
 *
 *   DATABASE_URL=… node scripts/seed-golden-product.js
 */

'use strict';

const db = require('../db');
const fixture = require('../tests/fixtures/catalog/golden-elite-pro');
const { validateForPromotion, promoteCatalog } = require('../services/catalog-promotion');
const { upsertProductSku, auditProductSkuReadiness } = require('../services/product-admin-service');

// ── 1. Produit parent ────────────────────────────────────────────────────
// promoteCatalog n'écrit PAS products → on doit le créer/upserter nous-mêmes.
// inventory_model commence à 'LEGACY_VARIANTS' : la bascule vers 'SKU' est
// explicite en fin de chaîne, APRÈS auditProductSkuReadiness.
async function upsertProductParent(client) {
  const p = fixture.productRow();
  const { rows: [product] } = await client.query(
    `INSERT INTO products
       (id, product_ref, name, description, category, subcategory,
        price_kmf, price_eur, promo_pct, image_url, images,
        stock, inventory_model, has_variants, is_active)
     VALUES
       ($1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11::jsonb,
        0, 'LEGACY_VARIANTS', true, true)
     ON CONFLICT (product_ref) DO UPDATE SET
       name         = EXCLUDED.name,
       description  = EXCLUDED.description,
       category     = EXCLUDED.category,
       subcategory  = EXCLUDED.subcategory,
       price_kmf    = EXCLUDED.price_kmf,
       promo_pct    = EXCLUDED.promo_pct,
       image_url    = EXCLUDED.image_url,
       images       = EXCLUDED.images,
       has_variants = true,
       is_active    = true,
       updated_at   = now()
     RETURNING *`,
    [
      p.id, p.product_ref, p.name, p.description, p.category, p.subcategory,
      p.price_kmf, 0, p.promo_pct, p.image_url, JSON.stringify(p.images),
    ]
  );
  return product;
}

// ── 2. Promotion fournisseur ─────────────────────────────────────────────
// Appelle le VRAI promoteCatalog avec le contrat source V2 de la fixture.
// C'est la seule façon de prouver que la raffinerie sait produire la sortie
// verrouillée par golden-product-gpm1.test.js.
//
// TRANSITION v1 → v2 : l'ancien seed écrivait des product_skus en SQL direct
// avec supplier_sku = NULL. planSkuReconciliation matche par supplier_sku :
// il ne retrouve pas les anciens → tente un INSERT → conflit sur
// (product_id, variant_combo). On nettoie les orphelins legacy UNE FOIS.
// Après le premier run v2, supplier_sku est renseigné et les re-promotions
// matchent normalement.
async function promoteSupplierData(client, productId) {
  // Nettoyage one-shot : supprimer les SKU sans supplier_sku (posés par le
  // seed v1). Idempotent : si aucune ligne ne matche, 0 rows deleted.
  const { rowCount } = await client.query(
    `DELETE FROM product_skus
      WHERE product_id = $1 AND supplier_sku IS NULL`,
    [productId]
  );
  if (rowCount > 0) {
    console.log(`  ⚠ nettoyage transition v1→v2 : ${rowCount} SKU legacy sans supplier_sku supprimé(s)`);
  }

  const sourceContract = fixture.sourceContract();
  validateForPromotion(sourceContract);
  await promoteCatalog(client, { productId, normalizedSourceContract: sourceContract });
}

// ── 3. Décision commerciale ──────────────────────────────────────────────
// Appelle le VRAI upsertProductSku — owner officiel du prix de vente.
// Chaque scénario SCENARIOS porte price_kmf (décision Komerce).
// On passe `client` et non le pool : même interface (.query()), et on reste
// dans la transaction (R3 vérifié : les deux fonctions n'utilisent que .query()).
async function applyCommercialDecisions(client, productId) {
  for (const s of fixture.SCENARIOS) {
    if (!s.sku) continue;
    await upsertProductSku(client, productId, {
      variant_combo: { Couleur: s.couleur, Taille: s.taille },
      sku: s.sku,
      price_kmf: s.price_kmf,
      stock: s.stock,
      is_active: s.expected !== 'inexistant',
    });
  }
}

// ── 4. Audit + bascule ──────────────────────────────────────────────────
async function switchToSku(client, productId) {
  const audit = await auditProductSkuReadiness(client, productId);
  if (audit.already_sku) return audit;
  if (!audit.ready) {
    throw new Error(
      `[seed-golden-product] auditProductSkuReadiness NOT READY : ${audit.reasons.join(' ; ')}`
    );
  }
  // Bascule explicite — pas de service dédié aujourd'hui (R2/option A du plan).
  // L'UPDATE est tracé, gardé par l'audit ci-dessus, et dans la transaction.
  await client.query(
    `UPDATE products SET inventory_model = 'SKU', updated_at = now() WHERE id = $1`,
    [productId]
  );
  return audit;
}

// ── Orchestration ────────────────────────────────────────────────────────
async function seedGoldenProduct() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Étape 1 : produit parent
    const product = await upsertProductParent(client);
    console.log(`  ✓ produit parent ${product.product_ref} (${product.id})`);

    // Étape 2 : vérité fournisseur (promoteCatalog)
    await promoteSupplierData(client, product.id);
    console.log('  ✓ promoteCatalog — médias, axes, SKU fournisseur, contenu enrichi');

    // Étape 3 : décision commerciale (upsertProductSku)
    await applyCommercialDecisions(client, product.id);
    console.log('  ✓ décisions commerciales — sku, price_kmf, is_active');

    // Étape 4 : audit + bascule
    const audit = await switchToSku(client, product.id);
    console.log(`  ✓ inventory_model = SKU (ready: ${audit.ready ?? audit.already_sku})`);

    await client.query('COMMIT');
    console.log('  ✅ COMMIT — chaîne Golden complète');
    return { product, audit };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('  ❌ ROLLBACK —', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const { product, audit } = await seedGoldenProduct();
  console.log(JSON.stringify({
    product_id: product.id,
    product_ref: product.product_ref,
    inventory_model: 'SKU',
    audit_ready: audit.ready ?? audit.already_sku,
  }, null, 2));
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed-golden-product] échec fatal :', err);
    process.exit(1);
  });
}

module.exports = { seedGoldenProduct };
