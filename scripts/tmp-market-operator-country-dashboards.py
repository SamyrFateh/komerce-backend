from pathlib import Path

root = Path('.')

# 1) Role migration — auth-identity owns users/user_role.
migration = root / 'migrations/158_market_operator_user_role.sql'
migration.write_text("""-- LOT 4U — dedicated country dashboard operator role.\n-- Read-only dashboard authority is still granted exclusively through\n-- operator_market_scopes; this enum value alone grants no market access.\n\nALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'market_operator';\n""", encoding='utf-8')

# 2) Market dashboard route: dedicated least-privilege read role.
p = root / 'routes/admin-dashboard-market.js'
s = p.read_text(encoding='utf-8')
s = s.replace(
    "const requireCanonicalContextRole = requireRole(['admin', 'agent_hub', 'agent_relais', 'agent_transitaire']);",
    "const requireCanonicalContextRole = requireRole(['admin', 'market_operator', 'agent_hub', 'agent_relais', 'agent_transitaire']);\nconst requireMarketDashboardReadRole = requireRole(['admin', 'market_operator']);"
)
needle = "  authenticate,\n  requireAdmin,\n  rejectClientMarketId,"
replacement = "  authenticate,\n  requireMarketDashboardReadRole,\n  rejectClientMarketId,"
if s.count(needle) < 4:
    raise SystemExit(f'expected at least 4 market read guards, got {s.count(needle)}')
s = s.replace(needle, replacement, 4)
p.write_text(s, encoding='utf-8')

# 3) Feature ownership registry.
p = root / 'features/auth-identity.feature.js'
s = p.read_text(encoding='utf-8')
needle = "      'migrations/121_exceptional_pickup_authorization.sql',"
replacement = needle + "\n      'migrations/158_market_operator_user_role.sql',"
if replacement not in s:
    if needle not in s:
        raise SystemExit('auth-identity migration anchor missing')
    s = s.replace(needle, replacement, 1)
p.write_text(s, encoding='utf-8')

# 4) Canonical schema snapshot keeps enum aligned.
p = root / 'db/schema.sql'
s = p.read_text(encoding='utf-8')
if "'market_operator'" not in s:
    anchors = [
        "    'agent_transitaire',\n    'sourcing'\n);",
        "    'agent_transitaire'\n);",
    ]
    for anchor in anchors:
        if anchor in s:
            if "sourcing" in anchor:
                repl = "    'agent_transitaire',\n    'sourcing',\n    'market_operator'\n);"
            else:
                repl = "    'agent_transitaire',\n    'market_operator'\n);"
            s = s.replace(anchor, repl, 1)
            break
    else:
        raise SystemExit('user_role enum anchor missing in db/schema.sql')
p.write_text(s, encoding='utf-8')

# 5) Route tests: country operator can read only granted market.
p = root / 'tests/unit/admin-dashboard-market.test.js'
s = p.read_text(encoding='utf-8')
anchor = "  test('market_id en query est refusé avant toute résolution et ne peut jamais autoriser', async () => {"
new_test = """  test('market_operator CM lit son cockpit CM mais ne peut pas lire CG', async () => {\n    mockCurrentUser = { id: 'partner-cm-1', role: 'market_operator' };\n    mockAllowedMarkets = new Set(['market-cm-id']);\n    mockGlobalAllowed = false;\n\n    const contextRes = await request(makeApp()).get('/api/admin/dashboard/context');\n    const cmRes = await request(makeApp()).get('/api/admin/dashboard/unified/market/CM');\n    const cgRes = await request(makeApp()).get('/api/admin/dashboard/unified/market/CG');\n\n    expect(contextRes.status).toBe(200);\n    expect(contextRes.body.actor.role).toBe('market_operator');\n    expect(cmRes.status).toBe(200);\n    expect(cgRes.status).toBe(403);\n    expect(cgRes.body.code).toBe('market_scope_denied');\n  });\n\n"""
if new_test.strip() not in s:
    if anchor not in s:
        raise SystemExit('dashboard route test anchor missing')
    s = s.replace(anchor, new_test + anchor, 1)
p.write_text(s, encoding='utf-8')

# 6) Contract note.
p = root / 'docs/contract/DASHBOARD_MARKET_SCOPE_2C.md'
s = p.read_text(encoding='utf-8')
marker = '## '
note = """\n## LOT 4U — opérateur partenaire pays\n\nLe rôle `market_operator` est le rôle de lecture du cockpit partenaire pays. Le rôle seul ne donne aucun accès : un grant actif `operator_market_scopes` reste obligatoire.\n\n- `market_operator` peut résoudre `/api/admin/dashboard/context` ;\n- il peut lire Pilotage, Commerce, Opérations et Finance uniquement via les routes `/market/:marketCode` ;\n- il ne peut jamais atteindre les agrégats globaux, qui restent `admin` + `dashboard_global_access_grants` ;\n- Cameroun (`CM`) et Congo (`CG`) sont donc isolés par le scope serveur, indépendamment de toute sélection navigateur.\n\nLes workspaces de mutation restent hors de ce rôle dans ce lot.\n"""
if '## LOT 4U — opérateur partenaire pays' not in s:
    s = s.rstrip() + '\n' + note + '\n'
p.write_text(s, encoding='utf-8')
