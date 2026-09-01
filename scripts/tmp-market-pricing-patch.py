from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(p): return (ROOT / p).read_text(encoding='utf-8')
def write(p, s): (ROOT / p).write_text(s, encoding='utf-8')
def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)

# services/pricing-workspace.js
p = 'services/pricing-workspace.js'
s = read(p)
s = replace_once(s,
    "const costComponents = require('./cost-component-admin-service');\nconst economicQueries = require('./economic-engine-queries');",
    "const costComponents = require('./cost-component-admin-service');\nconst marketCostComponents = require('./cost-component-market-service');\nconst economicQueries = require('./economic-engine-queries');",
    'pricing-workspace import')
market_block = r'''
async function buildMarketWorkspace({ market } = {}) {
  if (!market || !market.id || !market.code) {
    throw new PricingWorkspaceError(400, 'Marché Pricing requis', 'pricing_market_required');
  }
  const components = (await marketCostComponents.listEffectiveComponents(market.id)).map(publicComponent);
  return {
    scope: {
      mode: 'market_pricing',
      market_code: market.code,
      market_name: market.name,
      market_currency: market.currency,
      inherits_global: true,
    },
    summary: {
      cost_components: components.length,
      active_cost_components: components.filter(component => component.is_active).length,
      overridden_cost_components: components.filter(component => component.inherited === false).length,
    },
    cost_components: components,
    cost_meta: costComponents.META,
    capabilities: {
      cost_overrides: true,
      reset_to_global: true,
      create_components: false,
      product_price_mutation: false,
      strategy_mutation: false,
    },
  };
}

function marketOverridePayload(body = {}) {
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(body, 'default_value')) payload.default_value = body.default_value;
  if (Object.prototype.hasOwnProperty.call(body, 'notes')) payload.notes = body.notes;
  return payload;
}

async function updateMarketCostComponent(market, key, body = {}, actor = {}) {
  if (!market || !market.id) throw new PricingWorkspaceError(400, 'Marché Pricing requis', 'pricing_market_required');
  return marketCostComponents.upsertOverride({
    marketId: market.id,
    key,
    body: marketOverridePayload(body),
    actorId: actor.id || null,
  });
}

async function toggleMarketCostComponent(market, key, actor = {}) {
  if (!market || !market.id) throw new PricingWorkspaceError(400, 'Marché Pricing requis', 'pricing_market_required');
  const components = await marketCostComponents.listEffectiveComponents(market.id);
  const current = components.find(component => component.key === key);
  if (!current) throw new PricingWorkspaceError(404, 'Composant introuvable', 'market_cost_component_not_found');
  return marketCostComponents.upsertOverride({
    marketId: market.id,
    key,
    body: { is_active: !current.is_active },
    actorId: actor.id || null,
  });
}

async function resetMarketCostComponent(market, key, actor = {}) {
  if (!market || !market.id) throw new PricingWorkspaceError(400, 'Marché Pricing requis', 'pricing_market_required');
  return marketCostComponents.resetOverride({ marketId: market.id, key, actorId: actor.id || null });
}

'''
s = replace_once(s, 'module.exports = {\n', market_block + 'module.exports = {\n', 'pricing-workspace market block')
s = replace_once(s,
    '  buildWorkspace,\n',
    '  buildWorkspace,\n  buildMarketWorkspace,\n',
    'pricing-workspace export build')
s = replace_once(s,
    '  toggleCostComponent,\n};',
    '  toggleCostComponent,\n  updateMarketCostComponent,\n  toggleMarketCostComponent,\n  resetMarketCostComponent,\n};',
    'pricing-workspace exports')
write(p, s)

# services/pricing-cdr.js — optional market overlay, global signature remains compatible.
p = 'services/pricing-cdr.js'
s = read(p)
s = replace_once(s,
    "const { resolveFxRates } = require('../utils/rates');",
    "const { resolveFxRates } = require('../utils/rates');\nconst marketCostComponents = require('./cost-component-market-service');",
    'pricing-cdr import')
