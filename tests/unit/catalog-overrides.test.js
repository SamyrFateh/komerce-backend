'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — K-4 module partagé overrides tracés (DOCTRINE_CATALOGUE.md §5, §7)
 *
 * Verrouille :
 *   isPipelineSourced — connector_raw/ai_enriched only, legacy manual exclu ;
 *   upsertOverride    — whitelist stricte (rejet AVANT toute requête),
 *                        UPSERT sur (product_id, field_name), colonne
 *                        interpolée toujours issue de la whitelist (jamais
 *                        le field_name brut client — défense injection) ;
 *   upsertOverrides    — validation de tout le lot avant le premier query
 *                        (tout ou rien côté validation), overridden[] complet.
 */

const {
  OVERRIDABLE_FIELDS,
  isPipelineSourced,
  upsertOverride,
  upsertOverrides,
} = require('../../services/catalog-overrides');

const PRODUCT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function mockDb({ product } = {}) {
  const calls = [];
  const q = {
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO catalog_field_overrides')) {
        return { rows: [{ id: 'override-1', product_id: params[0], field_name: params[1], field_value: params[2], reason: params[3], set_by: params[4] }] };
      }
      if (sql.startsWith('UPDATE products')) {
        return { rows: [{ ...product, id: params[1] }] };
      }
      throw new Error(`SQL non mocké: ${sql.slice(0, 60)}`);
    }),
  };
  return { q, calls };
}

describe('isPipelineSourced', () => {
  it('vrai pour connector_raw', () => {
    expect(isPipelineSourced({ content_source: 'connector_raw' })).toBe(true);
  });

  it('vrai pour ai_enriched', () => {
    expect(isPipelineSourced({ content_source: 'ai_enriched' })).toBe(true);
  });

  it('faux pour manual (legacy, avant K-1)', () => {
    expect(isPipelineSourced({ content_source: 'manual' })).toBe(false);
  });

  it('faux si content_source absent/null', () => {
    expect(isPipelineSourced({ content_source: null })).toBe(false);
    expect(isPipelineSourced({})).toBe(false);
  });

  it('faux si produit absent', () => {
    expect(isPipelineSourced(null)).toBe(false);
    expect(isPipelineSourced(undefined)).toBe(false);
  });
});

describe('upsertOverride', () => {
  it('rejette un champ hors whitelist AVANT toute requête (doctrine §7)', async () => {
    const { q, calls } = mockDb();
    await expect(
      upsertOverride(q, { productId: PRODUCT_ID, fieldName: 'price_kmf', fieldValue: '1' })
    ).rejects.toMatchObject({ code: 'OVERRIDE_FIELD_NOT_ALLOWED' });
    expect(calls).toHaveLength(0);
  });

  it("rejette une tentative d'injection dans field_name (nom de colonne vérolé)", async () => {
    const { q, calls } = mockDb();
    await expect(
      upsertOverride(q, { productId: PRODUCT_ID, fieldName: 'name; DROP TABLE products;--', fieldValue: 'x' })
    ).rejects.toMatchObject({ code: 'OVERRIDE_FIELD_NOT_ALLOWED' });
    expect(calls).toHaveLength(0);
  });

  it('pose un override valide : INSERT ON CONFLICT puis UPDATE sur la colonne whitelistée uniquement', async () => {
    const { q, calls } = mockDb({ product: { id: PRODUCT_ID, name: 'Nom corrigé' } });
    const { override, product } = await upsertOverride(q, {
      productId: PRODUCT_ID, fieldName: 'name', fieldValue: 'Nom corrigé', reason: 'traduction', setBy: 'admin-1',
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain('INSERT INTO catalog_field_overrides');
    expect(calls[0].sql).toContain('ON CONFLICT (product_id, field_name)');
    expect(calls[0].params).toEqual([PRODUCT_ID, 'name', 'Nom corrigé', 'traduction', 'admin-1']);

    expect(calls[1].sql).toContain('UPDATE products SET name = $1');
    expect(calls[1].params).toEqual(['Nom corrigé', PRODUCT_ID]);

    expect(override.field_name).toBe('name');
    expect(product.name).toBe('Nom corrigé');
  });

  it('la colonne interpolée provient toujours de OVERRIDABLE_FIELDS, jamais du field_name brut', async () => {
    const { q, calls } = mockDb({ product: { id: PRODUCT_ID } });
    await upsertOverride(q, { productId: PRODUCT_ID, fieldName: 'emoji', fieldValue: '🎒' });
    const updateCall = calls.find((c) => c.sql.startsWith('UPDATE products'));
    expect(OVERRIDABLE_FIELDS).toContain('emoji');
    expect(updateCall.sql).toContain('SET emoji = $1');
  });
});

describe('upsertOverrides (batch)', () => {
  it('rejette tout le lot si un seul champ est hors whitelist — aucune requête émise', async () => {
    const { q, calls } = mockDb();
    await expect(
      upsertOverrides(q, PRODUCT_ID, { name: 'ok', stock: '999' })
    ).rejects.toMatchObject({ code: 'OVERRIDE_FIELD_NOT_ALLOWED' });
    expect(calls).toHaveLength(0);
  });

  it('pose tous les champs valides et retourne overridden[] complet', async () => {
    const { q, calls } = mockDb({ product: { id: PRODUCT_ID } });
    const { overridden, product } = await upsertOverrides(
      q, PRODUCT_ID, { name: 'Nom corrigé', description: 'Desc corrigée' }, { reason: 'lot', setBy: 'admin-1' }
    );
    expect(overridden).toEqual(['name', 'description']);
    // 2 champs × (INSERT + UPDATE) = 4 requêtes
    expect(calls).toHaveLength(4);
    expect(product).toBeDefined();
  });

  it('lot vide : overridden vide, aucune requête', async () => {
    const { q, calls } = mockDb({ product: { id: PRODUCT_ID } });
    const { overridden } = await upsertOverrides(q, PRODUCT_ID, {});
    expect(overridden).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
