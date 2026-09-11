from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Core grant semantics: DELEGATION remains grantor-subset; EXECUTION can be
# explicitly delegated by team.grant when the assignment ceiling permits it.
# ---------------------------------------------------------------------------
p = 'services/market-delegation-service.js'
anchor = "async function assertGrantAllowed(db, { assignmentId, capabilities, actorUserId = null, actorIsCentral = false }) {"
grantable = """async function grantableCapabilitiesForActor(executor, { assignmentId, actorUserId }) {
  const db = requireExecutor(executor);
  const membership = await activeMembershipForUser(db, assignmentId, actorUserId);
  if (!membership) return [];
  const owned = await activeMembershipCapabilities(db, membership.id);
  if (!owned.includes('team.grant')) return owned;

  const { rows } = await db.query(
    `SELECT acc.capability
       FROM assignment_capability_ceiling acc
       JOIN capability_registry cr ON cr.capability = acc.capability
      WHERE acc.assignment_id=$1::uuid
        AND acc.revoked_at IS NULL
        AND cr.class='EXECUTION'
        AND cr.authority_scope='MARKET'
        AND cr.delegation_mode='DELEGABLE'
        AND cr.status='LIVE'
      ORDER BY acc.capability`,
    [assignmentId]
  );
  return normalizeCapabilities([...owned, ...rows.map(row => row.capability)]);
}

"""
replace_once(p, anchor, grantable + anchor)
old = """  const grantorCaps = new Set(await activeMembershipCapabilities(db, grantorMembership.id));
  const forbidden = requested.filter(capability => !grantorCaps.has(capability));
  if (forbidden.length) {
    const error = new Error(`market_delegation_grant_exceeds_grantor:${forbidden.join(',')}`);
    error.code = 'MARKET_DELEGATION_GRANT_EXCEEDS_GRANTOR';
    throw error;
  }
  return { requested, grantorMembership };
}"""
new = """  const grantorCaps = new Set(await activeMembershipCapabilities(db, grantorMembership.id));
  const notOwned = requested.filter(capability => !grantorCaps.has(capability));
  let forbidden = [...notOwned];

  // Exception doctrinale strictement bornée au terrain : team.grant autorise
  // à déléguer une capability EXECUTION présente dans le ceiling sans que le
  // manager doive l'hériter lui-même. Les capabilities DELEGATION restent
  // soumises à grant(member) ⊆ grant(grantor).
  if (notOwned.length && grantorCaps.has('team.grant')) {
    const { rows } = await db.query(
      `SELECT capability
         FROM capability_registry
        WHERE capability = ANY($1::text[])
          AND class='EXECUTION'
          AND authority_scope='MARKET'
          AND delegation_mode='DELEGABLE'
          AND status='LIVE'`,
      [notOwned]
    );
    const delegableExecution = new Set(rows.map(row => row.capability));
    forbidden = notOwned.filter(capability => !delegableExecution.has(capability));
  }

  if (forbidden.length) {
    const error = new Error(`market_delegation_grant_exceeds_grantor:${forbidden.join(',')}`);
    error.code = 'MARKET_DELEGATION_GRANT_EXCEEDS_GRANTOR';
    throw error;
  }
  return { requested, grantorMembership };
}"""
replace_once(p, old, new)
replace_once(p,
    "  activeMembershipCapabilities,\n  assertGrantAllowed,",
    "  activeMembershipCapabilities,\n  grantableCapabilitiesForActor,\n  assertGrantAllowed,")

# ---------------------------------------------------------------------------
# Team service/read model exposes server-derived grantable capabilities.
# ---------------------------------------------------------------------------
p = 'services/market-delegation-team-service.js'
replace_once(p,
    "  activeMembershipCapabilities,\n  assertGrantAllowed,",
    "  activeMembershipCapabilities,\n  grantableCapabilitiesForActor,\n  assertGrantAllowed,")