s = replace_once(s, 'async function loadGlobalConfig() {', 'async function loadGlobalConfig(options = {}) {', 'pricing-cdr signature')
anchor = "    components = ccRes.rows;\n  } catch (err) {\n    components = [];\n  }"
replacement = "    components = ccRes.rows;\n    if (options.marketId) {\n      const today = new Date();\n      components = (await marketCostComponents.listEffectiveComponents(options.marketId)).filter(component => {\n        if (!component.is_active || component.is_exceptional) return false;\n        if (component.active_from && new Date(component.active_from) > today) return false;\n        if (component.active_until && new Date(component.active_until) < today) return false;\n        return true;\n      });\n      componentsSource = 'cost_components_market_override';\n    }\n  } catch (err) {\n    components = [];\n  }"
s = replace_once(s, anchor, replacement, 'pricing-cdr overlay')
write(p, s)

# services/order-cost-snapshot.js — order.market_id is the only authority passed to pricing config.
p = 'services/order-cost-snapshot.js'
s = read(p)
s = replace_once(s,
    "            p.volume_m3\n     FROM order_items oi\n     LEFT JOIN products p ON p.id = oi.product_id",
    "            p.volume_m3, o.market_id\n     FROM order_items oi\n     JOIN orders o ON o.id = oi.order_id\n     LEFT JOIN products p ON p.id = oi.product_id",
    'order snapshot market select')
s = replace_once(s,
    '  const config = await pricingEngine.loadGlobalConfig();',
    "  const orderMarketId = itemsRes.rows[0]?.market_id || null;\n  const config = orderMarketId\n    ? await pricingEngine.loadGlobalConfig({ marketId: orderMarketId })\n    : await pricingEngine.loadGlobalConfig();",
    'order snapshot config')
write(p, s)

# Canonical app — market_operator is a real Canonical role and Pricing becomes market-aware.
p = 'public/dashboards/canonical/js/app.js'
s = read(p)
s = replace_once(s,
    "const ALLOWED_ROLES = new Set(['admin', 'finance', 'sourcing', 'agent_hub', 'agent_relais', 'agent_transitaire', 'support']);",
    "const ALLOWED_ROLES = new Set(['admin', 'market_operator', 'finance', 'sourcing', 'agent_hub', 'agent_relais', 'agent_transitaire', 'support']);",
    'canonical market_operator role')
s = replace_once(s,
    "  function renderPricingWorkspace(root, user) {\n    if (!global.KomerceCanonicalPricingWorkspace) throw new Error('canonical_pricing_workspace_module_missing');\n    return global.KomerceCanonicalPricingWorkspace.mount({\n      root,\n      user,\n      document: global.document,\n      fetch: global.fetch.bind(global),\n      ui: global.KomerceCanonicalUI,\n    });\n  }",
    "  function renderPricingWorkspace(root, user, adminContext, requestedMarket) {\n    return canonicalMount(\n      global.KomerceCanonicalPricingWorkspace,\n      'canonical_pricing_workspace_module_missing',\n      root,\n      user,\n      adminContext,\n      requestedMarket\n    );\n  }",
    'canonical pricing renderer')
insert_after = "  function renderFinanceAccountingWorkspaceShell(root, user, adminContext) {\n    return renderMarketSurfaceShell(root, user, adminContext, {\n      surface: 'accounting-workspace',\n      title: 'Workspace Finance / Comptabilité',\n      requireMarket: true,\n      render: renderFinanceAccountingWorkspace,\n    });\n  }\n"
pricing_shell = insert_after + "\n  function renderPricingWorkspaceShell(root, user, adminContext) {\n    return renderMarketSurfaceShell(root, user, adminContext, {\n      surface: 'pricing-workspace',\n      title: 'Workspace Pricing / Atelier des coûts',\n      requireMarket: user && user.role === 'market_operator',\n      render: renderPricingWorkspace,\n    });\n  }\n"
s = replace_once(s, insert_after, pricing_shell, 'pricing shell')
s = replace_once(s,
    "    if (surface === SURFACES.PRICING_WORKSPACE) return renderPricingWorkspace(root, user);",
    "    if (surface === SURFACES.PRICING_WORKSPACE) return renderPricingWorkspaceShell(root, user, adminContext);",
    'pricing render ready')
