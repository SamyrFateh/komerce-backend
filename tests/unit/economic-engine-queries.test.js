'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/economic-engine-queries.js (R9)
 *
 * Couvre :
 *   checkCoherence         — fonction pure (caractérisation complète)
 *   determineStatus        — fonction pure (hiérarchie des sévérités)
 *   generateRecommendation — fonction pure (priorités)
 *   CONSTANTS              — CATEGORY_META, FAMILY_META, STATUS_MAP
 *   getVar                 — lecture DB avec fallback
 *   checkSOVDrift          — alertes dérive > 20%
 *   redistribute           — moteur de recalcul (debounce snapshot + setComputed)
 *   getVariables           — groupement par catégorie
 *   getCharges             — groupement par famille + totaux
 *   getHistory             — snapshots DESC
 *   updateVariable         — guards + rebuild
 *   createCharge           — validation famille + rebuild
 *   deleteCharge           — soft vs hard delete
 *
 * db et eco-bridge sont mockés (aucune connexion réelle).
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/eco-bridge', () => ({
  invalidateEcoCache:     jest.fn(),
  invalidateChargesCache: jest.fn(),
}));
jest.mock('../../services/economic-config', () => ({
  LEGACY_RUNTIME_INPUTS: {
    orders_per_month: { canonical: 'objectif_commandes_mois', fallback: 100 },
    target_basket_avg: { canonical: 'target_panier_moyen_kmf', fallback: 15000 },
    hub_monthly_cost_aed: { canonical: 'hub_monthly_cost_aed', fallback: 7000 },
    customs_rate_default_pct: { canonical: 'customs_rate_default_pct', fallback: 42 },
    mix_rail_a: { canonical: 'mix_rail_a', fallback: 60 },
    mix_rail_b: { canonical: 'mix_rail_b', fallback: 25 },
    mix_rail_c: { canonical: 'mix_rail_c', fallback: 10 },
    mix_rail_d: { canonical: 'mix_rail_d', fallback: 5 },
    margin_rail_a: { canonical: 'margin_rail_a', fallback: 45 },
    margin_rail_b: { canonical: 'margin_rail_b', fallback: 18 },
    margin_rail_c: { canonical: 'margin_rail_c', fallback: 35 },
    margin_rail_d: { canonical: 'margin_rail_d', fallback: 70 },
  },
  loadFinanceConfig: jest.fn(),
  resolveLegacyInput: jest.fn(),
  buildModelInputs: jest.fn(),
  projectLegacyRows: jest.fn(),
  writeThroughLegacyInput: jest.fn(),
}));

const db = require('../../db');
const economicConfig = require('../../services/economic-config');
const ecoQueries = require('../../services/economic-engine-queries');
const {
  checkCoherence,
  determineStatus,
  generateRecommendation,
  CATEGORY_META,
  FAMILY_META,
  STATUS_MAP,
} = ecoQueries;

const CURRENT_FINANCE = {
  objectif_commandes_mois: 100,
  target_panier_moyen_kmf: 15000,
  hub_monthly_cost_aed: 7000,
  customs_rate_default_pct: 42,
  mix_rail_a: 60, mix_rail_b: 25, mix_rail_c: 10, mix_rail_d: 5,
  margin_rail_a: 45, margin_rail_b: 18, margin_rail_c: 35, margin_rail_d: 70,
};

function inputsFromConfig(c = CURRENT_FINANCE) {
  return {
    ordersPerMonth: Number(c.objectif_commandes_mois),
    targetBasket: Number(c.target_panier_moyen_kmf),
    mixA: Number(c.mix_rail_a), mixB: Number(c.mix_rail_b), mixC: Number(c.mix_rail_c), mixD: Number(c.mix_rail_d),
    margA: Number(c.margin_rail_a), margB: Number(c.margin_rail_b), margC: Number(c.margin_rail_c), margD: Number(c.margin_rail_d),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  economicConfig.loadFinanceConfig.mockResolvedValue(CURRENT_FINANCE);
  economicConfig.resolveLegacyInput.mockImplementation((config, key) => {
    const spec = economicConfig.LEGACY_RUNTIME_INPUTS[key];
    return spec ? Number(config[spec.canonical] ?? spec.fallback) : undefined;
  });
  economicConfig.buildModelInputs.mockImplementation(inputsFromConfig);
  economicConfig.projectLegacyRows.mockImplementation((rows) => rows);
  economicConfig.writeThroughLegacyInput.mockResolvedValue({
    error: 'economic_variable_editor_retired', status: 410, source_of_truth: 'finance_config',
  });
});

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