replace_once(p,
    "  resolveAuthorization,\n  listTeam,",
    "  resolveAuthorization,\n  grantableCapabilitiesForActor,\n  listTeam,")

p = 'routes/market-delegation-team.js'
replace_once(p,
    "  resolveAuthorization,\n  listTeam,",
    "  resolveAuthorization,\n  grantableCapabilitiesForActor,\n  listTeam,")
old = """      const authz = await authorization(client, req, 'team.read');
      const team = await listTeam(client, { assignmentId: authz.assignment_id });
      return { authz, team };"""
new = """      const authz = await authorization(client, req, 'team.read');
      const [team, grantable] = await Promise.all([
        listTeam(client, { assignmentId: authz.assignment_id }),
        grantableCapabilitiesForActor(client, {
          assignmentId: authz.assignment_id,
          actorUserId: req.user.id,
        }),
      ]);
      return { authz, team, grantable };"""
replace_once(p, old, new)
replace_once(p,
    "      actor_capabilities: result.authz.capabilities,\n      ...result.team,",
    "      actor_capabilities: result.authz.capabilities,\n      actor_grantable_capabilities: result.grantable,\n      ...result.team,")

# ---------------------------------------------------------------------------
# Operations runtime: read boundary stays role-compatible; mutations can use
# explicit execution capabilities without making the manager a field agent.
# ---------------------------------------------------------------------------
p = 'routes/admin-operations-workspace.js'
replace_once(p,
    "const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');\nconst workspace = require('../services/operations-workspace');",
    "const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');\nconst { requireMarketExecutionCapability } = require('../middleware/require-market-execution-capability');\nconst workspace = require('../services/operations-workspace');")
replace_once(p,
    "// market_operator ajouté en lecture — les mutations restent exclusivement\n// agent_hub (requireHubWorkspaceAction) et agent_relais (requireRelayWorkspaceAction).\nconst attachWorkspaceReadDelegation = attachMarketDelegatedRoleFor(['admin', 'agent_hub', 'agent_relais', 'market_operator']);\nconst requireWorkspaceReadRole = requireRole(['admin', 'agent_hub', 'agent_relais', 'market_operator']);\nconst requireHubWorkspaceAction = requireRole(['admin', 'agent_hub']);\nconst requireRelayWorkspaceAction = requireRole(['admin', 'agent_relais']);",
    "// market_operator reste une projection de lecture. Les mutations terrain\n// utilisent soit le rôle legacy exact, soit une capability EXECUTION explicite.\nconst attachWorkspaceReadDelegation = attachMarketDelegatedRoleFor(['admin', 'agent_hub', 'agent_relais', 'market_operator']);\nconst requireWorkspaceReadRole = requireRole(['admin', 'agent_hub', 'agent_relais', 'market_operator']);\nconst LEGACY_OPERATION_ROLES = Object.freeze(['admin', 'agent_hub', 'agent_relais']);")
insert_anchor = "function actionActor(req) {"
helper = """function requireWorkspaceExecution(capability, legacyRoles) {
  const delegatedGuard = requireMarketExecutionCapability(capability);
  const legacyAllowed = new Set(legacyRoles || []);

  return (req, res, next) => {
    const role = req.user && req.user.role;
    if (legacyAllowed.has(role)) return requireWorkspaceMarketAccess(req, res, next);
    // Un rôle terrain legacy ne peut jamais emprunter le lane capability d'un
    // autre métier (agent_hub -> relais ou inversement).
    if (LEGACY_OPERATION_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Rôle terrain interdit pour cette action', code: 'role_forbidden' });
    }
    return delegatedGuard(req, res, next);
  };
}

"""
replace_once(p, insert_anchor, helper + insert_anchor)
old_use = """router.use(
  '/market/:marketCode',
  authenticate,
  attachWorkspaceReadDelegation,
  requireWorkspaceReadRole,
  rejectClientMarketAuthority,
  resolveRequestedMarket,
  attachAuthorizedMarkets,
  requireWorkspaceMarketAccess
);"""
new_use = """router.use(
  '/market/:marketCode',
  authenticate,
  attachWorkspaceReadDelegation,
  rejectClientMarketAuthority,
  resolveRequestedMarket,
  attachAuthorizedMarkets
);"""
replace_once(p, old_use, new_use)
replace_once(p,
    "router.get('/market/:marketCode', async (req, res, next) => {",
    "router.get('/market/:marketCode', requireWorkspaceReadRole, requireWorkspaceMarketAccess, async (req, res, next) => {")
