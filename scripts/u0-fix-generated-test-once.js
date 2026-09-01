'use strict';

const fs = require('fs');
const file = 'tests/unit/shadow-domains-boundary.test.js';
let source = fs.readFileSync(file, 'utf8');
const bad = `test('Vague 2 — local-stock reste GET-only et providers-services n'autorise que l'Inquiry POST canonique',`;
const good = `test("Vague 2 — local-stock reste GET-only et providers-services n'autorise que l'Inquiry POST canonique",`;
if (!source.includes(bad)) {
  throw new Error('U0 generated test title anchor missing');
}
source = source.replace(bad, good);
fs.writeFileSync(file, source);
console.log('U0 generated test title fixed.');
