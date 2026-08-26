'use strict';

const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function mustReplace(source, oldValue, newValue, label) {
  if (!source.includes(oldValue)) throw new Error(`Missing anchor: ${label}`);
  return source.replace(oldValue, newValue);
}

// Legacy cash -> shared mutation authority
{
  const path = 'routes/cash.js';
  let s = read(path);
  if (!s.includes("require('../services/cash-deposit-service')")) {
    s = mustReplace(
      s,
      "const { collectCash } = require('../services/cash-operations'); // [R5]\n",
      "const { collectCash } = require('../services/cash-operations'); // [R5]\nconst cashDeposits = require('../services/cash-deposit-service');\n",
      'cash deposit import'
    );
    s = s.replace(
      '* @depends       db.js, middleware/auth.js, services/*',
      '* @depends       db.js, middleware/auth.js, services/cash-operations.js, services/cash-deposit-service.js, services/*'
    );
  }

  const depositStart = s.indexOf('// 3. POST /deposit — Agent déclare un dépôt');
  const depositEnd = s.indexOf('// 4. GET /deposits', depositStart);
  if (depositStart < 0 || depositEnd < 0) throw new Error('Legacy deposit block not found');
  const dividerStart = s.lastIndexOf('// ═', depositStart);
  const dividerEnd = s.lastIndexOf('// ═', depositEnd);
  const depositReplacement = [
    '// ══════════════════════════════════════════════════════════════════════════════',
    '// 3. POST /deposit — Agent déclare un dépôt',
    '// ══════════════════════════════════════════════════════════════════════════════',
    "router.post('/deposit', authenticate, requireRelaisOrAdmin, async (req, res, next) => {",
    '  try {',
    '    const deposit = await cashDeposits.createDeposit({ agentId: req.user.id, payload: req.body || {} });',
    '    return res.status(201).json({',
    '      success: true,',
    "      message: `Dépôt de ${Number(deposit.amount_kmf).toLocaleString('fr-FR')} KMF enregistré`,",
    '      deposit,',
    '    });',
    '  } catch (err) {',
    '    if (err instanceof cashDeposits.CashDepositError) {',
    '      return res.status(err.status || 400).json({ error: err.message });',
    '    }',
    '    return next(err);',
    '  }',
    '});',
    '',
  ].join('\n');
  s = s.slice(0, dividerStart) + depositReplacement + s.slice(dividerEnd);

  const verifyStart = s.indexOf('// 5. POST /deposits/:id/verify — Admin valide un dépôt');
  const verifyEnd = s.indexOf('// 6. POST /deposits/:id/dispute', verifyStart);
  if (verifyStart < 0 || verifyEnd < 0) throw new Error('Legacy verify block not found');
  const verifyDividerStart = s.lastIndexOf('// ═', verifyStart);
  const verifyDividerEnd = s.lastIndexOf('// ═', verifyEnd);
  const verifyReplacement = [
    '// ══════════════════════════════════════════════════════════════════════════════',
    '// 5. POST /deposits/:id/verify — Admin valide un dépôt',
    '// ══════════════════════════════════════════════════════════════════════════════',
    "router.post('/deposits/:id/verify', authenticate, requireAdmin, async (req, res, next) => {",
    '  try {',
    '    const deposit = await cashDeposits.verifyDeposit({',
    '      depositId: req.params.id,',
    '      verifierId: req.user.id,',
    '      notes: req.body && req.body.notes,',
    '    });',
    "    return res.json({ success: true, message: 'Dépôt vérifié', deposit });",
    '  } catch (err) {',
    '    if (err instanceof cashDeposits.CashDepositError) {',
    '      return res.status(err.status || 400).json({ error: err.message });',
    '    }',
    '    return next(err);',
    '  }',
    '});',
    '',
  ].join('\n');
  s = s.slice(0, verifyDividerStart) + verifyReplacement + s.slice(verifyDividerEnd);

  const disputeStart = s.indexOf('// 6. POST /deposits/:id/dispute — Admin conteste un dépôt');
  const disputeEnd = s.indexOf('// 7. GET /reconciliation', disputeStart);
  if (disputeStart < 0 || disputeEnd < 0) throw new Error('Legacy dispute block not found');
  const disputeDividerStart = s.lastIndexOf('// ═', disputeStart);
  const disputeDividerEnd = s.lastIndexOf('// ═', disputeEnd);
  const disputeReplacement = [
    '// ══════════════════════════════════════════════════════════════════════════════',
    '// 6. POST /deposits/:id/dispute — Admin conteste un dépôt',
    '// ══════════════════════════════════════════════════════════════════════════════',
    "router.post('/deposits/:id/dispute', authenticate, requireAdmin, async (req, res, next) => {",
    '  try {',
    '    const deposit = await cashDeposits.disputeDeposit({',
    '      depositId: req.params.id,',
    '      verifierId: req.user.id,',
    '      reason: req.body && req.body.reason,',
    '    });',
    "    return res.json({ success: true, message: 'Dépôt contesté', deposit });",
    '  } catch (err) {',
    '    if (err instanceof cashDeposits.CashDepositError) {',
    '      return res.status(err.status || 400).json({ error: err.message });',
    '    }',
    '    return next(err);',
    '  }',
    '});',
    '',
  ].join('\n');
  s = s.slice(0, disputeDividerStart) + disputeReplacement + s.slice(disputeDividerEnd);
  write(path, s);
}