describe('CATEGORY_META', () => {
  it('contient les 7 catégories attendues', () => {
    const keys = Object.keys(CATEGORY_META);
    expect(keys).toEqual(expect.arrayContaining([
      'cost', 'revenue', 'margin', 'mix', 'exchange', 'pricing', 'health',
    ]));
    expect(keys).toHaveLength(7);
  });

  it('chaque catégorie a un label et une icône', () => {
    for (const v of Object.values(CATEGORY_META)) {
      expect(v).toHaveProperty('label');
      expect(v).toHaveProperty('icon');
    }
  });
});

describe('FAMILY_META', () => {
  it('contient les 5 familles de charges', () => {
    expect(Object.keys(FAMILY_META)).toEqual(expect.arrayContaining([
      'demarrage', 'croisiere', 'operationnelle', 'exceptionnelle', 'incident',
    ]));
  });
});

describe('STATUS_MAP', () => {
  it('contient les 4 statuts avec label et emoji', () => {
    for (const key of ['stable', 'surveiller', 'tension', 'blocking']) {
      expect(STATUS_MAP[key]).toHaveProperty('label');
      expect(STATUS_MAP[key]).toHaveProperty('emoji');
    }
  });
});

// ── checkCoherence (fonction pure) ───────────────────────────────────────────

describe('checkCoherence', () => {
  const OK_DATA = {
    breakEven: 5000, targetBasket: 15000,
    safetyRatio: 20, marginPressure: 15,
    netProfit: 1000,
    mixA: 60, mixB: 25, mixC: 10, mixD: 5,
  };

  it('retourne [] quand tout est dans les normes', () => {
    expect(checkCoherence(OK_DATA)).toEqual([]);
  });

  it('blocking quand breakEven > targetBasket', () => {
    const alerts = checkCoherence({ ...OK_DATA, breakEven: 20000 });
    expect(alerts.some(a => a.severity === 'blocking' && a.category === 'rentabilite')).toBe(true);
  });

  it('critical quand safetyRatio < 5 et >= 0', () => {
    const alerts = checkCoherence({ ...OK_DATA, safetyRatio: 3 });
    expect(alerts.some(a => a.severity === 'critical' && a.category === 'securite')).toBe(true);
  });

  it('warning quand safetyRatio entre 5 et 15 exclu', () => {
    const alerts = checkCoherence({ ...OK_DATA, safetyRatio: 10 });
    expect(alerts.some(a => a.severity === 'warning' && a.category === 'securite')).toBe(true);
  });

  it('aucune alerte sécurité si safetyRatio >= 15', () => {
    const alerts = checkCoherence({ ...OK_DATA, safetyRatio: 15 });
    expect(alerts.filter(a => a.category === 'securite')).toHaveLength(0);
  });

  it('critical quand mixSum != 100 (écart > 0.5)', () => {
    const alerts = checkCoherence({ ...OK_DATA, mixA: 70 }); // sum = 110
    expect(alerts.some(a => a.category === 'coherence')).toBe(true);
  });

  it('aucune alerte cohérence si mixSum = 100', () => {
    const alerts = checkCoherence({ ...OK_DATA, mixA: 60, mixB: 25, mixC: 10, mixD: 5 });
    expect(alerts.filter(a => a.category === 'coherence')).toHaveLength(0);
  });

  it('critical quand netProfit < 0', () => {
    const alerts = checkCoherence({ ...OK_DATA, netProfit: -500 });
    expect(alerts.some(a => a.severity === 'critical' && a.category === 'rentabilite')).toBe(true);
  });

  it('warning quand marginPressure > 25', () => {
    const alerts = checkCoherence({ ...OK_DATA, marginPressure: 30 });
    expect(alerts.some(a => a.severity === 'warning' && a.category === 'charges')).toBe(true);
  });

  it('peut générer plusieurs alertes simultanées', () => {
    const alerts = checkCoherence({
      ...OK_DATA, breakEven: 20000, safetyRatio: 2, netProfit: -100, marginPressure: 30,
    });
    expect(alerts.length).toBeGreaterThanOrEqual(3);
  });
});

// ── determineStatus ───────────────────────────────────────────────────────────

describe('determineStatus', () => {
  it('stable si aucune alerte', () => {
    expect(determineStatus([])).toBe('stable');
  });

  it('surveiller si seulement des warnings', () => {
    expect(determineStatus([{ severity: 'warning' }])).toBe('surveiller');
  });

  it('tension si au moins une critical (pas de blocking)', () => {
    expect(determineStatus([{ severity: 'critical' }, { severity: 'warning' }])).toBe('tension');
  });

  it('blocking si au moins une blocking (priorité max)', () => {
    expect(determineStatus([
      { severity: 'blocking' }, { severity: 'critical' }, { severity: 'warning' },
    ])).toBe('blocking');
  });
});

// ── generateRecommendation ────────────────────────────────────────────────────

