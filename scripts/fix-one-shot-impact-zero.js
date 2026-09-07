'use strict';
const fs = require('fs');
const file = 'scripts/one-shot-impact-zero.js';
let src = fs.readFileSync(file, 'utf8');
const anchor = "const fs = require('fs');\n";
if (!src.includes(anchor)) throw new Error('one-shot anchor missing');
if (!src.includes("const search = '${search}';")) {
  src = src.replace(anchor, anchor + "const search = '${search}';\n");
  fs.writeFileSync(file, src);
}
console.log('one-shot literal fixed');
