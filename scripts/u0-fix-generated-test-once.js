'use strict';

const fs = require('fs');
const file = 'tests/unit/shadow-domains-boundary.test.js';
let source = fs.readFileSync(file, 'utf8');

function replaceTestBlock(titleFragment, replacement) {
  const titlePos = source.indexOf(titleFragment);
  if (titlePos < 0) throw new Error(`U0 generated test anchor missing: ${titleFragment}`);
  const start = source.lastIndexOf('  test(', titlePos);
  const next = source.indexOf('\n  test(', start + 1);
  const suiteEnd = source.lastIndexOf('\n});');
  const end = next >= 0 ? next : suiteEnd;
  if (start < 0 || end < 0) throw new Error(`U0 generated test bounds missing: ${titleFragment}`);
  source = source.slice(0, start) + replacement.trimEnd() + '\n' + source.slice(end);
}

// The finalizer intentionally writes the new business intent, but regex literals
// embedded in template strings lose escaping. Normalize the guard to equivalent
// string-based assertions so the generated test remains both parseable and real.
replaceTestBlock(
  'Boutique ne peut jamais importer directement les services backend owners',
  [
    "  test('Boutique ne peut jamais importer directement les services backend owners', () => {",
    "    const boutiqueFiles = walk(path.join(ROOT, 'public', 'boutique', 'js'), ['.js']);",
    '    const offenders = [];',
    '    for (const candidate of boutiqueFiles) {',
    "      const rel = path.relative(ROOT, candidate).split(path.sep).join('/');",
    "      const text = fs.readFileSync(candidate, 'utf8');",
    "      const importsLocalStockOwner = text.includes('/services/local-stock-service');",
    "      const importsProviderOwner = text.includes('/services/providers-service');",
    '      if (importsLocalStockOwner || importsProviderOwner) offenders.push(rel);',
    '    }',
    '    expect(offenders).toEqual([]);',
    '  });',
  ].join('\n')
);

const badTitle = `test('Vague 2 — local-stock reste GET-only et providers-services n'autorise que l'Inquiry POST canonique',`;
const goodTitle = `test("Vague 2 — local-stock reste GET-only et providers-services n'autorise que l'Inquiry POST canonique",`;
if (!source.includes(badTitle)) throw new Error('U0 generated V2 title anchor missing');
source = source.replace(badTitle, goodTitle);

replaceTestBlock(
  'Vague 2 — local-stock reste GET-only et providers-services',
  [
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
  ].join('\n')
);

// Final hygiene: never let the temporary generator introduce whitespace debt.
source = source
  .split('\n')
  .map((line) => line.replace(/[ \t]+$/u, ''))
  .join('\n');

fs.writeFileSync(file, source);
console.log('U0 generated V2 boundary guards normalized without fragile regex literals.');