describe('generateRecommendation', () => {
  it('priority high si status blocking', () => {
    const r = generateRecommendation('blocking', []);
    expect(r.priority).toBe('high');
  });

  it('priority high si alerte rentabilite', () => {
    const r = generateRecommendation('tension', [{ category: 'rentabilite' }]);
    expect(r.priority).toBe('high');
  });

  it('priority medium si alerte derive', () => {
    const r = generateRecommendation('surveiller', [{ category: 'derive' }]);
    expect(r.priority).toBe('medium');
  });

  it('priority medium si alerte charges', () => {
    const r = generateRecommendation('surveiller', [{ category: 'charges' }]);
    expect(r.priority).toBe('medium');
  });

  it('priority low si stable sans alerte', () => {
    const r = generateRecommendation('stable', []);
    expect(r.priority).toBe('low');
  });

  it('retourne un objet avec text et priority', () => {
    const r = generateRecommendation('stable', []);
    expect(r).toHaveProperty('text');
    expect(r).toHaveProperty('priority');
    expect(typeof r.text).toBe('string');
  });
});

// ── getVar ────────────────────────────────────────────────────────────────────

describe('getVar — compat finance_config', () => {
  it('lit une clé runtime canonisée via finance_config', async () => {
    const v = await ecoQueries.getVar('customs_rate_default_pct', 99);
    expect(v).toBe(42);
    expect(economicConfig.loadFinanceConfig).toHaveBeenCalledTimes(1);
    expect(economicConfig.resolveLegacyInput).toHaveBeenCalledWith(CURRENT_FINANCE, 'customs_rate_default_pct');
  });

  it('retourne le fallback pour une clé legacy sans mapping runtime', async () => {
    const v = await ecoQueries.getVar('cost_transit', 55);
    expect(v).toBe(55);
  });
});

// ── checkSOVDrift ─────────────────────────────────────────────────────────────

describe('checkSOVDrift', () => {
  it('retourne [] si aucune dérive', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await ecoQueries.checkSOVDrift();
    expect(result).toEqual([]);
  });

  it('construit un objet alerte par ligne de dérive', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        key: 'cost_transit', label: 'Transit (vers Comores)',
        value_supposed: 500, value_observed: 700,
      }],
    });
    const result = await ecoQueries.checkSOVDrift();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      severity: 'warning',
      category: 'derive',
    });
    expect(result[0].message).toContain('Transit (vers Comores)');
    // Écart = |700-500|/500 = 40%
    expect(result[0].detail).toContain('40%');
  });

  it('retourne plusieurs alertes si plusieurs dérives', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { key: 'a', label: 'A', value_supposed: 100, value_observed: 150 },
        { key: 'b', label: 'B', value_supposed: 200, value_observed: 280 },
      ],
    });
    const result = await ecoQueries.checkSOVDrift();
    expect(result).toHaveLength(2);
  });
});

// ── redistribute ──────────────────────────────────────────────────────────────

// Helper : finance_config est mocké comme SOV; DB ne sert qu'aux charges, drift et snapshots.
function mockRedistribute({ charges = [], varValue = null, hasRecentSnapshot = false } = {}) {
  if (varValue !== null) {
    economicConfig.buildModelInputs.mockReturnValue({
      ordersPerMonth: varValue, targetBasket: varValue,
      mixA: varValue, mixB: varValue, mixC: varValue, mixD: varValue,
      margA: varValue, margB: varValue, margC: varValue, margD: varValue,
    });
  }
  db.query.mockImplementation(async (sql) => {
    const s = sql.trim();
    if (s.includes('FROM charges WHERE is_active')) return { rows: charges };
    if (s.includes('ABS(value_observed - value_supposed)')) return { rows: [] };
    if (s.includes('FROM economic_snapshots ORDER BY created_at DESC LIMIT 1')) {
      return hasRecentSnapshot ? { rows: [{ created_at: new Date().toISOString() }] } : { rows: [] };
    }
    if (s.includes('INSERT INTO economic_snapshots')) return { rows: [] };
    return { rows: [] };
  });
}

