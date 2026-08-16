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
`replaceRegex(\n  'public/boutique/css/checkout-vertical-rail.css',\n  /(\\.ck-recipient-grid\\s*\\{[\\s\\S]*?grid-template-columns:\\s*)repeat\\(2,\\s*minmax\\(0,1fr\\)\\)/,\n  '$1repeat(auto-fit, minmax(min(100%, 180px), 1fr))',\n  2,\n  'recipient grid is container-adaptive'\n);`,
'recipient grid'
);

patchBuilder(
`replaceOnce(\n  'public/boutique/css/shared-list-library-remove.css',\n  \".k-library-item-row {\\n  display: grid;\\n  grid-template-columns: minmax(0, 1fr) auto;\\n  align-items: stretch;\\n  gap: 8px;\\n  min-width: 0;\\n}\\n\\n.k-library-item-row .k-library-item {\\n  min-width: 0;\\n}\",\n  \".k-library-item-row {\\n  display: flex;\\n  flex-wrap: wrap;\\n  align-items: stretch;\\n  gap: 8px;\\n  min-width: 0;\\n}\\n\\n.k-library-item-row .k-library-item {\\n  flex: 1 1 280px;\\n  min-width: 0;\\n}\",\n  'shared-list row wraps by container width'\n);`,
`replaceOnce(\n  'public/boutique/css/shared-list-library-remove.css',\n  \".k-library-item-row {\\n  display: grid;\\n  grid-template-columns: minmax(0, 1fr) auto;\\n  align-items: stretch;\\n  gap: 8px;\\n  min-width: 0;\\n}\\n\\n\",\n  \"\",\n  'shared-list row geometry owned by lists-tab stylesheet'\n);`,
'shared-list duplicate row'
);

patchBuilder(
`replaceOnce(\n  'public/boutique/css/shared-list-library-remove.css',\n  \"  align-self: center;\\n  min-height: 40px;\",\n  \"  align-self: center;\\n  flex: 0 0 auto;\\n  margin-left: auto;\\n  min-height: 40px;\",\n  'shared-list remove action flex placement'\n);`,
`// The row layout stays owned by shared-list-lists-tab.css.\n`,
'shared-list flex placement'
);

patchBuilder(
`replaceRegex(\n  'public/boutique/css/shared-list-library-remove.css',\n  /\\n@media \\(max-width: 430px\\) \\{[\\s\\S]*?\\n\\}\\s*$/,\n  '\\n',\n  1,\n  'remove 430 breakpoint'\n);`,
`replaceRegex(\n  'public/boutique/css/shared-list-library-remove.css',\n  /\\n@media \\(max-width: 430px\\) \\{[\\s\\S]*?\\n\\}\\s*$/,\n  \"\\n@media (max-width: 899px) {\\n  .k-library-item-remove {\\n    justify-self: end;\\n    min-height: 36px;\\n  }\\n}\\n\",\n  1,\n  'replace bespoke 430 breakpoint with canonical mobile breakpoint'\n);`,
'shared-list breakpoint'
);

fs.writeFileSync(path, src);
console.log('CSB builder bootstrap applied.');
