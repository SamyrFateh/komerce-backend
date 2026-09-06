'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/cost-allocation.test.js
 * Tests de caractérisation — services/cost-allocation.js
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/order-cost-snapshot', () => ({
  lockEstimatedCostsForOrder: jest.fn().mockResolvedValue({ locked: true }),
}));

const db = require('../../db');
const {
  COST_TYPES,
  VARIABLE_COST_TYPES,
  FIXED_COST_TYPES,
  EXCEPTIONAL_COST_TYPES,
  shareByWeight,
  taxableWeight,
  computeOrderCostVariance,
  computeProductCostVariance,
  getOrderCostTruth,
} = require('../../services/cost-allocation');

beforeEach(() => jest.clearAllMocks());

describe('COST_TYPES — constantes doctrine', () => {
  it('contient les 14 types canoniques historiques', () => {
    expect(COST_TYPES).toContain('product_purchase');
    expect(COST_TYPES).toContain('freight');
    expect(COST_TYPES).toContain('customs');
    expect(COST_TYPES).toContain('risk_provision');
    expect(COST_TYPES).toContain('fixed_overhead');
    expect(COST_TYPES).toContain('incident');
    expect(COST_TYPES).toHaveLength(14);
  });

  it('VARIABLE + FIXED + EXCEPTIONAL restent sans chevauchement', () => {
    const all = [...VARIABLE_COST_TYPES, ...FIXED_COST_TYPES, ...EXCEPTIONAL_COST_TYPES];
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
    expect(VARIABLE_COST_TYPES).not.toContain('risk_provision');
  });
});

describe('shareByWeight', () => {
  it('ventile proportionnellement au poids', () => {
    const result = shareByWeight(1000, [
      { id: 'a', weight: 3 },
      { id: 'b', weight: 1 },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find(r => r.id === 'a').share).toBe(750);
    expect(result.find(r => r.id === 'b').share).toBe(250);
  });

  it('share_pct sum ≈ 100', () => {
    const result = shareByWeight(999, [
      { id: 'a', weight: 2 },
      { id: 'b', weight: 3 },
      { id: 'c', weight: 5 },
    ]);
    const pctSum = result.reduce((s, r) => s + r.share_pct, 0);
    expect(Math.round(pctSum)).toBe(100);
  });

  it('retourne shares à 0 si totalWeight = 0', () => {
    const result = shareByWeight(500, [
      { id: 'x', weight: 0 },
      { id: 'y', weight: 0 },
    ]);
    expect(result.every(r => r.share === 0 && r.share_pct === 0)).toBe(true);
  });

  it('retourne tableau vide si entries vide', () => {
    expect(shareByWeight(1000, [])).toEqual([]);
  });

  it('arrondit au KMF entier (Math.round)', () => {
    const result = shareByWeight(1000, [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
      { id: 'c', weight: 1 },
    ]);
    expect(result.every(r => r.share === 333)).toBe(true);
  });
});

describe('taxableWeight', () => {
  it('sea : facteur 1000 — poids volumétrique = volume × 1000', () => {
    expect(taxableWeight(10, 0.5, 'sea')).toBe(500);
  });

  it('sea : poids réel gagne si > volumétrique', () => {
    expect(taxableWeight(50, 0.001, 'sea')).toBe(50);
  });

  it('air : facteur 167 — poids volumétrique = volume × 167', () => {
    expect(taxableWeight(20, 1, 'air')).toBe(167);
  });

  it('mode par défaut = sea', () => {
    expect(taxableWeight(5, 0.01)).toBe(10);
  });

  it('gère les valeurs nulles/undefined gracieusement', () => {
    expect(taxableWeight(null, null)).toBe(0);
    expect(taxableWeight(undefined, undefined, 'air')).toBe(0);
  });
});

describe('computeOrderCostVariance', () => {
  const ORDER_ID = 'order-001';

  it('compare le réel transactionnel à N1+payment et isole N3', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{
          landed: '800',
          business_complete: '1000',
          business_variable: '100',
          risk_provision: '0',
          fixed_overhead: '100',
          imputations_count: 1,
          missing_variable_snapshot_count: 0,
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { cost_type: 'freight', amount: '350', all_actual: true },
          { cost_type: 'customs', amount: '250', all_actual: true },
          { cost_type: 'fixed_overhead', amount: '100', all_actual: true },
        ],
      });

    const result = await computeOrderCostVariance(ORDER_ID);

    expect(result.order_id).toBe(ORDER_ID);
    expect(result.estimated.business_kmf).toBe(1000);
    expect(result.estimated.variable_total_kmf).toBe(900);
    expect(result.real.total_kmf).toBe(700);
    expect(result.real.variable_total_kmf).toBe(600);
    expect(result.real.structure_total_kmf).toBe(100);
    expect(result.variance).toEqual({ scope: 'N1+payment', total_kmf: -300, total_pct: -33.33 });
  });

  it('variance pct null si le périmètre estimé = 0', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        landed: '0', business_complete: '0', business_variable: '0', risk_provision: '0', fixed_overhead: '0',
        imputations_count: 1, missing_variable_snapshot_count: 0,
      }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await computeOrderCostVariance(ORDER_ID);
    expect(result.variance.total_pct).toBeNull();
  });

  it('ne calcule pas de variance si le split N2 manque', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        landed: '800', business_complete: '1000', business_variable: null, risk_provision: '0', fixed_overhead: null,
        imputations_count: 1, missing_variable_snapshot_count: 1,
      }] })
      .mockResolvedValueOnce({ rows: [{ cost_type: 'freight', amount: '600', all_actual: true }] });

    const result = await computeOrderCostVariance(ORDER_ID);
    expect(result.variance).toBeNull();
    expect(result.reconciliation_status).toBe('not_decisional');
  });
});

