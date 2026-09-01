from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'pattern count != 1 in {path}: {text.count(old)}')
    p.write_text(text.replace(old, new, 1))


# 1) Canonical renderer: choose a deterministic real product photo from state.products.
path = 'public/boutique/js/render/category-shelf-visuals.js'
replace_once(
    path,
    "'use strict';\n\nexport const KOMERCE_SHELF_SPRITE",
    "'use strict';\n\nimport { matchesSubcategory, normalizeCategoryKey } from '../shop-schema.js';\n\nexport const KOMERCE_SHELF_SPRITE",
)

marker = "export function getShelfCategoryVisual(categoryKey) {\n"
helper = r'''function normalizeProductImageUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;
  if (url.startsWith('/') || /^https?:\/\//i.test(url)) return url;
  return null;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Picks one deterministic REAL catalog image for a subcategory.
 * The catalog remains the media source of truth: no parallel subcategory asset catalog.
 * Stable ordering prevents the navigation image from changing with ranking/shuffle order.
 */
export function getShelfSubcategoryProductImage(products, categoryKey, subcategoryKey) {
  if (!Array.isArray(products) || !products.length || !subcategoryKey) return null;
  const canonicalCategory = normalizeCategoryKey(categoryKey);
  const candidates = products
    .filter((product) => {
      if (!product || !normalizeProductImageUrl(product.image_url)) return false;
      if (normalizeCategoryKey(product.category) !== canonicalCategory) return false;
      return matchesSubcategory(categoryKey, subcategoryKey, product.subcategory);
    })
    .sort((a, b) => {
      const aOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aKey = String(a.product_ref || a.id || a.name || '');
      const bKey = String(b.product_ref || b.id || b.name || '');
      return aKey.localeCompare(bKey, 'fr');
    });
  return candidates.length ? normalizeProductImageUrl(candidates[0].image_url) : null;
}

export function renderShelfProductPhoto(src, extraClass = '') {
  const safeSrc = normalizeProductImageUrl(src);
  if (!safeSrc) return '';
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<img class="k-shelf-object${cls} k-shelf-product-photo" src="${escapeAttribute(safeSrc)}" alt="" aria-hidden="true" loading="eager" decoding="async">`;
}

'''
p = Path(path)
text = p.read_text()
if marker not in text:
    raise SystemExit('renderer insertion marker missing')
p.write_text(text.replace(marker, helper + marker, 1))


# 2) Desktop owner consumes product photos first, canonical visual only as fallback.
path = 'public/boutique/js/controllers/home-controller.js'
replace_once(
    path,
    "import { getShelfSubcategoryVisual, renderShelfUse } from '../render/category-shelf-visuals.js';",
    "import {\n  getShelfSubcategoryProductImage,\n  getShelfSubcategoryVisual,\n  renderShelfProductPhoto,\n  renderShelfUse,\n} from '../render/category-shelf-visuals.js';",
)
replace_once(
    path,
    """        const visual = getShelfSubcategoryVisual(catKey, sub.key);\n        const object = visual\n          ? renderShelfUse(visual, 'k-shelf-object--subcategory')\n          : `<span class=\"k-shelf-emoji-fallback\">${icon}</span>`;\n        const active = activeSubcat === sub.key ? ' active' : '';\n        return `<button type=\"button\" class=\"k-subcutout${active}\" data-subcat=\"${key}\"${visual ? ` data-shelf-visual=\"${escapeHtml(visual)}\"` : ''}>\n""",
    """        const photo = getShelfSubcategoryProductImage(state.products, catKey, sub.key);\n        const visual = getShelfSubcategoryVisual(catKey, sub.key);\n        const object = photo\n          ? renderShelfProductPhoto(photo, 'k-shelf-object--subcategory')\n          : visual\n            ? renderShelfUse(visual, 'k-shelf-object--subcategory')\n            : `<span class=\"k-shelf-emoji-fallback\">${icon}</span>`;\n        const active = activeSubcat === sub.key ? ' active' : '';\n        const mediaAttr = photo ? ' data-shelf-media=\"product\"' : '';\n        return `<button type=\"button\" class=\"k-subcutout${active}\" data-subcat=\"${key}\"${visual ? ` data-shelf-visual=\"${escapeHtml(visual)}\"` : ''}${mediaAttr}>\n""",
)


