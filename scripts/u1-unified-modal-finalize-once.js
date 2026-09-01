'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content); }
function must(content, needle, label) {
  if (!content.includes(needle)) throw new Error(`U1 anchor missing: ${label}`);
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

// -----------------------------------------------------------------------------
// 1) State — one modal session, explicit kind/ref/detail.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/js/b-store.js';
  let src = read(file);
  const from = `  modalOpen: false,\n  modalProduct: null,\n`;
  const to = `  modalOpen: false,\n  /** Surface de détail active dans l'unique shell #k-modal. */\n  modalKind: 'product', // product | physical_offer | service\n  modalRef: null,\n  /** Projection de lecture pour Physical Offer / Service ; jamais un faux Product. */\n  modalDetail: null,\n  modalProduct: null,\n`;
  src = replaceOnce(src, from, to, 'b-store modal state');
  write(file, src);
}

// -----------------------------------------------------------------------------
// 2) Modal core — keep Product path intact, add a non-product shell lifecycle.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/js/b-modal-core.js';
  let src = read(file);

  src = replaceOnce(
    src,
    `bus.on('modal:open', function({ id, pushHistory }) { openModal(String(id), pushHistory); });`,
    `bus.on('modal:open', function({ id, pushHistory, kind, detail }) {\n  openModal(String(id), { pushHistory, kind, detail });\n});`,
    'modal:open bus bridge'
  );

  const openAnchor = `    function openModal(id, pushHistory) {\n    const product = state.products.find(p => String(p.id) === String(id));\n`;
  must(src, openAnchor, 'openModal declaration');

  const helper = `    function _normalizeModalOpenOptions(value) {\n      if (typeof value === 'boolean') {\n        return { kind: 'product', pushHistory: value, detail: null };\n      }\n      if (!value || typeof value !== 'object') {\n        return { kind: 'product', pushHistory: undefined, detail: null };\n      }\n      return {\n        kind: value.kind || 'product',\n        pushHistory: value.pushHistory,\n        detail: value.detail || null,\n      };\n    }\n\n    function _openDiscoveryModal(id, options) {\n      const kind = options.kind;\n      const detail = options.detail;\n      if ((kind !== 'service' && kind !== 'physical_offer') || !detail || !detail.title) return;\n      if (!dom.modalOverlay || !dom.modal) return;\n\n      if (!dom.modalOverlay.classList.contains('open')) {\n        state._savedCatalogScrollY = getScrollY();\n        if (!_modalHistoryPushed) {\n          history.pushState({ kModal: true }, '');\n          _modalHistoryPushed = true;\n        }\n      }\n\n      state.modalKind = kind;\n      state.modalRef = String(id);\n      state.modalDetail = detail;\n      state.modalProduct = null;\n      state.modalHistory = [];\n      state.modalSubcatFilter = null;\n\n      dom.modal.classList.add('k-modal--discovery');\n      if (dom.modalBackLabel) dom.modalBackLabel.textContent = 'Catalogue';\n      updateCartBadge();\n\n      dom.modalOverlay.classList.add('open');\n      const scrollEl = dom.modal.querySelector('.k-modal-scroll');\n      if (scrollEl) scrollEl.scrollTop = 0;\n      requestAnimationFrame(function() {\n        const liveScrollEl = dom.modal && dom.modal.querySelector('.k-modal-scroll');\n        if (liveScrollEl) liveScrollEl.scrollTop = 0;\n      });\n\n      // Generic modal lifecycle is active before the catalog-owned renderer paints.\n      state.modalOpen = true;\n      bus.emit('modal:discovery-opened', { kind, ref: String(id), detail });\n\n      document.body.classList.remove('modal-has-cart');\n      document.body.style.setProperty('--modal-scroll-y', \`-\${state._savedCatalogScrollY || 0}px\`);\n      document.body.classList.add('modal-open');\n\n      // Same mobile scroll guards as Product modal; no second overlay/lifecycle.\n      if (window.innerWidth < 900) {\n        const pageScroll = dom.pageScroll;\n        if (pageScroll) {\n          state._savedPagerInlineStyles = {\n            position: pageScroll.style.position,\n            top: pageScroll.style.top,\n            left: pageScroll.style.left,\n            right: pageScroll.style.right,\n            bottom: pageScroll.style.bottom,\n            width: pageScroll.style.width,\n            height: pageScroll.style.height,\n            overflow: pageScroll.style.overflow,\n            overflowX: pageScroll.style.overflowX,\n            overflowY: pageScroll.style.overflowY,\n          };\n          pageScroll.style.position = '';\n          pageScroll.style.top = '';\n          pageScroll.style.left = '';\n          pageScroll.style.right = '';\n          pageScroll.style.bottom = '';\n          pageScroll.style.width = '';\n          pageScroll.style.height = '';\n          pageScroll.style.overflow = '';\n          pageScroll.style.overflowX = '';\n          pageScroll.style.overflowY = '';\n        }\n\n        const grid = document.getElementById('k-grid');\n        if (grid && grid.classList.contains('k-grid-flat-subcat')) {\n          state._savedGridScrollLeft = grid.scrollLeft;\n          grid.style.scrollSnapType = 'none';\n          grid.scrollLeft = 0;\n        }\n      }\n\n      hideModalFAB();\n    }\n\n    function openModal(id, optionsOrPushHistory) {\n      const openOptions = _normalizeModalOpenOptions(optionsOrPushHistory);\n      if (openOptions.kind !== 'product') {\n        _openDiscoveryModal(id, openOptions);\n        return;\n      }\n      const pushHistory = openOptions.pushHistory;\n      const product = state.products.find(p => String(p.id) === String(id));\n`;

  src = src.replace(openAnchor, helper);

  const productStateAnchor = `    state.modalProduct = product;\n`;
  const productStateReplacement = `    state.modalKind = 'product';\n    state.modalRef = String(id);\n    state.modalDetail = null;\n    if (dom.modal) dom.modal.classList.remove('k-modal--discovery');\n    state.modalProduct = product;\n`;
  src = replaceOnce(src, productStateAnchor, productStateReplacement, 'product modal state');

  src = replaceOnce(
    src,
    `    dom.modalOverlay.classList.remove('open');\n    // Unlock body scroll — CSS class drives layout\n`,
    `    dom.modalOverlay.classList.remove('open');\n    if (dom.modal) dom.modal.classList.remove('k-modal--discovery');\n    // Unlock body scroll — CSS class drives layout\n`,
    'close modal class cleanup'
  );

  src = replaceOnce(
    src,
    `    state.modalProduct = null;\n    state.modalHistory = [];\n`,
    `    state.modalProduct = null;\n    state.modalKind = 'product';\n    state.modalRef = null;\n    state.modalDetail = null;\n    state.modalHistory = [];\n`,
    'close modal state cleanup'
  );

  write(file, src);
}