describe('computeProductCostVariance', () => {
  const PRODUCT_ID = 'prod-001';

  it('retourne variance N1+payment pour un produit avec données', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        product_id: PRODUCT_ID,
        quantity_sold: 10,
        orders_count: 3,
        missing_variable_snapshot_count: 0,
        total_estimated_variable_kmf: '5000',
        total_estimated_contribution_cost_kmf: '5200',
        total_estimated_risk_provision_kmf: '200',
        total_real_variable_kmf: '4500',
        total_real_provision_kmf: '250',
        total_real_structure_kmf: '800',
        total_real_unknown_kmf: '0',
      }],
    });

    const result = await computeProductCostVariance(PRODUCT_ID);

    expect(result.product_id).toBe(PRODUCT_ID);
    expect(result.quantity_sold).toBe(10);
    expect(result.total_estimated_kmf).toBe(5000);
    expect(result.total_real_kmf).toBe(4500);
    expect(result.total_real_structure_kmf).toBe(800);
    expect(result.variance_kmf).toBe(-500);
    expect(result.variance_pct).toBeCloseTo(-10, 1);
    expect(result.variance_scope).toBe('N1+payment');
    expect(result.risk_provision_status).toBe('period_reconciliation_pending');
  });

  it('retourne { no_data: true } si aucune imputation', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await computeProductCostVariance(PRODUCT_ID);
    expect(result.no_data).toBe(true);
  });
});

const ORDER_ROW = {
  id: 'order-001',
  reference: 'CMD-001',
  status: 'delivered',
  payment_status: 'paid',
  total_kmf: '10000',
  created_at: new Date(),
};

const EST_ROW_FULL = {
  imputations_count: '3',
  items_quantity: '5',
  sale_total: '10000',
  estimated_landed: '5000',
  estimated_business: '8000',
  estimated_business_variable: '1500',
  estimated_fixed_overhead: '1500',
  estimated_risk_provision: '200',
  expected_product_purchase: '3000',
  expected_sourcing: '0',
  expected_hub: '400',
  expected_packaging: '0',
  expected_freight: '1000',
  expected_customs: '500',
  expected_port_transitary: '0',
  expected_local_distribution: '200',
  expected_relay: '300',
  expected_payment: '100',
  missing_variable_snapshot_count: '0',
  estimated_margin: '2000',
};

