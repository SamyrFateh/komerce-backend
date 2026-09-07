'use strict';

const fs = require('fs');
const path = require('path');

function read(rel) { return fs.readFileSync(path.join(process.cwd(), rel), 'utf8'); }
function write(rel, content) { fs.writeFileSync(path.join(process.cwd(), rel), content); }
function replaceOnce(content, from, to, label) {
  const count = content.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  return content.replace(from, to);
}

write('scripts/impact-suppressions.json', '[]\n');

{
  const rel = 'services/dashboard-metrics/control-tower.js';
  let s = read(rel);
  s = replaceOnce(s,
`async function getCAEncaisse(filters = {}) {`,
`function composeOrderFilterSql(prefix, filterQuery, suffix = '') {
  if (!filterQuery || typeof filterQuery.where !== 'string' || !Array.isArray(filterQuery.params)) {
    throw new TypeError('filterQuery invalide');
  }
  const where = filterQuery.where.trim();
  const allowed = /^1=1(?: AND o\\.(?:created_at (?:>=|<=)|destination_island =|relais_id =|status::text =|payment_status::text =|market_id =) \\$\\d+)*$/;
  if (!allowed.test(where)) throw new Error('Clause filtre SQL non canonique');
  const indexes = [...where.matchAll(/\\$(\\d+)/g)].map((m) => Number(m[1]));
  const maxIndex = indexes.length ? Math.max(...indexes) : 0;
  if (maxIndex !== filterQuery.params.length) throw new Error('Paramètres filtre SQL incohérents');
  return String(prefix) + where + String(suffix);
}

async function getCAEncaisse(filters = {}) {`, 'control-tower helper');

  s = replaceOnce(s,
`  const { where, params } = buildFiltersClause(filters);
  const sql = \`\n    SELECT COALESCE(SUM(o.total_kmf), 0)::bigint AS value,\n           COUNT(*)::int AS items_total\n    FROM orders o\n    WHERE \${where}\n      AND o.payment_status = 'paid'\n      AND o.status NOT IN ('cancelled', 'refunded')\n  \`;
  const r = await db.query(sql, params);`,
`  const filterQuery = buildFiltersClause(filters);
  const sql = composeOrderFilterSql(
    \`\n    SELECT COALESCE(SUM(o.total_kmf), 0)::bigint AS value,\n           COUNT(*)::int AS items_total\n    FROM orders o\n    WHERE \`,
    filterQuery,
    \`\n      AND o.payment_status = 'paid'\n      AND o.status NOT IN ('cancelled', 'refunded')\n  \`
  );
  const r = await db.query(sql, filterQuery.params);`, 'control-tower current query');

  s = replaceOnce(s,
`    const prevQuery = buildFiltersClause(prev);
    const prevSql = \`\n      SELECT COALESCE(SUM(o.total_kmf), 0)::bigint AS value\n      FROM orders o\n      WHERE \${prevQuery.where}\n        AND o.payment_status = 'paid'\n        AND o.status NOT IN ('cancelled', 'refunded')\n    \`;
    const prevR = await db.query(prevSql, prevQuery.params);`,
`    const prevQuery = buildFiltersClause(prev);
    const prevSql = composeOrderFilterSql(
      \`\n      SELECT COALESCE(SUM(o.total_kmf), 0)::bigint AS value\n      FROM orders o\n      WHERE \`,
      prevQuery,
      \`\n        AND o.payment_status = 'paid'\n        AND o.status NOT IN ('cancelled', 'refunded')\n    \`
    );
    const prevR = await db.query(prevSql, prevQuery.params);`, 'control-tower previous query');
  write(rel, s);
}

