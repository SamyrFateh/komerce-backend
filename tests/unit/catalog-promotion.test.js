'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/catalog-promotion.test.js
 *
 * Couvre services/catalog-promotion.js (PDC-8 Lot 6 + Lot Content) :
 * orchestration transactionnelle de la promotion normalized_source_contract
 * V2 → catalogue canonique (catalog_media, product_variants, product_skus,
 * product_sku_media, product_content_profile, product_content_sections,
 * product_attributes).
 *
 * Ce module ne fait jamais BEGIN/COMMIT/ROLLBACK — il reçoit un client déjà
 * en transaction. Les tests fournissent donc un client scripté (mock-db
 * harness) et vérifient uniquement la séquence de requêtes qu'il émet,
 * sans BEGIN/COMMIT dans le script attendu.
 *
 * Scénarios :
 *   ✅ contrat V1 (normalized_source_contract null) → aucune écriture, no-op
 *   ✅ contrat V2 invalide (schema_version incorrecte) → rejet 422, aucune écriture
 *   ✅ sellable_units explicitement vide → rejet 422 explicite
 *   ✅ purchase_price invalide → rejet 422
 *   ✅ nominal complet : media + axes + SKU create + couture SKU↔media + content
 *   ✅ re-promotion : SKU existant conservé (update, pas re-création), média par identité mis à jour
 *   ✅ stock inconnu sur update → stock existant jamais écrasé (CASE WHEN stockKnown)
 *   ✅ SKU disparu → désactivé, jamais supprimé
 *
 * Le contenu (profil/sections/attributs) a sa propre suite dédiée :
 * tests/unit/catalog-promotion-content.test.js (mapping pur) et
 * tests/unit/catalog-promotion-content-db.test.js (écriture DB idempotente,
 * override manuel, désactivation, ré-promotion).
 */

const { makeClient } = require('../integration/test-harness/mock-db');
const { promoteCatalog, validateForPromotion } = require('../../services/catalog-promotion');

// baseContractV2() ne porte aucun champ éditorial (brand/highlights/specifications/
// sections/materials/care/warnings tous absents) -> mapContentToProfileRow renvoie un
// profil tout-null, mapContentToSectionRows/AttributeRows renvoient []. promoteContent
// émet donc systématiquement exactement 3 requêtes dans ce cas : 1 upsert profil (0
// override manuel préexistant -> mis à jour) + 1 désactivation sections (portée vide,
// no-op côté données mais la requête part) + 1 désactivation attributs (idem).
function noEditorialContentMocks() {
  return [
    { rows: [{ id: 'content-profile-1' }] }, // INSERT product_content_profile ... RETURNING id
    { rows: [], rowCount: 0 },               // UPDATE product_content_sections (désactivation, portée vide)
    { rows: [], rowCount: 0 },               // UPDATE product_attributes (désactivation, portée vide)
  ];
}

const EMPTY_CONTENT_RESULT = {
  profile: 'upserted',
  sections: { upserted: 0, deactivated: 0 },
  attributes: { upserted: 0, deactivated: 0 },
};

function baseContractV2(overrides = {}) {
  return {
    schema_version: '2',
    product_name: 'Robe imprimée',
    supplier_name: 'Supplier X',
    currency: 'AED',
    media: [
      { supplier_media_id: 'IMG-1', url: 'https://x/img1.jpg', role: 'PRODUCT' },
    ],
    option_axes: [
      { key: 'couleur', display_name: 'Couleur', values: ['Rouge'] },
    ],
    sellable_units: [
      { supplier_sku: 'SKU-1', option_values: { couleur: 'Rouge' }, stock_available: 10, media_refs: ['IMG-1'] },
    ],
    ...overrides,
  };
}