// -----------------------------------------------------------------------------
// 3) Dedicated catalog renderer INSIDE #k-modal. It owns content, not lifecycle.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/js/b-modal-discovery-detail.js';
  write(file, `/**\n * @komerce-arch-lite\n * @role          catalog-modal-discovery-detail\n * @domain        catalog\n * @layer         ui-renderer\n * @owner         public/boutique/js/discovery-rail.js\n * @purpose       Rendre Physical Offer / Service dans l'unique shell #k-modal sans les convertir en Product.\n * @impact-areas  product-discovery, discovery-rail, modal-layout\n * @version       2026-09\n */\n'use strict';\n\nimport { bus } from './b-bus.js';\nimport { sanitize } from './b-utils.js';\nimport { closeModal } from './b-modal.js';\n\nconst SLOT_ID = 'k-modal-discovery-detail';\nlet _installed = false;\n\nfunction statusFor(kind) {\n  return kind === 'physical_offer' ? 'Préparation sur commande' : 'Sur demande';\n}\n\nfunction ctaFor(kind) {\n  return kind === 'physical_offer' ? 'Commander' : 'Demander';\n}\n\nfunction buildDetailHTML(kind, ref, detail) {\n  const image = detail.image_ref\n    ? \`<img class="k-modal-discovery-img" src="\${sanitize(detail.image_ref)}" alt="\${sanitize(detail.title)}" loading="lazy" decoding="async">\`\n    : '<div class="k-modal-discovery-media-fallback" aria-hidden="true">K</div>';\n  const provider = detail.provider_name\n    ? \`<div class="k-modal-discovery-provider">\${sanitize(detail.provider_name)}\${detail.zone ? \` · \${sanitize(detail.zone)}\` : ''}</div>\`\n    : (detail.zone ? \`<div class="k-modal-discovery-provider">\${sanitize(detail.zone)}</div>\` : '');\n  const description = detail.description\n    ? \`<p class="k-modal-discovery-desc">\${sanitize(detail.description)}</p>\`\n    : '';\n\n  return \`\n    <div class="k-modal-discovery-shell">\n      <div class="k-modal-discovery-media">\${image}</div>\n      <div class="k-modal-discovery-body">\n        <span class="k-modal-discovery-badge">\${sanitize(statusFor(kind))}</span>\n        <h2 class="k-modal-discovery-title">\${sanitize(detail.title)}</h2>\n        \${provider}\n        \${description}\n        <button class="k-discovery-cta k-modal-discovery-cta" type="button"\n          data-discovery-modal-action="\${sanitize(kind)}"\n          data-discovery-ref="\${sanitize(ref)}">\${sanitize(ctaFor(kind))}</button>\n      </div>\n    </div>\`;\n}\n\nexport function renderDiscoveryModalDetail(payload) {\n  const slot = document.getElementById(SLOT_ID);\n  if (!slot || !payload) return false;\n  const { kind, ref, detail } = payload;\n  if ((kind !== 'service' && kind !== 'physical_offer') || !ref || !detail?.title) return false;\n\n  slot.dataset.discoveryKind = kind;\n  slot.innerHTML = buildDetailHTML(kind, ref, detail);\n  slot.hidden = false;\n  return true;\n}\n\nexport function clearDiscoveryModalDetail() {\n  const slot = document.getElementById(SLOT_ID);\n  if (!slot) return;\n  slot.hidden = true;\n  slot.innerHTML = '';\n  delete slot.dataset.discoveryKind;\n}\n\nfunction handleAction(event) {\n  const button = event.target.closest('[data-discovery-modal-action][data-discovery-ref]');\n  if (!button || !button.matches('button')) return;\n  const kind = button.dataset.discoveryModalAction;\n  const ref = button.dataset.discoveryRef;\n  if (!kind || !ref) return;\n\n  // Continue inside Komerce: close the detail lifecycle without browser-back,\n  // then hand the business action to the canonical Inquiry path.\n  closeModal({ skipHistoryBack: true });\n  bus.emit('discovery:request', { kind, ref, source: button });\n}\n\nexport function setupDiscoveryModalDetail() {\n  if (_installed) return;\n  _installed = true;\n\n  const slot = document.getElementById(SLOT_ID);\n  if (!slot) return;\n  slot.addEventListener('click', handleAction);\n  bus.on('modal:discovery-opened', renderDiscoveryModalDetail);\n  bus.on('modal:closed', clearDiscoveryModalDetail);\n}\n`);
}

