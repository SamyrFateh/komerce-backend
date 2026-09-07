'use strict';
const fs = require('fs');
const file = 'scripts/one-shot-impact-zero.js';
let src = fs.readFileSync(file, 'utf8');
const anchor = "const fs = require('fs');\n";
if (!src.includes(anchor)) throw new Error('one-shot anchor missing');
if (!src.includes("const search = '${search}';")) {
  src = src.replace(anchor, anchor + "const search = '${search}';\n");
}
// The generator contains template literals that themselves emit template literals.
// GitHub source stores those delimiters as two backslashes + backtick; collapse to
// the single escape required by the outer template literal before parsing it.
src = src.split('\\\\`').join('\\`');
fs.writeFileSync(file, src);
console.log('one-shot literals fixed');
