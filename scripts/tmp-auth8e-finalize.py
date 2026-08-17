from pathlib import Path
import json
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f'{path}: expected source fragment not found: {old[:100]!r}')
    write(path, text.replace(old, new, 1))


def regex_once(path, pattern, replacement, flags=0):
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{path}: expected one regex match, got {count}: {pattern[:100]!r}')
    write(path, updated)


# 1. Supprimer entièrement l'ancienne délégation publique téléphone -> JWT.
regex_once(
    'routes/auth.js',
    r'// ─── POST /api/auth/orders-by-phone.*?(?=// ─── POST /api/auth/logout)',
    '',
    re.S,
)
text = read('routes/auth.js')
text = text.replace('const _JWT_SECRET = JWT_SECRET;\n', '')
write('routes/auth.js', text)

# 2. Validator désormais mort.
regex_once(
    'validators/index.js',
    r"\n  ordersByPhone: \{\n    body: Joi\.object\(\{ phone: phone\.required\(\) \}\),\n  \},",
    '',
)

# 3. Feature auth-identity : surface HTTP et note de sécurité réelles.
p = 'features/auth-identity.feature.js'
t = read(p)
t = t.replace('authedRoutesDetected: 7,\n    totalRoutes: 20,', 'authedRoutesDetected: 7,\n    totalRoutes: 19,')
old_note = 'note: "7/20 routes protégées (tableau de bord, refresh, etc.). 13 routes publiques par design : OTP (cooldown 5 min/phone + plafond journalier DB, test-reset gaté par isOtpTestMode() → 404 en prod), magic-link (token signé), guest-checkout (flux boutique public), orders-by-phone (client lookup public), admin-reset gaté applicativement (ADMIN_RESET_KEY ≥ 32 chars obligatoire + ALLOW_ADMIN_RESET=true requis en prod — désactivé par défaut).",'
new_note = 'note: "7/19 routes protégées. 12 routes publiques par design : OTP (cooldown 5 min/phone + plafond journalier DB, test-reset gaté par isOtpTestMode() → 404 en prod), magic-link (token mono-usage), guest-checkout (route historique 410), login/register/logout et admin-reset gaté applicativement. AUTH-8e supprime la délégation publique par téléphone : un numéro seul ne délivre plus aucun JWT.",'
if old_note not in t:
    raise SystemExit('features/auth-identity.feature.js: security.note source changed')
t = t.replace(old_note, new_note, 1)
t = t.replace("      'POST /api/auth/orders-by-phone',\n", '')
write(p, t)

# 4. Invariant public-by-design : retirer l'ancienne exception.
p = 'tests/invariants/auth-identity.mutating-routes-guarded.test.js'
t = read(p)
t = t.replace('signé, guest-checkout = flux boutique public, orders-by-phone =\n *      lookup client public, admin-reset gaté applicativement par', 'signé, guest-checkout = flux boutique public, admin-reset gaté applicativement par')
t = t.replace('7 routes protégées, 13 publiques par conception, sur 20 déclarées.', '7 routes protégées, 12 publiques par conception, sur 19 déclarées.')
t = t.replace('mutant + guest-checkout + orders-by-phone + admin-reset + login +\n// register + logout = 13).', 'mutant + guest-checkout + admin-reset + login +\n// register + logout = 12).')
t = t.replace("  'POST /api/auth/orders-by-phone',  // client lookup public\n", '')
write(p, t)

# 5. Test du router : la route supprimée ne fait plus partie du contrat.
p = 'tests/unit/auth-route.test.js'
t = read(p)
t = t.replace(" *   POST /orders-by-phone : 400 téléphone invalide, rate-limit → 429,\n *                          aucun user → liste vide, succès → token\n", '')
start = t.find("describe('POST /api/auth/orders-by-phone', () => {")
end = t.find("describe('POST /api/auth/logout', () => {", start)
if start < 0 or end < 0:
    raise SystemExit('tests/unit/auth-route.test.js: orders-by-phone block not found')
t = t[:start] + t[end:]
write(p, t)

# 6. Contract generator + Security360 baseline : la surface disparaît réellement.
regex_once(
    'scripts/contract-generate.js',
    r"\n  '/api/auth/orders-by-phone': \{\n    post: \{ fields: \['token','name'\], source: 'route-read' \}\n  \},",
    '',
)
baseline_path = Path('scripts/.security-360-baseline.json')
baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
route = 'POST /api/auth/orders-by-phone'
if route not in baseline.get('flagged', []):
    raise SystemExit('Security360 baseline: route legacy absente avant retrait')