route_map = {
    "router.post('/market/:marketCode/orders/:reference/mark-ordered', requireHubWorkspaceAction,": "router.post('/market/:marketCode/orders/:reference/mark-ordered', requireWorkspaceExecution('execution.order.mark_ordered', ['admin', 'agent_hub']),",
    "router.post('/market/:marketCode/distribution/run', requireHubWorkspaceAction,": "router.post('/market/:marketCode/distribution/run', requireWorkspaceExecution('execution.distribution.run', ['admin', 'agent_hub']),",
    "router.post('/market/:marketCode/parcels/:reference/ship', requireHubWorkspaceAction,": "router.post('/market/:marketCode/parcels/:reference/ship', requireWorkspaceExecution('execution.parcel.ship', ['admin', 'agent_hub']),",
    "router.post('/market/:marketCode/orders/:reference/confirm-cash', requireRelayWorkspaceAction,": "router.post('/market/:marketCode/orders/:reference/confirm-cash', requireWorkspaceExecution('execution.cash.confirm', ['admin', 'agent_relais']),",
    "router.post('/market/:marketCode/parcels/:reference/receive', requireRelayWorkspaceAction,": "router.post('/market/:marketCode/parcels/:reference/receive', requireWorkspaceExecution('execution.parcel.receive', ['admin', 'agent_relais']),",
    "router.post('/market/:marketCode/parcels/:reference/collect', requireRelayWorkspaceAction,": "router.post('/market/:marketCode/parcels/:reference/collect', requireWorkspaceExecution('execution.parcel.collect', ['admin', 'agent_relais']),",
    "router.post('/market/:marketCode/inventory/items/:itemId/assign', requireHubWorkspaceAction,": "router.post('/market/:marketCode/inventory/items/:itemId/assign', requireWorkspaceExecution('execution.inventory.assign', ['admin', 'agent_hub']),",
}
for old, new in route_map.items():
    replace_once(p, old, new)
replace_once(p,
    "  requireWorkspaceMarketAccess,\n  actionActor,",
    "  requireWorkspaceMarketAccess,\n  requireWorkspaceExecution,\n  actionActor,")

# ---------------------------------------------------------------------------
# Team UI: execution rights are explicit, labelled, and never part of read or
# "same as me" presets unless the actor actually owns them.
# ---------------------------------------------------------------------------
p = 'public/dashboards/canonical/js/market-team.js'
replace_once(p,
    "    'market.observation.record': 'Saisir les observations marché',",
    "    'market.observation.record': 'Saisir les observations marché',\n    'structure.event.record': 'Enregistrer une charge structurelle réelle',")
replace_once(p,
    "    'client.read': 'Lire les clients du marché',",
    "    'client.read': 'Lire les clients du marché',\n    'client.case.handle': 'Traiter les dossiers clients',")
replace_once(p,
    "    'provider.manage': 'Gérer les prestataires locaux',",
    "    'provider.manage': 'Gérer les prestataires locaux',\n    'catalog.expose': 'Exposer les produits sur le marché',\n    'local_offer.manage': 'Gérer les offres locales',")
replace_once(p,
    "    'cash_control.policy.manage': 'Gérer le contrôle des encaissements',",
    "    'cash_control.policy.manage': 'Gérer le contrôle des encaissements',\n    'execution.order.mark_ordered': 'Terrain · envoyer une commande au sourcing',\n    'execution.distribution.run': 'Terrain · lancer la répartition',\n    'execution.parcel.ship': 'Terrain · expédier un colis',\n    'execution.inventory.assign': 'Terrain · affecter l’inventaire',\n    'execution.parcel.receive': 'Terrain · réceptionner un colis au relais',\n    'execution.parcel.collect': 'Terrain · remettre un colis au client',\n    'execution.cash.confirm': 'Terrain · confirmer un encaissement cash',")