describe('redistribute', () => {
  it('retourne un objet avec status, kpis de base et alerts', async () => {
    mockRedistribute({ varValue: 100 });
    const result = await ecoQueries.redistribute('test');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('alerts');
    expect(result).toHaveProperty('totalCostPerOrder');
    expect(result).toHaveProperty('breakEven');
    expect(result).toHaveProperty('safetyRatio');
  });

  it('insère un snapshot si aucun snapshot récent', async () => {
    mockRedistribute({ varValue: 100, hasRecentSnapshot: false });
    await ecoQueries.redistribute('test_insert');
    const insertCalls = db.query.mock.calls.filter(([sql]) =>
      sql.trim().startsWith('INSERT INTO economic_snapshots')
    );
    expect(insertCalls.length).toBe(1);
  });

  it('ne réinsère pas de snapshot si un existe depuis < 15 min (debounce)', async () => {
    mockRedistribute({ varValue: 100, hasRecentSnapshot: true });
    await ecoQueries.redistribute('test_debounce');
    const insertCalls = db.query.mock.calls.filter(([sql]) =>
      sql.trim().startsWith('INSERT INTO economic_snapshots')
    );
    expect(insertCalls.length).toBe(0);
  });

  it('calcule correctement le coût par commande depuis des charges per_order', async () => {
    const charges = [
      { amount_kmf: 300, recurrence_period: 'per_order', is_active: true },
      { amount_kmf: 200, recurrence_period: 'per_order', is_active: true },
    ];
    mockRedistribute({ charges, varValue: 100 });
    const result = await ecoQueries.redistribute('calc_test');
    // perOrderCost = 500, monthlyPerOrder = 0 (pas de charge monthly), totalCostPerOrder = 500
    // Mais getVar('orders_per_month') retourne 100 → monthlyPerOrder = 0
    expect(result.totalCostPerOrder).toBe(500);
  });

  it('retourne status=blocking si breakEven > targetBasket', async () => {
    economicConfig.buildModelInputs.mockReturnValue({
      mixA: 25, mixB: 25, mixC: 25, mixD: 25,
      margA: 10, margB: 10, margC: 10, margD: 10,
      ordersPerMonth: 100, targetBasket: 1000,
    });
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.includes('FROM charges WHERE is_active')) {
        return { rows: [{ amount_kmf: 50000, recurrence_period: 'per_order', is_active: true }] };
      }
      if (s.includes('ABS(value_observed - value_supposed)')) return { rows: [] };
      if (s.includes('FROM economic_snapshots ORDER BY created_at DESC LIMIT 1')) return { rows: [] };
      if (s.includes('INSERT INTO economic_snapshots')) return { rows: [] };
      return { rows: [] };
    });
    const result = await ecoQueries.redistribute('blocking_test');
    expect(result.status).toBe('blocking');
  });
});

// ── getVariables ──────────────────────────────────────────────────────────────

describe('getVariables', () => {
  function mockVariableRead(rows) {
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.includes('FROM economic_variables WHERE is_active')) return { rows };
      if (s.includes('FROM charges WHERE is_active')) return { rows: [] };
      return { rows: [] };
    });
  }

  it('groupe les métadonnées legacy tout en déclarant finance_config comme vérité', async () => {
    mockVariableRead([
      { category: 'cost', key: 'cost_sourcing', label: 'Sourcing', value_used: 1000 },
      { category: 'cost', key: 'cost_transit', label: 'Transit', value_used: 500 },
      { category: 'margin', key: 'margin_rail_a', label: 'Rail A', value_used: 45 },
    ]);
    const result = await ecoQueries.getVariables();
    expect(result.source_of_truth).toBe('finance_config');
    expect(result.legacy_storage).toBe('read_only');
    expect(result.categories.cost.variables).toHaveLength(2);
    expect(result.categories.cost.label).toBe('Coûts');
    expect(result.categories.margin.variables).toHaveLength(1);
  });

  it('utilise un label et icône par défaut si la catégorie est inconnue', async () => {
    mockVariableRead([{ category: 'unknown_cat', key: 'x', label: 'X', value_used: 1 }]);
    const result = await ecoQueries.getVariables();
    expect(result.categories.unknown_cat).toMatchObject({ label: 'unknown_cat', icon: '📦' });
  });

  it('retourne categories={} si aucune variable active', async () => {
    mockVariableRead([]);
    const result = await ecoQueries.getVariables();
    expect(result.categories).toEqual({});
  });
});

// ── getCharges ────────────────────────────────────────────────────────────────

describe('getCharges', () => {
  it('groupe par famille et calcule les totaux', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { family: 'operationnelle', name: 'Hub Dubai', amount_kmf: 400,  is_active: true, recurrence_period: 'monthly'   },
        { family: 'operationnelle', name: 'Transit',   amount_kmf: 500,  is_active: true, recurrence_period: 'per_order' },
        { family: 'demarrage',      name: 'Setup',     amount_kmf: 1000, is_active: true, recurrence_period: 'one_time'  },
      ],
    });
    const result = await ecoQueries.getCharges();
    expect(result.families).toHaveProperty('operationnelle');
    expect(result.families.operationnelle.charges).toHaveLength(2);
    expect(result.totals.monthly).toBe(400);
    expect(result.totals.per_order).toBe(500);
    expect(result.totals.one_time).toBe(1000);
  });

  it('n\'ajoute pas aux totaux les charges inactives', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { family: 'operationnelle', name: 'Actif',   amount_kmf: 400, is_active: true,  recurrence_period: 'monthly' },
        { family: 'operationnelle', name: 'Inactif', amount_kmf: 999, is_active: false, recurrence_period: 'monthly' },
      ],
    });
    const result = await ecoQueries.getCharges();
    expect(result.totals.monthly).toBe(400);
  });

  it('utilise un label/emoji par defaut pour une famille inconnue et cumule les charges weekly', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { family: 'famille_inconnue', name: 'X', amount_kmf: 100, is_active: true, recurrence_period: 'weekly' },
      ],
    });
    const result = await ecoQueries.getCharges();
    expect(result.families.famille_inconnue).toMatchObject({ label: 'famille_inconnue', emoji: '📦' });
    expect(result.totals.weekly).toBe(100);
  });
});

