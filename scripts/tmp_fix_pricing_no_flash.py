from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1))


app = 'public/dashboards/canonical/js/app.js'
replace_once(app,
"""    const selector = mountMarketSelector({
      document: global.document,
      container: root,
      adminContext,
      contextContract: global.KomerceAdminContext,
      title: options.title,
      requireMarket: Boolean(options.requireMarket),
      onChange: requestedMarket => options.render(surface, user, adminContext, requestedMarket),
    });

    root.appendChild(surface);
    return options.render(surface, user, adminContext, selector.initialMarket);
""",
"""    const renderCurrent = requestedMarket => options.render(surface, user, adminContext, requestedMarket);
    const renderAtomically = async requestedMarket => {
      // Pricing garde l'Atelier courant visible pendant que le marché suivant
      // se construit hors DOM. Le swap n'arrive qu'après un rendu réussi :
      // aucun flash du workspace historique, aucun écran blanc en cas d'échec.
      const stage = global.document.createElement('div');
      stage.className = 'kmc-market-surface-stage';
      stage.dataset.marketSurfaceStage = '';
      await options.render(stage, user, adminContext, requestedMarket);
      surface.replaceChildren(stage);
      return stage;
    };

    const selector = mountMarketSelector({
      document: global.document,
      container: root,
      adminContext,
      contextContract: global.KomerceAdminContext,
      title: options.title,
      requireMarket: Boolean(options.requireMarket),
      onChange: requestedMarket => options.atomicSwap
        ? renderAtomically(requestedMarket)
        : renderCurrent(requestedMarket),
    });

    root.appendChild(surface);
    return renderCurrent(selector.initialMarket);
""")
replace_once(app,
"""      title: 'Workspace Pricing / Atelier des coûts',
      requireMarket: true,
      render: renderPricingWorkspace,
""",
"""      title: 'Workspace Pricing / Atelier des coûts',
      requireMarket: true,
      atomicSwap: true,
      render: renderPricingWorkspace,
""")

cockpit = 'public/dashboards/canonical/js/pricing-economic-cockpit.js'
replace_once(cockpit,
"""  function fixedMutualizedCard(doc, structure, marketLabel, isAdmin) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-mutualized');
    card.dataset.costSummary = 'fixed-mutualized';
    card.appendChild(costCardHeader(doc, '🔗', 'Charges fixes mutualisées', 'Charges fixes partagées entre marchés.', 'Gérer les mutualisations', 'fixed-mutualized',
      isAdmin ? null : 'Réservé à l’administration — un ajustement mutualisé affecte tous les marchés à la fois.'));
""",
"""  function fixedMutualizedCard(doc, structure, marketLabel) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-mutualized is-readonly');
    card.dataset.costSummary = 'fixed-mutualized';
    card.dataset.readOnly = 'true';
    card.setAttribute('aria-label', 'Charges fixes mutualisées · lecture seule');
    card.appendChild(costCardHeader(doc, '🔗', 'Charges fixes mutualisées', 'Charges fixes partagées entre marchés.'));
""")
replace_once(cockpit,
"""    const isAdmin = (user && user.role) === 'admin';
    const marketLabel = payload.scope?.market_name || marketCode;
    const section = el(doc, 'section', 'kmc-cockpit-costs');
    section.appendChild(variableCostCard(doc, groups.variable));
    section.appendChild(fixedDirectCard(doc, structure));
    section.appendChild(fixedMutualizedCard(doc, structure, marketLabel, isAdmin));
""",
"""    const marketLabel = payload.scope?.market_name || marketCode;
    const section = el(doc, 'section', 'kmc-cockpit-costs');
    section.appendChild(variableCostCard(doc, groups.variable));
    section.appendChild(fixedDirectCard(doc, structure));
    section.appendChild(fixedMutualizedCard(doc, structure, marketLabel));
""")
replace_once(cockpit,
"""        if (detailKey === 'fixed-direct' || detailKey === 'fixed-mutualized') {
          await openStructureEventForm(rootObject, doc, workspace, options, detailKey);
          return;
        }
""",
"""        if (detailKey === 'fixed-direct') {
          await openStructureEventForm(rootObject, doc, workspace, options, detailKey);
          return;
        }
""")

css = 'public/dashboards/canonical/css/pricing-economic-cockpit.css'
p = Path(css)
s = p.read_text()
old = ".kmc-cockpit-cost-card.is-fixed-mutualized { --cockpit-accent: #2478e8; --cockpit-soft: #eef5ff; }"
new = """.kmc-cockpit-cost-card.is-fixed-mutualized {
  --cockpit-accent: #94a3b8;
  --cockpit-soft: #f1f5f9;
  background: #f8fafc;
  border-color: #e2e8f0;
}
.kmc-cockpit-cost-card.is-fixed-mutualized .kmc-cockpit-cost-identity strong,
.kmc-cockpit-cost-card.is-fixed-mutualized .kmc-cockpit-cost-identity small,
.kmc-cockpit-cost-card.is-fixed-mutualized .kmc-cockpit-cell {
  color: #64748b;
}
.kmc-cockpit-cost-card.is-fixed-mutualized .kmc-cockpit-cell.is-head,
.kmc-cockpit-cost-card.is-fixed-mutualized .kmc-cockpit-cost-total-row {
  background: #f1f5f9;
}
.kmc-market-surface-stage { display: contents; }"""
if old not in s:
    raise SystemExit('mutualized CSS pattern not found')
p.write_text(s.replace(old, new, 1))

index = 'public/dashboards/canonical/index.html'
p = Path(index)
s = p.read_text()
s = s.replace('pricing-economic-cockpit.css?v=1403', 'pricing-economic-cockpit.css?v=1404')
s = s.replace('pricing-economic-cockpit.js?v=1404', 'pricing-economic-cockpit.js?v=1405')
s = s.replace('app.js?v=1502', 'app.js?v=1503')
p.write_text(s)