read_anchor = "  let mounting = false;"
terrain = """  const TERRAIN_PRESET = Object.freeze([
    'execution.order.mark_ordered',
    'execution.distribution.run',
    'execution.parcel.ship',
    'execution.inventory.assign',
    'execution.parcel.receive',
    'execution.parcel.collect',
    'execution.cash.confirm',
  ]);

"""
replace_once(p, read_anchor, terrain + read_anchor)
old = """  function presetControls(checklist, available) {
    const wrap = el('div', 'kmc-team-presets');
    const read = el('button', 'kmc-workspace-action is-secondary', 'Preset lecture');
    read.type = 'button';
    read.addEventListener('click', () => setChecked(checklist, READ_PRESET.filter(cap => available.includes(cap))));
    const same = el('button', 'kmc-workspace-action is-secondary', 'Même périmètre que moi');
    same.type = 'button';
    same.addEventListener('click', () => setChecked(checklist, available));
    const none = el('button', 'kmc-workspace-action is-secondary', 'Tout décocher');
    none.type = 'button';
    none.addEventListener('click', () => setChecked(checklist, []));
    wrap.append(read, same, none);
    return wrap;
  }"""
new = """  function presetControls(checklist, available, actorOwned) {
    const wrap = el('div', 'kmc-team-presets');
    const read = el('button', 'kmc-workspace-action is-secondary', 'Preset lecture');
    read.type = 'button';
    read.addEventListener('click', () => setChecked(checklist, READ_PRESET.filter(cap => available.includes(cap))));
    const same = el('button', 'kmc-workspace-action is-secondary', 'Même périmètre que moi');
    same.type = 'button';
    same.addEventListener('click', () => setChecked(checklist, (actorOwned || []).filter(cap => available.includes(cap))));
    const terrainCaps = TERRAIN_PRESET.filter(cap => available.includes(cap));
    if (terrainCaps.length) {
      const terrain = el('button', 'kmc-workspace-action is-secondary', 'Preset terrain');
      terrain.type = 'button';
      terrain.addEventListener('click', () => setChecked(checklist, terrainCaps));
      wrap.appendChild(terrain);
    }
    const none = el('button', 'kmc-workspace-action is-secondary', 'Tout décocher');
    none.type = 'button';
    none.addEventListener('click', () => setChecked(checklist, []));
    wrap.append(read, same, none);
    return wrap;
  }"""
replace_once(p, old, new)
replace_once(p,
    "    card.appendChild(el('p', 'kmc-team-help', 'Choisissez uniquement les droits nécessaires. Le serveur refuse tout droit que vous ne possédez pas vous-même.'));",
    "    card.appendChild(el('p', 'kmc-team-help', 'Choisissez uniquement les droits nécessaires. Les droits de pilotage restent bornés par vos propres droits ; les droits terrain sont délégables explicitement sans vous les attribuer.'));")
replace_once(p,
    "    const available = [...team.actor_capabilities].sort();\n    const checklist = capabilityChecklist(available, READ_PRESET.filter(cap => available.includes(cap)));\n    card.appendChild(presetControls(checklist, available));",
    "    const available = [...(team.actor_grantable_capabilities || team.actor_capabilities || [])].sort();\n    const checklist = capabilityChecklist(available, READ_PRESET.filter(cap => available.includes(cap)));\n    card.appendChild(presetControls(checklist, available, team.actor_capabilities || []));")