// -----------------------------------------------------------------------------
// 4) Discovery rail — card click opens same Komerce modal, not a second sheet.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/js/discovery-rail.js';
  let src = read(file);
  src = src.replace(
    `import { openDiscoveryDetail, closeDiscoveryDetail } from './render/render-discovery-detail.js';\n`,
    ''
  );
  src = src.replace(
    `  // Card click (non-button) — product → PDP, others → detail (future L2)`,
    `  // Card click (non-button) — all kinds open the same Komerce modal shell.`
  );
  src = replaceOnce(
    src,
    `  // Enrich with kind for the detail renderer\n  openDiscoveryDetail({ ...detail, kind });`,
    `  openModal(ref, { kind, detail });`,
    'discovery card detail open'
  );

  const oldListener = `\n  // CTA dans le detail sheet (injecté dans body, pas dans le shell)\n  document.addEventListener('click', (e) => {\n    const btn = e.target.closest('#k-discovery-detail-sheet [data-discovery-action][data-discovery-ref]');\n    if (!btn || !btn.matches('button')) return;\n    const kind = btn.dataset.discoveryAction;\n    const ref = btn.dataset.discoveryRef;\n    if (!kind || !ref) return;\n    closeDiscoveryDetail();\n    bus.emit('discovery:request', { kind, ref, source: btn });\n  });\n`;
  src = replaceOnce(src, oldListener, '\n', 'legacy detail sheet listener');
  write(file, src);
}