// API runtime
{
  const path = 'bootstrap/api-routes.js';
  let s = read(path);
  if (!s.includes('adminFinanceAccountingWorkspaceRouter')) {
    s = mustReplace(
      s,
      "  const adminCatalogWorkspaceRouter = require('../routes/admin-catalog-workspace');\n",
      "  const adminCatalogWorkspaceRouter = require('../routes/admin-catalog-workspace');\n  const adminFinanceAccountingWorkspaceRouter = require('../routes/admin-finance-accounting-workspace');\n",
      'api require'
    );
    s = mustReplace(
      s,
      "  app.use('/api/admin/workspaces/catalog', adminCatalogWorkspaceRouter);\n",
      "  app.use('/api/admin/workspaces/catalog', adminCatalogWorkspaceRouter);\n  app.use('/api/admin/workspaces/accounting', adminFinanceAccountingWorkspaceRouter);\n",
      'api mount'
    );
    s = s.replace(
      'routes/admin-shipping-customs-workspace.js, routes/admin-catalog-workspace.js',
      'routes/admin-shipping-customs-workspace.js, routes/admin-catalog-workspace.js, routes/admin-finance-accounting-workspace.js'
    );
  }
  write(path, s);
}

// HTML runtime
{
  const path = 'bootstrap/html-routes.js';
  let s = read(path);
  if (!s.includes("'/admin/workspaces/accounting'")) {
    s = mustReplace(s, "    '/admin/workspaces/catalog',\n", "    '/admin/workspaces/catalog',\n    '/admin/workspaces/accounting',\n", 'html canonical path');
    s = mustReplace(
      s,
      "    '/admin-next/workspaces/catalog': '/admin/workspaces/catalog',\n",
      "    '/admin-next/workspaces/catalog': '/admin/workspaces/catalog',\n    '/admin-next/workspaces/accounting': '/admin/workspaces/accounting',\n",
      'html alias'
    );
  }
  write(path, s);
}

// Canonical index
{
  const path = 'public/dashboards/canonical/index.html';
  let s = read(path);
  if (!s.includes('/dashboards/canonical/js/finance-accounting-workspace.js')) {
    s = mustReplace(
      s,
      '  <script src="/dashboards/canonical/js/catalog-workspace.js"></script>\n',
      '  <script src="/dashboards/canonical/js/catalog-workspace.js"></script>\n  <script src="/dashboards/canonical/js/finance-accounting-workspace.js"></script>\n',
      'canonical script'
    );
  }
  write(path, s);
}

