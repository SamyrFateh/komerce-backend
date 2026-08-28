from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH_ANCHOR_MISSING {path}: {old[:180]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) HTML routing: four historical pricing entrypoints converge on the single
# Canonical Pricing Workspace. ?legacy=1 remains an explicit rollback and does
# not grant any additional authority.
html = Path('bootstrap/html-routes.js')
text = html.read_text(encoding='utf-8')
anchor = """  // Legacy 1 reste accessible pour toutes les capacités non encore remplacées
  // par un Workspace / Entity 360 / Action Center Canonical.
  const ADMIN_DASHBOARD_PATHS = [
"""
replacement = """  // LOT 4J — les besoins de PricingView, PricingWorkshopView,
  // PricingStrategyView et EconomicFlowView sont prouvés absorbés par le seul
  // Pricing Workspace Canonical. Les anciens pathnames deviennent donc des
  // points d'entrée de compatibilité ; ?legacy=1 conserve le témoin Legacy 1.
  const PRICING_CANONICAL_ENTRYPOINTS = Object.freeze([
    '/admin/pricing',
    '/admin/pricing-workshop',
    '/admin/pricing-strategy',
    '/admin/economic-flow',
  ]);

  PRICING_CANONICAL_ENTRYPOINTS.forEach(routePath => {
    app.get(routePath, (req, res) => {
      if (req.query && req.query.legacy === '1') return sendLegacyAdmin(res);
      res.redirect(302, '/admin/workspaces/pricing');
    });
  });

  // Legacy 1 reste accessible pour toutes les capacités non encore remplacées
  // par un Workspace / Entity 360 / Action Center Canonical.
  const ADMIN_DASHBOARD_PATHS = [
"""
if anchor not in text:
    raise SystemExit('HTML_PRICING_CUTOVER_ANCHOR_MISSING')
text = text.replace(anchor, replacement, 1)
for entry in [
    "    '/admin/pricing',\n",
    "    '/admin/pricing-workshop',\n",
    "    '/admin/pricing-strategy',\n",
    "    '/admin/economic-flow',\n",
]:
    if entry not in text:
        raise SystemExit(f'HTML_LEGACY_ENTRY_MISSING {entry.strip()}')
    text = text.replace(entry, '', 1)
html.write_text(text, encoding='utf-8')

# 2) Unit proof: convergence + rollback, while simulator stays Legacy.
test_path = Path('tests/unit/bootstrap-html-routes.test.js')
test = test_path.read_text(encoding='utf-8')
insert_before = """    test('un second chemin admin au hasard sert bien le même index.html (pas de copier-coller cassé)', () => {
"""
new_tests = """    test.each([
      '/admin/pricing',
      '/admin/pricing-workshop',
      '/admin/pricing-strategy',
      '/admin/economic-flow',
    ])('%s converge vers le Pricing Workspace Canonical', (routePath) => {
      const res = fakeRes();
      app._routes[routePath]({ query: {} }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/admin/workspaces/pricing');
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    test.each([
      '/admin/pricing',
      '/admin/pricing-workshop',
      '/admin/pricing-strategy',
      '/admin/economic-flow',
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
    raise SystemExit('TEST_PRICING_CUTOVER_ANCHOR_MISSING')
test_path.write_text(test.replace(insert_before, new_tests, 1), encoding='utf-8')

# 3) Pricing contract becomes explicit about the post-proof entrypoint cutover.
replace_once(
    'docs/contract/PRICING_WORKSPACE_4F.md',
    'Les vues Legacy restent disponibles pendant la preuve. Aucun cutover destructif dans LOT 4F.',
    '''LOT 4J ferme uniquement les anciens **points d’entrée** déjà prouvés couverts par 4F :\n\n- `/admin/pricing` ;\n- `/admin/pricing-workshop` ;\n- `/admin/pricing-strategy` ;\n- `/admin/economic-flow`.\n\nSans query de rollback, ils redirigent vers `/admin/workspaces/pricing`. `?legacy=1` sert encore Legacy 1 au même pathname pendant la fenêtre de cutover. `CostingView`, `EconomicView`, `SettingsView` et `SimulatorView` restent hors de cette bascule tant que leur absorption n’est pas prouvée.'''
)

# 4) Cutover contract records the additive post-cutover convergence.
cutover = Path('docs/contract/DASHBOARD_CUTOVER_2.md')
cut = cutover.read_text(encoding='utf-8')
marker = """## Migration additive

