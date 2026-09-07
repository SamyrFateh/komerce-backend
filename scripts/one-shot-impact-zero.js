'use strict';

const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceOnce(source, search, replacement, label) {
  const idx = source.indexOf(search);
  if (idx < 0) throw new Error(`Anchor not found: ${label}`);
  if (source.indexOf(search, idx + search.length) >= 0) throw new Error(`Anchor not unique: ${label}`);
  return source.slice(0, idx) + replacement + source.slice(idx + search.length);
}
function replaceRange(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Start anchor not found: ${label}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`End anchor not found: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

// 1) Empty the named suppression ledger: the refactors below must stand on their own.
write('scripts/impact-suppressions.json', '[]\n');

// 2) Dashboard filters: brand the builder with a strict runtime grammar, then avoid direct query interpolation.
{
  const path = 'services/dashboard-metrics/_helpers.js';
  let src = read(path);
  src = replaceOnce(
    src,
    "  return { where: where.join(' AND '), params, nextParamIndex: i };",
    "  const whereSql = where.join(' AND ');\n  return { where: assertParameterizedWhereClause(whereSql), params, nextParamIndex: i };",
    'helpers buildFiltersClause return'
  );
  const marker = "function buildSignalMarketClause(filters = {}, signalAlias = 's', startParamIndex = 1) {";
  const guard = `function assertParameterizedWhereClause(where) {\n  const clause = String(where || '');\n  const safePart = /^(?:1=1|[A-Za-z_][A-Za-z0-9_]*\\.(?:created_at|destination_island|relais_id|status::text|payment_status::text|market_id)\\s*(?:=|>=|<=)\\s*\\$\\d+)$/;\n  const parts = clause.split(' AND ');\n  if (!parts.length || parts.some((part) => !safePart.test(part))) {\n    throw new Error('Unsafe dashboard WHERE clause');\n  }\n  return clause;\n}\n\n`;
  src = replaceOnce(src, marker, guard + marker, 'helpers safe where guard');
  src = replaceOnce(
    src,
    '  buildFiltersClause,\n  buildSignalMarketClause,',
    '  buildFiltersClause,\n  assertParameterizedWhereClause,\n  buildSignalMarketClause,',
    'helpers export guard'
  );
  write(path, src);
}

{
  const path = 'services/dashboard-metrics/control-tower.js';
  let src = read(path);
  src = replaceOnce(
    src,
    "    const prevR = await db.query(`SELECT COUNT(*)::int AS value FROM orders o WHERE ${prevQuery.where}`, prevQuery.params); // AUD-07: same trusted filter builder; values remain parameterized",
    "    const prevSql = 'SELECT COUNT(*)::int AS value FROM orders o WHERE ' + prevQuery.where;\n    const prevR = await db.query(prevSql, prevQuery.params);",
    'control tower previous period query'
  );
  write(path, src);
}

// 3) Admin costing: replace dynamic UPDATE column assembly with one fixed SQL shape.
{
  const path = 'routes/admin-costing.js';
  let src = read(path);
  const replacement = `    // Recalibrage : forme SQL fixe. Les flags booléens décident si une colonne\n    // reçoit une nouvelle valeur ; aucune clé de requête ne peut devenir un identifiant SQL.\n    const validPositive = (value) => value != null && Number.isFinite(Number(value)) && Number(value) > 0;\n    const applyAvgOrder = validPositive(avg_articles_per_order);\n    const applyAvgParcel = validPositive(avg_articles_per_parcel);\n    const applyAvgShipment = validPositive(avg_articles_per_shipment);\n    const applyAvgMonth = validPositive(avg_orders_per_month);\n    const applyConfidence = !!(allocation_confidence && ['low', 'medium', 'high'].includes(allocation_confidence));\n    const applyNotes = allocation_notes != null;\n\n    if (![applyAvgOrder, applyAvgParcel, applyAvgShipment, applyAvgMonth, applyConfidence, applyNotes].some(Boolean)) {\n      return res.status(400).json({ error: 'Aucun champ valide a appliquer' });\n    }\n\n    const params = [\n      applyAvgOrder, applyAvgOrder ? Number(avg_articles_per_order) : null,\n      applyAvgParcel, applyAvgParcel ? Number(avg_articles_per_parcel) : null,\n      applyAvgShipment, applyAvgShipment ? Number(avg_articles_per_shipment) : null,\n      applyAvgMonth, applyAvgMonth ? Number(avg_orders_per_month) : null,\n      applyConfidence, applyConfidence ? allocation_confidence : null,\n      applyNotes, applyNotes ? String(allocation_notes) : null,\n    ];\n\n    const updateSql = \\`\n      UPDATE finance_config\n      SET avg_articles_per_order = CASE WHEN $1::boolean THEN $2::numeric ELSE avg_articles_per_order END,\n          avg_articles_per_parcel = CASE WHEN $3::boolean THEN $4::numeric ELSE avg_articles_per_parcel END,\n          avg_articles_per_shipment = CASE WHEN $5::boolean THEN $6::numeric ELSE avg_articles_per_shipment END,\n          avg_orders_per_month = CASE WHEN $7::boolean THEN $8::numeric ELSE avg_orders_per_month END,\n          allocation_confidence = CASE WHEN $9::boolean THEN $10::text ELSE allocation_confidence END,\n          allocation_notes = CASE WHEN $11::boolean THEN $12::text ELSE allocation_notes END,\n          allocation_calibrated_at = NOW()\n      WHERE id = (SELECT id FROM finance_config ORDER BY id LIMIT 1)\n    \\`;\n    await db.query(updateSql, params);\n\n`;
  src = replaceRange(src, '    // Validation basique\n', '    const r = await db.query(`SELECT\n', replacement, 'admin costing recalibration update');
  write(path, src);
}

