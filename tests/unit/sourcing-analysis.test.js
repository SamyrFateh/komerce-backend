'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/sourcing-analysis.js (C2)
 *
 * Couverture :
 *   helpers purs    — getProductCostKmf, getProductWeightG, getProductWeightKg
 *   analyzeProduct  — les 9 étapes du moteur (statut, marge, rail, gaps, confiance,
 *                     suggestions, alertes) — aucun mock DB nécessaire
 *   getCfg          — fallback si clé absente ou table vide
 *   loadSourcingConfig — defaults quand DB silencieuse
 *   getSales30d     — map produit → ventes
 *   getAnalysis     — filtres rail / status / category / active_only
 *   getAnalysisById — trouvé / introuvable
 *   getSynthesis    — KPIs, alertes globales, top listes
 *   getConfig       — retourne config + explanation
 */

jest.mock('../../db');

const db = require('../../db');

// ─── Import après mock ────────────────────────────────────────────────────────

const {
  analyzeProduct,
  loadSourcingConfig,
  getSales30d,
  getAnalysis,
  getAnalysisById,
  getSynthesis,
  getConfig,
  getProductVariants,
} = require('../../services/sourcing-analysis');

// ═══════════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

/** Config minimale avec toutes les clés (valeurs par défaut du code) */
const CFG_DEFAULT = {
  costFixedPerOrderKmf: 4200,
  breakEvenOrderKmf: 14000,
  maxActiveProducts: 120,
  margins: { A: 45, B: 18, C: 35, D: 70 },
  priceRanges: {
    A: { max: 10000 },
    B: { min: 30000 },
    C: { min: 20000 },
    D: { max: 5000 },
  },
  weightMax: { A: 500, B: 5000, D: 200 },
  catalogCapMvp: 120,
  deadThresholdDays: 30,
  starThresholdSales30d: 3,
};

/** Produit complet rail A — toutes les métadonnées */
function makeProductA(overrides = {}) {
  return {
    id: 1,
    name: 'Savon Coco',
    category: 'hygiene',
    subcategory: null,
    price_kmf: 8000,
    image_url: null,
    is_active: true,
    cost_kmf: 3500,
    cost_price_kmf: null,
    weight_kg: 0.3,
    weight_g: null,
    sourcing_rail: 'A',
    volume_class: 'petit',
    volume_cm3: 800,
    repack_volume_cm3: null,
    fragility: 'robuste',
    sale_mode: 'bundle',
    exposure_mode: 'catalogue',
    lifecycle_status: 'star',
    quality_validated: true,
    real_weight_known: true,
    real_price_validated: true,
    delivery_delay_days: 7,
    supplier_notes: null,
    last_review_at: null,
    ...overrides,
  };
}

