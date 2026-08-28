from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH_ANCHOR_MISSING {path}: {old[:180]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) HTML routing — only the two Sourcing-specific Legacy entrypoints converge.
# /admin/suppliers deliberately stays Legacy because SuppliersView covers
# partner families that the Sourcing Workspace does not own.
html = Path('bootstrap/html-routes.js')
text = html.read_text(encoding='utf-8')
marker = """  // Legacy 1 reste accessible pour toutes les capacités non encore remplacées
  // par un Workspace / Entity 360 / Action Center Canonical.
"""
block = """  // LOT 4L — SourcingView et SourcingScannerView sont prouvés absorbés
  // par le Sourcing Workspace Canonical. SuppliersView reste Legacy car il
  // administre aussi des familles de partenaires hors partner_type=sourcing.
  const SOURCING_CANONICAL_ENTRYPOINTS = Object.freeze([
    '/admin/sourcing',
    '/admin/sourcing-scanner',
  ]);

  SOURCING_CANONICAL_ENTRYPOINTS.forEach(routePath => {
    app.get(routePath, (req, res) => {
      if (req.query && req.query.legacy === '1') return sendLegacyAdmin(res);
      res.redirect(302, '/admin/workspaces/sourcing');
    });
  });

"""
if marker not in text:
    raise SystemExit('HTML_SOURCING_CUTOVER_MARKER_MISSING')
text = text.replace(marker, block + marker, 1)

legacy_start = text.index("  const ADMIN_DASHBOARD_PATHS = [")
legacy_end_marker = "  ];\n\n  ADMIN_DASHBOARD_PATHS.forEach"
legacy_end = text.index(legacy_end_marker, legacy_start) + len("  ];")
legacy_block = text[legacy_start:legacy_end]
for entry in [
    "    '/admin/sourcing',\n",
    "    '/admin/sourcing-scanner',\n",
]:
    if entry not in legacy_block:
        raise SystemExit(f'HTML_LEGACY_ENTRY_MISSING {entry.strip()}')
    legacy_block = legacy_block.replace(entry, '', 1)
if "    '/admin/suppliers',\n" not in legacy_block:
    raise SystemExit('HTML_SUPPLIERS_MUST_REMAIN_LEGACY')
text = text[:legacy_start] + legacy_block + text[legacy_end:]
html.write_text(text, encoding='utf-8')


# 2) Bootstrap proof — two redirects + two explicit rollbacks + suppliers guard.
test_path = Path('tests/unit/bootstrap-html-routes.test.js')
test = test_path.read_text(encoding='utf-8')
insert_before = """    test('un second chemin admin au hasard sert bien le même index.html (pas de copier-coller cassé)', () => {
"""
new_tests = """    test.each([
      '/admin/sourcing',
      '/admin/sourcing-scanner',
    ])('%s converge vers le Sourcing Workspace Canonical', (routePath) => {
      const res = fakeRes();
      app._routes[routePath]({ query: {} }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/admin/workspaces/sourcing');
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    test.each([
      '/admin/sourcing',
      '/admin/sourcing-scanner',
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

    test('/admin/suppliers reste Legacy 1 : la vue couvre des partenaires hors sourcing', () => {
      const res = fakeRes();
      app._routes['/admin/suppliers']({ query: {} }, res);
      expect(res.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'dashboards', 'admin', 'index.html'),
        expect.any(Function)
      );
      expect(res.redirect).not.toHaveBeenCalled();
    });

""" + insert_before
if insert_before not in test:
    raise SystemExit('TEST_SOURCING_CUTOVER_ANCHOR_MISSING')
test_path.write_text(test.replace(insert_before, new_tests, 1), encoding='utf-8')


# 3) Sourcing contract — close only the two fully absorbed entrypoints and keep
# the multi-family Suppliers surface as an explicit Legacy exception.
replace_once(
    'docs/contract/SOURCING_WORKSPACE_4E.md',
    """Legacy reste disponible pendant la preuve :

- `/admin/sourcing`
- `/admin/sourcing-scanner`
- `/admin/suppliers`

Aucun cutover destructif dans LOT 4E.""",
    """LOT 4L ferme uniquement les deux anciens **points d’entrée Sourcing** dont les besoins sont prouvés couverts par 4E :

- `/admin/sourcing` ;
- `/admin/sourcing-scanner`.

Sans query de rollback, ils redirigent vers `/admin/workspaces/sourcing`. `?legacy=1` sert encore Legacy 1 au même pathname pendant la fenêtre de cutover.

`/admin/suppliers` reste volontairement Legacy : `SuppliersView` administre plusieurs familles de partenaires, alors que le Sourcing Workspace ne possède que `partner_type = sourcing`. Transitaires, relais, partenaires personnalisés et équipes Hub ne doivent pas disparaître par une redirection trop large."""
)