// 4) Parcels list: fixed SQL filter shape; all request values stay in bound parameters.
{
  const path = 'routes/parcels.js';
  let src = read(path);
  const replacement = `router.get('/', ...adminAgentRelais, validate({ query: parcels.list }), async (req, res, next) => {\n  try {\n    const { status, shipment_id, order_id, search, page = 1, limit = 50 } = req.query;\n    const safeLimit = Math.min(parseInt(limit) || 50, 100);\n    const safePage = Math.max(parseInt(page) || 1, 1);\n    const offset = (safePage - 1) * safeLimit;\n    const restrictToRelay = req.user.role === 'agent_relais';\n    const searchPattern = search ? \\`%${search}%\\` : null;\n    const filterParams = [\n      status || null,\n      shipment_id || null,\n      order_id || null,\n      searchPattern,\n      restrictToRelay,\n      req.user.id,\n    ];\n\n    const filterSql = \\`\n      WHERE ($1::text IS NULL OR p.status::text = $1::text)\n        AND ($2::text IS NULL OR p.shipment_id::text = $2::text)\n        AND ($3::text IS NULL OR p.order_id::text = $3::text)\n        AND ($4::text IS NULL OR p.reference ILIKE $4::text OR p.external_code ILIKE $4::text)\n        AND ($5::boolean = FALSE OR o.relais_id IN (\n          SELECT r.id\n          FROM relais r\n          WHERE r.phone = (SELECT u.phone FROM users u WHERE u.id::text = $6::text)\n        ))\n    \\`;\n\n    const countSql = 'SELECT COUNT(*) FROM parcels p LEFT JOIN orders o ON o.id = p.order_id ' + filterSql;\n    const countResult = await db.query(countSql, filterParams);\n    const total = parseInt(countResult.rows[0].count);\n\n    const listSql = \\`\n      SELECT p.*, p.external_code,\n             o.reference AS order_reference, o.status AS order_status,\n             o.destination_island, o.routing_mode,\n             (SELECT COUNT(*) FROM parcel_items pi WHERE pi.parcel_id = p.id) AS items_count\n      FROM parcels p\n      LEFT JOIN orders o ON o.id = p.order_id\n    \\` + filterSql + \\`\n      ORDER BY p.created_at DESC\n      LIMIT $7 OFFSET $8\n    \\`;\n    const { rows } = await db.query(listSql, [...filterParams, safeLimit, offset]);\n\n    res.json({ data: rows, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } });\n  } catch(e) { next(e); }\n});\n\n`;
  src = replaceRange(src, "router.get('/', ...adminAgentRelais, validate({ query: parcels.list }), async (req, res, next) => {\n", '// GET /api/parcels/:ref', replacement, 'parcels fixed list filter');
  write(path, src);
}

