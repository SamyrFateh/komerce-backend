from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH_ANCHOR_MISSING {path}: {old[:180]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) HTML routing — AlertsView and ProblemsView converge on the single
# Canonical Action Center. ?legacy=1 keeps each historical witness available.
html = Path('bootstrap/html-routes.js')
text = html.read_text(encoding='utf-8')
marker = """  // Legacy 1 reste accessible pour toutes les capacités non encore remplacées
  // par un Workspace / Entity 360 / Action Center Canonical.
"""
block = """  // LOT 4N — AlertsView est remplacée par l'Action Center 4G et la
  // vérité utile de ProblemsView a été auditée/absorbée par 4H. Aucun moteur
  // Problems parallèle n'est recréé ; ?legacy=1 garde les témoins historiques.
  const ACTION_CENTER_CANONICAL_ENTRYPOINTS = Object.freeze([
    '/admin/alerts',
    '/admin/problems',
  ]);

  ACTION_CENTER_CANONICAL_ENTRYPOINTS.forEach(routePath => {
    app.get(routePath, (req, res) => {
      if (req.query && req.query.legacy === '1') return sendLegacyAdmin(res);
      res.redirect(302, '/admin/action-center');
    });
  });

"""
if marker not in text:
    raise SystemExit('HTML_ACTION_CENTER_CUTOVER_MARKER_MISSING')
text = text.replace(marker, block + marker, 1)

legacy_start = text.index("  const ADMIN_DASHBOARD_PATHS = [")
legacy_end_marker = "  ];\n\n  ADMIN_DASHBOARD_PATHS.forEach"
legacy_end = text.index(legacy_end_marker, legacy_start) + len("  ];")
legacy_block = text[legacy_start:legacy_end]
for entry in [
    "    '/admin/alerts',\n",
    "    '/admin/problems',\n",
]:
    if entry not in legacy_block:
        raise SystemExit(f'HTML_LEGACY_ENTRY_MISSING {entry.strip()}')
    legacy_block = legacy_block.replace(entry, '', 1)
text = text[:legacy_start] + legacy_block + text[legacy_end:]
html.write_text(text, encoding='utf-8')