function allRealTypes() {
  return [
    { cost_type: 'product_purchase', amount: '3000', all_actual: true },
    { cost_type: 'freight', amount: '1000', all_actual: true },
    { cost_type: 'customs', amount: '500', all_actual: true },
    { cost_type: 'local_distribution', amount: '200', all_actual: true },
    { cost_type: 'relay', amount: '300', all_actual: true },
    { cost_type: 'hub', amount: '400', all_actual: true },
    { cost_type: 'risk_provision', amount: '200', all_actual: true },
    { cost_type: 'fixed_overhead', amount: '300', all_actual: true },
    { cost_type: 'payment', amount: '100', all_actual: true },
  ];
}

describe('getOrderCostTruth — cost_status = actual', () => {
  it('conserve actual quand toutes les preuves transactionnelles attendues sont présentes', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ORDER_ROW] })
      .mockResolvedValueOnce({ rows: [EST_ROW_FULL] })
      .mockResolvedValueOnce({ rows: allRealTypes() });

    const result = await getOrderCostTruth('order-001');

    expect(result.cost_status).toBe('actual');
    expect(result.cost_status_scope).toBe('transaction_variable_actual_with_period_risk_provision');
    expect(result.missing_cost_fields).toHaveLength(0);
    expect(result.real.margin_kmf).not.toBeNull();
    expect(result.estimated.business_variable_cost_kmf).toBe(1500);
    expect(result.estimated.risk_provision_kmf).toBe(200);
    expect(result.estimated.fixed_overhead_kmf).toBe(1500);
  });
});

describe('getOrderCostTruth — cost_status = estimated', () => {
  it('retourne estimated si aucun coût réel alloué', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ORDER_ROW] })
      .mockResolvedValueOnce({ rows: [EST_ROW_FULL] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getOrderCostTruth('order-001');

    expect(result.cost_status).toBe('estimated');
    expect(result.real.total_kmf).toBeNull();
    expect(result.real.margin_kmf).toBeNull();
  });
});

describe('getOrderCostTruth — cost_status = partial_real', () => {
  it('retourne partial_real si freight attendu est manquant', async () => {
    const realWithoutFreight = allRealTypes().filter(r => r.cost_type !== 'freight');

    db.query
      .mockResolvedValueOnce({ rows: [ORDER_ROW] })
      .mockResolvedValueOnce({ rows: [EST_ROW_FULL] })
      .mockResolvedValueOnce({ rows: realWithoutFreight });

    const result = await getOrderCostTruth('order-001');

    expect(result.cost_status).toBe('partial_real');
    expect(result.missing_cost_fields).toContain('freight');
    expect(result.real.margin_kmf).toBeNull();
  });
});

describe('getOrderCostTruth — cost_status = incomplete', () => {
  it('retourne incomplete si aucune imputation estimée', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ORDER_ROW] })
      .mockResolvedValueOnce({ rows: [{ ...EST_ROW_FULL, imputations_count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getOrderCostTruth('order-001');
    expect(result.cost_status).toBe('incomplete');
  });
});

describe('getOrderCostTruth — order introuvable', () => {
  it('retourne null si order inconnue', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await getOrderCostTruth('unknown');
    expect(result).toBeNull();
  });
});

describe('getOrderCostTruth — variance', () => {
  it('calcule la variance sur N1+payment et exclut provision risque + fixed_overhead du réel', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ORDER_ROW] })
      .mockResolvedValueOnce({ rows: [EST_ROW_FULL] })
      .mockResolvedValueOnce({ rows: allRealTypes() });

    const result = await getOrderCostTruth('order-001');
    const variableReal = allRealTypes()
      .filter(r => !['fixed_overhead', 'risk_provision'].includes(r.cost_type))
      .reduce((s, r) => s + Number(r.amount), 0);
    const estimatedVariable = 5000 + 1500 - 200;

    expect(result.variance.scope).toBe('N1+payment');
    expect(result.variance.total_kmf).toBe(Math.round(variableReal - estimatedVariable));
    expect(typeof result.variance.total_pct).toBe('number');
  });
});