# 3) Mobile flat pager consumes exactly the same real product photo helper.
path = 'public/boutique/js/b-subcat.js'
replace_once(
    path,
    """import {\n  getShelfSubcategoryVisual,\n  renderShelfUse,\n}                                  from './render/category-shelf-visuals.js';""",
    """import {\n  getShelfSubcategoryProductImage,\n  getShelfSubcategoryVisual,\n  renderShelfProductPhoto,\n  renderShelfUse,\n}                                  from './render/category-shelf-visuals.js';""",
)
replace_once(
    path,
    """          const visual = getShelfSubcategoryVisual(fs.cat, s.key);\n          const object = visual\n            ? renderShelfUse(visual, 'k-shelf-object--subcategory k-flat-subcat-object')\n            : '<span class=\"k-shelf-emoji-fallback\">' + sanitize(s.icon || '✨') + '</span>';\n          return '<button class=\"k-flat-subcat-tab\" data-flat-sub=\"' + s.key + '\"' +\n            (visual ? ' data-shelf-visual=\"' + sanitize(visual) + '\"' : '') + '>' +\n""",
    """          const photo = getShelfSubcategoryProductImage(state.products, fs.cat, s.key);\n          const visual = getShelfSubcategoryVisual(fs.cat, s.key);\n          const object = photo\n            ? renderShelfProductPhoto(photo, 'k-shelf-object--subcategory k-flat-subcat-object')\n            : visual\n              ? renderShelfUse(visual, 'k-shelf-object--subcategory k-flat-subcat-object')\n              : '<span class=\"k-shelf-emoji-fallback\">' + sanitize(s.icon || '✨') + '</span>';\n          return '<button class=\"k-flat-subcat-tab\" data-flat-sub=\"' + s.key + '\"' +\n            (visual ? ' data-shelf-visual=\"' + sanitize(visual) + '\"' : '') +\n            (photo ? ' data-shelf-media=\"product\"' : '') + '>' +\n""",
)


# 4) Mobile CSS no longer recolors subcategory media green/monochrome.
path = 'public/boutique/css/interactions.css'
replace_once(
    path,
    ".k-flat-subcat-object           { width:40px; height:36px; filter:drop-shadow(0 3px 5px var(--border-text-08)) grayscale(1) sepia(.58) hue-rotate(62deg) saturate(1.55) contrast(1.16) brightness(.74); }\n.k-flat-subcat-tab.is-active .k-flat-subcat-object { filter:drop-shadow(0 4px 6px var(--border-text-08)) grayscale(1) sepia(.68) hue-rotate(62deg) saturate(1.8) contrast(1.22) brightness(.66); transform:translateY(-1px); }\n.k-flat-subcat-tab-icon .k-shelf-emoji-fallback { display:block; filter:grayscale(1) sepia(.58) hue-rotate(62deg) saturate(1.55) contrast(1.16) brightness(.74); }",
    ".k-flat-subcat-object           { width:40px; height:36px; object-fit:contain; object-position:center; filter:drop-shadow(0 3px 5px var(--border-text-08)) saturate(1.02) contrast(1.04); }\n.k-flat-subcat-tab.is-active .k-flat-subcat-object { filter:drop-shadow(0 4px 6px var(--border-text-08)) saturate(1.06) contrast(1.06); transform:translateY(-1px); }\n.k-flat-subcat-tab-icon .k-shelf-emoji-fallback { display:block; filter:none; }",
)


# Desktop product photos keep their native color and proportions.
path = 'public/boutique/css/category-cutout-navigation-desktop.css'
replace_once(
    path,
    """  .k-shelf-object--subcategory {\n    width: 72px;\n    height: 64px;\n""",
    """  .k-shelf-product-photo {\n    object-fit: contain;\n    object-position: center;\n    background: transparent;\n  }\n\n  .k-shelf-object--subcategory {\n    width: 72px;\n    height: 64px;\n""",
)


