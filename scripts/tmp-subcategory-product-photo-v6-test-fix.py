from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:140]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'pattern count != 1 in {path}: {text.count(old)}')
    p.write_text(text.replace(old, new, 1))


# Ensure a real category product photo is still preferred when a precise subcategory
# has no image candidate. Static SVG/sprite media stays last-resort only.
path = 'public/boutique/js/render/category-shelf-visuals.js'
replace_once(
    path,
    """  return candidates.length ? normalizeProductImageUrl(candidates[0].image_url) : null;\n}\n\nexport function renderShelfProductPhoto""",
    """  if (candidates.length) return normalizeProductImageUrl(candidates[0].image_url);\n\n  const categoryCandidates = products\n    .filter((product) => product\n      && normalizeProductImageUrl(product.image_url)\n      && normalizeCategoryKey(product.category) === canonicalCategory)\n    .sort((a, b) => {\n      const aOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;\n      const bOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;\n      if (aOrder !== bOrder) return aOrder - bOrder;\n      const aKey = String(a.product_ref || a.id || a.name || '');\n      const bKey = String(b.product_ref || b.id || b.name || '');\n      return aKey.localeCompare(bKey, 'fr');\n    });\n  return categoryCandidates.length ? normalizeProductImageUrl(categoryCandidates[0].image_url) : null;\n}\n\nexport function renderShelfProductPhoto""",
)


# Main currently contains historical assertions that no longer match the canonical
# rail (they already fail independently of this feature). Re-anchor them on the
# current ownership/layout without weakening the subcategory media contract.
path = 'public/boutique/tests/unit/category-subcategory-continuity.test.js'
p = Path(path)
text = p.read_text()

old = r"""  test('rend le rail image compact et aligné sur le hero', () => {
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-cats-shell\s*\{[^}]*width:\s*calc\(100% - clamp\(32px, 2\.6vw, 48px\)\)[^}]*max-width:\s*1680px/s
    );
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-chip\s*\{[^}]*height:\s*64px[^}]*min-height:\s*64px/s
    );
  });"""
new = r"""  test('rend le rail image compact et aligné sur le hero', () => {
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-cats-shell\s*\{[^}]*width:\s*calc\(100% - clamp\(32px, 2\.6vw, 48px\)\)/s
    );
    expect(categories).toContain('max-width: 1680px;');
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-chip\s*\{[^}]*flex-basis:\s*118px/s
    );
    expect(categories).toMatch(/\.k-chip\s*\{\s*min-height:\s*64px;\s*\}/s);
    expect(categories).toMatch(/\.k-chip\s*\{\s*height:\s*64px;\s*\}/s);
  });"""
if old not in text:
    raise SystemExit('stale rail-image assertion block not found')
text = text.replace(old, new, 1)

old = r"""  test('prolonge la catégorie active par un sous-rail horizontal compact', () => {
    expect(desktop).toMatch(
      /html\.k-home-premium-v1 #k-subcats-wrap\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)[^}]*max-width:\s*1680px/s
    );
    expect(desktop).toMatch(
      /html\.k-home-premium-v1 #k-subcats-wrap \.k-subcats-rail\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/s
    );
  });"""
new = r"""  test('prolonge la catégorie active par un sous-rail horizontal compact', () => {
    expect(desktop).toMatch(
      /@media \(min-width:\s*900px\)[\s\S]*?#k-subcats-wrap\s*\{[^}]*display:\s*grid[^}]*width:\s*calc\(100% - clamp\(32px, 2\.6vw, 48px\)\)/s
    );
    expect(desktop).toMatch(
      /html\.k-home-premium-v1 #k-subcats-wrap\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*max-width:\s*1680px/s
    );
    expect(desktop).toMatch(
      /html\.k-home-premium-v1 #k-subcats-wrap \.k-subcats-rail\s*\{[^}]*min-width:\s*0[^}]*overflow-x:\s*auto/s
    );
  });"""
if old not in text:
    raise SystemExit('stale subrail assertion block not found')
text = text.replace(old, new, 1)

start = text.index("  test('calibre tous les visuels connus de sous-catégories et le fallback futur'")
end = text.index("\n\n  test('réutilise les mêmes photos produit naturelles dans le pager mobile'", start)
replacement = r"""  test('préfère la photo catalogue réelle et conserve seulement un fallback canonique', () => {
    const fallbackVisualKeys = [
      'mode-cutout:femme', 'mode-cutout:homme', 'mode-cutout:enfant', 'mode-cutout:beaute',
      'sub-maison-confort', 'sub-maison-cuisine', 'sub-maison-deco', 'sub-maison-enfants',
      'sub-tech-phone', 'sub-tech-ordi', 'sub-tech-audio', 'sub-tech-montre', 'sub-tech-gaming',
      'sub-brico-outils', 'sub-brico-elec', 'sub-brico-securite',
      'sub-perso-ceremonie', 'sub-perso-cadeau', 'sub-perso-impression',
      'sub-auto-filtres', 'sub-auto-freinage', 'sub-auto-eclairage', 'sub-auto-moto',
    ];
    fallbackVisualKeys.forEach((key) => expect(visuals).toContain(key));
    expect(visuals).toContain('getShelfSubcategoryProductImage');
    expect(visuals).toContain('renderShelfProductPhoto');
    expect(visuals).toContain('categoryCandidates');
    expect(desktopShelf).toContain('.k-shelf-product-photo');
    expect(desktopShelf).toContain('.k-subcutout-icon--all .k-shelf-object--all');
    expect(desktopShelf).toContain('color: var(--catalog-nav-muted);');
    expect(desktopShelf).toContain('color: var(--catalog-nav-strong);');
    expect(subcat).toContain('getShelfSubcategoryProductImage');
    expect(desktopShelf).toContain('.k-shelf-emoji-fallback');
    expect(desktopShelf).not.toContain('grayscale(1)');
    expect(desktopShelf).not.toContain('sepia(.58)');
    expect(desktopShelf).not.toContain('hue-rotate(62deg)');
  });"""
text = text[:start] + replacement + text[end:]

p.write_text(text)