baseline['flagged'] = [x for x in baseline['flagged'] if x != route]
baseline_path.write_text(json.dumps(baseline, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# 7. Ownership auth transversale de la policy de type de token.
p = 'features/auth.feature.js'
t = read(p)
if "      'utils/auth-token-policy.js',\n" not in t:
    t = t.replace("      'utils/auth-session-policy.js',\n", "      'utils/auth-session-policy.js',\n      'utils/auth-token-policy.js',\n", 1)
if "      'tests/unit/auth-token-policy.test.js',\n" not in t:
    t = t.replace("      'tests/unit/auth-session-policy.test.js',\n", "      'tests/unit/auth-session-policy.test.js',\n      'tests/unit/auth-token-policy.test.js',\n", 1)
t = t.replace("{ fn: 'signAuthToken / resolveSessionTtlSeconds', file: 'utils/auth-session.js, utils/auth-session-policy.js' },", "{ fn: 'signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict', file: 'utils/auth-session.js, utils/auth-session-policy.js, utils/auth-token-policy.js' },")
if 'un JWT scoped ou dépourvu des claims de session canoniques' not in t:
    t = t.replace("    'la durée absolue JWT + cookie est plafonnée à 7 jours et chaque preuve OTP/passkey/step-up émet une nouvelle jti (AUTH-8d)',\n", "    'la durée absolue JWT + cookie est plafonnée à 7 jours et chaque preuve OTP/passkey/step-up émet une nouvelle jti (AUTH-8d)',\n    'un JWT scoped ou dépourvu des claims de session canoniques ne peut jamais être élevé en session par les middlewares génériques (AUTH-8e)',\n", 1)
write(p, t)

# 8. Moderniser les harnesses historiques : les faux JWT {id} ne sont plus des sessions.
p = 'tests/unit/auth-guest.test.js'
t = read(p)
old = "return jwt.sign({ id: 'user-1', jti: 'jti-1', ...payload }, process.env.JWT_SECRET, { algorithm: 'HS256' });"
new = "return jwt.sign({ id: 'user-1', jti: 'jti-1', auth_time: 1700000000, amr: ['otp'], token_use: 'session', ...payload }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });"
if old not in t:
    raise SystemExit('auth-guest validToken helper changed')
t = t.replace(old, new, 1)
pattern = r"  it\('ne vérifie pas la révocation si jti est absent du payload \(isTokenRevoked court-circuite\)', async \(\) => \{.*?^  \}\);\n"
replacement = """  it('refuse un JWT signé sans jti/auth_time/amr avant tout accès DB', async () => {
    const tokenWithoutJti = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${tokenWithoutJti}` }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
"""
t, count = re.subn(pattern, replacement, t, count=1, flags=re.S | re.M)
if count != 1:
    raise SystemExit(f'auth-guest no-jti test replacement count={count}')
write(p, t)

p = 'tests/unit/require-verified-identity.test.js'
t = read(p)
old = "return jwt.sign({ id: 'user-1', jti: 'jti-1', ...payload }, process.env.JWT_SECRET, {\n    algorithm: 'HS256',\n  });"
new = "return jwt.sign({\n    id: 'user-1', jti: 'jti-1', auth_time: 1700000000, amr: ['otp'], token_use: 'session', ...payload,\n  }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });"
if old not in t:
    raise SystemExit('require-verified validToken helper changed')
t = t.replace(old, new, 1)
pattern = r"  it\('ne vérifie pas la révocation si le token ne contient pas de jti', async \(\) => \{.*?^  \}\);\n"
replacement = """  it('refuse un JWT signé incomplet avant tout accès DB', async () => {
    const tokenWithoutJti = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${tokenWithoutJti}` } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
"""
t, count = re.subn(pattern, replacement, t, count=1, flags=re.S | re.M)
if count != 1:
    raise SystemExit(f'require-verified no-jti test replacement count={count}')
write(p, t)

p = 'tests/unit/soft-auth.test.js'
t = read(p)
old = "return jwt.sign({ id: 'user-001', ...payload }, SECRET, { algorithm: 'HS256', expiresIn: '1h', ...options });"
new = "return jwt.sign({ id: 'user-001', jti: 'jti-default', auth_time: 1700000000, amr: ['otp'], token_use: 'session', ...payload }, SECRET, { algorithm: 'HS256', expiresIn: '1h', ...options });"
if old not in t:
    raise SystemExit('soft-auth makeToken helper changed')
t = t.replace(old, new, 1)
t = t.replace("const token = makeToken({ jti: undefined }); // pas de jti → pas de check révocation", "const token = makeToken({ jti: 'jti-cache' });")
t = t.replace('  // Aucun mock DB — si db.query est appelé le test lèvera "no mock"\n  db.query.mockResolvedValue({ rows: [] }); // revoked_tokens seulment si jti présent', '  db.query.mockResolvedValueOnce({ rows: [] }); // revoked_tokens')
write(p, t)

print('AUTH-8e source materialization complete')