// -----------------------------------------------------------------------------
// 5) Runtime wiring.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/js/main.js';
  let src = read(file);
  src = insertAfter(
    src,
    `import { setupDiscoveryRail } from './discovery-rail.js';\n`,
    `import { setupDiscoveryModalDetail } from './b-modal-discovery-detail.js';\n`,
    'main discovery modal import'
  );
  src = replaceOnce(
    src,
    `  setupDiscoveryInquiry();\n  setupDiscoveryRail();\n`,
    `  setupDiscoveryInquiry();\n  setupDiscoveryModalDetail();\n  setupDiscoveryRail();\n`,
    'main discovery setup'
  );
  write(file, src);
}

// -----------------------------------------------------------------------------
// 6) One dedicated slot in the existing modal markup.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/index.html';
  let src = read(file);
  const anchor = `      <div class="k-modal-product-zone">\n`;
  const block = `        <!-- U1 Discovery — même shell #k-modal, contenu métier distinct. -->\n        <div id="k-modal-discovery-detail" class="k-modal-discovery-detail" hidden></div>\n`;
  src = insertAfter(src, anchor, block, 'unified modal discovery slot');
  write(file, src);
}

// -----------------------------------------------------------------------------
// 7) CSS — remove second overlay/sheet; add same-shell Discovery mode.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/css/discovery-rail.css';
  let src = read(file);
  const marker = '/* ── Discovery detail sheet';
  const idx = src.indexOf(marker);
  if (idx < 0) throw new Error('U1 anchor missing: legacy Discovery detail CSS');
  src = src.slice(0, idx).trimEnd() + `\n\n/* ── U1 — Discovery detail inside the canonical Komerce modal ───────── */\n\n.k-modal-discovery-detail {\n  display: none;\n}\n\n.k-modal.k-modal--discovery .k-modal-product-zone {\n  display: block;\n}\n\n.k-modal.k-modal--discovery .k-modal-img-wrap,\n.k-modal.k-modal--discovery .k-modal-right-rail,\n.k-modal.k-modal--discovery .k-modal-long-details,\n.k-modal.k-modal--discovery .k-modal-enriched-content,\n.k-modal.k-modal--discovery .k-modal-suggestions,\n.k-modal.k-modal--discovery .k-modal-cart-slot,\n.k-modal.k-modal--discovery .k-modal-actions {\n  display: none;\n}\n\n.k-modal.k-modal--discovery .k-modal-discovery-detail:not([hidden]) {\n  display: block;\n}\n\n.k-modal-discovery-shell {\n  width: min(100%, 860px);\n  margin: 0 auto;\n  padding: 10px 12px 28px;\n}\n\n.k-modal-discovery-media {\n  overflow: hidden;\n  border: 1px solid var(--border);\n  border-radius: 16px;\n  background: linear-gradient(145deg, var(--sand) 0%, var(--sand-warm) 100%);\n  box-shadow: var(--elev-1);\n}\n\n.k-modal-discovery-img {\n  display: block;\n  width: 100%;\n  aspect-ratio: 4 / 3;\n  object-fit: cover;\n}\n\n.k-modal-discovery-media-fallback {\n  display: grid;\n  min-height: 220px;\n  place-items: center;\n  color: var(--ocean-dark);\n  font-size: 34px;\n  font-weight: 800;\n}\n\n.k-modal-discovery-body {\n  padding: 16px 2px 0;\n}\n\n.k-modal-discovery-badge {\n  display: inline-flex;\n  align-items: center;\n  min-height: 24px;\n  padding: 3px 8px;\n  border: 1px solid var(--border);\n  border-radius: 8px;\n  background: var(--surface-sand-94);\n  color: var(--ocean-dark);\n  font-size: 11px;\n  font-weight: 700;\n}\n\n.k-modal-discovery-title {\n  margin: 10px 0 4px;\n  color: var(--ocean-dark);\n  font-size: 22px;\n  line-height: 1.15;\n}\n\n.k-modal-discovery-provider {\n  color: var(--text-muted);\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.k-modal-discovery-desc {\n  margin: 12px 0 0;\n  color: var(--text);\n  font-size: 14px;\n  line-height: 1.5;\n}\n\n.k-modal-discovery-cta {\n  margin-top: 18px;\n  min-height: 42px;\n}\n\n.k-modal-discovery-detail[data-discovery-kind="physical_offer"] .k-modal-discovery-cta {\n  background: var(--terracotta-bg);\n  color: var(--terracotta-dark);\n  border-color: var(--border-terra-22);\n}\n\n.k-modal-discovery-detail[data-discovery-kind="service"] .k-modal-discovery-cta {\n  background: var(--cta-green-10);\n  color: var(--cta-green);\n  border-color: var(--border-sage-22);\n}\n\n@media (min-width: 900px) {\n  .k-modal-discovery-shell {\n    padding: 18px 22px 34px;\n  }\n\n  .k-modal-discovery-img {\n    aspect-ratio: 16 / 9;\n    max-height: 430px;\n  }\n\n  .k-modal-discovery-body {\n    padding-top: 18px;\n  }\n\n  .k-modal-discovery-title {\n    font-size: 26px;\n  }\n}\n`;
  write(file, src);
}

