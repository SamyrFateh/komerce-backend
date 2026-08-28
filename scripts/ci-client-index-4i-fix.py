from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH_ANCHOR_MISSING {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# Jest hoists mock factories. Variables intentionally read from mock factories
# must use the mock* naming convention to prove lazy test state is deliberate.
p = Path('tests/unit/admin-client-index-route.test.js')
text = p.read_text(encoding='utf-8')
text = text.replace('globalAllowed', 'mockGlobalAllowed').replace('allowedMarkets', 'mockAllowedMarkets')
p.write_text(text, encoding='utf-8')

# LOT 4I deliberately changes /admin/clients from the Legacy/Pilotage fallback
# to the dedicated Canonical Client Index while preserving Client 360 detail.
replace_once(
    'tests/unit/canonical-client-360-app.test.js',
    "test('surfaceForPath distingue le détail Client 360 de la liste clients Legacy 1', () => {\n  const env = loadApp('/admin/clients/%2B2691234567');\n  expect(env.api.surfaceForPath('/admin/clients/%2B2691234567')).toBe(env.api.SURFACES.CLIENT_360);\n  expect(env.api.surfaceForPath('/admin/clients')).toBe(env.api.SURFACES.PILOTAGE);\n});",
    "test('surfaceForPath distingue Client Index du détail Client 360', () => {\n  const env = loadApp('/admin/clients/%2B2691234567');\n  expect(env.api.surfaceForPath('/admin/clients/%2B2691234567')).toBe(env.api.SURFACES.CLIENT_360);\n  expect(env.api.surfaceForPath('/admin/clients')).toBe(env.api.SURFACES.CLIENT_INDEX);\n  expect(env.api.surfaceForPath('/admin-next/clients')).toBe(env.api.SURFACES.CLIENT_INDEX);\n});"
)

# Governance truth only: Feature Audit compares Express route registry syntax.
# The real route is DELETE /credentials/:id; the manifest used OpenAPI {id},
# producing a false MISSING_ROUTE + inverse warning. No auth runtime changes.
replace_once(
    'features/auth-passkey.feature.js',
    "      'DELETE /api/auth/passkey/credentials/{id}',",
    "      'DELETE /api/auth/passkey/credentials/:id',"
)

# providers-services already carries two independent business boundaries in its
# perimeter/invariants: (1) exclusive lifecycle ownership, (2) exposure is
# provider-gated and inquiries are not reservations. The classification had
# compressed both into a single rationale entry, which made the fresh gate
# report a warning despite the boundary already being explicit elsewhere.
replace_once(
    'features/providers-services.feature.js',
    "      'de ce lot, voir RECHALLENGE_DISCOVERY_LOCALE_COMPLET).',\n    ],",
    "      'de ce lot, voir RECHALLENGE_DISCOVERY_LOCALE_COMPLET).',\n      'Frontière métier autonome d’exposition et de demande : un service ou une offre ' +\n      'physique n’est exposable que sous l’autorité d’un provider actif, et une inquiry ' +\n      'reste un cycle sent -> answered -> accepted|declined — jamais une réservation, ' +\n      'un paiement ou un calendrier. Ces invariants sont testés dans providers-service.test.js.',\n    ],"
)

# Security360 deliberately fail-closes when a runtime route cannot be matched to
# a static guard chain. Its named-handler parser is line-bounded; keeping these
# declarations on one line makes authenticate + requireAdmin statically visible
# without changing a single runtime middleware or authorization rule.
replace_once(
    'routes/admin-client-index.js',
    "router.get(\n  '/clients/market/:marketCode',\n  authenticate,\n  requireAdmin,\n  rejectClientMarketIdentity,\n  resolveRequestedMarket,\n  attachAuthorizedMarkets,\n  requireClientIndexMarketRead,\n  marketHandler\n);",
    "router.get('/clients/market/:marketCode', authenticate, requireAdmin, rejectClientMarketIdentity, resolveRequestedMarket, attachAuthorizedMarkets, requireClientIndexMarketRead, marketHandler);"
)
replace_once(
    'routes/admin-client-index.js',
    "router.get(\n  '/clients',\n  authenticate,\n  requireAdmin,\n  rejectClientMarketIdentity,\n  requireDashboardGlobalAuthority,\n  globalHandler\n);",
    "router.get('/clients', authenticate, requireAdmin, rejectClientMarketIdentity, requireDashboardGlobalAuthority, globalHandler);"
)

print('CLIENT_INDEX_4I_TEST_GOVERNANCE_SECURITY_TRUTH_FIXED')