# 4) Global cutover contract — record Sourcing convergence while preserving the
# unresolved multi-family partner surface.
cutover = Path('docs/contract/DASHBOARD_CUTOVER_2.md')
cut = cutover.read_text(encoding='utf-8')
marker = "## Migration additive\n\n"
section = """## Extension LOT 4L — convergence Sourcing

Les deux points d’entrée strictement Sourcing ne conservent plus deux runtimes produit distincts :

| Ancien point d’entrée | Destination Canonical |
|---|---|
| `/admin/sourcing` | `/admin/workspaces/sourcing` |
| `/admin/sourcing-scanner` | `/admin/workspaces/sourcing` |

Chaque ancien pathname accepte encore `?legacy=1` pour servir Legacy 1 pendant la fenêtre de rollback. Cette query ne modifie aucune autorité backend.

`/admin/suppliers` reste Legacy : la vue historique couvre des familles de partenaires au-delà du seul `partner_type = sourcing` possédé par le Workspace 4E.

## Migration additive

"""
if marker not in cut:
    raise SystemExit('CUTOVER_DOC_MARKER_MISSING')
cut = cut.replace(marker, section, 1)
if '- Sourcing\n' not in cut:
    raise SystemExit('CUTOVER_SOURCING_LEGACY_BULLET_MISSING')
cut = cut.replace('- Sourcing\n', '- Partenaires multi-familles / Suppliers\n', 1)
cutover.write_text(cut, encoding='utf-8')


# 5) Canonical README — reduction without inventing a new surface.
readme = Path('public/dashboards/canonical/README.md')
r = readme.read_text(encoding='utf-8')
anchor = """LOT 4K réduit de même trois anciens points d’entrée Catalogue :
`/admin/products`, `/admin/categories` et `/admin/catalog-approval`
redirigent vers `/admin/workspaces/catalog`. `?legacy=1` conserve temporairement le témoin Legacy 1 ; `/admin/products/:productRef` reste Product 360.

"""
addition = anchor + """LOT 4L réduit les deux anciens points d’entrée strictement Sourcing :
`/admin/sourcing` et `/admin/sourcing-scanner` redirigent vers `/admin/workspaces/sourcing`.
`?legacy=1` conserve temporairement le témoin Legacy 1. `/admin/suppliers` reste Legacy car il couvre aussi des familles de partenaires hors sourcing.

"""
if anchor not in r:
    raise SystemExit('README_SOURCING_CUTOVER_ANCHOR_MISSING')
readme.write_text(r.replace(anchor, addition, 1), encoding='utf-8')


# 6) Dedicated cutover contract.
Path('docs/contract/SOURCING_CUTOVER_4L.md').write_text('''# LOT 4L — Sourcing entrypoint cutover

## But

Réduire les deux anciennes pages strictement Sourcing déjà absorbées par le Workspace 4E à **une seule surface Canonical**, sans masquer les capacités partenaires qui ne lui appartiennent pas.

## Convergence

- `/admin/sourcing` → `/admin/workspaces/sourcing`
- `/admin/sourcing-scanner` → `/admin/workspaces/sourcing`

La redirection est HTTP 302 pendant la fenêtre de cutover. Sur chacun de ces pathnames, `?legacy=1` sert encore `public/dashboards/admin/index.html`.

## Exception volontaire — Suppliers

`/admin/suppliers` reste Legacy. `SuppliersView` historique administre plusieurs familles de partenaires ; le Workspace 4E ne possède volontairement que `partner_type = sourcing`.

Le cutover ne doit donc ni masquer ni réattribuer :
- transitaires ;
- relais ;
- partenaires personnalisés ;
- équipes Hub.

## Invariants

- aucune API Sourcing modifiée ;
- aucun lifecycle `sourcing_candidates` modifié ;
- le moteur margin/rail homonyme reste `economic-engine` ;
- aucune fusion d’ownership `sourcing` / `economic-engine` / `catalog` ;
- aucune autorité marché inventée : le sourcing reste global sous `sourcing_global_access_grants` ;
- aucun UUID interne exposé par le navigateur Canonical ;
- Product 360 reste le drill-down produit ;
- RESET n’est pas touché.

## Preuve

Le bootstrap doit prouver les deux redirections, les deux rollbacks `?legacy=1` et le maintien de `/admin/suppliers` en Legacy 1. Les tests du Workspace, du lifecycle candidat, du moteur margin/rail réutilisé et du grant global doivent rester verts, ainsi que les gates Backend/Governance.
''', encoding='utf-8')

print('SOURCING_CUTOVER_4L_APPLIED')