"""
section = """## Extension LOT 4J — convergence Pricing

Les quatre besoins historiques explicitement absorbés par le Pricing Workspace ne conservent plus quatre runtimes produit distincts :

| Ancien point d’entrée | Destination Canonical |
|---|---|
| `/admin/pricing` | `/admin/workspaces/pricing` |
| `/admin/pricing-workshop` | `/admin/workspaces/pricing` |
| `/admin/pricing-strategy` | `/admin/workspaces/pricing` |
| `/admin/economic-flow` | `/admin/workspaces/pricing` |

Chaque ancien pathname accepte encore `?legacy=1` pour servir Legacy 1 pendant la fenêtre de rollback. Cette query ne modifie aucune autorité backend.

`/admin/costing`, `/admin/economic`, `/admin/settings` et `/admin/simulator` ne font pas partie de LOT 4J.

## Migration additive

"""
if marker not in cut:
    raise SystemExit('CUTOVER_DOC_ANCHOR_MISSING')
cut = cut.replace(marker, section, 1)
cut = cut.replace('- Pricing\n', '', 1)
cutover.write_text(cut, encoding='utf-8')

# 5) Runtime README advertises the compatibility convergence, not extra surfaces.
readme = Path('public/dashboards/canonical/README.md')
r = readme.read_text(encoding='utf-8')
readme_anchor = """- `/admin/demo` → cockpit commande staging.

"""
readme_replacement = """- `/admin/demo` → cockpit commande staging.

LOT 4J réduit aussi quatre anciens points d’entrée Pricing à une seule surface :
`/admin/pricing`, `/admin/pricing-workshop`, `/admin/pricing-strategy` et `/admin/economic-flow`
redirigent vers `/admin/workspaces/pricing`. `?legacy=1` conserve temporairement le témoin Legacy 1.

"""
if readme_anchor not in r:
    raise SystemExit('README_PRICING_CUTOVER_ANCHOR_MISSING')
readme.write_text(r.replace(readme_anchor, readme_replacement, 1), encoding='utf-8')

# 6) Dedicated cutover note: route-only, zero business/runtime ownership change.
Path('docs/contract/PRICING_CUTOVER_4J.md').write_text('''# LOT 4J — Pricing entrypoint cutover\n\n## But\n\nRéduire quatre anciennes pages Pricing déjà absorbées par le Workspace 4F à **une seule surface Canonical**, sans nouveau dashboard ni nouvelle logique métier.\n\n## Convergence\n\n- `/admin/pricing` → `/admin/workspaces/pricing`\n- `/admin/pricing-workshop` → `/admin/workspaces/pricing`\n- `/admin/pricing-strategy` → `/admin/workspaces/pricing`\n- `/admin/economic-flow` → `/admin/workspaces/pricing`\n\nLa redirection est HTTP 302 pendant la fenêtre de cutover. Sur chacun de ces pathnames, `?legacy=1` sert encore `public/dashboards/admin/index.html`.\n\n## Invariants\n\n- aucune API Pricing modifiée ;\n- aucune autorité de prix/coût/stratégie modifiée ;\n- aucun calcul déplacé dans le navigateur ;\n- aucun MarketScope ajouté au Pricing global ;\n- aucun import Legacy dans `canonical/**` ;\n- `SimulatorView` reste hors Pricing ;\n- RESET n’est pas touché.\n\n## Hors périmètre\n\n`/admin/costing`, `/admin/economic`, `/admin/settings`, `/admin/simulator` et les vues non explicitement absorbées par 4F restent inchangées.\n\n## Preuve\n\nLe test de bootstrap doit prouver les quatre redirections et les quatre rollbacks `?legacy=1`. Les tests du Pricing Workspace et les gates Backend/Governance doivent rester verts.\n''', encoding='utf-8')

print('PRICING_CUTOVER_4J_APPLIED')
