#!/usr/bin/env node
'use strict';

const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceOnce(path, from, to) {
  const src = read(path);
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${path}: expected one literal match, got ${n}`);
  write(path, src.replace(from, to));
}
function replaceRegexOnce(path, re, to) {
  const src = read(path);
  const m = src.match(re);
  if (!m || m.length < 1) throw new Error(`${path}: missing regex ${re}`);
  const replaced = src.replace(re, to);
  if (replaced === src) throw new Error(`${path}: regex replacement did nothing ${re}`);
  write(path, replaced);
}

const engine = 'tests/unit/economic-engine-queries.test.js';

replaceOnce(engine,
`jest.mock('../../utils/eco-bridge', () => ({
  invalidateEcoCache:     jest.fn(),
  invalidateChargesCache: jest.fn(),
}));

const db = require('../../db');
const ecoQueries = require('../../services/economic-engine-queries');`,
`jest.mock('../../utils/eco-bridge', () => ({
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
const ecoQueries = require('../../services/economic-engine-queries');`);

replaceOnce(engine,
`beforeEach(() => {
  jest.clearAllMocks();
});`,
`const CURRENT_FINANCE = {
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
});`);

replaceRegexOnce(engine,
/\/\/ ── getVar ─[\s\S]*?\/\/ ── checkSOVDrift/,
`// ── getVar ────────────────────────────────────────────────────────────────────

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

// ── checkSOVDrift`);

replaceRegexOnce(engine,
/\/\/ Helper : mock minimal pour que redistribute puisse s'exécuter sans DB réel\.[\s\S]*?\n\}\n\ndescribe\('redistribute'/,
`// Helper : finance_config est mocké comme SOV; DB ne sert qu'aux charges, drift et snapshots.
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

describe('redistribute'`);

replaceRegexOnce(engine,
/  it\('retourne status=blocking si breakEven > targetBasket'[\s\S]*?\n  \}\);\n\}\);\n\n\/\/ ── getVariables/,
`  it('retourne status=blocking si breakEven > targetBasket', async () => {
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

// ── getVariables`);

replaceRegexOnce(engine,
/describe\('getVariables'[\s\S]*?\n\}\);\n\n\/\/ ── getCharges/,
`describe('getVariables', () => {
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

// ── getCharges`);

replaceRegexOnce(engine,
/\/\/ ── updateVariable ─[\s\S]*?\/\/ ── createCharge/,
`// ── updateVariable ────────────────────────────────────────────────────────────

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

// ── createCharge`);

replaceRegexOnce(engine,
/\/\/ ── seedEconomicData ─[\s\S]*?\/\/ ── redistribute : charges monthly\/weekly/,
`// ── seedEconomicData ────────────────────────────────────────────────────────

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

// ── redistribute : charges monthly/weekly`);

replaceRegexOnce(engine,
/  it\('reinsere un snapshot si le dernier date de plus de 15 minutes'[\s\S]*?\n  \}\);/,
`  it('reinsere un snapshot si le dernier date de plus de 15 minutes', async () => {
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
  });`);

replaceRegexOnce(engine,
/    const vars = \{\n      mix_rail_a: 25,[\s\S]*?target_basket_avg: 1000[^\n]*\n    \};\n    db\.query\.mockImplementation/,
`    economicConfig.buildModelInputs.mockReturnValue({
      mixA: 25, mixB: 25, mixC: 25, mixD: 25,
      margA: 10, margB: 10, margC: 10, margD: 10,
      ordersPerMonth: 100, targetBasket: 1000,
    });
    db.query.mockImplementation`);

// Old writer-specific tail is replaced by a no-writer ratchet.
replaceRegexOnce(engine,
/\/\/ ── updateVariable : branche source_used === 'observed' ─[\s\S]*$/,
`// ── LOT 1A-4 writer ratchet ─────────────────────────────────────────────────

describe('economic_variables writer ratchet', () => {
  it('le service ne contient plus d’INSERT/UPDATE economic_variables', () => {
    const source = require('fs').readFileSync(require.resolve('../../services/economic-engine-queries'), 'utf8');
    expect(source).not.toMatch(/INSERT INTO economic_variables/i);
    expect(source).not.toMatch(/UPDATE economic_variables/i);
  });
});
`);

// ── dashboard Ops ─────────────────────────────────────────────────────────────
const ops = 'tests/unit/dashboard-ops-queries.test.js';
replaceOnce(ops,
`jest.mock('../../services/economic-engine-queries', () => ({
  getVar: jest.fn(),
}));

const db = require('../../db');
const { getEurKmf, loadDashConfig } = require('../../routes/dashboard-shared');
const { getVar } = require('../../services/economic-engine-queries');
const opsQueries = require('../../services/dashboard-ops-queries');`,
`jest.mock('../../services/economic-config', () => ({
  loadFinanceConfig: jest.fn(),
  resolveLegacyInput: jest.fn(),
}));

const db = require('../../db');
const { getEurKmf, loadDashConfig } = require('../../routes/dashboard-shared');
const economicConfig = require('../../services/economic-config');
const opsQueries = require('../../services/dashboard-ops-queries');`);

replaceOnce(ops,
`beforeEach(() => {
  jest.clearAllMocks();
});`,
`beforeEach(() => {
  jest.clearAllMocks();
  economicConfig.loadFinanceConfig.mockResolvedValue({
    customs_rate_default_pct: 42,
    hub_monthly_cost_aed: 7000,
  });
  economicConfig.resolveLegacyInput.mockImplementation((config, key) =>
    key === 'customs_rate_default_pct' ? Number(config.customs_rate_default_pct) : Number(config.hub_monthly_cost_aed)
  );
});`);

replaceRegexOnce(ops,
/  it\('FIX: appelle getEcoVar \(getVar\) avec les bonnes clés et valeurs par défaut'[\s\S]*?\n  \}\);/,
`  it('lit douane fallback et coût hub depuis finance_config', async () => {
    getEurKmf.mockResolvedValueOnce({ eur_kmf: 491, aed_kmf: 134 });
    db.query
      .mockResolvedValueOnce({ rows: [VOL_ROW] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('vue absente'))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await opsQueries.getPilotage('2026-06');

    expect(economicConfig.loadFinanceConfig).toHaveBeenCalledTimes(1);
    expect(economicConfig.resolveLegacyInput).toHaveBeenCalledWith(expect.any(Object), 'customs_rate_default_pct');
    expect(economicConfig.resolveLegacyInput).toHaveBeenCalledWith(expect.any(Object), 'hub_monthly_cost_aed');
    expect(result.couts.source_taux).toBe('finance_config_fallback');
    expect(result.couts.taux_terrain_pct).toBeCloseTo(42);
    expect(result.couts.hub_fixe_mensuel_kmf).toBe(7000 * 134);
  });`);

// remove obsolete getVar setup calls from remaining Pilotage tests
let opsSrc = read(ops);
opsSrc = opsSrc.replace(/\n    getVar\.mockResolvedValueOnce\(42\)\.mockResolvedValueOnce\(7000\);/g, '');
write(ops, opsSrc);

// ── route ─────────────────────────────────────────────────────────────────────
replaceOnce('tests/unit/economic-route.test.js',
  "      expect(queries.updateVariable).toHaveBeenCalledWith('eur_kmf', { value: 750 });",
  "      expect(queries.updateVariable).toHaveBeenCalledWith('eur_kmf', { value: 750 }, 'admin-1');");

console.log('LOT 1A-4 test migration applied with assertions.');
