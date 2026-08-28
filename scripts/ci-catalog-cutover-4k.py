from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH_ANCHOR_MISSING {path}: {old[:160]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) HTML routing — three Legacy catalogue entrypoints converge on the single
# Canonical Catalog Workspace. ?legacy=1 keeps the historical witness available
# without changing backend authority.
html = Path('bootstrap/html-routes.js')
text = html.read_text(encoding='utf-8')
marker = """  // Legacy 1 reste accessible pour toutes les capacités non encore remplacées
  // par un Workspace / Entity 360 / Action Center Canonical.
"""
block = """  // LOT 4K — ProductsView, CategoriesView et CatalogApprovalView sont
  // prouvés absorbés par le Catalog Workspace Canonical. Les anciens pathnames
  // deviennent des points d'entrée de compatibilité ; ?legacy=1 garde Legacy 1.
  const CATALOG_CANONICAL_ENTRYPOINTS = Object.freeze([
    '/admin/products',
    '/admin/categories',
    '/admin/catalog-approval',
  ]);

  CATALOG_CANONICAL_ENTRYPOINTS.forEach(routePath => {
    app.get(routePath, (req, res) => {
      if (req.query && req.query.legacy === '1') return sendLegacyAdmin(res);
      res.redirect(302, '/admin/workspaces/catalog');
    });
  });

"""
if marker not in text:
    raise SystemExit('HTML_CATALOG_CUTOVER_MARKER_MISSING')
text = text.replace(marker, block + marker, 1)

# Remove only from the Legacy route table, never from the newly inserted block.
legacy_start = text.index("  const ADMIN_DASHBOARD_PATHS = [")
legacy_end_marker = "  ];\n\n  ADMIN_DASHBOARD_PATHS.forEach"
legacy_end = text.index(legacy_end_marker, legacy_start) + len("  ];")
legacy_block = text[legacy_start:legacy_end]
for entry in [
    "    '/admin/products',\n",
    "    '/admin/categories',\n",
    "    '/admin/catalog-approval',\n",
]:
    if entry not in legacy_block:
        raise SystemExit(f'HTML_LEGACY_ENTRY_MISSING {entry.strip()}')
    legacy_block = legacy_block.replace(entry, '', 1)
text = text[:legacy_start] + legacy_block + text[legacy_end:]

old_product_comment = """  // LOT 3C — Product 360 Canonical. product_ref est l'identité métier stable ;
  // `/admin/products` reste Legacy 1 jusqu'au Catalogue Workspace Canonical.
"""
new_product_comment = """  // LOT 3C — Product 360 Canonical. product_ref est l'identité métier stable ;
  // LOT 4K fait converger l'index `/admin/products` vers le Catalog Workspace.
"""
if old_product_comment not in text:
    raise SystemExit('HTML_PRODUCT_360_COMMENT_ANCHOR_MISSING')
text = text.replace(old_product_comment, new_product_comment, 1)
html.write_text(text, encoding='utf-8')


# 2) Unit proof — convergence + explicit rollback, while Product 360 keeps its
# dedicated detail pathname and unrelated Legacy routes remain untouched.
test_path = Path('tests/unit/bootstrap-html-routes.test.js')
test = test_path.read_text(encoding='utf-8')
insert_before = """    test('un second chemin admin au hasard sert bien le même index.html (pas de copier-coller cassé)', () => {
"""
new_tests = """    test.each([
      '/admin/products',
      '/admin/categories',
      '/admin/catalog-approval',
    ])('%s converge vers le Catalog Workspace Canonical', (routePath) => {
      const res = fakeRes();
      app._routes[routePath]({ query: {} }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/admin/workspaces/catalog');
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    test.each([
      '/admin/products',
      '/admin/categories',
      '/admin/catalog-approval',
    ])('%s?legacy=1 conserve le rollback Legacy 1', (routePath) => {
      const res = fakeRes();
      app._routes[routePath]({ query: { legacy: '1' } }, res);
      expect(res.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'dashboards', 'admin', 'index.html'),
        expect.any(Function)
      );
      expect(res.redirect).not.toHaveBeenCalled();
    });

""" + insert_before
if insert_before not in test:
    raise SystemExit('TEST_CATALOG_CUTOVER_ANCHOR_MISSING')
test_path.write_text(test.replace(insert_before, new_tests, 1), encoding='utf-8')


