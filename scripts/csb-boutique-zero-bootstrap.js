'use strict';
const fs = require('fs');
const path = 'scripts/csb-boutique-zero.js';
let src = fs.readFileSync(path, 'utf8');

function patchBuilder(old, replacement, label) {
  const count = src.split(old).length - 1;
  if (count !== 1) throw new Error(`bootstrap ${label}: expected one block, got ${count}`);
  src = src.replace(old, replacement);
}

patchBuilder(
`replaceOnce(\n  'public/boutique/js/b-subcat.js',\n  \"        renderGrid();\\n        let _sc = dom.pageScroll;\",\n  \"        bus.emit('catalog:render-request');\\n        let _sc = dom.pageScroll;\",\n  'subcat requests catalog rerender through bus'\n);`,
`\n{\n  const path = 'public/boutique/js/b-subcat.js';\n  let src = read(path);\n  const count = (src.match(/renderGrid\\(\\);/g) || []).length;\n  if (count < 1) throw new Error('subcat: expected at least one catalog rerender call');\n  src = src.replace(/renderGrid\\(\\);/g, \"bus.emit('catalog:render-request');\");\n  if (/renderGrid\\s*\\(/.test(src)) throw new Error('subcat: direct renderGrid reference remains');\n  write(path, src);\n}\n`,
'subcat render'
);

patchBuilder(
`replaceOnce(\n  'public/boutique/css/checkout-vertical-rail.css',\n  \"  grid-template-columns: repeat(2, minmax(0,1fr));\",\n  \"  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));\",\n  'recipient grid is container-adaptive'\n);`,
`replaceRegex(\n  'public/boutique/css/checkout-vertical-rail.css',\n  /(\\.ck-recipient-grid\\s*\\{[\\s\\S]*?grid-template-columns:\\s*)repeat\\(2,\\s*minmax\\(0,1fr\\)\\)/,\n  '$1repeat(auto-fit, minmax(min(100%, 180px), 1fr))',\n  1,\n  'recipient grid is container-adaptive'\n);`,
'recipient grid'
);

fs.writeFileSync(path, src);
console.log('CSB builder bootstrap applied.');