// Canonical app
{
  const path = 'public/dashboards/canonical/js/app.js';
  let s = read(path);
  if (!s.includes("ACCOUNTING_WORKSPACE: 'accounting-workspace'")) {
    s = mustReplace(s, "    CATALOG_WORKSPACE: 'catalog-workspace',\n", "    CATALOG_WORKSPACE: 'catalog-workspace',\n    ACCOUNTING_WORKSPACE: 'accounting-workspace',\n", 'surface enum');
    const catalogRoute = [
      "    if (path === '/admin/workspaces/catalog' || path === '/admin-next/workspaces/catalog') {",
      '      return SURFACES.CATALOG_WORKSPACE;',
      '    }',
      '',
    ].join('\n');
    s = mustReplace(
      s,
      catalogRoute,
      catalogRoute + [
        "    if (path === '/admin/workspaces/accounting' || path === '/admin-next/workspaces/accounting') {",
        '      return SURFACES.ACCOUNTING_WORKSPACE;',
        '    }',
        '',
      ].join('\n'),
      'surface route'
    );
    const renderBlock = [
      '  function renderFinanceAccountingWorkspace(root, user, adminContext, requestedMarket) {',
      '    return canonicalMount(',
      '      global.KomerceCanonicalFinanceAccountingWorkspace,',
      "      'canonical_accounting_workspace_module_missing',",
      '      root,',
      '      user,',
      '      adminContext,',
      '      requestedMarket',
      '    );',
      '  }',
      '',
    ].join('\n');
    s = mustReplace(s, '  function renderCatalogWorkspace(root, user, adminContext) {\n', renderBlock + '  function renderCatalogWorkspace(root, user, adminContext) {\n', 'render function');
    const shellBlock = [
      '  function renderFinanceAccountingWorkspaceShell(root, user, adminContext) {',
      '    return renderMarketSurfaceShell(root, user, adminContext, {',
      "      surface: 'accounting-workspace',",
      "      title: 'Workspace Finance / Comptabilité',",
      '      requireMarket: true,',
      '      render: renderFinanceAccountingWorkspace,',
      '    });',
      '  }',
      '',
    ].join('\n');
    s = mustReplace(s, '  function renderDemo(root, user) {\n', shellBlock + '  function renderDemo(root, user) {\n', 'shell function');
    s = mustReplace(
      s,
      '    if (surface === SURFACES.CATALOG_WORKSPACE) return renderCatalogWorkspace(root, user, adminContext);\n',
      '    if (surface === SURFACES.CATALOG_WORKSPACE) return renderCatalogWorkspace(root, user, adminContext);\n    if (surface === SURFACES.ACCOUNTING_WORKSPACE) return renderFinanceAccountingWorkspaceShell(root, user, adminContext);\n',
      'render ready'
    );
    s = mustReplace(s, '    renderCatalogWorkspace,\n', '    renderCatalogWorkspace,\n    renderFinanceAccountingWorkspace,\n', 'export render');
    s = mustReplace(s, '    renderShippingCustomsWorkspaceShell,\n', '    renderShippingCustomsWorkspaceShell,\n    renderFinanceAccountingWorkspaceShell,\n', 'export shell');
    s = s.replace('shipping-customs-workspace, catalog-workspace, order-360', 'shipping-customs-workspace, catalog-workspace, finance-accounting-workspace, order-360');
    s = s.replace('/admin/workspaces/shipping-customs, /admin/workspaces/catalog, /admin/orders', '/admin/workspaces/shipping-customs, /admin/workspaces/catalog, /admin/workspaces/accounting, /admin/orders');
  }
  write(path, s);
}