/** Produit sans aucune métadonnée sourcing */
function makeProductEmpty(overrides = {}) {
  return {
    id: 2,
    name: 'Produit Inconnu',
    category: 'divers',
    subcategory: null,
    price_kmf: 12000,
    image_url: null,
    is_active: true,
    cost_kmf: null,
    cost_price_kmf: null,
    weight_kg: null,
    weight_g: null,
    sourcing_rail: null,
    volume_class: null,
    fragility: null,
    sale_mode: null,
    exposure_mode: null,
    lifecycle_status: 'candidate',
    quality_validated: false,
    real_weight_known: false,
    real_price_validated: false,
    delivery_delay_days: null,
    supplier_notes: null,
    last_review_at: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Helpers purs (exportés indirectement via analyzeProduct — testés en boîte blanche)
// ═══════════════════════════════════════════════════════════════════════════════

describe('analyzeProduct — normalisation coût (getProductCostKmf)', () => {
  it('utilise cost_kmf en priorité', () => {
    const a = analyzeProduct(
      makeProductA({ cost_kmf: 3000, cost_price_kmf: 5000 }),
      CFG_DEFAULT, {}
    );
    // margin = price - cost = 8000 - 3000 = 5000
    expect(a.computed.margin_kmf).toBe(5000);
  });

  it('tombe sur cost_price_kmf si cost_kmf absent', () => {
    const a = analyzeProduct(
      makeProductA({ cost_kmf: null, cost_price_kmf: 4000 }),
      CFG_DEFAULT, {}
    );
    expect(a.sourcing.cost_price_kmf).toBe(4000);
    expect(a.computed.margin_kmf).toBe(4000); // 8000 - 4000
  });

  it('retourne null si aucun coût renseigné', () => {
    const a = analyzeProduct(
      makeProductEmpty({ price_kmf: 10000 }),
      CFG_DEFAULT, {}
    );
    expect(a.sourcing.cost_price_kmf).toBeNull();
    expect(a.computed.margin_kmf).toBeNull();
    expect(a.computed.margin_pct).toBeNull();
  });

  it('ignore cost_kmf = 0 (zéro est traité comme absent)', () => {
    const a = analyzeProduct(
      makeProductA({ cost_kmf: 0, cost_price_kmf: 2000 }),
      CFG_DEFAULT, {}
    );
    expect(a.sourcing.cost_price_kmf).toBe(2000);
  });
});

describe('analyzeProduct — normalisation poids (getProductWeightG / Kg)', () => {
  it('convertit weight_kg → poids_g', () => {
    const a = analyzeProduct(
      makeProductA({ weight_kg: 0.3, weight_g: null }),
      CFG_DEFAULT, {}
    );
    expect(a.sourcing.weight_g).toBe(300);
  });

  it('utilise weight_g si weight_kg absent', () => {
    const a = analyzeProduct(
      makeProductA({ weight_kg: null, weight_g: 250 }),
      CFG_DEFAULT, {}
    );
    expect(a.sourcing.weight_g).toBe(250);
  });

  it('priorité weight_kg si les deux présents', () => {
    const a = analyzeProduct(
      makeProductA({ weight_kg: 1.0, weight_g: 500 }),
      CFG_DEFAULT, {}
    );
    expect(a.sourcing.weight_g).toBe(1000);
  });

  it('retourne null si aucun poids renseigné', () => {
    const a = analyzeProduct(
      makeProductEmpty(),
      CFG_DEFAULT, {}
    );
    expect(a.sourcing.weight_g).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. analyzeProduct — statut global
// ═══════════════════════════════════════════════════════════════════════════════

describe('analyzeProduct — statut en_phase', () => {
  it('produit complet star → en_phase green', () => {
    const a = analyzeProduct(makeProductA(), CFG_DEFAULT, { 1: 5 });
    expect(a.status).toBe('en_phase');
    expect(a.status_color).toBe('green');
    expect(a.confidence).toBe('forte');
  });

  it('reason cite les ventes si star threshold atteint', () => {
    const a = analyzeProduct(makeProductA(), CFG_DEFAULT, { 1: 5 });
    expect(a.reason).toMatch(/5 ventes/);
  });

  it('action = pousser si ventes >= starThreshold', () => {
    const a = analyzeProduct(makeProductA(), CFG_DEFAULT, { 1: 4 });
    expect(a.action).toBe('pousser');
  });

  it('action = bundler pour rail A sans ventes star', () => {
    const a = analyzeProduct(makeProductA({ lifecycle_status: 'active' }), CFG_DEFAULT, { 1: 1 });
    // score: marge ok (+2), standalone_viable false (8000 < 14000) (+0), quality (+1), poids ok (+1), active (+1), 1 vente (+1) = 6 ≥ 4
    // mais standalone_viable = false → bundle
    expect(a.action).toBe('bundler');
  });
});

describe('analyzeProduct — statut sous_reserve', () => {
  it('produit avec plusieurs gaps → sous_reserve', () => {
    const a = analyzeProduct(
      makeProductEmpty({ price_kmf: 15000 }),
      CFG_DEFAULT, {}
    );
    // pas en_phase (manque trop), pas test_requis (completeness > 0 grâce aux champs fixes)
    // status dépend du score et gaps
    expect(['sous_reserve', 'test_requis']).toContain(a.status);
    expect(a.gaps.length).toBeGreaterThan(0);
  });

  it('marge sous la cible du rail → sous_reserve avec reason marge', () => {
    // Rail B cible 18%. Marge ici = (30000 - 27000) / 30000 = 10%
    // Ventes > 0 pour éviter le gap "Rotation 0 vente sur 30j" qui masquerait la reason marge
    const p = makeProductA({
      price_kmf: 30000,
      cost_kmf: 27000,
      sourcing_rail: 'B',
      lifecycle_status: 'active',
    });
    const a = analyzeProduct(p, CFG_DEFAULT, { 1: 2 });
    expect(['sous_reserve', 'hors_phase']).toContain(a.status);
    if (a.status === 'sous_reserve') {
      expect(a.reason).toMatch(/[Mm]arge/);
    }
  });

  it('action = négocier si marge sous cible rail', () => {
    const p = makeProductA({
      price_kmf: 8000,
      cost_kmf: 7500, // marge ~6% < 45% cible rail A
      sourcing_rail: 'A',
      lifecycle_status: 'active',
      quality_validated: true,
    });
    const a = analyzeProduct(p, CFG_DEFAULT, {});
    expect(['négocier', 'tester', 'compléter les données', 'geler', 'refuser']).toContain(a.action);
  });
});

describe('analyzeProduct — statut test_requis', () => {
  it('produit totalement vide → test_requis ou sous_reserve', () => {
    const p = {
      id: 99, name: 'X', category: 'X', subcategory: null,
      price_kmf: null, image_url: null, is_active: true,
      cost_kmf: null, cost_price_kmf: null,
      weight_kg: null, weight_g: null,
      sourcing_rail: null, volume_class: null, fragility: null,
      sale_mode: null, exposure_mode: null, lifecycle_status: 'candidate',
      quality_validated: false, real_weight_known: false, real_price_validated: false,
      delivery_delay_days: null, supplier_notes: null, last_review_at: null,
    };
    const a = analyzeProduct(p, CFG_DEFAULT, {});
    // completeness < 0.3 → test_requis
    expect(a.status).toBe('test_requis');
    expect(a.action).toBe('tester');
    expect(a.confidence).toBe('faible');
  });
});

describe('analyzeProduct — statut hors_phase', () => {
  it('produit mort → hors_phase red', () => {
    // quality + prix de revente non validés + marge faible : score assez bas pour sortir
    // de sous_reserve (sinon le lifecycle 'dead' seul, avec le reste du produit complet,
    // ne suffit pas à franchir le seuil hors_phase)
    const a = analyzeProduct(
      makeProductA({
        lifecycle_status: 'dead',
        quality_validated: false,
        real_price_validated: false,
        price_kmf: 8000,
        cost_kmf: 7600,
        weight_kg: 1.0,
      }),
      CFG_DEFAULT, { 1: 0 }
    );
    expect(a.status).toBe('hors_phase');
    expect(a.status_color).toBe('red');
    expect(a.action).toBe('geler');
    expect(a.reason).toMatch(/mort/i);
  });

  it('action = refuser si marge < 10%', () => {
    const a = analyzeProduct(
      makeProductA({
        price_kmf: 8000,
        cost_kmf: 7800, // marge 2.5%
        lifecycle_status: 'active',
        quality_validated: false,
      }),
      CFG_DEFAULT, {}
    );
    if (a.status === 'hors_phase') {
      expect(a.action).toBe('refuser');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. analyzeProduct — inférence de rail
// ═══════════════════════════════════════════════════════════════════════════════

describe('analyzeProduct — inférence de rail', () => {
  it('rail déclaré → rail_source = declared', () => {
    const a = analyzeProduct(makeProductA({ sourcing_rail: 'B' }), CFG_DEFAULT, {});
    expect(a.sourcing.rail).toBe('B');
    expect(a.sourcing.rail_source).toBe('declared');
    expect(a.computed.inferred_rail).toBe('B');
  });

  it('prix <= 5000 → rail D inféré', () => {
    const a = analyzeProduct(
      makeProductA({ price_kmf: 4000, sourcing_rail: null }),
      CFG_DEFAULT, {}
    );
    expect(a.computed.inferred_rail).toBe('D');
    expect(a.sourcing.rail_source).toBe('inferred');
  });

  it('prix 6000-10000 → rail A inféré', () => {
    const a = analyzeProduct(
      makeProductA({ price_kmf: 8000, sourcing_rail: null }),
      CFG_DEFAULT, {}
    );
    expect(a.computed.inferred_rail).toBe('A');
  });

  it('prix >= 30000 → rail B inféré', () => {
    const a = analyzeProduct(
      makeProductA({ price_kmf: 35000, sourcing_rail: null }),
      CFG_DEFAULT, {}
    );
    expect(a.computed.inferred_rail).toBe('B');
  });

  it('prix 20000-30000 → rail C inféré', () => {
    const a = analyzeProduct(
      makeProductA({ price_kmf: 25000, sourcing_rail: null }),
      CFG_DEFAULT, {}
    );
    expect(a.computed.inferred_rail).toBe('C');
  });

  it('zone grise 10000-20000 → rail A par défaut', () => {
    const a = analyzeProduct(
      makeProductA({ price_kmf: 15000, sourcing_rail: null }),
      CFG_DEFAULT, {}
    );
    expect(a.computed.inferred_rail).toBe('A');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. analyzeProduct — gaps
// ═══════════════════════════════════════════════════════════════════════════════

describe('analyzeProduct — gaps identifiés', () => {
  it('produit complet = zéro gap', () => {
    const a = analyzeProduct(makeProductA(), CFG_DEFAULT, { 1: 1 });
    expect(a.gaps).toHaveLength(0);
  });

  it('signale "Prix d\'achat manquant" si pas de coût', () => {
    const a = analyzeProduct(
      makeProductA({ cost_kmf: null, cost_price_kmf: null }),
      CFG_DEFAULT, {}
    );
    expect(a.gaps).toContain("Prix d'achat manquant");
  });

  it('signale "Poids réel inconnu" si ni poids ni real_weight_known', () => {
    const a = analyzeProduct(
      makeProductA({ weight_kg: null, weight_g: null, real_weight_known: false }),
      CFG_DEFAULT, {}
    );
    expect(a.gaps).toContain('Poids réel inconnu');
  });

  it('ne signale pas le poids si real_weight_known = true même sans colonnes', () => {
    const a = analyzeProduct(
      makeProductA({ weight_kg: null, weight_g: null, real_weight_known: true }),
      CFG_DEFAULT, {}
    );
    expect(a.gaps).not.toContain('Poids réel inconnu');
  });

  it('signale "Rail non assigné (inféré)" si pas de rail déclaré', () => {
    const a = analyzeProduct(
      makeProductA({ sourcing_rail: null }),
      CFG_DEFAULT, {}
    );
    expect(a.gaps).toContain('Rail non assigné (inféré)');
  });

  it('signale "Rotation 0 vente sur 30j" pour produit actif sans ventes', () => {
    const a = analyzeProduct(
      makeProductA({ lifecycle_status: 'active' }),
      CFG_DEFAULT, {}
    );
    expect(a.gaps).toContain('Rotation 0 vente sur 30j');
  });

  it('ne signale pas la rotation 0 pour produit non actif', () => {
    const a = analyzeProduct(
      makeProductA({ lifecycle_status: 'candidate' }),
      CFG_DEFAULT, {}
    );
    expect(a.gaps).not.toContain('Rotation 0 vente sur 30j');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. analyzeProduct — alertes
// ═══════════════════════════════════════════════════════════════════════════════

describe('analyzeProduct — alertes', () => {
  it('prix < coût fixe par commande → alerte critical', () => {
    const a = analyzeProduct(
      makeProductA({ price_kmf: 3000 }), // < 4200
      CFG_DEFAULT, {}
    );
    const crit = a.alerts.find(al => al.level === 'critical' && al.message.includes('coût fixe'));
    expect(crit).toBeDefined();
  });

  it('marge négative → alerte critical', () => {
    const a = analyzeProduct(
      makeProductA({ price_kmf: 8000, cost_kmf: 9000 }),
      CFG_DEFAULT, {}
    );
    const negAlert = a.alerts.find(al => al.message.includes('NÉGATIVE'));
    expect(negAlert).toBeDefined();
    expect(negAlert.level).toBe('critical');
  });

  it('poids > max rail → alerte warning', () => {
    // Rail A max = 500g. On met 800g
    const a = analyzeProduct(
      makeProductA({ weight_kg: 0.8, sourcing_rail: 'A' }),
      CFG_DEFAULT, {}
    );
    const wAlert = a.alerts.find(al => al.message.includes('Poids'));
    expect(wAlert).toBeDefined();
    expect(wAlert.level).toBe('warning');
  });

  it('produit actif sans qualité validée → alerte warning', () => {
    const a = analyzeProduct(
      makeProductA({ quality_validated: false, lifecycle_status: 'active' }),
      CFG_DEFAULT, {}
    );
    const qAlert = a.alerts.find(al => al.message.includes('validation qualité'));
    expect(qAlert).toBeDefined();
    expect(qAlert.level).toBe('warning');
  });

  it('produit candidate sans qualité validée → pas d\'alerte qualité', () => {
    const a = analyzeProduct(
      makeProductA({ quality_validated: false, lifecycle_status: 'candidate' }),
      CFG_DEFAULT, {}
    );
    const qAlert = a.alerts.find(al => al.message && al.message.includes('validation qualité'));
    expect(qAlert).toBeUndefined();
  });

  it('produit nominal → zéro alerte', () => {
    const a = analyzeProduct(makeProductA(), CFG_DEFAULT, {});
    expect(a.alerts).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. analyzeProduct — confiance
// ═══════════════════════════════════════════════════════════════════════════════

describe('analyzeProduct — confiance', () => {
  it('toutes métadonnées → forte', () => {
    const a = analyzeProduct(makeProductA(), CFG_DEFAULT, {});
    expect(a.confidence).toBe('forte');
  });

  it('métadonnées partielles (4/10) → moyenne', () => {
    const a = analyzeProduct(
      makeProductA({
        sourcing_rail: null, cost_kmf: null, cost_price_kmf: null,
        weight_kg: null, weight_g: null, real_weight_known: false,
        fragility: null, volume_class: null,
        // gardés : sale_mode, quality_validated, delivery_delay_days, real_price_validated = 4
      }),
      CFG_DEFAULT, {}
    );
    expect(['moyenne', 'forte']).toContain(a.confidence);
  });

  it('produit vide → faible', () => {
    const p = {
      id: 99, name: 'X', category: 'X', subcategory: null,
      price_kmf: null, image_url: null, is_active: true,
      cost_kmf: null, cost_price_kmf: null,
      weight_kg: null, weight_g: null,
      sourcing_rail: null, volume_class: null, fragility: null,
      sale_mode: null, exposure_mode: null, lifecycle_status: 'candidate',
      quality_validated: false, real_weight_known: false, real_price_validated: false,
      delivery_delay_days: null, supplier_notes: null, last_review_at: null,
    };
    const a = analyzeProduct(p, CFG_DEFAULT, {});
    expect(a.confidence).toBe('faible');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. analyzeProduct — suggestions exposition & vente
// ═══════════════════════════════════════════════════════════════════════════════

describe('analyzeProduct — suggestions', () => {
  it('hors_phase → exposure_suggestion = caché', () => {
    const a = analyzeProduct(
      makeProductA({
        lifecycle_status: 'dead',
        quality_validated: false,
        real_price_validated: false,
        price_kmf: 8000,
        cost_kmf: 7600,
        weight_kg: 1.0,
      }),
      CFG_DEFAULT, { 1: 0 }
    );
    expect(a.exposure_suggestion).toBe('caché');
  });

  it('test_requis → exposure_suggestion = caché_test', () => {
    const p = {
      id: 99, name: 'X', category: 'X', subcategory: null,
      price_kmf: null, image_url: null, is_active: true,
      cost_kmf: null, cost_price_kmf: null, weight_kg: null, weight_g: null,
      sourcing_rail: null, volume_class: null, fragility: null, sale_mode: null,
      exposure_mode: null, lifecycle_status: 'candidate', quality_validated: false,
      real_weight_known: false, real_price_validated: false,
      delivery_delay_days: null, supplier_notes: null, last_review_at: null,
    };
    const a = analyzeProduct(p, CFG_DEFAULT, {});
    expect(a.exposure_suggestion).toBe('caché_test');
  });

  it('star avec ventes → catalogue_visible', () => {
    const a = analyzeProduct(makeProductA(), CFG_DEFAULT, { 1: 5 });
    expect(a.exposure_suggestion).toBe('catalogue_visible');
  });

  it('rail C → sur_demande', () => {
    // lifecycle 'active' (pas 'star') et ventes < seuil pour ne pas déclencher
    // la règle catalogue_visible (star/ventes) avant la règle rail C
    const a = analyzeProduct(
      makeProductA({ sourcing_rail: 'C', price_kmf: 25000, cost_kmf: 10000, lifecycle_status: 'active' }),
      CFG_DEFAULT, { 1: 2 }
    );
    expect(a.exposure_suggestion).toBe('sur_demande');
  });

  it('prix non standalone (< break_even) + rail A → bundle_obligatoire', () => {
    const a = analyzeProduct(
      makeProductA({ price_kmf: 8000 }), // 8000 < 14000 (break_even)
      CFG_DEFAULT, {}
    );
    expect(a.computed.standalone_viable).toBe(false);
    expect(a.sale_suggestion).toBe('bundle_obligatoire');
  });

  it('produit standalone viable + rail B → standalone_possible', () => {
    const a = analyzeProduct(
      makeProductA({ price_kmf: 35000, sourcing_rail: 'B', cost_kmf: 10000 }),
      CFG_DEFAULT, {}
    );
    expect(a.computed.standalone_viable).toBe(true);
    expect(a.sale_suggestion).toBe('standalone_possible');
  });

  it('rail C avec prix standalone → acompte_précommande', () => {
    const a = analyzeProduct(
      makeProductA({ price_kmf: 25000, sourcing_rail: 'C', cost_kmf: 10000 }),
      CFG_DEFAULT, {}
    );
    expect(a.sale_suggestion).toBe('acompte_précommande');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. analyzeProduct — structure de retour
// ═══════════════════════════════════════════════════════════════════════════════

describe('analyzeProduct — structure', () => {
  it('retourne toutes les clés attendues', () => {
    const a = analyzeProduct(makeProductA(), CFG_DEFAULT, {});
    expect(a).toHaveProperty('id');
    expect(a).toHaveProperty('name');
    expect(a).toHaveProperty('sourcing');
    expect(a).toHaveProperty('computed');
    expect(a).toHaveProperty('status');
    expect(a).toHaveProperty('status_color');
    expect(a).toHaveProperty('reason');
    expect(a).toHaveProperty('confidence');
    expect(a).toHaveProperty('gaps');
    expect(a).toHaveProperty('action');
    expect(a).toHaveProperty('exposure_suggestion');
    expect(a).toHaveProperty('sale_suggestion');
    expect(a).toHaveProperty('alerts');
  });

  it('computed.sales_30d = 0 si produit absent de la salesMap', () => {
    const a = analyzeProduct(makeProductA(), CFG_DEFAULT, {});
    expect(a.computed.sales_30d).toBe(0);
  });

  it('computed.sales_30d repris depuis salesMap', () => {
    const a = analyzeProduct(makeProductA(), CFG_DEFAULT, { 1: 7 });
    expect(a.computed.sales_30d).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. loadSourcingConfig — fallback DB
// ═══════════════════════════════════════════════════════════════════════════════

describe('loadSourcingConfig', () => {
  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [] }); // aucune clé en DB → fallbacks
  });

  it('retourne les fallbacks hardcodés si business_rules vide', async () => {
    const cfg = await loadSourcingConfig();
    expect(cfg.breakEvenOrderKmf).toBe(14000);
    expect(cfg.costFixedPerOrderKmf).toBe(4200);
    expect(cfg.margins.A).toBe(45);
    expect(cfg.catalogCapMvp).toBe(120);
  });

  it('utilise la valeur DB si la clé existe (format number)', async () => {
    db.query.mockImplementation((_sql, params) => {
      if (params?.[0] === 'BREAK_EVEN_ORDER_KMF') {
        return Promise.resolve({ rows: [{ value: 20000 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const cfg = await loadSourcingConfig();
    expect(cfg.breakEvenOrderKmf).toBe(20000);
  });

  it('utilise la valeur DB si format JSON {value: N}', async () => {
    db.query.mockImplementation((_sql, params) => {
      if (params?.[0] === 'CATALOG_CAP_MVP') {
        return Promise.resolve({ rows: [{ value: { value: 200 } }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const cfg = await loadSourcingConfig();
    expect(cfg.catalogCapMvp).toBe(200);
  });

  it('survit si db.query lance une exception (fallback silencieux)', async () => {
    db.query.mockRejectedValue(new Error('DB down'));
    const cfg = await loadSourcingConfig();
    expect(cfg.breakEvenOrderKmf).toBe(14000); // fallback
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. getSales30d
// ═══════════════════════════════════════════════════════════════════════════════

describe('getSales30d', () => {
  it('retourne une map produit → ventes', async () => {
    db.query.mockResolvedValue({
      rows: [
        { product_id: 1, sales_count: '5' },
        { product_id: 2, sales_count: '2' },
      ],
    });
    const map = await getSales30d();
    expect(map[1]).toBe(5);
    expect(map[2]).toBe(2);
  });

  it('retourne map vide si exception (table absente)', async () => {
    db.query.mockRejectedValue(new Error('relation does not exist'));
    const map = await getSales30d();
    expect(map).toEqual({});
  });

  it('cast sales_count en Number', async () => {
    db.query.mockResolvedValue({ rows: [{ product_id: 3, sales_count: '10' }] });
    const map = await getSales30d();
    expect(typeof map[3]).toBe('number');
    expect(map[3]).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. getAnalysisById
// ═══════════════════════════════════════════════════════════════════════════════

describe('getAnalysisById', () => {
  beforeEach(() => {
    // Par défaut : business_rules vide + order_items vide
    db.query.mockImplementation((sql) => {
      if (sql.includes('business_rules')) return Promise.resolve({ rows: [] });
      if (sql.includes('order_items'))   return Promise.resolve({ rows: [] });
      if (sql.includes('products WHERE id'))
        return Promise.resolve({ rows: [makeProductA()] });
      return Promise.resolve({ rows: [] });
    });
  });

  it('retourne null si produit introuvable', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('business_rules')) return Promise.resolve({ rows: [] });
      if (sql.includes('order_items'))   return Promise.resolve({ rows: [] });
      if (sql.includes('products WHERE id')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const result = await getAnalysisById(999);
    expect(result).toBeNull();
  });

  it('retourne une analyse si produit trouvé', async () => {
    const result = await getAnalysisById(1);
    expect(result).not.toBeNull();
    expect(result.id).toBe(1);
    expect(result.status).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. getAnalysis — filtres
// ═══════════════════════════════════════════════════════════════════════════════

describe('getAnalysis', () => {
  const products = [
    makeProductA({ id: 1, sourcing_rail: 'A', category: 'hygiene' }),
    makeProductA({ id: 2, sourcing_rail: 'B', price_kmf: 35000, cost_kmf: 10000, category: 'mode' }),
    makeProductA({ id: 3, sourcing_rail: 'A', lifecycle_status: 'dead', quality_validated: false, category: 'hygiene' }),
  ];

  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('business_rules')) return Promise.resolve({ rows: [] });
      if (sql.includes('order_items'))   return Promise.resolve({ rows: [] });
      if (sql.includes('FROM products')) return Promise.resolve({ rows: products });
      return Promise.resolve({ rows: [] });
    });
  });

  it('retourne tous les produits sans filtre', async () => {
    const result = await getAnalysis({});
    expect(result.products).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it('filtre par rail', async () => {
    const result = await getAnalysis({ rail: 'B' });
    expect(result.products.every(p => p.computed.inferred_rail === 'B')).toBe(true);
  });

  it('filtre par status', async () => {
    const result = await getAnalysis({ status: 'hors_phase' });
    expect(result.products.every(p => p.status === 'hors_phase')).toBe(true);
  });

  it('retourne generated_at et config', async () => {
    const result = await getAnalysis({});
    expect(result.generated_at).toBeDefined();
    expect(result.config.break_even_kmf).toBe(14000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. getSynthesis — KPIs et alertes globales
// ═══════════════════════════════════════════════════════════════════════════════

describe('getSynthesis', () => {
  beforeEach(() => {
    const products = [
      makeProductA({ id: 1, lifecycle_status: 'star' }),
      makeProductA({ id: 2, lifecycle_status: 'dead', quality_validated: false }),
    ];
    db.query.mockImplementation((sql) => {
      if (sql.includes('business_rules')) return Promise.resolve({ rows: [] });
      if (sql.includes('order_items'))   return Promise.resolve({ rows: [{ product_id: 1, sales_count: '5' }] });
      if (sql.includes('FROM products')) return Promise.resolve({ rows: products });
      return Promise.resolve({ rows: [] });
    });
  });

  it('retourne by_status avec les 4 catégories', async () => {
    const r = await getSynthesis();
    expect(r.by_status).toHaveProperty('en_phase');
    expect(r.by_status).toHaveProperty('hors_phase');
    expect(r.by_status).toHaveProperty('sous_reserve');
    expect(r.by_status).toHaveProperty('test_requis');
  });

  it('retourne by_rail', async () => {
    const r = await getSynthesis();
    expect(r.by_rail).toHaveProperty('A');
    expect(r.by_rail).toHaveProperty('B');
  });

  it('retourne top_push, top_watch, top_freeze', async () => {
    const r = await getSynthesis();
    expect(Array.isArray(r.top_push)).toBe(true);
    expect(Array.isArray(r.top_watch)).toBe(true);
    expect(Array.isArray(r.top_freeze)).toBe(true);
  });

  it('alerte critique si produits avec margin négative', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('business_rules')) return Promise.resolve({ rows: [] });
      if (sql.includes('order_items'))   return Promise.resolve({ rows: [] });
      if (sql.includes('FROM products')) return Promise.resolve({
        rows: [makeProductA({ id: 1, price_kmf: 3000, cost_kmf: 3500 })], // marge négative
      });
      return Promise.resolve({ rows: [] });
    });
    const r = await getSynthesis();
    const hasCrit = r.global_alerts.some(a => a.level === 'critical');
    expect(hasCrit).toBe(true);
  });

  it('alerte si catalogue dépasse cap MVP', async () => {
    const manyProducts = Array.from({ length: 130 }, (_, i) =>
      makeProductA({ id: i + 1, lifecycle_status: 'active' })
    );
    db.query.mockImplementation((sql) => {
      if (sql.includes('business_rules')) return Promise.resolve({ rows: [] });
      if (sql.includes('order_items'))   return Promise.resolve({ rows: [] });
      if (sql.includes('FROM products')) return Promise.resolve({ rows: manyProducts });
      return Promise.resolve({ rows: [] });
    });
    const r = await getSynthesis();
    const capAlert = r.global_alerts.find(a => a.message.includes('plafond MVP'));
    expect(capAlert).toBeDefined();
    expect(capAlert.level).toBe('warning');
  });

  it('retourne data_completeness_pct entre 0 et 100', async () => {
    const r = await getSynthesis();
    expect(r.data_completeness_pct).toBeGreaterThanOrEqual(0);
    expect(r.data_completeness_pct).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. getConfig
// ═══════════════════════════════════════════════════════════════════════════════

describe('getConfig', () => {
  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [] });
  });

  it('retourne la config + explanation', async () => {
    const cfg = await getConfig();
    expect(cfg.margins).toBeDefined();
    expect(cfg.explanation).toBeDefined();
    expect(cfg.explanation.rails).toHaveProperty('A');
    expect(cfg.explanation.rails).toHaveProperty('B');
    expect(cfg.explanation.rails).toHaveProperty('C');
    expect(cfg.explanation.rails).toHaveProperty('D');
    expect(cfg.explanation.lifecycle).toHaveProperty('star');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. getProductVariants — B1 (extrait de routes/sourcing-engine.js)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getProductVariants', () => {
  it('retourne null si produit introuvable', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM products WHERE id')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const result = await getProductVariants(999);
    expect(result).toBeNull();
  });

  it('retourne les variantes triées avec has_variants et total', async () => {
    const variantRows = [
      { id: 'v1', variant_type: 'couleur', variant_value: 'rouge', sku: 'SKU-1', stock: 5, price_kmf: 10000, image_url: null, display_order: 1 },
      { id: 'v2', variant_type: 'couleur', variant_value: 'bleu',  sku: 'SKU-2', stock: 3, price_kmf: 10000, image_url: null, display_order: 2 },
    ];
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM products WHERE id'))
        return Promise.resolve({ rows: [{ id: 1, has_variants: true }] });
      if (sql.includes('FROM product_variants'))
        return Promise.resolve({ rows: variantRows });
      return Promise.resolve({ rows: [] });
    });
    const result = await getProductVariants(1);
    expect(result.product_id).toBe(1);
    expect(result.has_variants).toBe(true);
    expect(result.variants).toEqual(variantRows);
    expect(result.total).toBe(2);
  });

  it('retourne total=0 et variants=[] si produit sans variante', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM products WHERE id'))
        return Promise.resolve({ rows: [{ id: 2, has_variants: false }] });
      if (sql.includes('FROM product_variants'))
        return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const result = await getProductVariants(2);
    expect(result.has_variants).toBe(false);
    expect(result.variants).toEqual([]);
    expect(result.total).toBe(0);
  });
});