// -----------------------------------------------------------------------------
// 8) Bus contract — explicit new event, and modal:closed consumer declaration.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/js/b-bus.js';
  let src = read(file);
  src = insertAfter(
    src,
    ` *   modal:opened     { product }        — fait : la modal vient de s'ouvrir sur ce produit (≠ modal:open, qui est la commande d'ouverture)\n`,
    ` *   modal:discovery-opened { kind, ref, detail } — fait : le shell modal Komerce vient de s'ouvrir sur une offre/service Discovery\n`,
    'bus event docs'
  );
  src = insertAfter(
    src,
    ` *   modal:opened               owner=modal-product producer=b-modal-core.js payload=value\n`,
    ` *   modal:discovery-opened     owner=catalog producer=b-modal-core.js payload=value\n`,
    'bus owned contract'
  );
  src = replaceOnce(
    src,
    ` *   modal:closed     : b-modal-product-detail-bootstrap.js, b-pager.js, group-side-cart.js\n`,
    ` *   modal:closed     : b-modal-product-detail-bootstrap.js, b-modal-discovery-detail.js, b-pager.js, group-side-cart.js\n`,
    'bus closed consumers'
  );
  src = insertAfter(
    src,
    ` *   modal:opened     : b-modal-product-detail-bootstrap.js, boutique.js, b-pdp-curation-suggestions.js, b-pager.js, b-modal-desktop-enhancers.js\n`,
    ` *   modal:discovery-opened : b-modal-discovery-detail.js\n`,
    'bus discovery consumers'
  );
  write(file, src);
}