describe('catalog-promotion (Lot 6)', () => {
  describe('validateForPromotion', () => {
    it('rejette une schema_version différente de "2"', () => {
      expect(() => validateForPromotion(baseContractV2({ schema_version: '1' })))
        .toThrow(/schema_version doit être "2"/);
    });

    it('rejette sellable_units explicitement vide', () => {
      expect(() => validateForPromotion(baseContractV2({ sellable_units: [] })))
        .toThrow(/aucune sellable_unit exploitable/);
    });

    it('accepte sellable_units absent (produit V1 sans SKU au sein d\'un contrat V2)', () => {
      const contract = baseContractV2({ sellable_units: undefined });
      expect(() => validateForPromotion(contract)).not.toThrow();
    });

    it('rejette un purchase_price non positif', () => {
      const contract = baseContractV2({
        sellable_units: [{ supplier_sku: 'SKU-1', option_values: { couleur: 'Rouge' }, purchase_price: -5 }],
      });
      expect(() => validateForPromotion(contract)).toThrow(/purchase_price doit être un nombre positif/);
    });

    it('rejette un stock_available non entier ou négatif', () => {
      const contract = baseContractV2({
        sellable_units: [{ supplier_sku: 'SKU-1', option_values: { couleur: 'Rouge' }, stock_available: -1 }],
      });
      expect(() => validateForPromotion(contract)).toThrow(/stock_available doit être un entier/);
    });

    it('propage les erreurs de structure riche (axe dupliqué, media_ref inconnu, etc.)', () => {
      const contract = baseContractV2({
        sellable_units: [{ supplier_sku: 'SKU-1', option_values: { couleur: 'Rouge' }, media_refs: ['IMG-INCONNU'] }],
      });
      expect(() => validateForPromotion(contract)).toThrow(/média inconnu/);
    });
  });

  describe('promoteCatalog', () => {
    it('V1 legacy (normalized_source_contract null) → no-op, aucune écriture', async () => {
      const client = makeClient([]);
      const result = await promoteCatalog(client, { productId: 'prod-1', normalizedSourceContract: null });

      expect(result).toEqual({ promoted: false, reason: 'v1_legacy' });
      expect(client.calls.length).toBe(0);
    });

    it('rejette un contrat invalide avant toute écriture', async () => {
      const client = makeClient([]);
      await expect(
        promoteCatalog(client, { productId: 'prod-1', normalizedSourceContract: baseContractV2({ schema_version: '3' }) })
      ).rejects.toThrow(/schema_version doit être "2"/);
      expect(client.calls.length).toBe(0);
    });

    it('nominal : media upsert, axe créé, SKU créé, couture SKU↔media', async () => {
      const client = makeClient([
        // 1. INSERT catalog_media (media[0])
        { rows: [{ id: 'media-1', source_media_id: 'IMG-1' }] },
        // 2. INSERT product_variants (axe couleur=Rouge)
        { rows: [] },
        // 3. SELECT product_skus existants (aucun)
        { rows: [] },
        // 4. INSERT product_skus (création SKU-1)
        { rows: [{ id: 'sku-1', supplier_sku: 'SKU-1' }] },
        // 5. INSERT product_sku_media (sku-1 <-> media-1)
        { rows: [] },
        // 6-8. Lot Content (contrat sans champ éditorial) : profil + désactivation sections/attributs
        ...noEditorialContentMocks(),
      ]);

      const result = await promoteCatalog(client, {
        productId: 'prod-1',
        normalizedSourceContract: baseContractV2(),
      });

      expect(result).toEqual({
        promoted: true,
        media: 1,
        variants: 1,
        skus: { count: 1 },
        skuMediaLinks: 1,
        content: EMPTY_CONTENT_RESULT,
      });

      expect(client.calls[0].sql).toMatch(/INSERT INTO catalog_media/);
      expect(client.calls[1].sql).toMatch(/INSERT INTO product_variants/);
      expect(client.calls[2].sql).toMatch(/SELECT id, supplier_sku, source, variant_combo, stock, is_active\s+FROM product_skus/);
      expect(client.calls[3].sql).toMatch(/INSERT INTO product_skus/);
      expect(client.calls[3].params).toEqual(['prod-1', 'SKU-1', JSON.stringify({ couleur: 'Rouge' }), 10]);
      expect(client.calls[4].sql).toMatch(/INSERT INTO product_sku_media/);
      expect(client.calls[4].params).toEqual(['sku-1', 'media-1']);
    });

    it('re-promotion : SKU existant mis à jour (même id), jamais recréé', async () => {
      const client = makeClient([
        { rows: [{ id: 'media-1', source_media_id: 'IMG-1' }] }, // media upsert
        { rows: [] }, // product_variants upsert
        { rows: [{ id: 'sku-1', supplier_sku: 'SKU-1', source: 'SUPPLIER', variant_combo: { couleur: 'Rouge' }, stock: 3, is_active: true }] }, // existing skus
        { rows: [] }, // UPDATE product_skus
        { rows: [] }, // INSERT product_sku_media
        ...noEditorialContentMocks(),
      ]);

      const result = await promoteCatalog(client, {
        productId: 'prod-1',
        normalizedSourceContract: baseContractV2(),
      });

      expect(result.skus).toEqual({ count: 1 });
      expect(result.content).toEqual(EMPTY_CONTENT_RESULT);
      expect(client.calls[3].sql).toMatch(/UPDATE product_skus/);
      expect(client.calls[3].sql).not.toMatch(/INSERT INTO product_skus/);
      // stockKnown=true (stock_available: 10 fourni) -> stock écrasé à 10
      expect(client.calls[3].params).toEqual([JSON.stringify({ couleur: 'Rouge' }), true, 10, 'sku-1']);
    });

    it('stock inconnu sur update : le CASE WHEN protège le stock existant (jamais écrasé par 0)', async () => {
      const contract = baseContractV2({
        sellable_units: [{ supplier_sku: 'SKU-1', option_values: { couleur: 'Rouge' } }], // pas de stock_available
      });
      const client = makeClient([
        { rows: [{ id: 'media-1', source_media_id: 'IMG-1' }] },
        { rows: [] },
        { rows: [{ id: 'sku-1', supplier_sku: 'SKU-1', source: 'SUPPLIER', variant_combo: { couleur: 'Rouge' }, stock: 7, is_active: true }] },
        { rows: [] },
        { rows: [] },
        ...noEditorialContentMocks(),
      ]);

      await promoteCatalog(client, { productId: 'prod-1', normalizedSourceContract: contract });

      // stockKnown=false -> le paramètre $2 (stockKnown) est false, stock CASE WHEN garde l'ancienne valeur en DB
      expect(client.calls[3].params[1]).toBe(false);
    });

    it('SKU disparu du replay → désactivé, jamais supprimé', async () => {
      const contract = baseContractV2({ sellable_units: [] });
      // sellable_units vide est rejeté par validateForPromotion — on veut ici
      // tester la désactivation via un remplacement du SKU par un autre.
      const contractReplaced = baseContractV2({
        sellable_units: [{ supplier_sku: 'SKU-2', option_values: { couleur: 'Bleu' }, stock_available: 5 }],
        option_axes: [{ key: 'couleur', display_name: 'Couleur', values: ['Bleu'] }],
        media: [],
      });

      const client = makeClient([
        // aucun media dans le contrat -> aucun appel média émis
        { rows: [] }, // product_variants upsert (Bleu)
        { rows: [{ id: 'sku-1', supplier_sku: 'SKU-1', source: 'SUPPLIER', variant_combo: { couleur: 'Rouge' }, stock: 3, is_active: true }] }, // existing: SKU-1 seul
        { rows: [{ id: 'sku-2', supplier_sku: 'SKU-2' }] }, // création SKU-2
        { rows: [] }, // désactivation SKU-1
        // aucun media_refs -> pas d'INSERT product_sku_media
        ...noEditorialContentMocks(),
      ]);

      const result = await promoteCatalog(client, { productId: 'prod-1', normalizedSourceContract: contractReplaced });

      expect(result.skuMediaLinks).toBe(0);
      expect(result.content).toEqual(EMPTY_CONTENT_RESULT);
      const deactivateCall = client.calls.find((c) => /UPDATE product_skus SET is_active = false/.test(c.sql));
      expect(deactivateCall).toBeTruthy();
      expect(deactivateCall.params).toEqual(['sku-1']);
    });
  });
});
