#!/usr/bin/env bash
set -euo pipefail

cat \
  .mdm9-delivery/part-00 \
  .mdm9-delivery/part-01 \
  .mdm9-delivery/part-02 \
  .mdm9-delivery/part-03-0 \
  .mdm9-delivery/part-03-1 \
  .mdm9-delivery/part-03-2 \
  .mdm9-delivery/part-03-3-0 \
  .mdm9-delivery/part-03-3-1 \
  .mdm9-delivery/part-03-3-2 \
  .mdm9-delivery/part-03-3-3 \
  .mdm9-delivery/part-04 \
  .mdm9-delivery/part-05 > /tmp/mdm9-min.b64

base64 --decode /tmp/mdm9-min.b64 > /tmp/mdm9-min.zip
unzip -t /tmp/mdm9-min.zip
rm -rf /tmp/mdm9-min
unzip -q /tmp/mdm9-min.zip -d /tmp

cp /tmp/mdm9-min/js/b-modal-product.js public/boutique/js/b-modal-product.js
cp /tmp/mdm9-min/js/boutique.js public/boutique/js/boutique.js
cp /tmp/mdm9-min/css/modal-mobile-canonical.css public/boutique/css/modal-mobile-canonical.css
cp /tmp/mdm9-min/playwright.config.js public/boutique/playwright.config.js
cp /tmp/mdm9-min/tests/e2e/modal-mdm9-gallery-layout.spec.js public/boutique/tests/e2e/modal-mdm9-gallery-layout.spec.js
cp /tmp/mdm9-min/tests/unit/b-modal-product.test.js public/boutique/tests/unit/b-modal-product.test.js
cp /tmp/mdm9-min/tests/unit/boutique-bootstrap.test.js public/boutique/tests/unit/boutique-bootstrap.test.js

mkdir -p public/boutique/tests/fixtures/images
python3 - <<'PY'
import struct, zlib
from pathlib import Path
out = Path('public/boutique/tests/fixtures/images')
def png(path, pixel):
    w = h = 1200
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w): raw.extend(pixel(x, y))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    payload = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    path.write_bytes(payload)
png(out / 'produit-plein-cadre.png', lambda x, y: (45, 122, 62))
png(out / 'produit-fond-blanc.png', lambda x, y: (200, 92, 45) if 400 <= x < 800 and 400 <= y < 800 else (255, 255, 255))
PY

node <<'NODE'
const fs = require('fs');
const path = require('path');
const manifestPath = 'features/catalog.feature.js';
let source = fs.readFileSync(manifestPath, 'utf8');
function addAfter(anchor, entry) {
  const line = `      '${entry}',`;
  if (source.includes(line)) return;
  if (!source.includes(anchor)) throw new Error(`Anchor absent: ${anchor}`);
  source = source.replace(anchor, `${anchor}\n${line}`);
}
addAfter("      'services/suppliers/normalized-product.js',", 'services/suppliers/json-source-pipeline.js');
addAfter("      'services/suppliers/connectors/noon-connector.js',", 'services/suppliers/connectors/json-connector.js');
addAfter("      'services/suppliers/catalog-import-orchestrator.js',", 'services/suppliers/catalog-import-json.js');
source = source.replace("      'css/modal-product-price-normalization.css',\n", '');
const needles = ['json-source-pipeline', 'json-connector', 'catalog-import-json'];
const tests = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(test|spec)\.js$/.test(entry.name)) {
      const body = fs.readFileSync(full, 'utf8');
      if (needles.some(n => full.includes(n) || body.includes(n))) tests.push(full.replace(/\\/g, '/'));
    }
  }
}
walk('tests');
const anchor = "      'tests/unit/catalog-approval.test.js',";
for (const test of [...new Set(tests)].sort()) {
  const line = `      '${test}',`;
  if (!source.includes(line)) source = source.replace(anchor, `${line}\n${anchor}`);
}
fs.writeFileSync(manifestPath, source);
console.log('Tests JSON déclarés:', tests.sort());
NODE

npm ci
npm run build
npx jest public/boutique/tests/unit/b-modal-product.test.js public/boutique/tests/unit/boutique-bootstrap.test.js --runInBand --forceExit
npm run feature:check
npm run feature:registry
npm run business-graph:gen
npm run business-graph:ratchet-check

rm -rf .mdm9-delivery
rm -f .github/workflows/mdm9-apply-delivery.yml .github/workflows/mdm9-apply-delivery-retry.yml
rm -f scripts/apply-mdm9-delivery.sh

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -A
git status --short
git commit -m 'fix(boutique): optimize product modal media space'
git push origin HEAD:fix/mdm9-modal-gallery-layout