// -----------------------------------------------------------------------------
// 9) Feature manifest — catalog owns the renderer, shared modal only the shell.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/features/catalog.feature.js';
  let src = read(file);
  src = replaceOnce(
    src,
    `      '../js/render/render-discovery-detail.js',\n`,
    `      '../js/b-modal-discovery-detail.js',\n`,
    'catalog file ownership'
  );
  src = insertAfter(
    src,
    `      '../tests/unit/discovery-rail.test.js',\n`,
    `      '../tests/unit/discovery-modal-detail.test.js',\n`,
    'catalog modal detail test ownership'
  );
  src = replaceOnce(
    src,
    `      'render-discovery-detail.js / openDiscoveryDetail / closeDiscoveryDetail',\n`,
    `      'b-modal-discovery-detail.js / setupDiscoveryModalDetail / renderDiscoveryModalDetail',\n`,
    'catalog internal api'
  );
  src = insertAfter(
    src,
    `      'recommendations — projection DiscoveryCard read-only ; aucun droit d’exposition n’est décidé côté frontend',\n`,
    `      'shared-cart-modal — cycle de vie et shell #k-modal ; catalog reste owner du contenu Discovery',\n`,
    'catalog modal shell consume'
  );
  src = insertAfter(
    src,
    `    'le kind Discovery ne crée jamais une taxonomie ou une navigation client parallèle ; seuls subtitle et CTA portent la nuance',\n`,
    `    'Product, Physical Offer et Service utilisent le même shell #k-modal ; aucune seconde modale Discovery ne peut être créée',\n`,
    'catalog unified modal invariant'
  );
  write(file, src);
}

// -----------------------------------------------------------------------------
// 10) Shared modal manifest — lifecycle evolves, business content remains outside.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/features/shared-cart-modal.feature.js';
  let src = read(file);
  src = replaceOnce(
    src,
    `  service: "Surface modale du panier partagé (panier/groupe) — orchestration d'ouverture, navigation carousel, contenu produit dans le modal, preuve sociale, ajout panier depuis le modal.",`,
    `  service: "Cycle de vie du shell modal Komerce — ouverture/fermeture/historique/scroll communs ; les renderers métier Product et Discovery restent propriétaires de leur contenu.",`,
    'shared modal service statement'
  );
  src = insertAfter(
    src,
    `    in:  ['fichiers js/* annotés @domain shared-cart-modal'],\n`,
    `    // Le shell #k-modal peut héberger plusieurs projections, sans absorber leur métier.\n`,
    'shared modal perimeter note'
  );
  src = replaceOnce(
    src,
    `      'openModal / closeModal / setupModal (b-modal-core.js)',\n`,
    `      'openModal(id, boolean|{kind,pushHistory,detail}) / closeModal / setupModal (b-modal-core.js)',\n`,
    'shared modal api signature'
  );
  src = insertAfter(
    src,
    `      'shared-cart — b-cart.js (addToCart/quickAdd/quickRemove/setQty, via b-modal-cart.js)',\n`,
    `      'catalog — projection Service/Physical Offer via modal:discovery-opened ; aucune vérité provider n est possédée ici',\n`,
    'shared modal consume catalog'
  );
  src = insertAfter(
    src,
    `    'sur desktop le bouton panier centre ouvre le recapitulatif canonique du checkout sans cibler le side-cart ; sur mobile il ouvre le drawer de relecture',\n`,
    `    'le cycle open/close/history du shell #k-modal reste unique pour Product, Physical Offer et Service ; aucun overlay Discovery parallèle',\n`,
    'shared modal unified lifecycle invariant'
  );
  write(file, src);
}