s = replace_once(s,
    "    const adminContext = (surface === SURFACES.CATALOG_WORKSPACE || surface === SURFACES.SOURCING_WORKSPACE || surface === SURFACES.PRICING_WORKSPACE || surface === SURFACES.ACTION_CENTER)\n      ? null\n      : await requireAdminContext();",
    "    const adminContext = (surface === SURFACES.CATALOG_WORKSPACE || surface === SURFACES.SOURCING_WORKSPACE || surface === SURFACES.ACTION_CENTER)\n      ? null\n      : await requireAdminContext();",
    'pricing admin context')
s = replace_once(s,
    '    renderFinanceAccountingWorkspaceShell,\n    renderDemo,',
    '    renderFinanceAccountingWorkspaceShell,\n    renderPricingWorkspaceShell,\n    renderDemo,',
    'pricing shell export')
write(p, s)

# Pricing Workspace UI — one surface, global for central or cost-only for a selected market.
p = 'public/dashboards/canonical/js/pricing-workspace.js'
s = read(p)
s = replace_once(s,
    "  const ENDPOINT = '/api/admin/workspaces/pricing';\n",
    "  const ENDPOINT = '/api/admin/workspaces/pricing';\n\n  function endpointFor(context) {\n    return context && context.requestedMarket\n      ? `${ENDPOINT}/market/${encodeURIComponent(context.requestedMarket)}`\n      : ENDPOINT;\n  }\n",
    'pricing ui endpoint helper')
s = replace_once(s, '  function header(doc) {', '  function header(doc, context) {', 'pricing ui header signature')
s = replace_once(s,
    "    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Comprendre, simuler et décider le prix'));\n    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Surface centrale · moteur économique global · aucune autorité pays dans le navigateur'));",
    "    const marketMode = Boolean(context && context.requestedMarket);\n    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', marketMode ? `Modèle de coûts · ${context.requestedMarket}` : 'Comprendre, simuler et décider le prix'));\n    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', marketMode\n      ? 'Atelier pays · héritage du modèle central · seules les surcharges de ce marché sont modifiables'\n      : 'Surface centrale · moteur économique global'));",
    'pricing ui header copy')