{
  const rel = 'routes/admin-costing.js';
  let s = read(rel);
  const from = `    // Validation basique\n    const FINANCE_CONFIG_NUMERIC_COLS = ['avg_articles_per_order', 'avg_articles_per_parcel', 'avg_articles_per_shipment', 'avg_orders_per_month']; // AUD-07\n    const fields = { avg_articles_per_order, avg_articles_per_parcel, avg_articles_per_shipment, avg_orders_per_month };\n    const updates = [];\n    const params = [];\n    let i = 1;\n    for (const [key, value] of Object.entries(fields)) {\n      if (!FINANCE_CONFIG_NUMERIC_COLS.includes(key)) continue; // AUD-07: allowlist guard\n      if (value != null && Number.isFinite(Number(value)) && Number(value) > 0) {\n        updates.push(\`\${key} = $\${i++}\`);\n        params.push(Number(value));\n      }\n    }\n    if (allocation_confidence && ['low', 'medium', 'high'].includes(allocation_confidence)) {\n      updates.push(\`allocation_confidence = $\${i++}\`);\n      params.push(allocation_confidence);\n    }\n    if (allocation_notes != null) {\n      updates.push(\`allocation_notes = $\${i++}\`);\n      params.push(String(allocation_notes));\n    }\n    updates.push(\`allocation_calibrated_at = NOW()\`);\n\n    if (updates.length === 1) {\n      return res.status(400).json({ error: 'Aucun champ valide a appliquer' });\n    }\n\n    await db.query(\`UPDATE finance_config SET \${updates.join(', ')} WHERE id = (SELECT id FROM finance_config ORDER BY id LIMIT 1)\`, params); // AUD-07: updates[] contains allowlisted column names; values remain bound in params\n`;
  const to = `    // SQL de forme fixe : aucune colonne n'est construite depuis la requête.\n    const positiveNumberOrNull = (value) =>\n      value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;\n    const params = [\n      positiveNumberOrNull(avg_articles_per_order),\n      positiveNumberOrNull(avg_articles_per_parcel),\n      positiveNumberOrNull(avg_articles_per_shipment),\n      positiveNumberOrNull(avg_orders_per_month),\n      ['low', 'medium', 'high'].includes(allocation_confidence) ? allocation_confidence : null,\n      allocation_notes != null ? String(allocation_notes) : null,\n    ];\n\n    if (params.every((value) => value === null)) {\n      return res.status(400).json({ error: 'Aucun champ valide a appliquer' });\n    }\n\n    await db.query(\`\n      UPDATE finance_config\n      SET avg_articles_per_order = COALESCE($1, avg_articles_per_order),\n          avg_articles_per_parcel = COALESCE($2, avg_articles_per_parcel),\n          avg_articles_per_shipment = COALESCE($3, avg_articles_per_shipment),\n          avg_orders_per_month = COALESCE($4, avg_orders_per_month),\n          allocation_confidence = COALESCE($5, allocation_confidence),\n          allocation_notes = COALESCE($6, allocation_notes),\n          allocation_calibrated_at = NOW()\n      WHERE id = (SELECT id FROM finance_config ORDER BY id LIMIT 1)\n    \`, params);\n`;
  s = replaceOnce(s, from, to, 'admin-costing fixed update');
  write(rel, s);
}

{
  const rel = 'routes/parcels.js';
  let s = read(rel);
  s = replaceOnce(s,
`const STATUS_TO_STEP = {\n  preparation: 'preparation',\n  shipped:     'shipped',\n  in_transit:  'in_transit',\n  available:   'relais_received',\n  collected:   'collected',\n  cancelled:   'cancelled',\n};`,
`const STATUS_TO_STEP = {\n  preparation: 'preparation',\n  shipped:     'shipped',\n  in_transit:  'in_transit',\n  available:   'relais_received',\n  collected:   'collected',\n  cancelled:   'cancelled',\n};\n\nconst PARCEL_LIST_FILTER_SQL = \`\n  WHERE ($1::text IS NULL OR p.status::text = $1)\n    AND ($2::text IS NULL OR p.shipment_id::text = $2)\n    AND ($3::text IS NULL OR p.order_id::text = $3)\n    AND ($4::text IS NULL OR p.reference ILIKE $4 OR p.external_code ILIKE $4)\n    AND ($5::text IS NULL OR o.relais_id IN (\n      SELECT r.id FROM relais r\n      WHERE r.phone = (SELECT u.phone FROM users u WHERE u.id::text = $5)\n    ))\n\`;\n\nconst PARCEL_LIST_COUNT_SQL =\n  'SELECT COUNT(*) FROM parcels p LEFT JOIN orders o ON o.id = p.order_id' + PARCEL_LIST_FILTER_SQL;\n\nconst PARCEL_LIST_SQL = \`\n  SELECT p.*, p.external_code,\n         o.reference AS order_reference, o.status AS order_status,\n         o.destination_island, o.routing_mode,\n         (SELECT COUNT(*) FROM parcel_items pi WHERE pi.parcel_id = p.id) AS items_count\n  FROM parcels p\n  LEFT JOIN orders o ON o.id = p.order_id\n\` + PARCEL_LIST_FILTER_SQL + \`\n  ORDER BY p.created_at DESC\n  LIMIT $6 OFFSET $7\n\`;`, 'parcels static SQL constants');

  const from = `    const conditions = [];\n    const params = [];\n    let idx = 1;\n\n    if (status) { conditions.push(\`p.status = $\${idx++}\`); params.push(status); }\n    if (shipment_id) { conditions.push(\`p.shipment_id = $\${idx++}\`); params.push(shipment_id); }\n    if (order_id) { conditions.push(\`p.order_id = $\${idx++}\`); params.push(order_id); }\n    if (search) { conditions.push(\`(p.reference ILIKE $\${idx} OR p.external_code ILIKE $\${idx})\`); params.push(\`%\${search}%\`); idx++; }\n\n    // Agent relais: only see parcels for their relay point's orders\n    if (req.user.role === 'agent_relais') {\n      conditions.push(\`o.relais_id IN (SELECT r.id FROM relais r WHERE r.phone = (SELECT u.phone FROM users u WHERE u.id = $\${idx++}))\`);\n      params.push(req.user.id);\n    }\n\n    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';\n\n    const countResult = await db.query(\`SELECT COUNT(*) FROM parcels p LEFT JOIN orders o ON o.id = p.order_id \${where}\`, params); // AUD-07: where = parameterized condition templates; values remain bound in params\n    const total = parseInt(countResult.rows[0].count);\n\n    const { rows } = await db.query(\`\n      SELECT p.*, p.external_code,\n             o.reference AS order_reference, o.status AS order_status,\n             o.destination_island, o.routing_mode,\n             (SELECT COUNT(*) FROM parcel_items pi WHERE pi.parcel_id = p.id) AS items_count\n      FROM parcels p\n      LEFT JOIN orders o ON o.id = p.order_id\n      \${where} /* AUD-07: parameterized condition templates */\n      ORDER BY p.created_at DESC\n      LIMIT $\${idx++} OFFSET $\${idx++}\n    \`, [...params, safeLimit, offset]);`;
  const to = `    const filterParams = [\n      status || null,\n      shipment_id || null,\n      order_id || null,\n      search ? \`%\${search}%\` : null,\n      req.user.role === 'agent_relais' ? String(req.user.id) : null,\n    ];\n\n    const countResult = await db.query(PARCEL_LIST_COUNT_SQL, filterParams);\n    const total = parseInt(countResult.rows[0].count);\n\n    const { rows } = await db.query(PARCEL_LIST_SQL, [...filterParams, safeLimit, offset]);`;
  s = replaceOnce(s, from, to, 'parcels fixed list query');
  write(rel, s);
}