// -----------------------------------------------------------------------------
// 11) Runtime smoke test wiring.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/tests/unit/main.test.js';
  let src = read(file);
  src = insertAfter(
    src,
    `const mockSetupDiscoveryRail = jest.fn();\n`,
    `const mockSetupDiscoveryModalDetail = jest.fn();\n`,
    'main test mock declaration'
  );
  src = insertAfter(
    src,
    `jest.mock('../../js/discovery-rail.js', () => ({\n  setupDiscoveryRail: mockSetupDiscoveryRail,\n}));\n`,
    `jest.mock('../../js/b-modal-discovery-detail.js', () => ({\n  setupDiscoveryModalDetail: mockSetupDiscoveryModalDetail,\n}));\n`,
    'main test modal detail mock'
  );
  src = insertAfter(
    src,
    `  expect(mockSetupDiscoveryInquiry).toHaveBeenCalledTimes(1);\n`,
    `  expect(mockSetupDiscoveryModalDetail).toHaveBeenCalledTimes(1);\n`,
    'main test initial expectation'
  );
  // There are two identical Inquiry expectations; insert second modal expectation after the later Rail assertion.
  src = replaceOnce(
    src,
    `  expect(mockSetupDiscoveryInquiry).toHaveBeenCalledTimes(1);\n  expect(mockSetupDiscoveryRail).toHaveBeenCalledTimes(1);\n  jest.useRealTimers();\n`,
    `  expect(mockSetupDiscoveryInquiry).toHaveBeenCalledTimes(1);\n  expect(mockSetupDiscoveryModalDetail).toHaveBeenCalledTimes(1);\n  expect(mockSetupDiscoveryRail).toHaveBeenCalledTimes(1);\n  jest.useRealTimers();\n`,
    'main test resize expectation'
  );
  write(file, src);
}

// -----------------------------------------------------------------------------
// 12) Functional renderer + architecture contract test.
// -----------------------------------------------------------------------------
{
  const file = 'public/boutique/tests/unit/discovery-modal-detail.test.js';
  write(file, `'use strict';\n\n/**\n * @test-kind unit\n * @test-runner jest\n * @test-requires none\n */\n\nconst fs = require('fs');\nconst path = require('path');\n\nconst listeners = {};\nconst mockEmit = jest.fn();\nconst mockCloseModal = jest.fn();\n\njest.mock('../../js/b-bus.js', () => ({\n  bus: {\n    on: jest.fn((event, handler) => { listeners[event] = handler; }),\n    emit: mockEmit,\n  },\n}));\n\njest.mock('../../js/b-modal.js', () => ({ closeModal: mockCloseModal }));\njest.mock('../../js/b-utils.js', () => ({\n  sanitize: (value) => String(value)\n    .replace(/&/g, '&amp;')\n    .replace(/</g, '&lt;')\n    .replace(/>/g, '&gt;')\n    .replace(/"/g, '&quot;'),\n}));\n\nconst {\n  setupDiscoveryModalDetail,\n  renderDiscoveryModalDetail,\n  clearDiscoveryModalDetail,\n} = require('../../js/b-modal-discovery-detail.js');\n\nbeforeEach(() => {\n  document.body.innerHTML = '<div id="k-modal-discovery-detail" hidden></div>';\n  mockEmit.mockClear();\n  mockCloseModal.mockClear();\n});\n\ntest('rend une offre physique dans le slot du shell modal canonique', () => {\n  const rendered = renderDiscoveryModalDetail({\n    kind: 'physical_offer',\n    ref: 'offer-1',\n    detail: {\n      title: 'Samboussas au bœuf',\n      provider_name: 'Saveurs d Anjouan',\n      zone: 'Mutsamudu',\n      description: 'Préparés sur commande',\n      image_ref: '/images/samboussas.webp',\n    },\n  });\n\n  const slot = document.getElementById('k-modal-discovery-detail');\n  expect(rendered).toBe(true);\n  expect(slot.hidden).toBe(false);\n  expect(slot.dataset.discoveryKind).toBe('physical_offer');\n  expect(slot.textContent).toContain('Samboussas au bœuf');\n  expect(slot.textContent).toContain('Saveurs d Anjouan');\n  expect(slot.textContent).toContain('Commander');\n  expect(slot.querySelector('[data-discovery-ref="offer-1"]')).not.toBeNull();\n});\n\ntest('le CTA poursuit le parcours Komerce via Inquiry après fermeture contrôlée du même modal', () => {\n  setupDiscoveryModalDetail();\n  listeners['modal:discovery-opened']({\n    kind: 'service',\n    ref: 'svc-1',\n    detail: { title: 'Installation climatiseur', zone: 'Mutsamudu' },\n  });\n\n  document.querySelector('[data-discovery-modal-action="service"]').click();\n\n  expect(mockCloseModal).toHaveBeenCalledWith({ skipHistoryBack: true });\n  expect(mockEmit).toHaveBeenCalledWith('discovery:request', expect.objectContaining({\n    kind: 'service',\n    ref: 'svc-1',\n  }));\n});\n\ntest('modal:closed purge le contenu Discovery sans toucher au shell', () => {\n  renderDiscoveryModalDetail({\n    kind: 'service',\n    ref: 'svc-2',\n    detail: { title: 'Plomberie maison' },\n  });\n  clearDiscoveryModalDetail();\n  const slot = document.getElementById('k-modal-discovery-detail');\n  expect(slot.hidden).toBe(true);\n  expect(slot.innerHTML).toBe('');\n});\n\ntest('contrat U1 : aucun second renderer/overlay Discovery ne subsiste', () => {\n  const root = path.join(__dirname, '../..');\n  const rail = fs.readFileSync(path.join(root, 'js/discovery-rail.js'), 'utf8');\n  const core = fs.readFileSync(path.join(root, 'js/b-modal-core.js'), 'utf8');\n  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');\n\n  expect(rail).not.toMatch(/render-discovery-detail/);\n  expect(rail).toMatch(/openModal\\(ref, \\{ kind, detail \\}\\)/);\n  expect(core).toMatch(/modal:discovery-opened/);\n  expect((html.match(/id="k-modal-overlay"/g) || [])).toHaveLength(1);\n  expect(html).toMatch(/id="k-modal-discovery-detail"/);\n});\n`);
}