test = 'tests/unit/canonical-pricing-economic-cockpit.test.js'
p = Path(test)
s = p.read_text()
s = s.replace('pricing-economic-cockpit.js?v=1404', 'pricing-economic-cockpit.js?v=1405')
s = s.replace('pricing-economic-cockpit.css?v=1403', 'pricing-economic-cockpit.css?v=1404')
old_block = """  // Les charges structurelles utilisent leur panneau événementiel séparé.
  expect(source).toContain(\"detailKey === 'fixed-direct' || detailKey === 'fixed-mutualized'\");
  expect(source).toContain('await openStructureEventForm(rootObject, doc, workspace, options, detailKey)');

  // Gérer les mutualisations (GROUP) est admin only côté serveur — le
  // bouton doit refléter cette vérité, pas juste être masqué par CSS.
  expect(source).toContain(\"(options.user && options.user.role) === 'admin'\");
  expect(source).toContain('Réservé à l’administration — un ajustement mutualisé affecte tous les marchés à la fois.');

  // fixed-direct reste scopé au marché courant, fixed-mutualized utilise
  // toujours l'endpoint global, jamais /market/:code pour les écritures GROUP.
  expect(source).toContain(\"const globalEndpoint = workspace.endpointFor({});\");
  expect(source).toContain('const basePath = isMutualized ? globalEndpoint : marketEndpoint;');
"""
new_block = """  // Les charges fixes directes gardent leur panneau d'ajustement séparé.
  expect(source).toContain(\"detailKey === 'fixed-direct'\");
  expect(source).toContain('await openStructureEventForm(rootObject, doc, workspace, options, detailKey)');

  // Les mutualisées sont une vérité de groupe en lecture seule dans cet
  // Atelier : encadré grisé, aucune action de gestion exposée.
  expect(source).toContain(\"card.dataset.readOnly = 'true'\");
  expect(source).toContain(\"'Charges fixes mutualisées', 'Charges fixes partagées entre marchés.'\");
  expect(source).not.toContain(\"detailKey === 'fixed-direct' || detailKey === 'fixed-mutualized'\");
  expect(css).toContain('.kmc-cockpit-cost-card.is-fixed-mutualized');
  expect(css).toContain('background: #f8fafc');

  // Le support serveur GROUP reste disponible hors de cette surface ; le
  // cockpit ne le rend simplement plus manipulable.
  expect(source).toContain(\"const globalEndpoint = workspace.endpointFor({});\");
  expect(source).toContain('const basePath = isMutualized ? globalEndpoint : marketEndpoint;');
"""
if old_block not in s:
    raise SystemExit('cockpit test block not found')
p.write_text(s.replace(old_block, new_block, 1))

admin_test = 'tests/unit/canonical-admin-app.test.js'
p = Path(admin_test)
s = p.read_text()
s = s.replace(
    "  const pilotageMount = jest.fn().mockResolvedValue({ ok: true });\n  const demoMount = jest.fn().mockResolvedValue({ ok: true });",
    "  const pilotageMount = jest.fn().mockResolvedValue({ ok: true });\n  const pricingMount = jest.fn(({ root, requestedMarket }) => {\n    const marker = fakeNode('div');\n    marker.textContent = requestedMarket || 'global';\n    root.appendChild(marker);\n    return Promise.resolve({ ok: true });\n  });\n  const demoMount = jest.fn().mockResolvedValue({ ok: true });"
)
s = s.replace(
    "    KomerceCanonicalPilotage: { mount: pilotageMount },\n    KomerceDemoOrderFlow: { mount: demoMount },",
    "    KomerceCanonicalPilotage: { mount: pilotageMount },\n    KomerceCanonicalPricingWorkspace: { mount: pricingMount },\n    KomerceDemoOrderFlow: { mount: demoMount },"
)
s = s.replace(
    "    pilotageMount,\n    demoMount,",
    "    pilotageMount,\n    pricingMount,\n    demoMount,"
)
anchor = "  test('opérateur pays ne reçoit jamais Global et un DOM falsifié CG est rejeté avant Pilotage', async () => {"
insert = """  test('Pricing change de Market par swap atomique sans exposer le rendu intermédiaire', async () => {
    const env = loadCanonicalApp();
    const user = { id: 'hq-admin', role: 'admin' };
    const adminContext = {
      actor: user,
      access: {
        mode: 'global',
        allowedMarkets: ['CM', 'CG'],
        defaultMarket: 'CM',
        capabilities: ['dashboard.market.read'],
      },
    };

    await env.api.renderPricingWorkspaceShell(env.root, user, adminContext);
    const bar = env.root.children[0];
    const surface = env.root.children[1];
    const select = bar.children[1].children[1];
    expect(surface.children[0].textContent).toBe('CM');

    let finishSecondRender;
    env.pricingMount.mockImplementationOnce(({ root, requestedMarket }) => new Promise(resolve => {
      finishSecondRender = () => {
        const marker = fakeNode('div');
        marker.textContent = requestedMarket;
        root.appendChild(marker);
        resolve({ ok: true });
      };
    }));

    select.value = 'CG';
    const changePromise = select._listeners.change();
    expect(surface.children[0].textContent).toBe('CM');
    finishSecondRender();
    await changePromise;

    expect(surface.children).toHaveLength(1);
    const stage = surface.children[0];
    expect(stage.className).toBe('kmc-market-surface-stage');
    expect(stage.children[0].textContent).toBe('CG');
    expect(select.disabled).toBe(false);
  });

"""
if anchor not in s:
    raise SystemExit('admin test anchor not found')
p.write_text(s.replace(anchor, insert + anchor, 1))