# 3) Catalog Workspace contract — record the post-proof entrypoint cutover.
replace_once(
    'docs/contract/CATALOG_WORKSPACE_4C.md',
    """Legacy reste disponible pendant la preuve :

- `/admin/products`
- `/admin/categories`
- `/admin/catalog-approval`

Aucun cutover destructif dans LOT 4C.""",
    """LOT 4K ferme uniquement les anciens **points d’entrée** dont les besoins sont déjà prouvés couverts par 4C :

- `/admin/products` ;
- `/admin/categories` ;
- `/admin/catalog-approval`.

Sans query de rollback, ils redirigent vers `/admin/workspaces/catalog`. `?legacy=1` sert encore Legacy 1 au même pathname pendant la fenêtre de cutover.

`/admin/products/:productRef` reste Product 360 pour l’explication détaillée. Les variantes avancées et l’upload média restent hors de cette bascule conformément au périmètre 4C."""
)


# 4) Global dashboard cutover contract — add the catalogue convergence and stop
# advertising "Catalogue" as an unreconstructed surface.
cutover = Path('docs/contract/DASHBOARD_CUTOVER_2.md')
cut = cutover.read_text(encoding='utf-8')
marker = "## Migration additive\n\n"
section = """## Extension LOT 4K — convergence Catalogue

Les trois besoins historiques explicitement absorbés par le Catalog Workspace ne conservent plus trois runtimes produit distincts :

| Ancien point d’entrée | Destination Canonical |
|---|---|
| `/admin/products` | `/admin/workspaces/catalog` |
| `/admin/categories` | `/admin/workspaces/catalog` |
| `/admin/catalog-approval` | `/admin/workspaces/catalog` |

Chaque ancien pathname accepte encore `?legacy=1` pour servir Legacy 1 pendant la fenêtre de rollback. Cette query ne modifie aucune autorité backend.

Le détail produit reste `/admin/products/:productRef` → Product 360 Canonical.

## Migration additive

"""
if marker not in cut:
    raise SystemExit('CUTOVER_DOC_MARKER_MISSING')
cut = cut.replace(marker, section, 1)
if '- Catalogue\n' not in cut:
    raise SystemExit('CUTOVER_CATALOG_LEGACY_BULLET_MISSING')
cut = cut.replace('- Catalogue\n', '', 1)
cutover.write_text(cut, encoding='utf-8')


# 5) Canonical README — expose reduction, not a new surface.
readme = Path('public/dashboards/canonical/README.md')
r = readme.read_text(encoding='utf-8')
anchor = """LOT 4J réduit aussi quatre anciens points d’entrée Pricing à une seule surface :
`/admin/pricing`, `/admin/pricing-workshop`, `/admin/pricing-strategy` et `/admin/economic-flow`
redirigent vers `/admin/workspaces/pricing`. `?legacy=1` conserve temporairement le témoin Legacy 1.

"""
addition = anchor + """LOT 4K réduit de même trois anciens points d’entrée Catalogue :
`/admin/products`, `/admin/categories` et `/admin/catalog-approval`
redirigent vers `/admin/workspaces/catalog`. `?legacy=1` conserve temporairement le témoin Legacy 1 ; `/admin/products/:productRef` reste Product 360.

"""
if anchor not in r:
    raise SystemExit('README_CATALOG_CUTOVER_ANCHOR_MISSING')
readme.write_text(r.replace(anchor, addition, 1), encoding='utf-8')


# 6) Dedicated cutover contract.
Path('docs/contract/CATALOG_CUTOVER_4K.md').write_text('''# LOT 4K — Catalog entrypoint cutover

## But

Réduire trois anciennes pages Catalogue déjà absorbées par le Workspace 4C à **une seule surface Canonical**, sans nouveau dashboard ni nouvelle logique métier.

## Convergence

- `/admin/products` → `/admin/workspaces/catalog`
- `/admin/categories` → `/admin/workspaces/catalog`
- `/admin/catalog-approval` → `/admin/workspaces/catalog`

La redirection est HTTP 302 pendant la fenêtre de cutover. Sur chacun de ces pathnames, `?legacy=1` sert encore `public/dashboards/admin/index.html`.

## Invariants

- aucune API catalogue modifiée ;
- aucune autorité produit, taxonomie ou approbation modifiée ;
- aucun calcul ou règle de publication déplacé dans le navigateur ;
- aucun catalogue par marché inventé ;
- aucun import Legacy dans `canonical/**` ;
- `/admin/products/:productRef` reste Product 360 ;
- variantes avancées et upload média restent hors périmètre ;
- RESET n’est pas touché.

## Preuve

Le bootstrap doit prouver les trois redirections et les trois rollbacks `?legacy=1`. Les tests du Catalog Workspace, de son autorité globale et les gates Backend/Governance doivent rester verts.
''', encoding='utf-8')

print('CATALOG_CUTOVER_4K_APPLIED')