replace_once(p,
    "      const available = [...team.actor_capabilities].sort();\n      const checklist = capabilityChecklist(available, member.capabilities || []);\n      editor.appendChild(presetControls(checklist, available));",
    "      const available = [...(team.actor_grantable_capabilities || team.actor_capabilities || [])].sort();\n      const checklist = capabilityChecklist(available, member.capabilities || []);\n      editor.appendChild(presetControls(checklist, available, team.actor_capabilities || []));")

# ---------------------------------------------------------------------------
# Unit/static proofs.
# ---------------------------------------------------------------------------
p = 'tests/unit/market-delegation-team-service.test.js'
anchor = "  test('acceptance code revalidates invitation capabilities through non-central addMembership', () => {"
addition = """  test('team.grant peut déléguer EXECUTION dans le ceiling sans que le manager l’hérite', async () => {
    const db = executor();
    db.query
      // ceiling
      .mockResolvedValueOnce({ rows: [{ capability: 'execution.parcel.ship' }] })
      // grantor membership
      .mockResolvedValueOnce({ rows: [{ id: 'manager-m', assignment_id: 'a1', user_id: 'u1', status: 'ACTIVE' }] })
      // grantor owns team.grant, not execution.parcel.ship
      .mockResolvedValueOnce({ rows: [{ capability: 'team.grant' }, { capability: 'team.read' }] })
      // registry proves the not-owned capability is LIVE EXECUTION
      .mockResolvedValueOnce({ rows: [{ capability: 'execution.parcel.ship' }] });

    await expect(delegation.assertGrantAllowed(db, {
      assignmentId: 'a1',
      capabilities: ['execution.parcel.ship'],
      actorUserId: 'u1',
      actorIsCentral: false,
    })).resolves.toMatchObject({ requested: ['execution.parcel.ship'] });
  });

  test('team.grant ne contourne jamais la règle de possession pour une capability DELEGATION', async () => {
    const db = executor();
    db.query
      .mockResolvedValueOnce({ rows: [{ capability: 'pricing.decide' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'manager-m', assignment_id: 'a1', user_id: 'u1', status: 'ACTIVE' }] })
      .mockResolvedValueOnce({ rows: [{ capability: 'team.grant' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(delegation.assertGrantAllowed(db, {
      assignmentId: 'a1',
      capabilities: ['pricing.decide'],
      actorUserId: 'u1',
      actorIsCentral: false,
    })).rejects.toMatchObject({ code: 'MARKET_DELEGATION_GRANT_EXCEEDS_GRANTOR' });
  });

"""
replace_once(p, anchor, addition + anchor)

p = 'tests/unit/market-delegation-team-routes.test.js'
anchor = "  test('API is mounted once at the composition root', () => {"
addition = """  test('GET team expose la liste grantable calculée serveur, distincte des droits possédés', () => {
    expect(routeSource).toContain('actor_grantable_capabilities: result.grantable');
    expect(routeSource).toContain('grantableCapabilitiesForActor');
  });

"""
replace_once(p, anchor, addition + anchor)

p = 'tests/unit/market-delegation-team-ui.test.js'
old = """  test('la gestion équipe ne peut sélectionner que des capabilities renvoyées au grantor et humanise les droits métier LIVE', () => {
    const js = read('public/dashboards/canonical/js/market-team.js');
    expect(js).toContain('const available = [...team.actor_capabilities].sort()');"""
new = """  test('la gestion équipe utilise le périmètre grantable serveur et humanise les droits métier LIVE', () => {
    const js = read('public/dashboards/canonical/js/market-team.js');
    expect(js).toContain('team.actor_grantable_capabilities || team.actor_capabilities');"""