{
  const rel = 'public/boutique/scripts/gate-smoke-boutique.cjs';
  let s = read(rel);
  s = replaceOnce(s,
`const { chromium } = require('@playwright/test');\nconst { spawn } = require('child_process');\nconst http = require('http');`,
`const { chromium } = require('@playwright/test');\nconst handler = require('serve-handler');\nconst http = require('http');`, 'smoke imports');
  s = replaceOnce(s,
`function resolveServeScript() {\n  const pkgPath = require.resolve('serve/package.json');\n  const pkg = require(pkgPath);\n  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.serve;\n  return path.join(path.dirname(pkgPath), binRel);\n}\n\nasync function startServer() {\n  if (process.env.GATE_SMOKE_NO_SERVER) return null; // réutilise un serveur déjà lancé (dev local)\n  // On lance \`node <serve/build/main.js> ...\` directement (process.execPath),\n  // au lieu de \`npx serve\`. npx passe par un .cmd sous Windows, ce qui force\n  // shell:true — et spawn(shell:true) plante par intermittence avec EINVAL\n  // sur certaines installations Windows/Node (bug connu côté Node, pas côté\n  // ce script). En invoquant le binaire node directement, on n'a plus besoin\n  // de shell du tout, sur aucun OS.\n  const serveScript = resolveServeScript();\n  const child = spawn(process.execPath, [serveScript, SERVE_ROOT, '-l', String(PORT), '--no-clipboard'], {\n    stdio: ['ignore', 'pipe', 'pipe'],\n  });\n  child.stdout.on('data', () => {});\n  child.stderr.on('data', () => {});\n  await waitForServer(BASE_URL, 15_000);\n  return child;\n}\n\nfunction stopServer(child) {\n  if (!child) return;\n  child.kill();\n}`,
`async function startServer(options = {}) {\n  if (process.env.GATE_SMOKE_NO_SERVER) return null; // réutilise un serveur déjà lancé (dev local)\n  const requestedPort = options.port ?? PORT;\n  const server = http.createServer((req, res) => handler(req, res, { public: SERVE_ROOT, cleanUrls: false }));\n  await new Promise((resolve, reject) => {\n    server.once('error', reject);\n    server.listen(requestedPort, '127.0.0.1', resolve);\n  });\n  const actualPort = server.address().port;\n  await waitForServer(\`http://127.0.0.1:\${actualPort}/boutique/\`, 15_000);\n  return server;\n}\n\nfunction stopServer(server) {\n  if (!server) return Promise.resolve();\n  return new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));\n}`,
'smoke in-process server');
  s = replaceOnce(s, `    stopServer(serverProcess);`, `    await stopServer(serverProcess);`, 'smoke await stop');
  s = replaceOnce(s,
`module.exports = { main, runParcours1, runParcours2, BASE_URL, ARTIFACTS_DIR };`,
`module.exports = { main, runParcours1, runParcours2, startServer, stopServer, BASE_URL, ARTIFACTS_DIR };`, 'smoke exports');
  write(rel, s);
}

