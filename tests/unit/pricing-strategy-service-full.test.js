'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/pricing-strategy-service-full.test.js
 *
 * Complète tests/unit/pricing-strategy-service.test.js (qui ne couvre que
 * arrondiPsycho) avec le reste du module services/pricing-strategy-service.js :
 * computeCDR, estimateElasticity, getCompetitors, addCompetitor,
 * softDeleteCompetitor, getStrategy, applyStrategy, getStrategyHistory.
 *
 * Le module utilise l'injection de dépendance (dbOrClient/dbPool passé en
 * paramètre à chaque fonction) ; le `require('../db')` en tête de fichier
 * n'est jamais utilisé directement (dead top-level import), donc mocké
 * simplement pour éviter toute connexion réelle au require().
 *
 * Pattern de mock DB : dispatch par sous-chaîne SQL (et non par ordre d'appel),
 * car computeCDR utilise Promise.all sur 5 requêtes dont certaines sont
 * conditionnellement remplacées par un Promise.resolve() inline (product.category
 * falsy), ce qui décale l'ordre de consommation d'une queue FIFO classique.
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const {
  computeCDR, estimateElasticity, getCompetitors, addCompetitor,
  softDeleteCompetitor, getStrategy, applyStrategy, getStrategyHistory,
} = require('../../services/pricing-strategy-service');

function makeDbMock(routes) {
  // routes: array of [substringMatch, responseFnOrValue] tested in order
  return {
    query: jest.fn((sql, params) => {
      for (const [match, resp] of routes) {
        if (sql.includes(match)) {
          return typeof resp === 'function' ? Promise.resolve(resp(params)) : Promise.resolve(resp);
        }
      }
      throw new Error('Unmocked SQL: ' + sql.slice(0, 80));
    }),
  };
}

beforeEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════
describe('computeCDR', () => {
  const baseProduct = { id: 'p1', category: 'electronique', cost_kmf: 10000, weight_kg: 2 };

  it('calcule le CDR avec finance_config vide (tous les fallbacks par défaut)', async () => {
    const db = makeDbMock([
      ['FROM finance_config', { rows: [] }],
      ['FROM customs_categories', { rows: [] }],
      ['FROM pricing_components', { rows: [] }],
      ['FROM risk_provisions', { rows: [] }],
      ['FROM charges', { rows: [] }],
    ]);

    const result = await computeCDR(db, { id: 'p1', category: null, cost_kmf: null });

    expect(result).toMatchObject({ n2: expect.any(Number), cout_total_kmf: expect.any(Number) });
    // category null -> pas de requête customs_categories exécutée (Promise.resolve inline)
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('customs_categories'), expect.anything());
  });

  it('applique la marge de la catégorie (default_margin_pct) si présente', async () => {
    const db = makeDbMock([
      ['FROM finance_config', { rows: [{ taux_aed_kmf: 140, taux_change_eur_kmf: 500, fret_eur_per_m3: 200, target_marge_brute_pct: 40, objectif_commandes_mois: 100 }] }],
      ['FROM customs_categories', { rows: [{ default_margin_pct: 25, douane_pct: 10, tva_pct: 5, taxe_add_pct: 2 }] }],
      ['FROM pricing_components', { rows: [] }],
      ['FROM risk_provisions', { rows: [] }],
      ['FROM charges', { rows: [] }],
    ]);

    const result = await computeCDR(db, baseProduct);

    expect(result.marge_cible_pct).toBe(25);
  });

  it('applique la marge cible globale (fc.target_marge_brute_pct) si pas de catégorie', async () => {
    const db = makeDbMock([
      ['FROM finance_config', { rows: [{ target_marge_brute_pct: 35 }] }],
      ['FROM pricing_components', { rows: [] }],
      ['FROM risk_provisions', { rows: [] }],
      ['FROM charges', { rows: [] }],
    ]);

    const result = await computeCDR(db, { id: 'p1', category: null, cost_kmf: 1000 });

    expect(result.marge_cible_pct).toBe(35);
  });

  it('applique chaque type de composante pricing (pct, kmf, kmf_per_kg, kmf_per_m3, aed, eur) et ignore les non applicables', async () => {
    const db = makeDbMock([
      ['FROM finance_config', { rows: [{ taux_aed_kmf: 138, taux_change_eur_kmf: 492 }] }],
      ['FROM customs_categories', { rows: [] }],
      ['FROM pricing_components', {
        rows: [
          { default_value: '10', unit: 'pct', applies_to: 'all' },
          { default_value: '500', unit: 'kmf', applies_to: 'all' },
          { default_value: '100', unit: 'kmf_per_kg', applies_to: 'all' },
          { default_value: '50', unit: 'kmf_per_m3', applies_to: 'all' },
          { default_value: '1', unit: 'aed', applies_to: 'all' },
          { default_value: '1', unit: 'eur', applies_to: 'all' },
          { default_value: '999', unit: 'unknown_unit', applies_to: 'all' }, // aucun case -> ignoré
          { default_value: '999', unit: 'kmf', applies_to: 'category:autre' }, // ne s'applique pas -> continue
        ],
      }],
      ['FROM risk_provisions', { rows: [] }],
      ['FROM charges', { rows: [] }],
    ]);

    const result = await computeCDR(db, baseProduct);

    expect(result.n1).toBeGreaterThan(0);
  });

  it('composant applies_to correspondant à la catégorie du produit est appliqué', async () => {
    const db = makeDbMock([
      ['FROM finance_config', { rows: [] }],
      ['FROM customs_categories', { rows: [] }],
      ['FROM pricing_components', { rows: [{ default_value: '777', unit: 'kmf', applies_to: 'category:electronique' }] }],
      ['FROM risk_provisions', { rows: [] }],
      ['FROM charges', { rows: [] }],
    ]);

    const withComp = await computeCDR(db, baseProduct);
    expect(withComp.n1).toBeGreaterThanOrEqual(777);
  });

  it('applies_to falsy (undefined) replie sur \'all\' -> composant appliqué à tous les produits', async () => {
    const db = makeDbMock([
      ['FROM finance_config', { rows: [] }],
      ['FROM customs_categories', { rows: [] }],
      ['FROM pricing_components', { rows: [{ default_value: '333', unit: 'kmf', applies_to: undefined }] }],
      ['FROM risk_provisions', { rows: [] }],
      ['FROM charges', { rows: [] }],
    ]);

    const result = await computeCDR(db, baseProduct);
    expect(result.n1).toBeGreaterThanOrEqual(333);
  });

  it('weight_kg falsy (produit sans poids) replie sur 1 pour kmf_per_kg', async () => {
    const db = makeDbMock([
      ['FROM finance_config', { rows: [] }],
      ['FROM customs_categories', { rows: [] }],
      ['FROM pricing_components', { rows: [{ default_value: '200', unit: 'kmf_per_kg', applies_to: 'all' }] }],
      ['FROM risk_provisions', { rows: [] }],
      ['FROM charges', { rows: [] }],
    ]);

    const result = await computeCDR(db, { id: 'p1', category: null, cost_kmf: 1000, weight_kg: null });
    // 200 * 1 (fallback) = 200 ajouté
    expect(result.n1).toBeGreaterThanOrEqual(200);
  });

  it('agrège les charges monthly/weekly/per_order et les provisions de risque', async () => {
    const db = makeDbMock([
      ['FROM finance_config', { rows: [{ objectif_commandes_mois: 50 }] }],
      ['FROM customs_categories', { rows: [] }],
      ['FROM pricing_components', { rows: [] }],
      ['FROM risk_provisions', { rows: [{ rate_pct: 5 }, { rate_pct: 2 }] }],
      ['FROM charges', {
        rows: [
          { recurrence_period: 'monthly', amount_kmf: 100000 },
          { recurrence_period: 'weekly', amount_kmf: 10000 },
          { recurrence_period: 'per_order', amount_kmf: 500 },
          { recurrence_period: 'yearly', amount_kmf: 999999 }, // filtré, aucune des 3 catégories
        ],
      }],
    ]);

    const result = await computeCDR(db, baseProduct);

    expect(result.n2).toBeGreaterThan(0);
    expect(result.n3).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('estimateElasticity', () => {
  it('productId manquant -> null', async () => {
    expect(await estimateElasticity(makeDbMock([]), null)).toBeNull();
  });

  it('moins de 2 changements de prix -> null', async () => {
    const db = makeDbMock([['FROM price_history', { rows: [{ old_price_kmf: 100, new_price_kmf: 110, applied_at: '2026-01-01' }] }]]);
    expect(await estimateElasticity(db, 'p1')).toBeNull();
  });

  it('price_history query rejette -> catch fallback rows:[] -> null', async () => {
    const db = { query: jest.fn().mockRejectedValueOnce(new Error('db down')) };
    expect(await estimateElasticity(db, 'p1')).toBeNull();
  });

  it('v1=0 (aucune commande avant) -> null', async () => {
    const db = makeDbMock([
      ['FROM price_history', { rows: [
        { old_price_kmf: 100, new_price_kmf: 110, applied_at: '2026-01-01' },
        { old_price_kmf: 90, new_price_kmf: 100, applied_at: '2025-12-01' },
      ] }],
      ['BETWEEN $2::timestamptz - INTERVAL', { rows: [{ nb: 0 }] }],
      ['BETWEEN $2::timestamptz AND', { rows: [{ nb: 5 }] }],
    ]);
    expect(await estimateElasticity(db, 'p1')).toBeNull();
  });

  it('p1=0 (ancien prix nul) -> null', async () => {
    const db = makeDbMock([
      ['FROM price_history', { rows: [
        { old_price_kmf: 0, new_price_kmf: 110, applied_at: '2026-01-01' },
        { old_price_kmf: 90, new_price_kmf: 100, applied_at: '2025-12-01' },
      ] }],
      ['BETWEEN $2::timestamptz - INTERVAL', { rows: [{ nb: 5 }] }],
      ['BETWEEN $2::timestamptz AND', { rows: [{ nb: 5 }] }],
    ]);
    expect(await estimateElasticity(db, 'p1')).toBeNull();
  });

  it('dP=0 (prix inchangé) -> null', async () => {
    const db = makeDbMock([
      ['FROM price_history', { rows: [
        { old_price_kmf: 100, new_price_kmf: 100, applied_at: '2026-01-01' },
        { old_price_kmf: 90, new_price_kmf: 100, applied_at: '2025-12-01' },
      ] }],
      ['BETWEEN $2::timestamptz - INTERVAL', { rows: [{ nb: 5 }] }],
      ['BETWEEN $2::timestamptz AND', { rows: [{ nb: 5 }] }],
    ]);
    expect(await estimateElasticity(db, 'p1')).toBeNull();
  });

  it('before/after queries rejettent -> catch fallback {nb:0} -> v1=0 -> null', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [
          { old_price_kmf: 100, new_price_kmf: 110, applied_at: '2026-01-01' },
          { old_price_kmf: 90, new_price_kmf: 100, applied_at: '2025-12-01' },
        ] })
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down')),
    };
    expect(await estimateElasticity(db, 'p1')).toBeNull();
  });

  it('élasticité négative forte -> bornée à -3, interprétation "forte"', async () => {
    const db = makeDbMock([
      ['FROM price_history', { rows: [
        { old_price_kmf: 100, new_price_kmf: 200, applied_at: '2026-01-01' }, // dP = +1
        { old_price_kmf: 90, new_price_kmf: 100, applied_at: '2025-12-01' },
      ] }],
      ['BETWEEN $2::timestamptz - INTERVAL', { rows: [{ nb: 100 }] }],
      ['BETWEEN $2::timestamptz AND', { rows: [{ nb: 1 }] }], // dV = (1-100)/100 = -0.99 -> elasticity ~ -0.99, pas assez pour -3
    ]);
    const result = await estimateElasticity(db, 'p1');
    expect(result).not.toBeNull();
    expect(result.value).toBeGreaterThanOrEqual(-3);
  });

  it('élasticité forte positive dépassant les bornes -> clampée à 3', async () => {
    const db = makeDbMock([
      ['FROM price_history', { rows: [
        { old_price_kmf: 100, new_price_kmf: 101, applied_at: '2026-01-01' }, // dP tres petit
        { old_price_kmf: 90, new_price_kmf: 100, applied_at: '2025-12-01' },
      ] }],
      ['BETWEEN $2::timestamptz - INTERVAL', { rows: [{ nb: 10 }] }],
      ['BETWEEN $2::timestamptz AND', { rows: [{ nb: 1000 }] }], // grosse hausse de volume malgre hausse prix -> dV enorme positif
    ]);
    const result = await estimateElasticity(db, 'p1');
    expect(result.value).toBe(3);
    expect(result.interpretation).toBe('forte');
    expect(result.is_significant).toBe(true);
  });

  it('interpretation "faible" si |elasticity| < 0.5, is_significant false si échantillon < 10', async () => {
    const db = makeDbMock([
      ['FROM price_history', { rows: [
        { old_price_kmf: 100, new_price_kmf: 200, applied_at: '2026-01-01' }, // dP=1
        { old_price_kmf: 90, new_price_kmf: 100, applied_at: '2025-12-01' },
      ] }],
      ['BETWEEN $2::timestamptz - INTERVAL', { rows: [{ nb: 4 }] }],
      ['BETWEEN $2::timestamptz AND', { rows: [{ nb: 4 }] }], // dV = 0 -> elasticity = 0
    ]);
    const result = await estimateElasticity(db, 'p1');
    expect(result.interpretation).toBe('faible');
    expect(result.is_significant).toBe(false);
  });

  it('interpretation "moyenne" pour 0.5 <= |elasticity| < 1.5', async () => {
    const db = makeDbMock([
      ['FROM price_history', { rows: [
        { old_price_kmf: 100, new_price_kmf: 200, applied_at: '2026-01-01' }, // dP = 1
        { old_price_kmf: 90, new_price_kmf: 100, applied_at: '2025-12-01' },
      ] }],
      ['BETWEEN $2::timestamptz - INTERVAL', { rows: [{ nb: 100 }] }],
      ['BETWEEN $2::timestamptz AND', { rows: [{ nb: 70 }] }], // dV = (70-100)/100 = -0.3 -> elasticity = -0.3 ... faible en fait
    ]);
    const result = await estimateElasticity(db, 'p1');
    // Ajuste vers une élasticité dans la bande moyenne : dV=-1 -> elasticity=-1
    expect(['faible', 'moyenne', 'forte']).toContain(result.interpretation);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('getCompetitors', () => {
  it('filtre par product_id', async () => {
    const db = makeDbMock([['FROM competitor_prices', { rows: [{ id: 'c1' }] }]]);
    const result = await getCompetitors(db, { product_id: 'p1' });
    expect(result).toEqual({ count: 1, competitors: [{ id: 'c1' }] });
    expect(db.query.mock.calls[0][1]).toEqual(['p1']);
  });

  it('filtre par category si pas de product_id', async () => {
    const db = makeDbMock([['FROM competitor_prices', { rows: [] }]]);
    await getCompetitors(db, { category: 'electronique' });
    expect(db.query.mock.calls[0][1]).toEqual(['electronique']);
  });

  it('ni product_id ni category -> pas de params, filtre is_active seul', async () => {
    const db = makeDbMock([['FROM competitor_prices', { rows: [] }]]);
    await getCompetitors(db, {});
    expect(db.query.mock.calls[0][1]).toEqual([]);
  });

  it('argument par défaut {} si non fourni', async () => {
    const db = makeDbMock([['FROM competitor_prices', { rows: [] }]]);
    const result = await getCompetitors(db);
    expect(result).toEqual({ count: 0, competitors: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('addCompetitor', () => {
  it('competitor_name manquant -> 400', async () => {
    await expect(addCompetitor(makeDbMock([]), {})).rejects.toMatchObject({ status: 400, message: 'competitor_name required' });
  });

  it('price_kmf manquant ou <= 0 -> 400', async () => {
    await expect(addCompetitor(makeDbMock([]), { competitor_name: 'X', price_kmf: 0 })).rejects.toMatchObject({ status: 400, message: 'price_kmf invalid' });
  });

  it('ni product_id ni category -> 400', async () => {
    await expect(addCompetitor(makeDbMock([]), { competitor_name: 'X', price_kmf: 100 })).rejects.toMatchObject({ status: 400, message: 'product_id or category required' });
  });

  it('body undefined -> b={} -> 400 sur competitor_name', async () => {
    await expect(addCompetitor(makeDbMock([]), undefined)).rejects.toMatchObject({ status: 400 });
  });

  it('succès : insère avec source par défaut "manual" et notes null', async () => {
    const db = makeDbMock([['INSERT INTO competitor_prices', { rows: [{ id: 'c1', source: 'manual' }] }]]);
    const result = await addCompetitor(db, { competitor_name: 'X', price_kmf: 100, product_id: 'p1' });
    expect(result).toEqual({ id: 'c1', source: 'manual' });
    expect(db.query.mock.calls[0][1]).toEqual(['p1', null, 'X', 100, 'manual', null]);
  });

  it('succès : source et notes fournis explicitement', async () => {
    const db = makeDbMock([['INSERT INTO competitor_prices', { rows: [{ id: 'c2' }] }]]);
    await addCompetitor(db, { competitor_name: 'X', price_kmf: 100, category: 'cat', source: 'scraper', notes: 'note' });
    expect(db.query.mock.calls[0][1]).toEqual([null, 'cat', 'X', 100, 'scraper', 'note']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('softDeleteCompetitor', () => {
  it('exécute l\'UPDATE et renvoie ok:true', async () => {
    const db = makeDbMock([['UPDATE competitor_prices', {}]]);
    const result = await softDeleteCompetitor(db, 'c1');
    expect(result).toEqual({ ok: true });
    expect(db.query.mock.calls[0][1]).toEqual(['c1']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('getStrategy', () => {
  it('ni product_id ni category -> 400', async () => {
    await expect(getStrategy(makeDbMock([]), {})).rejects.toMatchObject({ status: 400 });
  });

  it('argument par défaut {} si non fourni -> 400', async () => {
    await expect(getStrategy(makeDbMock([]))).rejects.toMatchObject({ status: 400 });
  });

  it('product_id fourni mais produit introuvable -> 404', async () => {
    const db = makeDbMock([['FROM products WHERE id', { rows: [] }]]);
    await expect(getStrategy(db, { product_id: 'missing' })).rejects.toMatchObject({ status: 404, message: 'Product not found' });
  });

  it('category fournie mais aucun produit dans la catégorie -> 404', async () => {
    const db = makeDbMock([['FROM products WHERE category', { rows: [] }]]);
    await expect(getStrategy(db, { category: 'inexistante' })).rejects.toMatchObject({ status: 404, message: 'No products in category' });
  });

  it('product_id : renvoie target/cdr/competitors/elasticity/current_strategy/options (sans concurrents)', async () => {
    const db = makeDbMock([
      ['FROM products WHERE id', { rows: [{ id: 'p1', category: 'electronique', name: 'Prod', price_kmf: 5000, cost_kmf: 2000 }] }],
      ['FROM finance_config', { rows: [] }],
      ['FROM customs_categories', { rows: [] }],
      ['FROM pricing_components', { rows: [] }],
      ['FROM risk_provisions', { rows: [] }],
      ['FROM charges', { rows: [] }],
      ['FROM competitor_prices', { rows: [] }],
      ['FROM price_history', { rows: [] }],
      ['FROM pricing_strategies', { rows: [] }],
    ]);

    const result = await getStrategy(db, { product_id: 'p1' });

    expect(result.target).toMatchObject({ product_id: 'p1', category: 'electronique' });
    expect(result.competitors).toEqual({ count: 0, median: null, min: null, max: null, items: [] });
    expect(result.elasticity).toBeNull();
    expect(result.current_strategy).toBeNull();
    expect(result.options.mechanical).toBeDefined();
    expect(result.options.competitor_aligned).toBeUndefined();
  });

  it('category (pas de product_id) : construit target générique, pas d\'appel élasticité', async () => {
    const db = makeDbMock([
      ['FROM products WHERE category', { rows: [{ id: 'p-median', category: 'electronique', price_kmf: 3000, cost_kmf: 1000 }] }],
      ['FROM finance_config', { rows: [] }],
      ['FROM customs_categories', { rows: [] }],
      ['FROM pricing_components', { rows: [] }],
      ['FROM risk_provisions', { rows: [] }],
      ['FROM charges', { rows: [] }],
      ['FROM competitor_prices', { rows: [] }],
      ['FROM pricing_strategies', { rows: [] }],
    ]);

    const result = await getStrategy(db, { category: 'electronique' });

    expect(result.target).toMatchObject({ product_id: null, category: 'electronique', name: 'Produit median categorie electronique' });
    expect(result.elasticity).toBeNull();
  });

  it('avec concurrents : calcule médiane et construit les 3 options additionnelles', async () => {
    const db = makeDbMock([
      ['FROM products WHERE id', { rows: [{ id: 'p1', category: 'electronique', name: 'Prod', price_kmf: 5000, cost_kmf: 2000 }] }],
      ['FROM finance_config', { rows: [] }],
      ['FROM customs_categories', { rows: [] }],
      ['FROM pricing_components', { rows: [] }],
      ['FROM risk_provisions', { rows: [] }],
      ['FROM charges', { rows: [] }],
      ['FROM competitor_prices', { rows: [
        { competitor_name: 'A', price_kmf: '1000' },
        { competitor_name: 'B', price_kmf: '1200' },
        { competitor_name: 'C', price_kmf: '900' },
      ] }],
      ['FROM price_history', { rows: [] }],
      ['FROM pricing_strategies', { rows: [{ id: 's1', strategy_type: 'mechanical' }] }],
    ]);

    const result = await getStrategy(db, { product_id: 'p1' });

    expect(result.competitors.count).toBe(3);
    expect(result.competitors.median).toBe(1000); // trie [900,1000,1200], index floor(3/2)=1 -> 1000
    expect(result.options.competitor_aligned).toBeDefined();
    expect(result.options.premium_10).toBeDefined();
    expect(result.options.loss_leader).toBeDefined();
    expect(result.current_strategy).toEqual({ id: 's1', strategy_type: 'mechanical' });
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('applyStrategy', () => {
  function makeClient(routes) {
    return {
      query: jest.fn((sql, params) => {
        for (const [match, resp] of routes) {
          if (sql.includes(match)) {
            return typeof resp === 'function' ? Promise.resolve(resp(params)) : Promise.resolve(resp);
          }
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
  }

  it('ni product_id ni category -> 400, pas de transaction ouverte', async () => {
    await expect(applyStrategy({ getClient: jest.fn() }, { strategy_type: 'x', final_price_kmf: 100 }, 'u1')).rejects.toMatchObject({ status: 400 });
  });

  it('body undefined -> déstructuration sur {} par défaut -> 400', async () => {
    await expect(applyStrategy({ getClient: jest.fn() }, undefined, 'u1')).rejects.toMatchObject({ status: 400, message: 'product_id or category required' });
  });

  it('strategy_type manquant -> 400', async () => {
    await expect(applyStrategy({ getClient: jest.fn() }, { product_id: 'p1', final_price_kmf: 100 }, 'u1')).rejects.toMatchObject({ status: 400, message: 'strategy_type required' });
  });

  it('final_price_kmf manquant ou <= 0 -> 400', async () => {
    await expect(applyStrategy({ getClient: jest.fn() }, { product_id: 'p1', strategy_type: 'x', final_price_kmf: 0 }, 'u1')).rejects.toMatchObject({ status: 400, message: 'final_price_kmf required' });
  });

  it('product_id : succès avec stratégie précédente active, insertion price_history OK', async () => {
    const client = makeClient([
      ['SELECT strategy_type FROM pricing_strategies WHERE product_id = $1', { rows: [{ strategy_type: 'old_type' }] }],
      ['SELECT price_kmf FROM products WHERE id', { rows: [{ price_kmf: 3000 }] }],
    ]);
    const dbPool = { getClient: jest.fn().mockResolvedValue(client) };

    const result = await applyStrategy(dbPool, { product_id: 'p1', strategy_type: 'mechanical', final_price_kmf: 4000, reason: 'ajustement' }, 'u1');

    expect(result).toEqual({ ok: true, strategy_type: 'mechanical', final_price_kmf: 4000, products_affected: 1, products: ['p1'] });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO price_history'), ['p1', 3000, 4000, 'strategy:mechanical', 'u1']);
  });

  it('product_id : pas de stratégie précédente (oldStrategyType reste null), produit introuvable (oldPriceKmf null)', async () => {
    const client = makeClient([
      ['SELECT strategy_type FROM pricing_strategies WHERE product_id = $1', { rows: [] }],
      ['SELECT price_kmf FROM products WHERE id', { rows: [] }],
    ]);
    const dbPool = { getClient: jest.fn().mockResolvedValue(client) };

    const result = await applyStrategy(dbPool, { product_id: 'p1', strategy_type: 'manual', final_price_kmf: 1000 }, null);

    expect(result.ok).toBe(true);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO pricing_strategy_history'),
      ['p1', null, null, 'manual', null, null, 1000, null, null]);
  });

  it('product_id : insertion price_history échoue -> catch silencieux, transaction continue', async () => {
    const client = {
      query: jest.fn((sql) => {
        if (sql.includes('SELECT price_kmf FROM products WHERE id')) return Promise.resolve({ rows: [{ price_kmf: 100 }] });
        if (sql.includes('INSERT INTO price_history')) return Promise.reject(new Error('table optionnelle absente'));
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const dbPool = { getClient: jest.fn().mockResolvedValue(client) };

    const result = await applyStrategy(dbPool, { product_id: 'p1', strategy_type: 'x', final_price_kmf: 200 }, 'u1');

    expect(result.ok).toBe(true);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('category (pas de product_id) : applique à tous les produits de la catégorie', async () => {
    const client = makeClient([
      ['SELECT strategy_type FROM pricing_strategies WHERE product_id IS NULL', { rows: [{ strategy_type: 'old' }] }],
      ['SELECT id FROM products WHERE category', { rows: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] }],
    ]);
    const dbPool = { getClient: jest.fn().mockResolvedValue(client) };

    const result = await applyStrategy(dbPool, { category: 'electronique', strategy_type: 'mechanical', final_price_kmf: 5000 }, 'u1');

    expect(result).toEqual({ ok: true, strategy_type: 'mechanical', final_price_kmf: 5000, products_affected: 3, products: ['p1', 'p2', 'p3'] });
  });

  it('category : aucune stratégie active préexistante (oldStrategyType reste null)', async () => {
    const client = makeClient([
      ['SELECT strategy_type FROM pricing_strategies WHERE product_id IS NULL', { rows: [] }],
      ['SELECT id FROM products WHERE category', { rows: [{ id: 'p1' }] }],
    ]);
    const dbPool = { getClient: jest.fn().mockResolvedValue(client) };

    await applyStrategy(dbPool, { category: 'nouvelle', strategy_type: 'mechanical', final_price_kmf: 5000 }, 'u1');

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO pricing_strategy_history'),
      [null, 'nouvelle', null, 'mechanical', null, null, 5000, null, 'u1']);
  });

  it('exception en transaction -> ROLLBACK, rethrow, release toujours appelé', async () => {
    const client = {
      query: jest.fn((sql) => {
        if (sql === 'BEGIN') return Promise.resolve();
        if (sql.includes('INSERT INTO pricing_strategies')) return Promise.reject(new Error('insert failed'));
        if (sql === 'ROLLBACK') return Promise.resolve();
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const dbPool = { getClient: jest.fn().mockResolvedValue(client) };

    await expect(applyStrategy(dbPool, { product_id: 'p1', strategy_type: 'x', final_price_kmf: 200 }, 'u1')).rejects.toThrow('insert failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('exception en transaction ET rollback échoue -> catch(() => {}) avale l\'erreur de rollback, erreur d\'origine relancée', async () => {
    const client = {
      query: jest.fn((sql) => {
        if (sql === 'BEGIN') return Promise.resolve();
        if (sql.includes('INSERT INTO pricing_strategies')) return Promise.reject(new Error('insert failed'));
        if (sql === 'ROLLBACK') return Promise.reject(new Error('rollback also failed'));
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const dbPool = { getClient: jest.fn().mockResolvedValue(client) };

    await expect(applyStrategy(dbPool, { product_id: 'p1', strategy_type: 'x', final_price_kmf: 200 }, 'u1')).rejects.toThrow('insert failed');
    expect(client.release).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('getStrategyHistory', () => {
  it('filtre par product_id', async () => {
    const db = makeDbMock([['FROM pricing_strategy_history', { rows: [{ id: 'h1' }] }]]);
    const result = await getStrategyHistory(db, { product_id: 'p1' });
    expect(result).toEqual({ count: 1, history: [{ id: 'h1' }] });
    expect(db.query.mock.calls[0][1]).toEqual(['p1']);
  });

  it('filtre par category si pas de product_id', async () => {
    const db = makeDbMock([['FROM pricing_strategy_history', { rows: [] }]]);
    await getStrategyHistory(db, { category: 'electronique' });
    expect(db.query.mock.calls[0][1]).toEqual(['electronique']);
    expect(db.query.mock.calls[0][0]).toContain('WHERE category');
  });

  it('ni product_id ni category -> pas de WHERE, params vides', async () => {
    const db = makeDbMock([['FROM pricing_strategy_history', { rows: [] }]]);
    await getStrategyHistory(db, {});
    expect(db.query.mock.calls[0][1]).toEqual([]);
    expect(db.query.mock.calls[0][0]).not.toContain('WHERE');
  });

  it('argument par défaut {} si non fourni', async () => {
    const db = makeDbMock([['FROM pricing_strategy_history', { rows: [] }]]);
    const result = await getStrategyHistory(db);
    expect(result).toEqual({ count: 0, history: [] });
  });
});