start = s.index('  function renderCosts(rootNode, ui, doc, payload, context) {')
end = s.index('  function formatEconomicValue(value, unit) {', start)
new_costs = r'''  function renderCosts(rootNode, ui, doc, payload, context) {
    const marketMode = Boolean(context && context.requestedMarket);
    const slot = section(
      rootNode,
      ui,
      'Atelier des coûts',
      marketMode
        ? 'Chaque ligne hérite du modèle central tant qu’aucune surcharge locale n’est définie. Reset restaure immédiatement l’héritage global.'
        : 'Autorité centrale cost_components. Les marchés peuvent surcharger valeur et activation sans modifier cette base.'
    );
    const rows = payload.cost_components || [];
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = marketMode
      ? '<thead><tr><th>Clé</th><th>Famille</th><th>Catégorie</th><th>Valeur effective</th><th>Base globale</th><th>Unité</th><th>Origine</th><th>État</th><th></th></tr></thead>'
      : '<thead><tr><th>Clé</th><th>Famille</th><th>Catégorie</th><th>Valeur</th><th>Unité</th><th>Scope</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.key));
      tr.appendChild(td(doc, row.family));
      tr.appendChild(td(doc, row.category));
      const valueCell = doc.createElement('td');
      const input = doc.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '0.01';
      input.value = row.default_value == null ? '' : row.default_value;
      input.dataset.costValue = row.key;
      valueCell.appendChild(input);
      tr.appendChild(valueCell);
      if (marketMode) {
        tr.appendChild(td(doc, row.base_default_value));
      }
      tr.appendChild(td(doc, row.unit));
      if (marketMode) {
        tr.appendChild(td(doc, row.inherited ? 'Global hérité' : 'Override pays'));
      } else {
        tr.appendChild(td(doc, row.scope));
      }
      tr.appendChild(td(doc, row.is_active ? 'Actif' : 'Inactif'));
      const actions = doc.createElement('td');
      const save = button(doc, 'Enregistrer', 'save-cost', true);
      save.dataset.key = row.key;
      actions.appendChild(save);
      const toggle = button(doc, row.is_active ? 'Désactiver' : 'Activer', 'toggle-cost', true);
      toggle.dataset.key = row.key;
      actions.appendChild(toggle);
      if (marketMode && row.inherited === false) {
        const reset = button(doc, 'Revenir au global', 'reset-cost', true);
        reset.dataset.key = row.key;
        actions.appendChild(reset);
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    slot.appendChild(wrap);

    if (!marketMode) {
      const form = doc.createElement('form');
      form.className = 'kmc-workspace-inline-form';
      form.dataset.pricingCostForm = '';
      form.innerHTML = '<input name="key" required placeholder="clé"><input name="label" required placeholder="Libellé"><select name="family"><option value="landed_relay">landed_relay</option><option value="business">business</option><option value="exceptional">exceptional</option></select><input name="category" required placeholder="catégorie"><input name="default_value" type="number" min="0" step="0.01" required placeholder="valeur"><select name="unit"><option value="kmf">kmf</option><option value="pct">pct</option><option value="kmf_per_kg">kmf_per_kg</option><option value="kmf_per_m3">kmf_per_m3</option></select><button class="kmc-workspace-action" type="submit">Créer composant</button>';
      slot.appendChild(form);
    }
  }

'''
s = s[:start] + new_costs + s[end:]
# route all actions through selected endpoint
for old, new in [
  ('`${ENDPOINT}/simulate`', '`${endpointFor(context)}/simulate`'),
  ('`${ENDPOINT}/products/${encodeURIComponent(productRef)}/apply-price`', '`${endpointFor(context)}/products/${encodeURIComponent(productRef)}/apply-price`'),
  ('`${ENDPOINT}/strategy?product_ref=${encodeURIComponent(productRef)}`', '`${endpointFor(context)}/strategy?product_ref=${encodeURIComponent(productRef)}`'),
  ('`${ENDPOINT}/strategy/apply`', '`${endpointFor(context)}/strategy/apply`'),
  ('`${ENDPOINT}/competitors/${encodeURIComponent(ref)}/deactivate`', '`${endpointFor(context)}/competitors/${encodeURIComponent(ref)}/deactivate`'),
  ('`${ENDPOINT}/cost-components/${encodeURIComponent(key)}/update`', '`${endpointFor(context)}/cost-components/${encodeURIComponent(key)}/update`'),
  ('`${ENDPOINT}/cost-components/${encodeURIComponent(key)}/toggle`', '`${endpointFor(context)}/cost-components/${encodeURIComponent(key)}/toggle`'),
  ('`${ENDPOINT}/competitors`', '`${endpointFor(context)}/competitors`'),
  ('`${ENDPOINT}/cost-components`', '`${endpointFor(context)}/cost-components`'),
]:
    s = s.replace(old, new)
# insert reset action after toggle block
old_toggle = "      if (act === 'toggle-cost') {\n        const key = target.dataset.key;\n        const result = await action(context, `${endpointFor(context)}/cost-components/${encodeURIComponent(key)}/toggle`, {}, 'État du composant modifié.');\n        if (result) await context.reload();\n      }"
new_toggle = old_toggle + "\n      if (act === 'reset-cost') {\n        const key = target.dataset.key;\n        const result = await action(context, `${endpointFor(context)}/cost-components/${encodeURIComponent(key)}/reset`, {}, 'Override supprimé · héritage global restauré.');\n        if (result) await context.reload();\n      }"
s = replace_once(s, old_toggle, new_toggle, 'pricing ui reset action')
s = replace_once(s,
    "      ui: options.ui,\n      reload: null,",
    "      ui: options.ui,\n      adminContext: options.adminContext || null,\n      requestedMarket: options.requestedMarket || null,\n      reload: null,",
    'pricing ui context')
s = replace_once(s,
    '      const payload = await jsonRequest(context.fetch, ENDPOINT);',
    '      const payload = await jsonRequest(context.fetch, endpointFor(context));',
    'pricing ui load endpoint')
