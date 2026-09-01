'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content); }
function must(content, needle, label) {
  if (!content.includes(needle)) throw new Error(`U1 command-owner anchor missing: ${label}`);
}
function replaceOnce(content, from, to, label) {
  must(content, from, label);
  return content.replace(from, to);
}
function insertAfter(content, anchor, block, label) {
  must(content, anchor, label);
  if (content.includes(block.trim())) return content;
  return content.replace(anchor, anchor + block);
}

// One canonical producer for the cross-slice Discovery command.
{
  const file = 'public/boutique/js/discovery-actions.js';
  write(file, `/**\n * @komerce-arch-lite\n * @role          catalog-discovery-actions\n * @domain        catalog\n * @layer         ui-controller\n * @owner         public/boutique/js/discovery-actions.js\n * @purpose       Posséder l'unique émission de la commande discovery:request, quel que soit le point d'entrée Boutique.\n * @impact-areas  product-discovery, discovery-rail, modal-layout\n * @version       2026-09\n */\n'use strict';\n\nimport { bus } from './b-bus.js';\n\nexport function requestDiscovery(kind, ref, source) {\n  if ((kind !== 'service' && kind !== 'physical_offer') || !ref) return false;\n  bus.emit('discovery:request', { kind, ref: String(ref), source });\n  return true;\n}\n`);
}

// Rail delegates command emission to the single owner.
{
  const file = 'public/boutique/js/discovery-rail.js';
  let src = read(file);
  src = replaceOnce(
    src,
    `import { bus } from './b-bus.js';\n`,
    `import { requestDiscovery } from './discovery-actions.js';\n`,
    'rail bus import'
  );
  src = replaceOnce(
    src,
    `    bus.emit('discovery:request', { kind, ref, source: button });\n`,
    `    requestDiscovery(kind, ref, button);\n`,
    'rail discovery request emission'
  );
  write(file, src);
}

// Modal renderer also delegates the same command; it remains only a listener on modal lifecycle bus events.
{
  const file = 'public/boutique/js/b-modal-discovery-detail.js';
  let src = read(file);
  src = insertAfter(
    src,
    `import { bus } from './b-bus.js';\n`,
    `import { requestDiscovery } from './discovery-actions.js';\n`,
    'modal discovery action import'
  );
  src = replaceOnce(
    src,
    `  bus.emit('discovery:request', { kind, ref, source: button });\n`,
    `  requestDiscovery(kind, ref, button);\n`,
    'modal discovery request emission'
  );
  write(file, src);
}

// Bus registry now names the real single producer.
{
  const file = 'public/boutique/js/b-bus.js';
  let src = read(file);
  src = replaceOnce(
    src,
    ` *   discovery:request           owner=catalog producer=discovery-rail.js payload=value\n`,
    ` *   discovery:request           owner=catalog producer=discovery-actions.js payload=value\n`,
    'discovery request producer contract'
  );
  write(file, src);
}

// Catalog manifest owns the new command module and its proof.
{
  const file = 'public/boutique/features/catalog.feature.js';
  let src = read(file);
  src = insertAfter(
    src,
    `      '../js/discovery-rail.js',\n`,
    `      '../js/discovery-actions.js',\n`,
    'catalog discovery actions ownership'
  );
  src = insertAfter(
    src,
    `      '../tests/unit/discovery-modal-detail.test.js',\n`,
    `      '../tests/unit/discovery-actions.test.js',\n`,
    'catalog discovery actions test ownership'
  );
  src = insertAfter(
    src,
    `      'b-modal-discovery-detail.js / setupDiscoveryModalDetail / renderDiscoveryModalDetail',\n`,
    `      'discovery-actions.js / requestDiscovery — producteur unique discovery:request',\n`,
    'catalog internal discovery action api'
  );
  write(file, src);
}

// Modal renderer test asserts delegation, not a second bus producer.
{
  const file = 'public/boutique/tests/unit/discovery-modal-detail.test.js';
  let src = read(file);
  src = insertAfter(
    src,
    `const mockCloseModal = jest.fn();\n`,
    `const mockRequestDiscovery = jest.fn();\n`,
    'modal test action mock declaration'
  );
  src = insertAfter(
    src,
    `jest.mock('../../js/b-modal.js', () => ({ closeModal: mockCloseModal }));\n`,
    `jest.mock('../../js/discovery-actions.js', () => ({ requestDiscovery: mockRequestDiscovery }));\n`,
    'modal test action mock'
  );
  src = insertAfter(
    src,
    `  mockCloseModal.mockClear();\n`,
    `  mockRequestDiscovery.mockClear();\n`,
    'modal test action reset'
  );
  src = replaceOnce(
    src,
    `  expect(mockEmit).toHaveBeenCalledWith('discovery:request', expect.objectContaining({\n    kind: 'service',\n    ref: 'svc-1',\n  }));\n`,
    `  expect(mockRequestDiscovery).toHaveBeenCalledWith(\n    'service',\n    'svc-1',\n    expect.any(HTMLElement),\n  );\n  expect(mockEmit).not.toHaveBeenCalledWith('discovery:request', expect.anything());\n`,
    'modal test no second bus producer'
  );
  write(file, src);
}

// Direct proof of the single command producer.
{
  const file = 'public/boutique/tests/unit/discovery-actions.test.js';
  write(file, `'use strict';\n\n/**\n * @test-kind unit\n * @test-runner jest\n * @test-requires none\n */\n\nconst mockEmit = jest.fn();\n\njest.mock('../../js/b-bus.js', () => ({\n  bus: { emit: mockEmit },\n}));\n\nconst { requestDiscovery } = require('../../js/discovery-actions.js');\n\nbeforeEach(() => mockEmit.mockClear());\n\ntest('émet la commande canonique pour service', () => {\n  const source = document.createElement('button');\n  expect(requestDiscovery('service', 'svc-1', source)).toBe(true);\n  expect(mockEmit).toHaveBeenCalledTimes(1);\n  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {\n    kind: 'service', ref: 'svc-1', source,\n  });\n});\n\ntest('émet la même commande canonique pour physical_offer', () => {\n  expect(requestDiscovery('physical_offer', 'offer-1', null)).toBe(true);\n  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {\n    kind: 'physical_offer', ref: 'offer-1', source: null,\n  });\n});\n\ntest('refuse un kind hors frontière Discovery actionnable', () => {\n  expect(requestDiscovery('product', 'p-1', null)).toBe(false);\n  expect(mockEmit).not.toHaveBeenCalled();\n});\n`);
}

console.log('U1 Discovery command producer centralized.');
