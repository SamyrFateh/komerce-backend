'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const controlTowerPath = path.join(root, 'services/dashboard-metrics/control-tower.js');
const smokePath = path.join(root, 'public/boutique/scripts/gate-smoke-boutique.cjs');
const modulePath = path.join(root, 'public/boutique/scripts/lib/static-server.cjs');
const testPath = path.join(root, 'public/boutique/tests/unit/gate-smoke-server.test.js');

// Close the last dynamic previous-period query through the same validated filter boundary.
let controlTower = fs.readFileSync(controlTowerPath, 'utf8');
const previousCountBefore = "    const prevR = await db.query(`SELECT COUNT(*)::int AS value FROM orders o WHERE ${prevQuery.where}`, prevQuery.params); // AUD-07: same trusted filter builder; values remain parameterized";
const previousCountAfter = "    const prevSql = composeOrderFilterSql('SELECT COUNT(*)::int AS value FROM orders o WHERE ', prevQuery);\n    const prevR = await db.query(prevSql, prevQuery.params);";
if (!controlTower.includes(previousCountBefore)) throw new Error('control-tower previous count query not found');
controlTower = controlTower.replace(previousCountBefore, previousCountAfter);
fs.writeFileSync(controlTowerPath, controlTower);

let smoke = fs.readFileSync(smokePath, 'utf8');

const importsBefore = "const { chromium } = require('@playwright/test');\nconst handler = require('serve-handler');\nconst http = require('http');\nconst path = require('path');";
const importsAfter = "const { chromium } = require('@playwright/test');\nconst path = require('path');\nconst { startStaticServer, stopStaticServer } = require('./lib/static-server.cjs');";
if (!smoke.includes(importsBefore)) throw new Error('post-patcher smoke imports not found');
smoke = smoke.replace(importsBefore, importsAfter);

const serverBlock = /function waitForServer\(url, timeoutMs\) \{[\s\S]*?function stopServer\(server\) \{[\s\S]*?\n\}\n\n(?=\/\/ ── Parcours 1)/;
if (!serverBlock.test(smoke)) throw new Error('post-patcher server block not found');
smoke = smoke.replace(serverBlock, `async function startServer(options = {}) {\n  if (process.env.GATE_SMOKE_NO_SERVER) return null; // réutilise un serveur déjà lancé (dev local)\n  return startStaticServer({\n    root: SERVE_ROOT,\n    port: options.port ?? PORT,\n    healthPath: '/boutique/',\n    timeoutMs: 15_000,\n  });\n}\n\nconst stopServer = stopStaticServer;\n\n`);

fs.writeFileSync(smokePath, smoke);

fs.writeFileSync(modulePath, `'use strict';\n\nconst http = require('http');\nconst handler = require('serve-handler');\n\nfunction waitForServer(url, timeoutMs) {\n  const deadline = Date.now() + timeoutMs;\n  return new Promise((resolve, reject) => {\n    const attempt = () => {\n      const req = http.get(url, (res) => {\n        res.resume();\n        resolve();\n      });\n      req.on('error', () => {\n        if (Date.now() > deadline) {\n          reject(new Error(\`serveur non prêt après \${timeoutMs} ms (\${url})\`));\n          return;\n        }\n        setTimeout(attempt, 100);\n      });\n    };\n    attempt();\n  });\n}\n\nasync function startStaticServer({ root, port, healthPath = '/boutique/', timeoutMs = 15_000 } = {}) {\n  if (!root || typeof root !== 'string') throw new TypeError('root statique requis');\n  const requestedPort = port == null ? 0 : Number(port);\n  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {\n    throw new TypeError('port invalide');\n  }\n  const server = http.createServer((req, res) => handler(req, res, { public: root, cleanUrls: false }));\n  await new Promise((resolve, reject) => {\n    server.once('error', reject);\n    server.listen(requestedPort, '127.0.0.1', resolve);\n  });\n  const actualPort = server.address().port;\n  try {\n    await waitForServer(\`http://127.0.0.1:\${actualPort}\${healthPath}\`, timeoutMs);\n  } catch (error) {\n    await stopStaticServer(server).catch(() => {});\n    throw error;\n  }\n  return server;\n}\n\nfunction stopStaticServer(server) {\n  if (!server) return Promise.resolve();\n  return new Promise((resolve, reject) => {\n    server.close((error) => error ? reject(error) : resolve());\n  });\n}\n\nmodule.exports = { startStaticServer, stopStaticServer };\n`);

fs.writeFileSync(testPath, `'use strict';\n\nconst http = require('http');\nconst path = require('path');\nconst { startStaticServer, stopStaticServer } = require('../../scripts/lib/static-server.cjs');\n\nfunction get(url) {\n  return new Promise((resolve, reject) => {\n    http.get(url, (res) => {\n      let body = '';\n      res.setEncoding('utf8');\n      res.on('data', (chunk) => { body += chunk; });\n      res.on('end', () => resolve({ status: res.statusCode, body }));\n    }).on('error', reject);\n  });\n}\n\ndescribe('gate-smoke in-process static server', () => {\n  test('sert la boutique sans process enfant', async () => {\n    const root = path.resolve(__dirname, '..', '..', '..');\n    const server = await startStaticServer({ root, port: 0, healthPath: '/boutique/' });\n    try {\n      const port = server.address().port;\n      const res = await get(\`http://127.0.0.1:\${port}/boutique/\`);\n      expect(res.status).toBe(200);\n      expect(res.body).toMatch(/<!doctype html|<html/i);\n    } finally {\n      await stopStaticServer(server);\n    }\n  });\n});\n`);

console.log('Playwright-free static server split + final control-tower guard applied');