// ── getHistory ────────────────────────────────────────────────────────────────

describe('getHistory', () => {
  it('retourne les snapshots les plus récents en premier', async () => {
    const snap = { id: 1, model_status: 'stable', created_at: new Date().toISOString() };
    db.query.mockResolvedValueOnce({ rows: [snap] });
    const result = await ecoQueries.getHistory();
    expect(result).toHaveProperty('snapshots');
    expect(result.snapshots[0]).toEqual(snap);
    // Vérifie que la requête passe bien ORDER BY created_at DESC LIMIT 20
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(sql).toContain('LIMIT 20');
  });

  it('retourne snapshots=[] si aucun historique', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await ecoQueries.getHistory();
    expect(result.snapshots).toEqual([]);
  });
});

// ── updateVariable ────────────────────────────────────────────────────────────

describe('updateVariable — legacy read-only / write-through canonique', () => {
  it('retourne 404 si la clé metadata n’existe pas', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await ecoQueries.updateVariable('missing_key', { value_used: 1 });
    expect(result).toMatchObject({ error: 'variable_not_found', status: 404 });
  });

  it('retourne 410 pour une variable calculée', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ key: 'total_cost_per_order', is_computed: true }] });
    const result = await ecoQueries.updateVariable('total_cost_per_order', { value_used: 1 });
    expect(result).toMatchObject({
      error: 'computed_variable_read_only', status: 410, source_of_truth: 'computed_projection',
    });
    expect(economicConfig.writeThroughLegacyInput).not.toHaveBeenCalled();
  });

  it('refuse 410 une clé legacy sans mapping et n’écrit jamais economic_variables', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ key: 'cost_transit', is_computed: false }] });
    const result = await ecoQueries.updateVariable('cost_transit', { value_used: 600 });
    expect(result.status).toBe(410);
    const legacyWrites = db.query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT INTO) economic_variables/i.test(sql.trim()));
    expect(legacyWrites).toHaveLength(0);
  });

  it('write-through une clé canonisée puis reconstruit le résumé sans écriture legacy', async () => {
    const metadata = { category: 'mix', key: 'mix_rail_a', label: 'Mix A', is_computed: false, value_supposed: 60 };
    economicConfig.writeThroughLegacyInput.mockResolvedValueOnce({
      key: 'mix_rail_a', canonical_field: 'mix_rail_a', value: 61,
      finance_config: { ...CURRENT_FINANCE, mix_rail_a: 61 },
    });
    economicConfig.projectLegacyRows.mockImplementation((rows) => rows.map(r => ({ ...r, value_used: 61, source_used: 'finance_config' })));
    economicConfig.buildModelInputs.mockImplementation(inputsFromConfig);
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.startsWith('SELECT * FROM economic_variables WHERE key')) return { rows: [metadata] };
      if (s.includes('FROM charges WHERE is_active')) return { rows: [] };
      if (s.includes('ABS(value_observed - value_supposed)')) return { rows: [] };
      if (s.includes('FROM economic_snapshots ORDER BY created_at DESC LIMIT 1')) return { rows: [{ created_at: new Date().toISOString() }] };
      return { rows: [] };
    });

    const result = await ecoQueries.updateVariable('mix_rail_a', { value_used: 61 }, 'admin-1');
    expect(economicConfig.writeThroughLegacyInput).toHaveBeenCalledWith('mix_rail_a', { value_used: 61 }, 'admin-1');
    expect(result).toMatchObject({ canonical_field: 'mix_rail_a', source_of_truth: 'finance_config' });
    const legacyWrites = db.query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT INTO) economic_variables/i.test(sql.trim()));
    expect(legacyWrites).toHaveLength(0);
  });
});

// ── createCharge ──────────────────────────────────────────────────────────────