// -----------------------------------------------------------------------------
// 13) Doctrine — same Boutique, same card, same modal; only final capability differs.
// -----------------------------------------------------------------------------
{
  const file = 'docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md';
  let src = read(file);
  const anchor = `> **Le système sait. Le client agit.**\n\n---\n\n## 8. Discovery est une projection de lecture\n`;
  const replacement = `> **Le système sait. Le client agit.**\n\n### Une seule surface de détail Komerce\n\nLa carte Discovery n'ouvre jamais une marketplace, une page artisan ni un second système de modale.\n\n\`Product\`, \`Physical Offer\` et \`Service\` restent des vérités métier distinctes, mais utilisent le **même shell de détail Komerce**. La nature métier détermine les capacités affichées et l'interaction finale, pas une nouvelle expérience.\n\n\`\`\`text\nCarte Komerce\n      ↓\n#k-modal\n      ↓\nProduct        → Acheter\nPhysical Offer → Commander\nService        → Demander / Contacter\n\`\`\`\n\nLes blocs de détail (média, fournisseur, variantes, livraison, références, contact autorisé) sont optionnels et apparaissent uniquement lorsque leur domaine source possède réellement la donnée. Discovery ne les invente jamais.\n\n> **Une seule expérience de découverte et de détail Komerce ; seule la nature de l'interaction finale change.**\n\n---\n\n## 8. Discovery est une projection de lecture\n`;
  src = replaceOnce(src, anchor, replacement, 'Discovery doctrine unified modal section');
  write(file, src);
}

// -----------------------------------------------------------------------------
// 14) Legacy second renderer removed.
// -----------------------------------------------------------------------------
{
  const legacy = 'public/boutique/js/render/render-discovery-detail.js';
  if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
}

console.log('U1 unified Komerce detail modal applied.');
