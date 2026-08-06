'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/sourcing-analysis-density.test.js
 * Tests de caractérisation — lot V-2 (densité de valeur dans analyzeProduct)
 *
 * Couvre :
 *   margin_kmf_per_dm3 — calcul nominal, priorité repack_volume_cm3,
 *                        NULL si volume ou coût absent (données partielles)
 *   review_volume      — alerte informative volume manquant (produit actif),
 *                        alerte densité sous cible, AUCUNE alerte au-dessus,
 *                        level 'info' : n'affecte jamais la sourcing_decision
 *   gaps               — 'Volume réel non mesuré (cm³)' distinct du gabarit
 *
 * Doctrine : DOCTRINE_DENSITE_VALEUR §3 — informatif tant que la cible
 * n'est pas calibrée sur un shipment réel.
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const { analyzeProduct } = require('../../services/sourcing-analysis');

// Config minimale : seuls les champs consommés par analyzeProduct
const cfg = {
  breakEvenOrderKmf: 14000,
  costFixedPerOrderKmf: 4200,
  margins: { A: 45, B: 18, C: 35, D: 70 },
  priceRanges: { A: { max: 10000 }, B: { min: 30000 }, C: { min: 20000 }, D: { max: 5000 } },
  weightMax: { A: 500, B: 5000, D: 200 },
  valueDensityTargetKmfPerDm3: 500,
};

const base = {
  id: 'p1', name: 'produit', is_active: true,
  quality_validated: true, lifecycle_status: 'active',
};

// ════════════════════════════════════════════════════════════════
// 1. margin_kmf_per_dm3
// ════════════════════════════════════════════════════════════════

describe('margin_kmf_per_dm3', () => {
  it('calcule la densité : marge absolue / dm³', () => {
    const a = analyzeProduct({ ...base,
      price_kmf: 5000, cost_kmf: 1000, volume_cm3: 100, sourcing_rail: 'D',
    }, cfg, {});

    // (5000-1000) / (100/1000 dm³) = 40 000 KMF/dm³
    expect(a.computed.margin_kmf_per_dm3).toBe(40000);
  });

  it('préfère le volume repacké : c\'est lui qui voyage', () => {
    const a = analyzeProduct({ ...base,
      price_kmf: 20000, cost_kmf: 14000,
      volume_cm3: 30000, repack_volume_cm3: 12000, sourcing_rail: 'C',
    }, cfg, {});

    // 6000 / 12 dm³ = 500 (et non 6000/30 = 200)
    expect(a.computed.margin_kmf_per_dm3).toBe(500);
  });

  it('reste NULL sans volume (données partielles acceptées)', () => {
    const a = analyzeProduct({ ...base,
      price_kmf: 8000, cost_kmf: 5000, sourcing_rail: 'A',
    }, cfg, {});

    expect(a.computed.margin_kmf_per_dm3).toBeNull();
  });

  it('reste NULL sans coût (pas de marge calculable)', () => {
    const a = analyzeProduct({ ...base,
      price_kmf: 8000, volume_cm3: 500, sourcing_rail: 'A',
    }, cfg, {});

    expect(a.computed.margin_kmf_per_dm3).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
// 2. Alertes review_volume — INFORMATIVES uniquement
// ════════════════════════════════════════════════════════════════

describe('alertes review_volume', () => {
  const alertsOf = (a) => a.alerts.filter(x => x.code === 'review_volume');

  it('signale un produit actif sans volume mesuré', () => {
    const a = analyzeProduct({ ...base,
      price_kmf: 8000, cost_kmf: 5000, sourcing_rail: 'A',
    }, cfg, {});

    const alerts = alertsOf(a);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('info');
  });

  it('signale une densité sous la cible (indicatif, cible non calibrée)', () => {
    const a = analyzeProduct({ ...base,
      // 10000 de marge / 45 dm³ = 222 < cible 500
      price_kmf: 35000, cost_kmf: 25000, volume_cm3: 45000, sourcing_rail: 'B',
    }, cfg, {});

    const alerts = alertsOf(a);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('info');
    expect(alerts[0].message).toContain('222');
  });

  it('aucune alerte au-dessus de la cible', () => {
    const a = analyzeProduct({ ...base,
      price_kmf: 5000, cost_kmf: 1000, volume_cm3: 100, sourcing_rail: 'D',
    }, cfg, {});

    expect(alertsOf(a)).toHaveLength(0);
  });

  it('les alertes info ne touchent jamais aux niveaux bloquants existants', () => {
    const a = analyzeProduct({ ...base,
      price_kmf: 35000, cost_kmf: 25000, volume_cm3: 45000, sourcing_rail: 'B',
    }, cfg, {});

    // La doctrine V-2 : ni le score ni la décision ne bougent — donc aucune
    // alerte critical/warning ne doit provenir du volet densité.
    const blocking = a.alerts.filter(x =>
      x.code === 'review_volume' && (x.level === 'critical' || x.level === 'warning'));
    expect(blocking).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. Gap volume
// ════════════════════════════════════════════════════════════════

describe('gap volume', () => {
  it('distingue le volume réel du gabarit déclaratif', () => {
    const a = analyzeProduct({ ...base,
      price_kmf: 8000, cost_kmf: 5000, sourcing_rail: 'A',
      volume_class: 'S', // gabarit renseigné...
    }, cfg, {});

    // ...mais volume cm³ absent : le gap dédié doit être présent,
    // et le gap gabarit absent.
    expect(a.gaps).toContain('Volume réel non mesuré (cm³)');
    expect(a.gaps).not.toContain('Gabarit non renseigné');
  });

  it('aucun gap volume quand le volume est mesuré', () => {
    const a = analyzeProduct({ ...base,
      price_kmf: 8000, cost_kmf: 5000, volume_cm3: 500,
      volume_class: 'S', sourcing_rail: 'A',
    }, cfg, {});

    expect(a.gaps).not.toContain('Volume réel non mesuré (cm³)');
  });
});