s = replace_once(s,
    '      rootNode.appendChild(header(context.document));\n      rootNode.appendChild(context.ui.KpiStrip.create(metrics(payload.summary)).element);\n      renderEconomicModel(rootNode, context.ui, context.document, payload);\n      renderProducts(rootNode, context.ui, context.document, payload, context);\n      renderStrategy(rootNode, context.ui, context.document, context);\n      renderCosts(rootNode, context.ui, context.document, payload, context);\n      renderEconomicVariables(rootNode, context.ui, context.document, payload);\n      renderEconomicCharges(rootNode, context.ui, context.document, payload);',
    "      rootNode.appendChild(header(context.document, context));\n      rootNode.appendChild(context.ui.KpiStrip.create(metrics(payload.summary)).element);\n      if (context.requestedMarket) {\n        renderCosts(rootNode, context.ui, context.document, payload, context);\n      } else {\n        renderEconomicModel(rootNode, context.ui, context.document, payload);\n        renderProducts(rootNode, context.ui, context.document, payload, context);\n        renderStrategy(rootNode, context.ui, context.document, context);\n        renderCosts(rootNode, context.ui, context.document, payload, context);\n        renderEconomicVariables(rootNode, context.ui, context.document, payload);\n        renderEconomicCharges(rootNode, context.ui, context.document, payload);\n      }",
    'pricing ui conditional sections')
s = replace_once(s,
    '  return { ENDPOINT, mount, jsonRequest, metrics, recommendationByRef, formatEconomicValue };',
    '  return { ENDPOINT, endpointFor, mount, jsonRequest, metrics, recommendationByRef, formatEconomicValue };',
    'pricing ui export')
write(p, s)

# order-cost-snapshot test — prove market_id drives config selection.
p = 'tests/unit/order-cost-snapshot.test.js'
s = read(p)
insert = r'''
  it('charge le modèle de coûts du marché figé sur la commande', async () => {
    process.env.ORDER_COST_SNAPSHOT_ACTIVE = 'true';
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ order_item_id: 'oi-cm', product_id: 'prod-1', quantity: 1, price_kmf: 3000, market_id: 'market-cm' }] })
      .mockResolvedValueOnce({ rows: [] }) };
    pricingEngine.loadGlobalConfig.mockResolvedValueOnce({ market: 'CM' });
    pricingEngine.recommend.mockResolvedValueOnce({ landed_relay_cost_kmf: 1000, business_complete_cost_kmf: 2000 });

    await lockEstimatedCostsForOrder('order-cm', client);

    expect(pricingEngine.loadGlobalConfig).toHaveBeenCalledWith({ marketId: 'market-cm' });
    expect(pricingEngine.recommend).toHaveBeenCalledWith(expect.any(Object), { config: { market: 'CM' } });
  });

'''
s = replace_once(s,
    "  it('reste idempotent si ON CONFLICT DO NOTHING ne retourne aucune ligne', async () => {",
    insert + "  it('reste idempotent si ON CONFLICT DO NOTHING ne retourne aucune ligne', async () => {",
    'order snapshot market test')
write(p, s)

# New focused service test.
write('tests/unit/cost-component-market-service.test.js', r'''\'use strict\';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const db = require('../../db');
const service = require('../../services/cost-component-market-service');

describe('cost-component-market-service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('projection hérite du global sans override', () => {
    expect(service.effectiveRow({
      id: 'cc-1', key: 'freight', label: 'Fret', family: 'landed_relay', category: 'freight',
      base_default_value: '1000', unit: 'kmf_per_shipment', scope: 'global', source: 'default',
      confidence: 'medium', base_is_active: true, is_exceptional: false, override_id: null,
    })).toMatchObject({ key: 'freight', default_value: 1000, is_active: true, inherited: true });
  });

  test('projection applique valeur et activation du marché', () => {
    expect(service.effectiveRow({
      id: 'cc-1', key: 'freight', label: 'Fret', family: 'landed_relay', category: 'freight',
      base_default_value: '1000', unit: 'kmf_per_shipment', scope: 'global', source: 'default',
      confidence: 'medium', base_is_active: true, is_exceptional: false,
      override_id: 'ov-1', override_default_value: '1250', override_is_active: false, override_notes: 'CM',
    })).toMatchObject({ key: 'freight', default_value: 1250, is_active: false, base_default_value: 1000, inherited: false });
  });

  test('listEffectiveComponents borne la jointure par market_id', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await service.listEffectiveComponents('market-cm');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('o.market_id = $1'), ['market-cm']);
  });
});
'''.replace("\\'use strict\\';", "'use strict';"))

