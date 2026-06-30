'use strict';

jest.mock('../../services/pricing-engine', () => ({
  loadGlobalConfig: jest.fn(),
  recommend: jest.fn(),
}));

const pricingEngine = require('../../services/pricing-engine');
const {
  normalizeCandidate,
  scanCandidate,
  convertToKMF,
  mapCategory,
  estimateWeight,
  estimateVolume,
  computeConfidence,
} = require('../../services/supplier-catalog-scanner');

const config = {
  finance: {
    taux_aed_kmf: 138,
    taux_change_eur_kmf: 492,
    target_marge_brute_pct: 40,
  },
  categories: {
    phones: { key: 'phones', default_weight_kg: 0.25, default_margin_pct: 35 },
    vetements: { key: 'vetements', default_weight_kg: 0.4, default_margin_pct: 45 },
    maison: { key: 'maison', default_weight_kg: 1.5, default_margin_pct: 40 },
    autre: { key: 'autre', default_weight_kg: 0.5, default_margin_pct: 40 },
  },
};

const cats = Object.values(config.categories);

describe('supplier-catalog-scanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pricingEngine.loadGlobalConfig.mockResolvedValue(config);
  });

  describe('convertToKMF', () => {
    it('convertit les devises connues vers KMF', () => {
      expect(convertToKMF(10, 'EUR', config.finance)).toBe(4920);
      expect(convertToKMF(10, 'USD', config.finance)).toBe(4526);
      expect(convertToKMF(1000, 'KMF', config.finance)).toBe(1000);
      expect(convertToKMF(10, 'AED', config.finance)).toBe(1380);
    });

    it('retourne 0 pour un montant absent ou nul', () => {
      expect(convertToKMF(null, 'EUR', config.finance)).toBe(0);
      expect(convertToKMF(0, 'EUR', config.finance)).toBe(0);
    });
  });

  describe('mapCategory', () => {
    it('mappe les categories fournisseur vers les categories Komerce', () => {
      expect(mapCategory('smartphone accessories', cats)).toEqual({ key: 'phones', source: 'mapped', confidence: 'medium' });
      expect(mapCategory('home kitchen', cats)).toEqual({ key: 'maison', source: 'mapped', confidence: 'medium' });
    });

    it('retourne autre en fallback quand la categorie est inconnue', () => {
      expect(mapCategory('unknown category', cats)).toEqual({ key: 'autre', source: 'default', confidence: 'low' });
      expect(mapCategory(null, cats)).toEqual({ key: 'autre', source: 'default', confidence: 'low' });
    });
  });

  describe('estimateWeight', () => {
    it('priorise le poids fournisseur quand il est fourni', () => {
      expect(estimateWeight(2.4, 'phones', cats)).toEqual({ value: 2.4, source: 'supplier', confidence: 'high' });
    });

    it('utilise le poids par defaut de categorie si le fournisseur ne donne rien', () => {
      expect(estimateWeight(null, 'phones', cats)).toEqual({ value: 0.25, source: 'category', confidence: 'medium' });
    });
  });

  describe('estimateVolume', () => {
    it('calcule le volume depuis les dimensions fournisseur', () => {
      expect(estimateVolume({ l_cm: 10, w_cm: 20, h_cm: 30 }, 'maison')).toEqual({
        value: 0.006,
        source: 'supplier',
        confidence: 'high',
      });
    });

    it('retombe sur un volume categorie si les dimensions sont absentes', () => {
      expect(estimateVolume(null, 'maison')).toEqual({ value: 0.020, source: 'category', confidence: 'low' });
    });
  });

  describe('computeConfidence', () => {
    it('retourne high quand la majorite des sources viennent du fournisseur', () => {
      expect(computeConfidence({ a: 'supplier', b: 'supplier', c: 'category' })).toBe('high');
    });

    it('retourne medium quand la majorite est exploitable mais pas fournisseur', () => {
      expect(computeConfidence({ a: 'category', b: 'mapped', c: 'missing' })).toBe('medium');
    });

    it('retourne low sans donnees fiables', () => {
      expect(computeConfidence({ a: 'missing', b: 'default' })).toBe('low');
      expect(computeConfidence({})).toBe('low');
    });
  });

  describe('normalizeCandidate', () => {
    it('normalise un produit fournisseur avec prix, categorie, poids et volume', async () => {
      const product = {
        supplier_name: 'Dubai Supplier',
        supplier_product_id: 'SKU-001',
        product_name: 'Smartphone X',
        supplier_category: 'smartphone',
        purchase_price: 10,
        currency: 'EUR',
        weight_kg: 0.3,
        dimensions: { l_cm: 10, w_cm: 5, h_cm: 2 },
        stock_available: 12,
      };

      const candidate = await normalizeCandidate(product, { config });

      expect(candidate).toEqual(expect.objectContaining({
        supplier_name: 'Dubai Supplier',
        supplier_product_id: 'SKU-001',
        product_name: 'Smartphone X',
        komerce_category: 'phones',
        purchase_price_kmf: 4920,
        estimated_weight_kg: 0.3,
        estimated_volume_m3: 0.0001,
        target_margin_pct: 35,
      }));
      expect(candidate.data_sources).toEqual(expect.objectContaining({
        category: 'mapped',
        purchase_price: 'supplier',
        weight: 'supplier',
        volume: 'supplier',
        target_margin: 'category',
      }));
      expect(candidate.confidence).toBe('high');
    });

    it('applique des defaults raisonnables quand des champs fournisseur manquent', async () => {
      const candidate = await normalizeCandidate({ supplier_name: 'Manual', product_name: 'Produit incomplet' }, { config });

      expect(candidate).toEqual(expect.objectContaining({
        supplier_name: 'Manual',
        product_name: 'Produit incomplet',
        supplier_product_id: null,
        supplier_category: null,
        purchase_price: null,
        currency: 'AED',
        komerce_category: 'autre',
        purchase_price_kmf: 0,
        estimated_weight_kg: 0.5,
        estimated_volume_m3: 0.005,
        target_margin_pct: 40,
      }));
      expect(candidate.confidence).toBe('medium');
    });
  });

  describe('scanCandidate', () => {
    it('appelle pricing-engine et transforme healthy en decision TEST', async () => {
      pricingEngine.recommend.mockResolvedValue({ health_status: 'healthy', recommended_price_kmf: 9000 });

      const result = await scanCandidate({
        komerce_category: 'phones',
        purchase_price_kmf: 4920,
        estimated_weight_kg: 0.3,
        estimated_volume_m3: 0.0001,
        confidence: 'high',
      }, { config });

      expect(pricingEngine.recommend).toHaveBeenCalledWith({
        product_id: null,
        category: 'phones',
        cost_kmf: 4920,
        weight_kg: 0.3,
        volume_m3: 0.0001,
        current_price_kmf: 0,
        channel: 'cash_relais',
      }, { config });
      expect(result).toEqual(expect.objectContaining({
        sourcing_decision: 'TEST',
        market_confidence: 'unknown',
        confidence: 'high',
      }));
    });

    it('transforme danger en AVOID et loss en LOSS', async () => {
      pricingEngine.recommend.mockResolvedValueOnce({ health_status: 'danger' });
      await expect(scanCandidate({ komerce_category: 'maison' }, { config }))
        .resolves.toEqual(expect.objectContaining({ sourcing_decision: 'AVOID' }));

      pricingEngine.recommend.mockResolvedValueOnce({ health_status: 'loss' });
      await expect(scanCandidate({ komerce_category: 'maison' }, { config }))
        .resolves.toEqual(expect.objectContaining({ sourcing_decision: 'LOSS' }));
    });
  });
});
