'use strict';

const fs = require('fs');
const file = 'tests/unit/shadow-domains-boundary.test.js';
let source = fs.readFileSync(file, 'utf8');

const badTitle = `test('Vague 2 — local-stock reste GET-only et providers-services n'autorise que l'Inquiry POST canonique',`;
const goodTitle = `test("Vague 2 — local-stock reste GET-only et providers-services n'autorise que l'Inquiry POST canonique",`;
if (!source.includes(badTitle)) {
  throw new Error('U0 generated test title anchor missing');
}
source = source.replace(badTitle, goodTitle);

const titleFragment = '  test("Vague 2 — local-stock reste GET-only et providers-services';
const start = source.indexOf(titleFragment);
if (start < 0) throw new Error('U0 V2 test block start missing');
const nextTest = source.indexOf('\n  test(', start + titleFragment.length);
const suiteEnd = source.lastIndexOf('\n});');
const end = nextTest >= 0 ? nextTest : suiteEnd;
if (end < 0) throw new Error('U0 V2 test block end missing');

const safeBlock = [
  '  test("Vague 2 — local-stock reste GET-only et providers-services n\'autorise que l\'Inquiry POST canonique", () => {',
  "    expect(fs.existsSync(path.join(ROOT, 'routes', 'local-stock.js'))).toBe(true);",
  "    expect(fs.existsSync(path.join(ROOT, 'routes', 'providers-services.js'))).toBe(true);",
  "    expect(() => require('../../routes/local-stock.js')).not.toThrow();",
  "    expect(() => require('../../routes/providers-services.js')).not.toThrow();",
  '',
  "    const bootstrapSrc = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');",
  "    expect(bootstrapSrc).toContain(\"app.use('/api/local-stock', localStockRouter)\");",
  "    expect(bootstrapSrc).toContain(\"app.use('/api/providers-services', providersServicesRouter)\");",
  '',
  "    const localStockSrc = fs.readFileSync(path.join(ROOT, 'routes', 'local-stock.js'), 'utf8');",
  "    for (const verb of ['post', 'put', 'patch', 'delete']) {",
  "      expect(localStockSrc.includes('router.' + verb)).toBe(false);",
  '    }',
  '',
  "    const providersServicesSrc = fs.readFileSync(path.join(ROOT, 'routes', 'providers-services.js'), 'utf8');",
  "    for (const verb of ['put', 'patch', 'delete']) {",
  "      expect(providersServicesSrc.includes('router.' + verb)).toBe(false);",
  '    }',
  "    expect(providersServicesSrc.split('router.post').length - 1).toBe(1);",
  "    expect(providersServicesSrc).toContain(\"router.post('/inquiries'\");",
  '  });',
].join('\n');

source = source.slice(0, start) + safeBlock + source.slice(end);
fs.writeFileSync(file, source);
console.log('U0 generated V2 boundary test normalized without fragile regex literals.');
