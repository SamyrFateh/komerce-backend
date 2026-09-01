'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content); }
function must(content, needle, label) {
  if (!content.includes(needle)) throw new Error(`U1 ownership anchor missing: ${label}`);
}

// I-2 — .k-modal is owned by modal-shell.css, never by Discovery rail CSS.
{
  const discoveryCssPath = 'public/boutique/css/discovery-rail.css';
  const modalShellPath = 'public/boutique/css/modal-shell.css';
  const marker = '/* ── U1 — Discovery detail inside the canonical Komerce modal ───────── */';

  let discoveryCss = read(discoveryCssPath);
  const markerIndex = discoveryCss.indexOf(marker);
  if (markerIndex < 0) throw new Error('U1 modal CSS block missing from discovery-rail.css');

  const modalBlock = discoveryCss.slice(markerIndex).trim();
  discoveryCss = discoveryCss.slice(0, markerIndex).trimEnd() + '\n';
  write(discoveryCssPath, discoveryCss);

  let modalShell = read(modalShellPath);
  if (!modalShell.includes(marker)) {
    modalShell = modalShell.trimEnd() + '\n\n' + modalBlock + '\n';
  }
  write(modalShellPath, modalShell);
}

// I-7 — --modal-scroll-y keeps exactly one producer/write path in b-modal-core.js.
{
  const file = 'public/boutique/js/b-modal-core.js';
  let src = read(file);

  const helperAnchor = `    function _normalizeModalOpenOptions(value) {\n`;
  must(src, helperAnchor, 'normalize modal options');
  const helper = `    function _lockModalBodyScroll() {\n      state._savedCatalogScrollY = getScrollY();\n      document.body.style.setProperty('--modal-scroll-y', \`-\${state._savedCatalogScrollY}px\`);\n      document.body.classList.add('modal-open');\n    }\n\n`;
  if (!src.includes('function _lockModalBodyScroll()')) {
    src = src.replace(helperAnchor, helper + helperAnchor);
  }

  const discoveryWrite = `      document.body.style.setProperty('--modal-scroll-y', \`-\${state._savedCatalogScrollY || 0}px\`);\n      document.body.classList.add('modal-open');\n`;
  must(src, discoveryWrite, 'Discovery modal scroll lock');
  src = src.replace(discoveryWrite, `      _lockModalBodyScroll();\n`);

  const productWrite = `    state._savedCatalogScrollY = getScrollY();\n    document.body.style.setProperty('--modal-scroll-y', \`-\${state._savedCatalogScrollY}px\`);\n    document.body.classList.add('modal-open');\n`;
  must(src, productWrite, 'Product modal scroll lock');
  src = src.replace(productWrite, `    _lockModalBodyScroll();\n`);

  const writeCount = (src.match(/setProperty\('--modal-scroll-y'/g) || []).length;
  if (writeCount !== 1) {
    throw new Error(`U1 expected exactly 1 --modal-scroll-y write, found ${writeCount}`);
  }

  write(file, src);
}

console.log('U1 modal ownership corrections applied.');