describe('createCharge', () => {
  it('retourne missingFields si family, name ou amount_kmf manquants', async () => {
    expect((await ecoQueries.createCharge({ name: 'X', amount_kmf: 100 })).missingFields).toBe(true);
    expect((await ecoQueries.createCharge({ family: 'operationnelle', amount_kmf: 100 })).missingFields).toBe(true);
    expect((await ecoQueries.createCharge({ family: 'operationnelle', name: 'X' })).missingFields).toBe(true);
  });

  it('retourne invalidFamily si la famille est inconnue', async () => {
    const result = await ecoQueries.createCharge({
      family: 'fantasme', name: 'X', amount_kmf: 100,
    });
    expect(result.invalidFamily).toBe(true);
  });

  it('insère la charge et retourne { charge, executive }', async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.startsWith('INSERT INTO charges')) {
        return { rows: [{ id: 42, family: 'operationnelle', name: 'Nouveau', amount_kmf: 200 }] };
      }
      // redistribute + buildExecutiveSummary chain
      if (s.includes('FROM charges WHERE is_active')) return { rows: [] };
      if (s.includes('FROM economic_variables WHERE key')) return { rows: [{ value_used: 100, value_supposed: 100 }] };
      if (s.startsWith('UPDATE economic_variables SET value_used')) return { rows: [] };
      if (s.includes('ABS(value_observed - value_supposed)')) return { rows: [] };
      if (s.includes('FROM economic_snapshots ORDER BY created_at DESC LIMIT 1')) return { rows: [] };
      if (s.includes('INSERT INTO economic_snapshots')) return { rows: [] };
      if (s.includes('FROM charges WHERE is_active = TRUE')) return { rows: [] };
      return { rows: [] };
    });

    const result = await ecoQueries.createCharge({
      family: 'operationnelle', name: 'Nouveau', amount_kmf: 200,
    });
    expect(result.charge).toBeDefined();
    expect(result.charge.id).toBe(42);
    expect(result).toHaveProperty('executive');
  });
});

// ── deleteCharge ──────────────────────────────────────────────────────────────

describe('deleteCharge', () => {
  it('retourne notFound si la charge n\'existe pas', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    expect((await ecoQueries.deleteCharge('99', false)).notFound).toBe(true);
  });

  it('soft delete par défaut (force=false) → is_active=FALSE, mode=soft', async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.startsWith('SELECT * FROM charges WHERE id')) return { rows: [{ id: '5', is_deletable: true }] };
      if (s.startsWith('UPDATE charges SET is_active = FALSE')) return { rows: [{ id: '5', is_active: false }] };
      if (s.includes('FROM charges WHERE is_active')) return { rows: [] };
      if (s.includes('FROM economic_variables WHERE key')) return { rows: [{ value_used: 100, value_supposed: 100 }] };
      if (s.startsWith('UPDATE economic_variables SET value_used')) return { rows: [] };
      if (s.includes('ABS(value_observed - value_supposed)')) return { rows: [] };
      if (s.includes('FROM economic_snapshots ORDER BY created_at DESC LIMIT 1')) return { rows: [] };
      if (s.includes('INSERT INTO economic_snapshots')) return { rows: [] };
      if (s.includes('FROM charges WHERE is_active = TRUE')) return { rows: [] };
      return { rows: [] };
    });
    const result = await ecoQueries.deleteCharge('5', false);
    expect(result.mode).toBe('soft');
    expect(result.deleted).toBe(true);
    // Vérifie qu'aucun DELETE hard n'a été émis
    const hardDelete = db.query.mock.calls.find(([sql]) => sql.trim().startsWith('DELETE FROM charges'));
    expect(hardDelete).toBeUndefined();
  });

  it('hard delete si force=true et is_deletable=true', async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.startsWith('SELECT * FROM charges WHERE id')) return { rows: [{ id: '7', is_deletable: true }] };
      if (s.startsWith('DELETE FROM charges')) return { rows: [] };
      if (s.includes('FROM charges WHERE is_active')) return { rows: [] };
      if (s.includes('FROM economic_variables WHERE key')) return { rows: [{ value_used: 100, value_supposed: 100 }] };
      if (s.startsWith('UPDATE economic_variables SET value_used')) return { rows: [] };
      if (s.includes('ABS(value_observed - value_supposed)')) return { rows: [] };
      if (s.includes('FROM economic_snapshots ORDER BY created_at DESC LIMIT 1')) return { rows: [] };
      if (s.includes('INSERT INTO economic_snapshots')) return { rows: [] };
      if (s.includes('FROM charges WHERE is_active = TRUE')) return { rows: [] };
      return { rows: [] };
    });
    const result = await ecoQueries.deleteCharge('7', true);
    expect(result.mode).toBe('hard');
    expect(result.deleted).toBe(true);
  });

  it('retourne forbidden si force=true mais is_deletable=false', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: '3', is_deletable: false }] });
    const result = await ecoQueries.deleteCharge('3', true);
    expect(result.forbidden).toBe(true);
  });
});

// ── seedEconomicData ────────────────────────────────────────────────────────