# New route boundary test.
write('tests/unit/admin-pricing-workspace-market-route.test.js', r'''\'use strict\';

/** @test-kind unit @test-runner jest @test-requires none */
let role = 'market_operator';
let authorized = new Set(['market-cm']);
let centralPricing = false;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'partner-1', role }; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => { req.authorizedMarkets = new Set(authorized); next(); },
  requireMarketScope: getter => (req, res, next) => req.authorizedMarkets.has(getter(req))
    ? next()
    : res.status(403).json({ code: 'market_scope_denied' }),
}));

jest.mock('../../middleware/require-pricing-global-authority', () => ({
  hasPricingGlobalAuthority: jest.fn(async () => centralPricing),
  requirePricingGlobalAuthority: (req, res, next) => centralPricing ? next() : res.status(403).json({ code: 'pricing_global_access_denied' }),
}));

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');

const marketProjection = { scope: { mode: 'market_pricing', market_code: 'CM' }, summary: {}, cost_components: [] };
const workspace = {
  PricingWorkspaceError: class PricingWorkspaceError extends Error {},
  buildMarketWorkspace: jest.fn(async () => marketProjection),
  updateMarketCostComponent: jest.fn(async () => ({ key: 'freight', default_value: 1250 })),
  toggleMarketCostComponent: jest.fn(async () => ({ key: 'freight', is_active: false })),
  resetMarketCostComponent: jest.fn(async () => ({ key: 'freight', inherited: true })),
  buildWorkspace: jest.fn(), simulate: jest.fn(), flow: jest.fn(), applyPrice: jest.fn(), getStrategy: jest.fn(),
  applyStrategy: jest.fn(), addCompetitor: jest.fn(), deactivateCompetitor: jest.fn(), createCostComponent: jest.fn(),
  updateCostComponent: jest.fn(), toggleCostComponent: jest.fn(),
};
jest.mock('../../services/pricing-workspace', () => workspace);

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-pricing-workspace');
function app() { const a = express(); a.use(express.json()); a.use('/api/admin/workspaces/pricing', router); return a; }

beforeEach(() => {
  jest.clearAllMocks();
  role = 'market_operator';
  authorized = new Set(['market-cm']);
  centralPricing = false;
  db.query.mockImplementation(async (_sql, params) => ({ rows: [{ id: params[0] === 'CM' ? 'market-cm' : 'market-cg', code: params[0], name: params[0], currency: 'XAF' }] }));
});

test('opérateur CM lit et modifie uniquement le modèle CM', async () => {
  let res = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(res.status).toBe(200);
  expect(workspace.buildMarketWorkspace).toHaveBeenCalledWith({ market: expect.objectContaining({ id: 'market-cm', code: 'CM' }) });

  res = await request(app()).post('/api/admin/workspaces/pricing/market/CM/cost-components/freight/update').send({ default_value: 1250 });
  expect(res.status).toBe(200);
  expect(workspace.updateMarketCostComponent).toHaveBeenCalledWith(expect.objectContaining({ id: 'market-cm' }), 'freight', { default_value: 1250 }, expect.objectContaining({ id: 'partner-1' }));
});

test('opérateur CM reçoit 403 sur le modèle CG', async () => {
  const res = await request(app()).get('/api/admin/workspaces/pricing/market/CG');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('market_scope_denied');
  expect(workspace.buildMarketWorkspace).not.toHaveBeenCalled();
});

test('market_operator ne peut jamais atteindre le pricing global', async () => {
  const res = await request(app()).get('/api/admin/workspaces/pricing');
  expect(res.status).toBe(403);
  expect(workspace.buildWorkspace).not.toHaveBeenCalled();
});
'''.replace("\\'use strict\\';", "'use strict';"))

# Feature manifest additions.
p = 'features/economic-engine.feature.js'
s = read(p)
s = replace_once(s,
    "      'services/cost-component-admin-service.js',\n      'services/pricing-workspace.js',",
    "      'services/cost-component-admin-service.js',\n      'services/cost-component-market-service.js',\n      'services/pricing-workspace.js',",
    'economic service manifest')