# 5) Contract test: real product media is preferred on desktop and mobile; no green recoloring.
path = 'public/boutique/tests/unit/category-subcategory-continuity.test.js'
p = Path(path)
text = p.read_text()
text = text.replace(
    "test('réutilise les mêmes objets monochromes dans le pager mobile'",
    "test('réutilise les mêmes photos produit naturelles dans le pager mobile'",
    1,
)
text = text.replace(
    "    expect(subcat).toContain('getShelfSubcategoryVisual');\n    expect(subcat).toContain(\"renderShelfUse(visual, 'k-shelf-object--subcategory k-flat-subcat-object')\");\n    expect(interactions).toMatch(/\\.k-flat-subcat-tab\\s*\\{[^}]*flex-direction:\\s*column[^}]*background:\\s*transparent[^}]*border:\\s*0/s);\n    expect(interactions).toMatch(/\\.k-flat-subcat-object\\s*\\{[^}]*grayscale\\(1\\)[^}]*hue-rotate\\(62deg\\)[^}]*saturate\\(1\\.55\\)/s);\n    expect(interactions).toMatch(/\\.k-flat-subcat-tab\\.is-active::after\\s*\\{[^}]*width:\\s*18px/s);",
    "    expect(subcat).toContain('getShelfSubcategoryProductImage');\n    expect(subcat).toContain('renderShelfProductPhoto');\n    expect(subcat).toContain('data-shelf-media=\\\"product\\\"');\n    expect(interactions).toMatch(/\\.k-flat-subcat-tab\\s*\\{[^}]*flex-direction:\\s*column[^}]*background:\\s*transparent[^}]*border:\\s*0/s);\n    expect(interactions).toMatch(/\\.k-flat-subcat-object\\s*\\{[^}]*object-fit:contain[^}]*saturate\\(1\\.02\\)[^}]*contrast\\(1\\.04\\)/s);\n    expect(interactions).not.toMatch(/\\.k-flat-subcat-object[^}]*grayscale\\(1\\)/s);\n    expect(interactions).not.toMatch(/\\.k-flat-subcat-object[^}]*hue-rotate\\(62deg\\)/s);\n    expect(interactions).toMatch(/\\.k-flat-subcat-tab\\.is-active::after\\s*\\{[^}]*width:\\s*18px/s);",
    1,
)
text = text.replace(
    "    expect(desktopShelf).toContain('grayscale(1)');\n    expect(desktopShelf).toContain('sepia(.58)');\n    expect(desktopShelf).toContain('hue-rotate(62deg)');\n    expect(desktopShelf).toContain('saturate(1.55)');",
    "    expect(visuals).toContain('getShelfSubcategoryProductImage');\n    expect(visuals).toContain('renderShelfProductPhoto');\n    expect(desktopShelf).toContain('.k-shelf-product-photo');\n    expect(desktopShelf).not.toContain('grayscale(1)');\n    expect(desktopShelf).not.toContain('sepia(.58)');\n    expect(desktopShelf).not.toContain('hue-rotate(62deg)');",
    1,
)
p.write_text(text)


# Behavioral unit: desktop rail actually emits a catalog product <img> when one matches.
path = 'public/boutique/tests/unit/home-controller.test.js'
p = Path(path)
text = p.read_text()
text = text.replace(
    "  getCategoryLabel: jest.fn(),\n}));",
    "  getCategoryLabel: jest.fn(),\n  normalizeCategoryKey: jest.fn((key) => key),\n  matchesSubcategory: jest.fn((cat, sub, productSub) => sub === productSub),\n}));",
    1,
)
needle = """      state.activeSubcat = 'chaussures';\n\n      renderSubcatRail('mode', { count: 42 });\n"""
replacement = """      state.activeSubcat = 'chaussures';\n      state.products = [\n        { id: 'p-photo', product_ref: 'PHOTO-001', category: 'mode', subcategory: 'chaussures', image_url: 'https://cdn.example.test/chaussure.webp', sort_order: 1 },\n      ];\n\n      renderSubcatRail('mode', { count: 42 });\n"""
if needle not in text:
    raise SystemExit('home-controller fixture marker missing')
text = text.replace(needle, replacement, 1)
needle = """      const activeChip = wrap.querySelector('.k-subcutout.active');\n      expect(activeChip.textContent).toContain('Chaussures');\n"""
replacement = """      const activeChip = wrap.querySelector('.k-subcutout.active');\n      expect(activeChip.textContent).toContain('Chaussures');\n      expect(activeChip.dataset.shelfMedia).toBe('product');\n      expect(activeChip.querySelector('img.k-shelf-product-photo')?.getAttribute('src')).toBe('https://cdn.example.test/chaussure.webp');\n"""
if needle not in text:
    raise SystemExit('home-controller assertion marker missing')
text = text.replace(needle, replacement, 1)
p.write_text(text)