// Contract generator
{
  const path = 'scripts/contract-generate.js';
  let s = read(path);
  if (!s.includes('LOT 4D — Canonical Finance / Comptabilité Workspace')) {
    const anchor = "  { prefix: '/api/admin/workspaces/catalog/categories/{key}/subcategories/{subKey}/deactivate', method: 'post', schema: null },\n";
    const block = [
      '  // LOT 4D — Canonical Finance / Comptabilité Workspace (single-market cash actions)',
      "  { prefix: '/api/admin/workspaces/accounting/market/{marketCode}', method: 'get', schema: null },",
      "  { prefix: '/api/admin/workspaces/accounting/market/{marketCode}/deposits', method: 'post', schema: null },",
      "  { prefix: '/api/admin/workspaces/accounting/market/{marketCode}/deposits/{depositRef}/verify', method: 'post', schema: null },",
      "  { prefix: '/api/admin/workspaces/accounting/market/{marketCode}/deposits/{depositRef}/dispute', method: 'post', schema: null },",
      '',
    ].join('\n');
    s = mustReplace(s, anchor, anchor + block, 'contract route block');
  }
  if (!s.includes('// LOT 4D — réponses Finance / Comptabilité Workspace')) {
    const responseBlock = [
      '  // LOT 4D — réponses Finance / Comptabilité Workspace consommées par Canonical.',
      "  '/api/admin/workspaces/accounting/market/{marketCode}': { get: { fields: ['scope','filters','summary','reconciliation','deposits','uncollected','collections','invoices'], source: 'test' } },",
      "  '/api/admin/workspaces/accounting/market/{marketCode}/deposits': { post: { fields: ['ok','action','result'], source: 'test' } },",
      "  '/api/admin/workspaces/accounting/market/{marketCode}/deposits/{depositRef}/verify': { post: { fields: ['ok','action','result'], source: 'test' } },",
      "  '/api/admin/workspaces/accounting/market/{marketCode}/deposits/{depositRef}/dispute': { post: { fields: ['ok','action','result'], source: 'test' } },",
      '',
    ].join('\n');
    s = mustReplace(s, 'const KNOWN_RESPONSES = {\n', 'const KNOWN_RESPONSES = {\n' + responseBlock, 'known responses');
  }
  write(path, s);
}

// Feature ownership: payments owns mutation; dashboard owns orchestration/projection.
{
  const path = 'features/payments.feature.js';
  let s = read(path);
  if (!s.includes('services/cash-deposit-service.js')) {
    s = mustReplace(s, "      'services/cash-operations.js',\n", "      'services/cash-operations.js',\n      'services/cash-deposit-service.js',\n", 'payments service ownership');
  }
  if (!s.includes('migrations/148_cash_deposit_business_reference.sql')) {
    s = mustReplace(s, "      'migrations/079_paypal_payment_mode.sql',\n", "      'migrations/079_paypal_payment_mode.sql',\n      'migrations/148_cash_deposit_business_reference.sql',\n", 'payments migration ownership');
  }
  if (!s.includes('tests/unit/cash-deposit-service.test.js')) {
    s = mustReplace(s, "      'tests/unit/cash-operations-service.test.js',\n", "      'tests/unit/cash-operations-service.test.js',\n      'tests/unit/cash-deposit-service.test.js',\n", 'payments test ownership');
  }
  write(path, s);
}

{
  const path = 'features/dashboard.feature.js';
  let s = read(path);
  if (!s.includes('services/finance-accounting-workspace.js')) {
    s = mustReplace(s, "      'services/relay-dashboard-queries.js',\n", "      'services/relay-dashboard-queries.js',\n      'services/finance-accounting-workspace.js',\n", 'dashboard service ownership');
  }
  if (!s.includes('routes/admin-finance-accounting-workspace.js')) {
    s = mustReplace(s, "      'routes/admin-dashboard.js',\n", "      'routes/admin-dashboard.js',\n      'routes/admin-finance-accounting-workspace.js',\n", 'dashboard route ownership');
  }
  if (!s.includes('dashboards/canonical/js/finance-accounting-workspace.js')) {
    s = mustReplace(s, "      'dashboards/canonical/js/demo-order-flow.js',\n", "      'dashboards/canonical/js/demo-order-flow.js',\n      'dashboards/canonical/js/finance-accounting-workspace.js',\n", 'dashboard ui ownership');
  }
  const tests = [
    'tests/unit/admin-finance-accounting-workspace-route.test.js',
    'tests/unit/finance-accounting-workspace.test.js',
    'tests/unit/canonical-finance-accounting-workspace-boundary.test.js',
  ];
  for (const test of tests) {
    if (!s.includes(test)) {
      s = mustReplace(s, "      'tests/unit/canonical-demo-order-flow.test.js',\n", "      'tests/unit/canonical-demo-order-flow.test.js',\n      '" + test + "',\n", `dashboard test ownership ${test}`);
    }
  }
  write(path, s);
}

console.log('LOT 4D wiring transformations applied');
