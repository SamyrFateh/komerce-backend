'use strict';

const fs = require('fs');

function replaceOnce(file, from, to) {
  let src = fs.readFileSync(file, 'utf8');
  if (!src.includes(from)) return false;
  src = src.replace(from, to);
  fs.writeFileSync(file, src, 'utf8');
  console.log(`fixed ${file}`);
  return true;
}

replaceOnce(
  'public/boutique/css/tokens.css',
  `  --checkout-control-soft: #f8f7f4;  /* action secondaire "Changer" */`,
  `  --checkout-control-soft: #f8f7f4;  /* action secondaire "Changer" */\n  --checkout-recent-card-bg:  #fffdfa;  /* carte produit récemment vu */\n  --checkout-recent-media-bg: #f4f0e8;  /* fond média produit récemment vu */`
);

replaceOnce(
  'public/boutique/css/checkout-vertical-rail.css',
  '    background: #fffdfa;',
  '    background: var(--checkout-recent-card-bg);'
);

replaceOnce(
  'public/boutique/css/checkout-vertical-rail.css',
  '    background: #f4f0e8;',
  '    background: var(--checkout-recent-media-bg);'
);

replaceOnce(
  'public/boutique/scripts/check-sticky-integrity.js',
  `const CSS_DIR = path.join(path.resolve(__dirname, '..'), 'css', 'dist');\nconst DIST_FILES = ['base.css', 'components.css', 'desktop.css'];`,
  `const CSS_DIR = path.join(path.resolve(__dirname, '..'), 'css');\nconst SOURCE_FILES = fs.readdirSync(CSS_DIR)\n  .filter(f => f.endsWith('.css'))\n  .sort();`
);

replaceOnce(
  'public/boutique/scripts/check-sticky-integrity.js',
  'for (const f of DIST_FILES) {',
  'for (const f of SOURCE_FILES) {'
);

replaceOnce(
  'public/boutique/scripts/check-sticky-integrity.js',
  'Sticky Integrity — sticky vs centrage vertical (css/dist/)',
  'Sticky Integrity — sticky vs centrage vertical (CSS source)'
);