{
  const rel = 'tests/unit/admin-costing.test.js';
  let s = read(rel);
  s = replaceOnce(s,
`    expect(res.status).toBe(200);\n    const updateSql = mockQuery.mock.calls[0][0];\n    expect(updateSql).not.toMatch(/drop_table_or_whatever/);\n    expect(updateSql).not.toMatch(/malicious_col/);\n    expect(updateSql).toMatch(/avg_articles_per_order/);`,
`    expect(res.status).toBe(200);\n    const [updateSql, updateParams] = mockQuery.mock.calls[0];\n    expect(updateSql).not.toMatch(/drop_table_or_whatever/);\n    expect(updateSql).not.toMatch(/malicious_col/);\n    expect(updateSql).toMatch(/avg_articles_per_order/);\n    expect(updateParams).toEqual([3.5, null, null, null, null, null]);`, 'admin costing allowlist test');
  s = replaceOnce(s,
`    expect(res.status).toBe(200);\n    const updateSql = mockQuery.mock.calls[0][0];\n    expect(updateSql).not.toMatch(/allocation_confidence/);`,
`    expect(res.status).toBe(200);\n    const [updateSql, updateParams] = mockQuery.mock.calls[0];\n    expect(updateSql).toMatch(/allocation_confidence/);\n    expect(updateParams[4]).toBeNull();`, 'admin costing confidence test');
  s = replaceOnce(s,
`    expect(res.status).toBe(200);\n    expect(res.body.applied).toEqual({ allocation_confidence: 'high' });\n    expect(mockInvalidateAllDashboards).toHaveBeenCalledTimes(1);`,
`    expect(res.status).toBe(200);\n    expect(res.body.applied).toEqual({ allocation_confidence: 'high' });\n    expect(mockQuery.mock.calls[0][1]).toEqual([3.5, null, null, null, 'high', null]);\n    expect(mockInvalidateAllDashboards).toHaveBeenCalledTimes(1);`, 'admin costing success params test');
  write(rel, s);
}

{
  const rel = 'tests/unit/parcels-route.test.js';
  let s = read(rel);
  s = replaceOnce(s,
`    test('agent_relais est restreint à son point relais', async () => {`,
`    test('les filtres de liste restent entièrement paramétrés', async () => {\n      mockDbQuery\n        .mockResolvedValueOnce({ rows: [{ count: '1' }] })\n        .mockResolvedValueOnce({ rows: [{ id: 'p1' }] });\n\n      const res = await request(buildApp()).get('/api/parcels').query({\n        status: 'shipped',\n        shipment_id: VALID_UUID_1,\n        order_id: VALID_UUID_2,\n        search: 'COL-42',\n      });\n\n      expect(res.status).toBe(200);\n      const [countSql, countParams] = mockDbQuery.mock.calls[0];\n      expect(countSql).not.toContain('COL-42');\n      expect(countParams).toEqual(['shipped', VALID_UUID_1, VALID_UUID_2, '%COL-42%', null]);\n      expect(mockDbQuery.mock.calls[1][1]).toEqual(['shipped', VALID_UUID_1, VALID_UUID_2, '%COL-42%', null, 50, 0]);\n    });\n\n    test('agent_relais est restreint à son point relais', async () => {`, 'parcels param test insert');
  s = replaceOnce(s,
`      const countSql = mockDbQuery.mock.calls[0][0];\n      expect(countSql).toMatch(/relais r WHERE r.phone/);`,
`      const [countSql, countParams] = mockDbQuery.mock.calls[0];\n      expect(countSql).toMatch(/relais r/);\n      expect(countParams[4]).toBe('agent-1');`, 'parcels relay test');
  write(rel, s);
}

{
  const rel = 'public/boutique/tests/unit/gate-smoke-server.test.js';
  const content = `'use strict';\n\nconst http = require('http');\nconst { startServer, stopServer } = require('../../scripts/gate-smoke-boutique.cjs');\n\nfunction get(url) {\n  return new Promise((resolve, reject) => {\n    http.get(url, (res) => {\n      let body = '';\n      res.setEncoding('utf8');\n      res.on('data', (chunk) => { body += chunk; });\n      res.on('end', () => resolve({ status: res.statusCode, body }));\n    }).on('error', reject);\n  });\n}\n\ndescribe('gate-smoke in-process static server', () => {\n  test('sert la boutique sans child_process', async () => {\n    const server = await startServer({ port: 0 });\n    try {\n      const port = server.address().port;\n      const res = await get(\`http://127.0.0.1:\${port}/boutique/\`);\n      expect(res.status).toBe(200);\n      expect(res.body).toMatch(/<!doctype html|<html/i);\n    } finally {\n      await stopServer(server);\n    }\n  });\n});\n`;
  write(rel, content);
}

console.log('impact zero patch applied');