# 2) Bootstrap proof — two redirects and two explicit rollbacks.
test_path = Path('tests/unit/bootstrap-html-routes.test.js')
test = test_path.read_text(encoding='utf-8')
insert_before = """    test('un second chemin admin au hasard sert bien le même index.html (pas de copier-coller cassé)', () => {
"""
new_tests = """    test.each([
      '/admin/alerts',
      '/admin/problems',
    ])('%s converge vers l’Action Center Canonical', (routePath) => {
      const res = fakeRes();
      app._routes[routePath]({ query: {} }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/admin/action-center');
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    test.each([
      '/admin/alerts',
      '/admin/problems',
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
    raise SystemExit('TEST_ACTION_CENTER_CUTOVER_ANCHOR_MISSING')
test_path.write_text(test.replace(insert_before, new_tests, 1), encoding='utf-8')


# 3) Dedicated Action Center boundary witness — stable route + both historical
# entrypoints now converge, while legacy rollback remains explicit.
boundary_path = Path('tests/unit/canonical-action-center-boundary.test.js')
boundary = boundary_path.read_text(encoding='utf-8')
old_boundary = """test('stable Action Center route is Canonical while /admin/alerts remains Legacy during proof', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const canonicalRes = fakeRes();
  app._routes['/admin/action-center']({}, canonicalRes);
  expect(canonicalRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
  expect(canonicalRes.sendFile).toHaveBeenCalledWith(path.join(CANONICAL, 'index.html'), expect.any(Function));

  const legacyRes = fakeRes();
  app._routes['/admin/alerts']({}, legacyRes);
  expect(legacyRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
});
"""
new_boundary = """test('stable Action Center et anciens points d’entrée Alerts/Problems convergent avec rollback Legacy', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const canonicalRes = fakeRes();
  app._routes['/admin/action-center']({}, canonicalRes);
  expect(canonicalRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
  expect(canonicalRes.sendFile).toHaveBeenCalledWith(path.join(CANONICAL, 'index.html'), expect.any(Function));

  for (const routePath of ['/admin/alerts', '/admin/problems']) {
    const cutoverRes = fakeRes();
    app._routes[routePath]({ query: {} }, cutoverRes);
    expect(cutoverRes.redirect).toHaveBeenCalledWith(302, '/admin/action-center');
    expect(cutoverRes.sendFile).not.toHaveBeenCalled();

    const legacyRes = fakeRes();
    app._routes[routePath]({ query: { legacy: '1' } }, legacyRes);
    expect(legacyRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
    expect(legacyRes.sendFile).toHaveBeenCalledWith(
      path.join(ROOT, 'public', 'dashboards', 'admin', 'index.html'),
      expect.any(Function)
    );
  }
});
"""
if old_boundary not in boundary:
    raise SystemExit('ACTION_CENTER_BOUNDARY_WITNESS_ANCHOR_MISSING')
boundary_path.write_text(boundary.replace(old_boundary, new_boundary, 1), encoding='utf-8')


# 4) Action Center contract — record post-proof Alerts cutover.
replace_once(
    'docs/contract/ACTION_CENTER_4G.md',
    """## Legacy

`/admin/alerts` et `/api/admin/signals` restent disponibles pendant la preuve.

Le refactor du routeur Legacy corrige également son bug d’erreur historique : les handlers déclarent désormais `next`, donc une erreur DB atteint bien le middleware d’erreur au lieu de laisser la requête pendante.""",
    """## Legacy / cutover 4N

LOT 4N ferme le point d’entrée UI `/admin/alerts` après preuve : sans query de rollback, il redirige vers `/admin/action-center`. `/admin/alerts?legacy=1` sert encore Legacy 1 pendant la fenêtre de rollback.

L’API historique `/api/admin/signals` reste disponible pour les consommateurs Legacy ; le cutover 4N est un changement de surface UI, pas une suppression d’API.

Le refactor du routeur Legacy corrige également son bug d’erreur historique : les handlers déclarent désormais `next`, donc une erreur DB atteint bien le middleware d’erreur au lieu de laisser la requête pendante."""
)


# 5) Problems truth contract — close the route only after the truth audit. Rules
# rejected by 4H stay rejected and are not resurrected for visual parity.
replace_once(
    'docs/contract/DECISION_SIGNALS_TRUTH_4H.md',
    """## Frontière 4H

4H ne :

- crée aucune nouvelle table ;
- modifie aucune commande, PO, notification ou donnée de paiement ;
- n'ajoute aucune mutation métier à l'Action Center ;
- ne fabrique pas de scope marché sur `signals` ;
- ne supprime pas encore la route Legacy `/admin/problems` avant preuve de couverture.""",
    """## Frontière 4H / cutover 4N

4H ne :

- crée aucune nouvelle table ;
- modifie aucune commande, PO, notification ou donnée de paiement ;
- n'ajoute aucune mutation métier à l'Action Center ;
- ne fabrique pas de scope marché sur `signals`.

Après la preuve 4H, LOT 4N ferme le point d’entrée produit `/admin/problems` : il redirige vers `/admin/action-center`, avec `/admin/problems?legacy=1` comme témoin de rollback. Les règles Legacy rejetées par 4H (`double_payment`, `no_hub_scan`, etc.) ne sont pas réintroduites : leur absence est une correction de vérité, pas une perte de couverture canonique."""
)


# 6) Global cutover contract.
cutover = Path('docs/contract/DASHBOARD_CUTOVER_2.md')
cut = cutover.read_text(encoding='utf-8')
marker = "## Migration additive\n\n"
section = """## Extension LOT 4N — convergence Action Center

Les deux anciennes surfaces de constats ne conservent plus deux runtimes produit parallèles :

| Ancien point d’entrée | Destination Canonical |
|---|---|
| `/admin/alerts` | `/admin/action-center` |
| `/admin/problems` | `/admin/action-center` |

Chaque ancien pathname accepte encore `?legacy=1` pour servir Legacy 1 pendant la fenêtre de rollback. Cette query ne modifie aucune autorité backend.

`ProblemsView` n’est pas recopié : LOT 4H a audité ses règles une par une. Les prédicats faux ou non prouvables restent volontairement absents du moteur `decision-signals`.

## Migration additive

"""
if marker not in cut:
    raise SystemExit('CUTOVER_DOC_MARKER_MISSING')
cut = cut.replace(marker, section, 1)
if '- Action Center\n' not in cut:
    raise SystemExit('CUTOVER_ACTION_CENTER_LEGACY_BULLET_MISSING')
cut = cut.replace('- Action Center\n', '', 1)
cutover.write_text(cut, encoding='utf-8')


# 7) Canonical README.
readme = Path('public/dashboards/canonical/README.md')
r = readme.read_text(encoding='utf-8')
anchor = """LOT 4L réduit les deux anciens points d’entrée strictement Sourcing :
`/admin/sourcing` et `/admin/sourcing-scanner` redirigent vers `/admin/workspaces/sourcing`.
`?legacy=1` conserve temporairement le témoin Legacy 1. `/admin/suppliers` reste Legacy car il couvre aussi des familles de partenaires hors sourcing.

"""
addition = anchor + """LOT 4N réduit les deux anciennes surfaces de constats :
`/admin/alerts` et `/admin/problems` redirigent vers `/admin/action-center`.
`?legacy=1` conserve temporairement les témoins Legacy ; aucun moteur Problems parallèle n’est recréé.

"""
if anchor not in r:
    raise SystemExit('README_ACTION_CENTER_CUTOVER_ANCHOR_MISSING')
readme.write_text(r.replace(anchor, addition, 1), encoding='utf-8')


# 8) Dedicated cutover contract.
Path('docs/contract/ACTION_CENTER_CUTOVER_4N.md').write_text('''# LOT 4N — Action Center entrypoint cutover

## But

Réduire les deux anciennes surfaces de constats (`AlertsView`, `ProblemsView`) à **un seul Action Center Canonical**, sans recréer un second moteur d’anomalies.

## Convergence

- `/admin/alerts` → `/admin/action-center`
- `/admin/problems` → `/admin/action-center`

La redirection est HTTP 302 pendant la fenêtre de cutover. Sur chacun de ces pathnames, `?legacy=1` sert encore `public/dashboards/admin/index.html`.

## Vérité Problems

LOT 4H a audité les 10 règles de `ProblemsView` :
- règles prouvables réécrites dans `decision-signals` ;
- règles déjà couvertes non dupliquées ;
- règles non canoniques rejetées ;
- générateurs historiques trompeurs retirés.

Le cutover 4N ne réintroduit donc aucune règle rejetée pour obtenir une parité visuelle artificielle.

## Invariants

- aucune mutation de commande/colis/produit/cash depuis Action Center ;
- lifecycle limité aux signaux (`acknowledge`, `snooze`, `resolve`) ;
- aucun `market_id` inventé tant que `signals` n’en possède pas ;
- `signal_ref` reste l’identité navigateur ;
- drill-down résolu serveur vers références métier publiques ;
- API Legacy `/api/admin/signals` non supprimée par ce lot ;
- RESET n’est pas touché.

## Preuve

Le bootstrap et le témoin Action Center doivent prouver les deux redirections et les deux rollbacks. Les tests `decision-signals`, Action Center et signal-service doivent rester verts, ainsi que les gates Backend/Governance et Security360.
''', encoding='utf-8')

print('ACTION_CENTER_CUTOVER_4N_APPLIED')