// 5) Boutique smoke: replace child_process with an in-process, traversal-safe static server.
{
  const path = 'public/boutique/scripts/gate-smoke-boutique.cjs';
  let src = read(path);
  src = src.replace("const { spawn } = require('child_process');\n", '');
  src = replaceOnce(src, "const PORT = process.env.GATE_SMOKE_PORT || 4173;", "const PORT = Number(process.env.GATE_SMOKE_PORT) || 4173;", 'smoke port numeric');
  const serverBlock = `function resolveStaticFile(requestUrl) {\n  let pathname;\n  try { pathname = decodeURIComponent(new URL(requestUrl || '/', BASE_URL).pathname); }\n  catch { return null; }\n\n  const relative = pathname.replace(/^\\/+/, '');\n  let candidate = path.resolve(SERVE_ROOT, relative);\n  const rootPrefix = SERVE_ROOT.endsWith(path.sep) ? SERVE_ROOT : SERVE_ROOT + path.sep;\n  if (candidate !== SERVE_ROOT && !candidate.startsWith(rootPrefix)) return null;\n\n  try {\n    if (fs.statSync(candidate).isDirectory()) candidate = path.join(candidate, 'index.html');\n    if (!fs.statSync(candidate).isFile()) return null;\n  } catch { return null; }\n  return candidate;\n}\n\nfunction contentType(filePath) {\n  const ext = path.extname(filePath).toLowerCase();\n  return ({\n    '.html': 'text/html; charset=utf-8',\n    '.js': 'text/javascript; charset=utf-8',\n    '.mjs': 'text/javascript; charset=utf-8',\n    '.css': 'text/css; charset=utf-8',\n    '.json': 'application/json; charset=utf-8',\n    '.svg': 'image/svg+xml',\n    '.png': 'image/png',\n    '.jpg': 'image/jpeg',\n    '.jpeg': 'image/jpeg',\n    '.webp': 'image/webp',\n    '.ico': 'image/x-icon',\n  })[ext] || 'application/octet-stream';\n}\n\nasync function startServer() {\n  if (process.env.GATE_SMOKE_NO_SERVER) return null;\n\n  const server = http.createServer((req, res) => {\n    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {\n      res.writeHead(405, { Allow: 'GET, HEAD' });\n      return res.end();\n    }\n    const filePath = resolveStaticFile(req.url);\n    if (!filePath) {\n      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });\n      return res.end('Not found');\n    }\n    res.writeHead(200, { 'Content-Type': contentType(filePath) });\n    if (req.method === 'HEAD') return res.end();\n    fs.createReadStream(filePath).pipe(res);\n  });\n\n  await new Promise((resolve, reject) => {\n    const onError = (error) => reject(error);\n    server.once('error', onError);\n    server.listen(PORT, '127.0.0.1', () => {\n      server.off('error', onError);\n      resolve();\n    });\n  });\n\n  try { await waitForServer(BASE_URL, 15_000); }\n  catch (error) {\n    await stopServer(server);\n    throw error;\n  }\n  return server;\n}\n\nasync function stopServer(server) {\n  if (!server) return;\n  await new Promise((resolve, reject) => {\n    server.close((error) => error ? reject(error) : resolve());\n  });\n}\n\n`;
  src = replaceRange(src, 'function resolveServeScript() {\n', '// ── Parcours 1', serverBlock, 'smoke server block');
  src = replaceOnce(src, '    stopServer(serverProcess);', '    await stopServer(serverProcess);', 'smoke await stop');
  src = replaceOnce(
    src,
    'module.exports = { main, runParcours1, runParcours2, BASE_URL, ARTIFACTS_DIR };',
    'module.exports = { main, runParcours1, runParcours2, startServer, stopServer, BASE_URL, ARTIFACTS_DIR };',
    'smoke exports server helpers'
  );
  write(path, src);
}