describe('seedEconomicData', () => {
  it('seed uniquement les 5 charges et zéro economic_variables', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(ecoQueries.seedEconomicData()).resolves.toBeUndefined();
    const legacyWrites = db.query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT INTO) economic_variables/i.test(sql.trim()));
    const insertChargeCalls = db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO charges'));
    expect(legacyWrites).toHaveLength(0);
    expect(insertChargeCalls).toHaveLength(5);
  });

  it('continue le seed charges si les corrections historiques charges échouent', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes("UPDATE charges SET name = 'Hub Dubai'")) throw new Error('relation does not exist');
      return { rows: [] };
    });
    await expect(ecoQueries.seedEconomicData()).resolves.toBeUndefined();
    const legacyWrites = db.query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT INTO) economic_variables/i.test(sql.trim()));
    expect(legacyWrites).toHaveLength(0);
  });
});

// ── redistribute : charges monthly/weekly ───────────────────────────────────

describe('redistribute - repartition des couts monthly/weekly', () => {
  it('additionne correctement les charges monthly et weekly (weekly x4.33)', async () => {
    const charges = [
      { amount_kmf: 300, recurrence_period: 'monthly', is_active: true },
      { amount_kmf: 100, recurrence_period: 'weekly', is_active: true },
    ];
    mockRedistribute({ charges, varValue: 100 });
    const result = await ecoQueries.redistribute('monthly_weekly_test');
    // totalMonthlyCost = 300 + round(100*4.33) = 300 + 433 = 733
    // ordersPerMonth = 100 -> monthlyPerOrder = round(733/100) = 7
    // totalCostPerOrder = perOrderCost(0) + monthlyPerOrder(7) = 7
    expect(result.totalCostPerOrder).toBe(7);
  });

  it('gere ordersPerMonth<=0, weightedMargin<=0 et targetBasket<=0 (branches defensives)', async () => {
    mockRedistribute({ varValue: 0 }); // toutes les variables (mix, marges, orders, targetBasket) = 0
    const result = await ecoQueries.redistribute('zero_vars_test');
    // ordersPerMonth=0 -> monthlyPerOrder=0 ; weightedMargin=0 -> breakEven=999999
    // targetBasket=0 -> safetyRatio=0, marginPressure=100
    expect(result.breakEven).toBe(999999);
    expect(result.safetyRatio).toBe(0);
    expect(result.marginPressure).toBe(100);
  });

  it('reinsere un snapshot si le dernier date de plus de 15 minutes', async () => {
    const oldDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    let insertCalled = false;
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.includes('FROM charges WHERE is_active')) return { rows: [] };
      if (s.includes('ABS(value_observed - value_supposed)')) return { rows: [] };
      if (s.includes('FROM economic_snapshots ORDER BY created_at DESC LIMIT 1')) return { rows: [{ created_at: oldDate }] };
      if (s.includes('INSERT INTO economic_snapshots')) { insertCalled = true; return { rows: [] }; }
      return { rows: [] };
    });
    await ecoQueries.redistribute('old_snapshot_test');
    expect(insertCalled).toBe(true);
  });

  it("utilise 'manual' comme trigger_event par defaut si aucun n'est fourni", async () => {
    mockRedistribute({ varValue: 100 });
    await ecoQueries.redistribute();
    const insertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO economic_snapshots'));
    expect(insertCall[1][2]).toBe('manual');
  });
});

// ── buildExecutiveSummary ───────────────────────────────────────────────────

describe('buildExecutiveSummary', () => {
  it('agrege les charges par famille/type et trie les alertes par severite', async () => {
    const charges = [
      { family: 'operationnelle', amount_kmf: 200, recurrence_period: 'per_order', is_active: true },
      { family: 'operationnelle', amount_kmf: 400, recurrence_period: 'monthly', is_active: true },
      { family: 'demarrage', amount_kmf: 100, recurrence_period: 'weekly', is_active: true },
      { family: 'incident', amount_kmf: 999, recurrence_period: 'one_time', is_active: false },
    ];
    economicConfig.buildModelInputs.mockReturnValue({
      mixA: 25, mixB: 25, mixC: 25, mixD: 25,
      margA: 10, margB: 10, margC: 10, margD: 10,
      ordersPerMonth: 100, targetBasket: 1000,
    });
    db.query.mockImplementation(async (sql, params) => {
      const s = sql.trim();
      if (s.includes('FROM charges WHERE is_active')) return { rows: charges };
      if (s.includes('FROM economic_variables WHERE key')) {
        const v = vars[params && params[0]];
        return { rows: v != null ? [{ value_used: v, value_supposed: v }] : [] };
      }
      if (s.startsWith('UPDATE economic_variables')) return { rows: [] };
      if (s.includes('ABS(value_observed - value_supposed)')) return { rows: [] };
      if (s.includes('FROM economic_snapshots ORDER BY created_at DESC LIMIT 1')) return { rows: [] };
      if (s.includes('INSERT INTO economic_snapshots')) return { rows: [] };
      return { rows: [] };
    });

    const summary = await ecoQueries.buildExecutiveSummary();

    expect(summary.charges_summary.by_family).toEqual({
      operationnelle: 600, demarrage: 100, incident: 999,
    });
    expect(summary.charges_summary.total_per_order).toBe(200);
    expect(summary.charges_summary.total_monthly).toBe(400 + Math.round(100 * 4.33));
    expect(summary.charges_summary.count_active).toBe(4);
    // Au moins 2 alertes -> le comparateur de tri est bien exerce
    expect(summary.alerts.length).toBeGreaterThanOrEqual(2);
    expect(summary.status).toBe('blocking');
    expect(summary.kpis).toHaveLength(5);
  });
});

