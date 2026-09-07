'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../services/order-cost-snapshot', () => ({
  lockEstimatedCostsForOrder: jest.fn(),
}));

const orderCostSnapshot = require('../../services/order-cost-snapshot');
const {
  COST_TYPES,
  ALLOCATION_METHODS,
  VARIABLE_COST_TYPES,
  FIXED_COST_TYPES,
  EXCEPTIONAL_COST_TYPES,
  shareByWeight,
  taxableWeight,
  lockEstimatedCostsForOrder,
} = require('../../services/cost-allocation/_helpers');
const {
  SNAPSHOT_LANDED_TO_REAL_COST_TYPE,
  N2_PROVISION_COST_TYPES,
  CONTRIBUTION_COST_TYPES,
  classifyOrderAllocationCostType,
} = require('../../services/cost-allocation/cost-types');

describe('cost-allocation/_helpers', () => {
  describe('constantes doctrine', () => {
    it('sont figees (Object.freeze) pour eviter une mutation accidentelle', () => {
      expect(Object.isFrozen(COST_TYPES)).toBe(true);
      expect(Object.isFrozen(ALLOCATION_METHODS)).toBe(true);
      expect(Object.isFrozen(VARIABLE_COST_TYPES)).toBe(true);
      expect(Object.isFrozen(FIXED_COST_TYPES)).toBe(true);
      expect(Object.isFrozen(EXCEPTIONAL_COST_TYPES)).toBe(true);
    });

    it('chaque cost type variable/fixe/exceptionnel appartient bien a COST_TYPES', () => {
      const all = [...VARIABLE_COST_TYPES, ...FIXED_COST_TYPES, ...EXCEPTIONAL_COST_TYPES];
      all.forEach((type) => expect(COST_TYPES).toContain(type));
      N2_PROVISION_COST_TYPES.forEach((type) => expect(COST_TYPES).toContain(type));
    });

    it('les sous-categories transactionnelles/fixes/exceptionnelles sont mutuellement exclusives', () => {
      const variable = new Set(VARIABLE_COST_TYPES);
      const fixed = new Set(FIXED_COST_TYPES);
      const exceptional = new Set(EXCEPTIONAL_COST_TYPES);
      FIXED_COST_TYPES.forEach((t) => expect(variable.has(t)).toBe(false));
      EXCEPTIONAL_COST_TYPES.forEach((t) => {
        expect(variable.has(t)).toBe(false);
        expect(fixed.has(t)).toBe(false);
      });
    });

    it('fige la classification économique sans traiter la provision risque comme cash commande', () => {
      expect(VARIABLE_COST_TYPES).toEqual(expect.arrayContaining([
        'product_purchase', 'sourcing', 'hub', 'packaging', 'freight', 'customs',
        'port_transitaire', 'local_distribution', 'relay', 'payment',
      ]));
      expect(VARIABLE_COST_TYPES).not.toContain('risk_provision');
      expect(CONTRIBUTION_COST_TYPES).toContain('risk_provision');
      expect(FIXED_COST_TYPES).toEqual(['fixed_overhead']);
      expect(classifyOrderAllocationCostType('risk_provision')).toBe('provision');
      expect(classifyOrderAllocationCostType('made_up_cost')).toBe('unknown');
    });

    it('centralise la correspondance port_transitary snapshot vers port_transitaire réel', () => {
      expect(SNAPSHOT_LANDED_TO_REAL_COST_TYPE.port_transitary).toBe('port_transitaire');
    });
  });

  describe('shareByWeight', () => {
    it('repartit un total proportionnellement aux poids', () => {
      const result = shareByWeight(900, [
        { id: 'a', weight: 1 },
        { id: 'b', weight: 2 },
      ]);
      expect(result).toEqual([
        { id: 'a', share: 300, share_pct: 33.33 },
        { id: 'b', share: 600, share_pct: 66.67 },
      ]);
    });

    it('retourne des shares a 0 si le poids total est nul', () => {
      const result = shareByWeight(500, [
        { id: 'a', weight: 0 },
        { id: 'b', weight: 0 },
      ]);
      expect(result).toEqual([
        { id: 'a', share: 0, share_pct: 0 },
        { id: 'b', share: 0, share_pct: 0 },
      ]);
    });

    it('retourne un tableau vide si aucune entree', () => {
      expect(shareByWeight(100, [])).toEqual([]);
    });

    it('traite un poids manquant comme 0', () => {
      const result = shareByWeight(100, [{ id: 'a' }, { id: 'b', weight: 1 }]);
      expect(result).toEqual([
        { id: 'a', share: 0, share_pct: 0 },
        { id: 'b', share: 100, share_pct: 100 },
      ]);
    });
  });

  describe('taxableWeight', () => {
    it('retient le poids volumetrique si superieur au poids reel (mode sea, facteur 1000)', () => {
      expect(taxableWeight(100, 0.5, 'sea')).toBe(500);
    });

    it('retient le poids reel si superieur au volumetrique', () => {
      expect(taxableWeight(800, 0.1, 'sea')).toBe(800);
    });

    it('utilise le facteur 167 en mode air', () => {
      expect(taxableWeight(20, 0.1, 'air')).toBe(20);
      expect(taxableWeight(20, 1, 'air')).toBe(167);
    });

    it('gere les valeurs manquantes/non numeriques comme 0', () => {
      expect(taxableWeight(undefined, undefined)).toBe(0);
      expect(taxableWeight('abc', null)).toBe(0);
    });
  });

  describe('lockEstimatedCostsForOrder', () => {
    it('delegue a order-cost-snapshot avec les memes arguments', async () => {
      orderCostSnapshot.lockEstimatedCostsForOrder.mockResolvedValue({ order_id: 'o1', imputations_count: 2 });
      const client = { query: jest.fn() };

      const result = await lockEstimatedCostsForOrder('o1', client, { foo: 'bar' });

      expect(orderCostSnapshot.lockEstimatedCostsForOrder).toHaveBeenCalledWith('o1', client, { foo: 'bar' });
      expect(result).toEqual({ order_id: 'o1', imputations_count: 2 });
    });
  });
});