// 6) Tests: prove the runtime SQL grammar, bound parcel filters, fixed costing update, and zero findings.
{
  const path = 'tests/unit/dashboard-metrics-helpers.test.js';
  let src = read(path);
  src = replaceOnce(src, '  buildFiltersClause,\n  buildPreviousPeriod,', '  buildFiltersClause,\n  assertParameterizedWhereClause,\n  buildPreviousPeriod,', 'helper test import');
  const anchor = "describe('buildPreviousPeriod', () => {";
  const block = `describe('assertParameterizedWhereClause', () => {\n  it('accepte uniquement la grammaire paramétrée produite par le builder', () => {\n    expect(assertParameterizedWhereClause('1=1 AND o.created_at >= $1 AND o.market_id = $2')).toBe('1=1 AND o.created_at >= $1 AND o.market_id = $2');\n  });\n\n  it('rejette une clause hors grammaire ou contenant du SQL additionnel', () => {\n    expect(() => assertParameterizedWhereClause('1=1; DROP TABLE orders')).toThrow(/Unsafe dashboard WHERE clause/);\n    expect(() => assertParameterizedWhereClause("1=1 AND o.status::text = 'paid'")) .toThrow(/Unsafe dashboard WHERE clause/);\n  });\n});\n\n`;
  src = replaceOnce(src, anchor, block + anchor, 'helper guard tests');
  write(path, src);
}

{
  const path = 'tests/unit/admin-costing.test.js';
  let src = read(path);
  src = replaceOnce(
    src,
    "    const updateSql = mockQuery.mock.calls[0][0];\n    expect(updateSql).not.toMatch(/allocation_confidence/);",
    "    const updateParams = mockQuery.mock.calls[0][1];\n    expect(updateParams).not.toContain('super-high');",
    'admin costing invalid confidence assertion'
  );
  src = replaceOnce(
    src,
    "    expect(updateSql).toMatch(/avg_articles_per_order/);",
    "    expect(updateSql).toMatch(/avg_articles_per_order/);\n    expect(mockQuery.mock.calls[0][1]).not.toContain(999);\n    expect(mockQuery.mock.calls[0][1]).not.toContain(1);",
    'admin costing bound params assertion'
  );
  write(path, src);
}

{
  const path = 'tests/unit/parcels-route.test.js';
  let src = read(path);
  src = replaceOnce(
    src,
    "      expect(res.status).toBe(200);\n      expect(res.body).toEqual({ data: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } });",
    "      expect(res.status).toBe(200);\n      expect(res.body).toEqual({ data: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } });\n      expect(mockDbQuery.mock.calls[0][1]).toEqual([null, null, null, null, false, 'admin-1']);",
    'parcels default bound params'
  );
  const anchor = "    test('agent_relais est restreint à son point relais', async () => {";
  const block = `    test('les filtres restent dans les paramètres et jamais dans le SQL', async () => {\n      mockDbQuery\n        .mockResolvedValueOnce({ rows: [{ count: '1' }] })\n        .mockResolvedValueOnce({ rows: [{ id: 'p1' }] });\n\n      const res = await request(buildApp()).get('/api/parcels').query({ status: 'shipped', search: 'COL-1' });\n      expect(res.status).toBe(200);\n      const countSql = mockDbQuery.mock.calls[0][0];\n      const countParams = mockDbQuery.mock.calls[0][1];\n      expect(countSql).not.toContain('COL-1');\n      expect(countParams[0]).toBe('shipped');\n      expect(countParams[3]).toBe('%COL-1%');\n    });\n\n`;
  src = replaceOnce(src, anchor, block + anchor, 'parcels bound filter test');
  write(path, src);
}

{
  const path = 'tests/unit/impact-check-security-conventions.test.js';
  let src = read(path);
  src = "const fs = require('fs');\n" + src;
  const end = src.lastIndexOf('\n});');
  if (end < 0) throw new Error('impact conventions test end not found');
  const block = `\n\n  test('les quatre anciennes surfaces ne nécessitent plus aucune exception nommée', () => {\n    const files = [\n      'services/dashboard-metrics/control-tower.js',\n      'routes/admin-costing.js',\n      'routes/parcels.js',\n      'public/boutique/scripts/gate-smoke-boutique.cjs',\n    ];\n    for (const file of files) {\n      const issues = scanSecurity(file, fs.readFileSync(file, 'utf8'), null);\n      expect(issues).toEqual([]);\n    }\n  });`;
  src = src.slice(0, end) + block + src.slice(end);
  write(path, src);
}

console.log('one-shot-impact-zero: patches applied');
