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
