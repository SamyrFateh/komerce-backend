from pathlib import Path


def rep(path, old, new, expected=1, label='replace'):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    n = text.count(old)
    if n != expected:
        raise SystemExit(f'{label}: expected {expected}, got {n}')
    p.write_text(text.replace(old, new, expected), encoding='utf-8')


def recent_auth():
    return "{ authTime: Math.floor(Date.now() / 1000), amr: ['otp'] }"

# AUTH-2 route harness: authenticated enrollment now means authenticated + recent strong proof.
rep('tests/unit/auth-passkey.test.js',
    "  let app;\n  let currentUser;\n",
    "  let app;\n  let currentUser;\n  let currentAuth;\n",
    label='auth2 vars')
rep('tests/unit/auth-passkey.test.js',
    "    currentUser = null;\n    process.env.WEBAUTHN_RP_ID",
    "    currentUser = null;\n    currentAuth = null;\n    process.env.WEBAUTHN_RP_ID",
    label='auth2 reset')
rep('tests/unit/auth-passkey.test.js',
    "    app.use((req, res, next) => { req.user = currentUser; next(); });",
    "    app.use((req, res, next) => { req.user = currentUser; req.auth = currentAuth; next(); });",
    label='auth2 request context')
rep('tests/unit/auth-passkey.test.js',
    "  it('register/verify avec réponse malformée (authentifié) → 400', async () => {\n    currentUser = { id: 'user-A', role: 'client' };",
    "  it('register/verify avec réponse malformée après preuve OTP récente → 400', async () => {\n    currentUser = { id: 'user-A', role: 'client' };\n    currentAuth = " + recent_auth() + ";",
    label='auth2 malformed recent')
anchor = "  it('register/verify sans session → 401', async () => {\n    const res = await request(app).post('/api/auth/passkey/register/verify').send({ id: 'x' });\n    expect(res.status).toBe(401);\n  });\n"
insert = anchor + "\n  it('register/options avec session mais sans preuve récente → 428 step_up_required', async () => {\n    currentUser = { id: 'user-A', role: 'client' };\n    const res = await request(app).post('/api/auth/passkey/register/options').send({});\n    expect(res.status).toBe(428);\n    expect(res.body.code).toBe('step_up_required');\n  });\n"
rep('tests/unit/auth-passkey.test.js', anchor, insert, label='auth2 stale proof oracle')

# AUTH-6 route harness: listing stays session-only, revoke requires recent proof.
rep('tests/unit/auth-passkey-management.test.js',
    "  let app;\n  let currentUser;\n  let mockManagement;\n",
    "  let app;\n  let currentUser;\n  let currentAuth;\n  let mockManagement;\n",
    label='auth6 vars')
rep('tests/unit/auth-passkey-management.test.js',
    "    currentUser = null;\n    mockManagement = {",
    "    currentUser = null;\n    currentAuth = null;\n    mockManagement = {",
    label='auth6 reset')
rep('tests/unit/auth-passkey-management.test.js',
    "    app.use((req, _res, next) => { req.user = currentUser; next(); });",
    "    app.use((req, _res, next) => { req.user = currentUser; req.auth = currentAuth; next(); });",
    label='auth6 request context')
# Every DELETE success/validation case must reach the route only after a recent strong proof.
for old in [
    "  it('DELETE rejette un ID de gestion malformé avant le service', async () => {\n    currentUser = { id: 'user-A', role: 'client' };",
    "  it('DELETE scelle la révocation au user authentifié', async () => {\n    currentUser = { id: 'user-A', role: 'client' };",
    "  it('DELETE répond 404 sans révéler un credential étranger', async () => {\n    currentUser = { id: 'user-A', role: 'client' };",
]:
    new = old + "\n    currentAuth = " + recent_auth() + ";"
    rep('tests/unit/auth-passkey-management.test.js', old, new, label='auth6 delete recent')
anchor6 = "  it('GET credentials renvoie la liste sûre du compte courant', async () => {\n    currentUser = { id: 'user-A', role: 'client' };\n    mockManagement.listCredentials.mockResolvedValue([{ id: 'mgmt-1', device_label: 'Passkey iPhone' }]);\n    const res = await request(app).get('/api/auth/passkey/credentials');\n    expect(res.status).toBe(200);\n    expect(res.body.credentials).toHaveLength(1);\n    expect(mockManagement.listCredentials).toHaveBeenCalledWith('user-A');\n  });\n"
insert6 = anchor6 + "\n  it('DELETE avec session mais sans preuve récente → 428 sans toucher au service', async () => {\n    currentUser = { id: 'user-A', role: 'client' };\n    const id = '11111111-1111-4111-8111-111111111111';\n    const res = await request(app).delete(`/api/auth/passkey/credentials/${id}`);\n    expect(res.status).toBe(428);\n    expect(res.body.code).toBe('step_up_required');\n    expect(mockManagement.revokeCredential).not.toHaveBeenCalled();\n  });\n"
rep('tests/unit/auth-passkey-management.test.js', anchor6, insert6, label='auth6 stale proof oracle')

Path('scripts/tmp-auth7-testpatch.py').unlink()
