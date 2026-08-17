'use strict';
const fs = require('fs');
const files = [
  'public/boutique/js/b-catalog.js',
  'public/boutique/js/b-subcat.js',
  'public/boutique/js/render/render-product-card.js',
  'public/boutique/js/b-modal-desktop-product.js',
  'public/boutique/js/b-favs.js',
  'public/boutique/js/b-modal-buybox-shared.js',
];
const symbols = ['showToast','cartQty','updateCartBadge','isFav','toggleFav','quickAdd','quickRemove','markAllCartButtons','pruneObsoleteCart','openCartWithHighlight','addToCart','getProductCartSummary','renderCartBody'];
for (const file of files) {
  const src = fs.readFileSync(file,'utf8');
  console.log('\n---', file, '---');
  for (const s of symbols) {
    const matches = [...src.matchAll(new RegExp('\\b' + s + '\\b','g'))];
    if (matches.length) console.log(s, matches.length);
  }
}