// ── getCoherence ─────────────────────────────────────────────────────────────

describe('getCoherence', () => {
  it('combine redistribute + checkSOVDrift et retourne le statut agrege', async () => {
    mockRedistribute({ varValue: 100 });
    const result = await ecoQueries.getCoherence();
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('status_label');
    expect(result).toHaveProperty('alerts');
    expect(result).toHaveProperty('checked_at');
  });
});

// ── updateCharge ─────────────────────────────────────────────────────────────

describe('updateCharge', () => {
  it('retourne notFound si la charge n\'existe pas', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await ecoQueries.updateCharge('99', { name: 'X' });
    expect(result.notFound).toBe(true);
  });

  it('retourne noFields si aucun champ reconnu', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: '5' }] });
    const result = await ecoQueries.updateCharge('5', { unknown_field: 'x' });
    expect(result.noFields).toBe(true);
  });

  it('effectue bien l\'UPDATE et retourne { charge, executive }', async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.startsWith('SELECT * FROM charges WHERE id')) return { rows: [{ id: '5', name: 'Old' }] };
      if (s.startsWith('UPDATE charges SET')) return { rows: [{ id: '5', name: 'Nouveau nom' }] };
      if (s.includes('FROM charges WHERE is_active')) return { rows: [] };
      if (s.includes('FROM economic_variables WHERE key')) return { rows: [{ value_used: 100, value_supposed: 100 }] };
      if (s.startsWith('UPDATE economic_variables SET value_used')) return { rows: [] };
      if (s.includes('ABS(value_observed - value_supposed)')) return { rows: [] };
      if (s.includes('FROM economic_snapshots ORDER BY created_at DESC LIMIT 1')) return { rows: [] };
      if (s.includes('INSERT INTO economic_snapshots')) return { rows: [] };
      return { rows: [] };
    });

    const result = await ecoQueries.updateCharge('5', { name: 'Nouveau nom' });
    expect(result.charge).toEqual({ id: '5', name: 'Nouveau nom' });
    expect(result).toHaveProperty('executive');
  });
});

// ── toggleCharge ─────────────────────────────────────────────────────────────

describe('toggleCharge', () => {
  it('retourne notFound si la charge n\'existe pas', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await ecoQueries.toggleCharge('99');
    expect(result.notFound).toBe(true);
  });

  it('inverse is_active et retourne { charge, executive }', async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.trim();
      if (s.startsWith('UPDATE charges SET is_active = NOT is_active')) return { rows: [{ id: '5', is_active: false }] };
      if (s.includes('FROM charges WHERE is_active')) return { rows: [] };
      if (s.includes('FROM economic_variables WHERE key')) return { rows: [{ value_used: 100, value_supposed: 100 }] };
      if (s.startsWith('UPDATE economic_variables SET value_used')) return { rows: [] };
      if (s.includes('ABS(value_observed - value_supposed)')) return { rows: [] };
      if (s.includes('FROM economic_snapshots ORDER BY created_at DESC LIMIT 1')) return { rows: [] };
      if (s.includes('INSERT INTO economic_snapshots')) return { rows: [] };
      return { rows: [] };
    });

    const result = await ecoQueries.toggleCharge('5');
    expect(result.charge).toEqual({ id: '5', is_active: false });
    expect(result).toHaveProperty('executive');
  });
});

// ── LOT 1A-4 writer ratchet ─────────────────────────────────────────────────

describe('economic_variables writer ratchet', () => {
  it('le service ne contient plus d’INSERT/UPDATE economic_variables', () => {
    const source = require('fs').readFileSync(require.resolve('../../services/economic-engine-queries'), 'utf8');
    expect(source).not.toMatch(/INSERT INTO economic_variables/i);
    expect(source).not.toMatch(/UPDATE economic_variables/i);
  });
});
