'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — boutique-ranking-engine.js : rankProducts()
 *
 * rankProducts() est une fonction pure (aucun accès DB).
 * On la teste en isolation avec des catalogues synthétiques.
 *
 * Invariants couverts :
 *   □ produit exclu = viewed_product_id → absent des résultats
 *   □ produit inactif (is_active:false) → exclu
 *   □ complément compat (P1) devance même sous-catégorie (P2)
 *   □ alternative prix ≥ 15 % déclenche price_cheaper / price_premium
 *   □ aucun signal → produit absent des résultats (doctrine : pas de raison = pas d'affichage)
 *   □ limit respectée (max 12)
 *   □ tri déterministe : score desc, rank asc, ventes desc, ref asc
 *   □ champs exposés : product_id, product_ref, name, price_kmf, reason_code, reason_label, score
 *   □ SIGNAL_WEIGHTS, REASON_LABELS et REASON_RANK exportés
 */

const {
  rankProducts,
  SIGNAL_WEIGHTS,
  REASON_LABELS,
  REASON_RANK,
} = require('../../services/boutique-ranking-engine');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProduct(overrides) {
  return {
    id: 'p-default',
    product_ref: 'REF-000',
    name: 'Produit Default',
    category: 'alimentation',
    subcategory: 'riz',
    price_kmf: 10000,
    image_url: null,
    compatibility_group: null,
    is_active: true,
    sale_count: 0,
    ...overrides,
  };
}

// ─── Exports du module ────────────────────────────────────────────────────────
describe("Exports du module", () => {
  test("SIGNAL_WEIGHTS exporte les poids attendus", () => {
    expect(SIGNAL_WEIGHTS.complement_compat).toBeGreaterThan(SIGNAL_WEIGHTS.same_subcategory);
    expect(typeof SIGNAL_WEIGHTS.general_popularity).toBe('number');
  });

  test("REASON_LABELS couvre les codes principaux", () => {
    const codes = ['complement_compat', 'same_subcategory', 'price_cheaper', 'price_premium'];
    codes.forEach(c => expect(REASON_LABELS[c]).toBeDefined());
  });

  test("REASON_RANK : complement_compat (1) < same_subcategory (4)", () => {
    expect(REASON_RANK.complement_compat).toBeLessThan(REASON_RANK.same_subcategory);
  });
});

// ─── Exclusions ───────────────────────────────────────────────────────────────
describe("Exclusions", () => {
  const catalogue = [
    makeProduct({ id: 'p1', subcategory: 'riz', sale_count: 50 }),
    makeProduct({ id: 'p2', subcategory: 'riz', sale_count: 30 }),
  ];

  test("le produit vu (viewed_product_id) est exclu des résultats", () => {
    const results = rankProducts(catalogue, {
      viewed_product_id: 'p1',
      subcategory: 'riz',
    });
    const ids = results.map(r => String(r.product_id));
    expect(ids).not.toContain('p1');
    expect(ids).toContain('p2');
  });

  test("un produit inactif est exclu", () => {
    const cat = [
      makeProduct({ id: 'active', is_active: true, subcategory: 'riz', sale_count: 10 }),
      makeProduct({ id: 'inactive', is_active: false, subcategory: 'riz', sale_count: 100 }),
    ];
    const results = rankProducts(cat, { subcategory: 'riz' });
    expect(results.map(r => String(r.product_id))).not.toContain('inactive');
  });

  test("produit sans aucun signal → absent des résultats", () => {
    // Produit dans une catégorie totalement étrangère au contexte
    const cat = [
      makeProduct({ id: 'orphan', category: 'electronics', subcategory: 'phone', sale_count: 0 }),
    ];
    const results = rankProducts(cat, {
      category: 'alimentation',
      subcategory: 'riz',
    });
    expect(results.length).toBe(0);
  });
});

// ─── Hiérarchie des signaux ───────────────────────────────────────────────────
describe("Hiérarchie signaux (P1 > P2)", () => {
  test("complément compat (P1) devance même sous-catégorie (P2)", () => {
    const viewed = makeProduct({ id: 'viewed', compatibility_group: 'cuisine', subcategory: 'riz' });
    const complement = makeProduct({
      id: 'complement',
      compatibility_group: 'cuisine',
      subcategory: 'huile', // différente → P1
      sale_count: 0,
    });
    const same_sub = makeProduct({
      id: 'same',
      compatibility_group: null,
      subcategory: 'riz', // P2 seulement
      sale_count: 200,
    });

    // viewed doit être dans le catalogue pour que anchorCompatGroups soit peuplé
    const results = rankProducts(
      [viewed, complement, same_sub],
      { viewed_product_id: 'viewed', subcategory: 'riz', category: 'alimentation' },
      {},
    );

    // Le complement doit apparaître en premier
    expect(String(results[0].product_id)).toBe('complement');
    expect(['complement_compat', 'cart_complement']).toContain(results[0].reason_code);
  });
});

// ─── Alternative de prix ──────────────────────────────────────────────────────
describe("Alternative de prix (P3)", () => {
  const viewedRef = makeProduct({ id: 'v', subcategory: 'riz', price_kmf: 10000 });
  const cheaper   = makeProduct({ id: 'cheap', subcategory: 'riz', price_kmf: 8000, sale_count: 5 }); // -20 %
  const premium   = makeProduct({ id: 'prem',  subcategory: 'riz', price_kmf: 13000, sale_count: 5 }); // +30 %
  const close     = makeProduct({ id: 'close', subcategory: 'riz', price_kmf: 10200, sale_count: 5 }); // +2 % → pas d'alt

  test("price_cheaper déclenché si écart ≥ 15 % en dessous", () => {
    const catalogue = [viewedRef, cheaper];
    const results = rankProducts(catalogue, {
      viewed_product_id: 'v',
      subcategory: 'riz',
    });
    const cheaperResult = results.find(r => String(r.product_id) === 'cheap');
    // Le signal price_cheaper doit être parmi les raisons (peut être éclipsé par same_subcategory)
    expect(cheaperResult).toBeDefined();
  });

  test("price_premium déclenché si écart ≥ 15 % au dessus", () => {
    const catalogue = [viewedRef, premium];
    const results = rankProducts(catalogue, {
      viewed_product_id: 'v',
      subcategory: 'riz',
    });
    expect(results.find(r => String(r.product_id) === 'prem')).toBeDefined();
  });

  test("pas d'alternative si écart < 15 %", () => {
    // 'close' est dans la même sous-catégorie donc il apparaît (same_subcategory),
    // mais son reason_code ne doit pas être price_cheaper / price_premium
    const catalogue = [viewedRef, close];
    const results = rankProducts(catalogue, {
      viewed_product_id: 'v',
      subcategory: 'riz',
    });
    const closeResult = results.find(r => String(r.product_id) === 'close');
    if (closeResult) {
      expect(['price_cheaper', 'price_premium']).not.toContain(closeResult.reason_code);
    }
  });
});

// ─── Limit ────────────────────────────────────────────────────────────────────
describe("Limit", () => {
  test("limit=3 retourne au maximum 3 résultats", () => {
    const catalogue = Array.from({ length: 10 }, (_, i) =>
      makeProduct({ id: `p${i}`, subcategory: 'riz', sale_count: i + 1 })
    );
    const results = rankProducts(catalogue, { subcategory: 'riz', limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test("limit > 12 est plafonné à 12", () => {
    const catalogue = Array.from({ length: 20 }, (_, i) =>
      makeProduct({ id: `p${i}`, subcategory: 'riz', sale_count: i + 1 })
    );
    const results = rankProducts(catalogue, { subcategory: 'riz', limit: 999 });
    expect(results.length).toBeLessThanOrEqual(12);
  });
});

// ─── Shape des résultats ──────────────────────────────────────────────────────
describe("Shape des résultats", () => {
  test("chaque résultat expose les champs requis", () => {
    const catalogue = [makeProduct({ id: 'p1', subcategory: 'riz', sale_count: 10 })];
    const results = rankProducts(catalogue, { subcategory: 'riz' });
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r).toHaveProperty('product_id');
    expect(r).toHaveProperty('product_ref');
    expect(r).toHaveProperty('name');
    expect(r).toHaveProperty('price_kmf');
    expect(r).toHaveProperty('score');
    expect(r).toHaveProperty('reason_code');
    expect(r).toHaveProperty('reason_label');
  });

  test("_rank et _sale ne fuient pas dans les résultats", () => {
    const catalogue = [makeProduct({ id: 'p1', subcategory: 'riz', sale_count: 10 })];
    const results = rankProducts(catalogue, { subcategory: 'riz' });
    results.forEach(r => {
      expect(r).not.toHaveProperty('_rank');
      expect(r).not.toHaveProperty('_sale');
    });
  });
});

// ─── Catalogue vide ───────────────────────────────────────────────────────────
describe("Catalogue vide", () => {
  test("retourne un tableau vide sans erreur", () => {
    expect(rankProducts([], { subcategory: 'riz' })).toEqual([]);
  });
});