replace_once(p, old, new)
anchor = "  test('les droits d’action settlement ne sont jamais ajoutés au preset lecture', () => {"
addition = """  test('les droits terrain ont un preset explicite mais ne contaminent ni lecture ni même-périmètre', () => {
    const js = read('public/dashboards/canonical/js/market-team.js');
    const terrain = js.match(/const TERRAIN_PRESET = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);/);
    const read = js.match(/const READ_PRESET = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);/);
    expect(terrain).not.toBeNull();
    expect(read).not.toBeNull();
    for (const capability of [
      'execution.order.mark_ordered', 'execution.distribution.run', 'execution.parcel.ship',
      'execution.inventory.assign', 'execution.parcel.receive', 'execution.parcel.collect',
      'execution.cash.confirm',
    ]) {
      expect(terrain[1]).toContain(`'${capability}'`);
      expect(read[1]).not.toContain(`'${capability}'`);
    }
    expect(js).toContain("'Preset terrain'");
    expect(js).toContain('(actorOwned || []).filter');
  });

"""
replace_once(p, anchor, addition + anchor)

p = 'tests/unit/canonical-operations-workspace-boundary.test.js'
replace_once(p,
    "  expect(workspaceRoute).toContain(\"requireHubWorkspaceAction = requireRole(['admin', 'agent_hub'])\");\n  expect(workspaceRoute).toContain(\"requireRelayWorkspaceAction = requireRole(['admin', 'agent_relais'])\");",
    "  expect(workspaceRoute).toContain('requireWorkspaceExecution');\n  expect(workspaceRoute).toContain(\"execution.order.mark_ordered\");\n  expect(workspaceRoute).toContain(\"execution.cash.confirm\");\n  expect(workspaceRoute).not.toContain('requireHubWorkspaceAction = requireRole');\n  expect(workspaceRoute).not.toContain('requireRelayWorkspaceAction = requireRole');")

# ---------------------------------------------------------------------------
# Feature ownership + doctrine.
# ---------------------------------------------------------------------------
p = 'features/market-delegation.feature.js'
replace_once(p,
    "      'migration 209 : finance.act + settlement.receive deviennent LIVE et sont backfillées dans les ceilings actifs ; auto-grant seulement aux managers déjà dotés de team.grant + team.revoke + finance.read',",
    "      'migration 209 : finance.act + settlement.receive deviennent LIVE et sont backfillées dans les ceilings actifs ; auto-grant seulement aux managers déjà dotés de team.grant + team.revoke + finance.read',\n      'EXECUTION terrain : les 7 capabilities execution.* sont explicitement délégables dans le ceiling mais jamais auto-accordées au manager ; team.grant peut les attribuer à une membership terrain sans que le grantor les possède lui-même',\n      'migration 212 : ajoute les EXECUTION LIVE/MARKET/DELEGABLE au template et aux ceilings actifs sans aucun auto-grant membership',")
replace_once(p,
    "      'migrations/210_market_delegation_structure_event_record_live.sql',",
    "      'migrations/210_market_delegation_structure_event_record_live.sql',\n      'migrations/212_market_delegation_execution_ceiling.sql',")
replace_once(p,
    "      'middleware/require-market-delegated-role.js',",
    "      'middleware/require-market-delegated-role.js',\n      'middleware/require-market-execution-capability.js',")
replace_once(p,
    "    { statement: 'migration 210 active structure.event.record sans jamais créer ni modifier un événement economic_structure_cost_events', test: 'tests/unit/market-delegation-p0.test.js' },",
    "    { statement: 'migration 210 active structure.event.record sans jamais créer ni modifier un événement economic_structure_cost_events', test: 'tests/unit/market-delegation-p0.test.js' },\n    { statement: 'les capabilities EXECUTION peuvent être explicitement déléguées par team.grant lorsqu’elles sont dans le ceiling, sans être héritées par le manager ; une capability DELEGATION reste soumise à la possession par le grantor', test: 'tests/unit/market-delegation-team-service.test.js' },\n    { statement: 'migration 212 ajoute le potentiel EXECUTION aux ceilings sans auto-grant membership', test: 'tests/e2e-api/market-delegation.execution.e2e.test.js' },")

# Temporary qualifier artifacts must never reach the final PR.
Path('.github/workflows/tmp-execution-bridge.yml').unlink(missing_ok=True)
Path('scripts/tmp-patch-execution-bridge.py').unlink(missing_ok=True)