s = replace_once(s,
    "      'migrations/152_pricing_workspace_global_authority.sql',\n",
    "      'migrations/152_pricing_workspace_global_authority.sql',\n      'migrations/159_cost_component_market_overrides.sql',\n",
    'economic migration manifest')
s = replace_once(s,
    "      'tests/unit/admin-pricing-workspace-route.test.js',\n      'tests/unit/pricing-workspace.test.js',",
    "      'tests/unit/admin-pricing-workspace-route.test.js',\n      'tests/unit/admin-pricing-workspace-market-route.test.js',\n      'tests/unit/cost-component-market-service.test.js',\n      'tests/unit/pricing-workspace.test.js',",
    'economic test manifest')
s = replace_once(s,
    "      'cost_component_events: RW',\n      'cost_components: RW',",
    "      'cost_component_events: RW',\n      'cost_component_market_override_events: RW!',\n      'cost_component_market_overrides: RW!',\n      'cost_components: RW',",
    'economic table manifest')
s = replace_once(s,
    "      'POST /api/admin/workspaces/pricing/cost-components/:key/toggle',\n",
    "      'POST /api/admin/workspaces/pricing/cost-components/:key/toggle',\n      'GET /api/admin/workspaces/pricing/market/:marketCode',\n      'POST /api/admin/workspaces/pricing/market/:marketCode/cost-components/:key/update',\n      'POST /api/admin/workspaces/pricing/market/:marketCode/cost-components/:key/toggle',\n      'POST /api/admin/workspaces/pricing/market/:marketCode/cost-components/:key/reset',\n",
    'economic contract manifest')
write(p, s)

# Contract generator route allow-list.
p = 'scripts/contract-generate.js'
s = read(p)
anchor = "  { prefix: '/api/admin/workspaces/accounting/market/{marketCode}/deposits/{depositRef}/dispute', method: 'post', schema: null },\n"
addition = anchor + "  // LOT 4U — Market-scoped Pricing cost workshop\n  { prefix: '/api/admin/workspaces/pricing/market/{marketCode}', method: 'get', schema: null },\n  { prefix: '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/update', method: 'post', schema: null },\n  { prefix: '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/toggle', method: 'post', schema: null },\n  { prefix: '/api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/reset', method: 'post', schema: null },\n"
s = replace_once(s, anchor, addition, 'contract generator market pricing')
write(p, s)

# Contract documentation.
p = 'docs/contract/PRICING_WORKSPACE_4F.md'
s = read(p)
s += r'''

## LOT 4U — Atelier des coûts par marché

Le rôle `market_operator` ne reçoit jamais `pricing_global_access_grants`. Il agit uniquement sur
`/api/admin/workspaces/pricing/market/:marketCode`, après résolution serveur du marché et vérification
de `operator_market_scopes`.

Le modèle global `cost_components` reste la base structurelle. `cost_component_market_overrides`
porte uniquement les différences pays : `default_value` et `is_active`. Absence d'override = héritage
du global. Un reset supprime l'override courant et journalise l'événement ; il ne modifie jamais le
composant global.

La granularité `scope` du composant (`category`, `product`, `relay`, etc.) reste une dimension métier
interne. Le marché est une frontière d'autorisation et de modèle économique distincte ; les deux axes
ne sont jamais confondus.

Le snapshot de coût d'une commande consomme le modèle effectif à partir de `orders.market_id`, déjà
résolu/fixé côté serveur. Aucun `market_id` ou `marketCode` de body/query navigateur n'entre dans le
calcul du CDR.

Dans ce lot, les partenaires pays peuvent modifier les hypothèses de coûts existantes et les activer /
désactiver localement. Ils ne peuvent pas créer de nouvelles catégories de composants, modifier le prix
catalogue global, la stratégie globale ou les variables économiques centrales.
'''
write(p, s)

# Remove temporary patch assets in the product commit.
(ROOT / 'scripts/tmp-market-pricing-patch.py').unlink()
(ROOT / '.github/workflows/tmp-market-pricing-patch.yml').unlink()
print('market pricing patch applied')
