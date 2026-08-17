from pathlib import Path


def rep(path, old, new, expected=1, label='replace'):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    n = text.count(old)
    if n != expected:
        raise SystemExit(f'{label}: expected {expected}, got {n}')
    p.write_text(text.replace(old, new, expected), encoding='utf-8')


# Session proof metadata.
rep('routes/otp.js', "const jwt = require('jsonwebtoken');\n", "", label='otp remove jwt')
rep('routes/otp.js', "const { setAuthCookie, clearAuthCookie } = require('../utils/auth-cookie');\n",
    "const { setAuthCookie, clearAuthCookie } = require('../utils/auth-cookie');\nconst { signAuthToken } = require('../utils/auth-session');\n",
    label='otp auth-session import')
rep('routes/otp.js',
    "function signKomerceJwt(user, phone) {\n  return jwt.sign(\n    {\n      id: user.id,\n      role: user.role || 'client',\n      phone,\n      fullName: user.full_name,\n      jti: crypto.randomUUID(),\n    },\n    process.env.JWT_SECRET,\n    { expiresIn: process.env.JWT_EXPIRES || '30d' }\n  );\n}",
    "function signKomerceJwt(user, phone) {\n  return signAuthToken(user, { method: 'otp', phone, fullName: user.full_name });\n}",
    label='otp claims')

rep('routes/auth.js', "const { randomBytes, randomUUID } = require('crypto');\n", "const { randomBytes } = require('crypto');\n", label='auth randomUUID')
rep('routes/auth.js', "const { authenticate } = require('../middleware/auth');\n",
    "const { authenticate } = require('../middleware/auth');\nconst { requireRecentAuth } = require('../middleware/require-recent-auth');\n",
    label='auth recent import')
rep('routes/auth.js', "const { setAuthCookie, clearAuthCookie } = require('../utils/auth-cookie');\n",
    "const { setAuthCookie, clearAuthCookie } = require('../utils/auth-cookie');\nconst { signAuthToken } = require('../utils/auth-session');\n",
    label='auth session import')
rep('routes/auth.js',
    "function generateToken(user) {\n  // N4 — jti unique pour permettre la révocation individuelle (migration 072)\n  return jwt.sign({ id: user.id, role: user.role, jti: randomUUID() }, _JWT_SECRET, { expiresIn: JWT_EXPIRES });\n}",
    "function generateToken(user) {\n  return signAuthToken(user, { method: 'password', expiresIn: JWT_EXPIRES });\n}",
    label='password claims')
rep('routes/auth.js', "router.put('/me/pickup-authorization', authenticate, validate(auth.pickupAuthorization), async (req, res, next) => {",
    "router.put('/me/pickup-authorization', authenticate, requireRecentAuth, validate(auth.pickupAuthorization), async (req, res, next) => {",
    label='pickup put')
rep('routes/auth.js', "router.delete('/me/pickup-authorization', authenticate, async (req, res, next) => {",
    "router.delete('/me/pickup-authorization', authenticate, requireRecentAuth, async (req, res, next) => {",
    label='pickup delete')

rep('routes/client-auth.js', "const jwt = require('jsonwebtoken');\n", "", label='magic remove jwt')
rep('routes/client-auth.js', "const { setAuthCookie } = require('../utils/auth-cookie');\n",
    "const { setAuthCookie } = require('../utils/auth-cookie');\nconst { signAuthToken } = require('../utils/auth-session');\n",
    label='magic session import')
rep('routes/client-auth.js',
    "    const jwtToken = jwt.sign(\n      { id: user.id, role: user.role, fullName: user.full_name, jti: crypto.randomUUID() },\n      process.env.JWT_SECRET,\n      { expiresIn: '30d' }\n    );",
    "    const jwtToken = signAuthToken(user, { method: 'magic_link', phone: user.phone, fullName: user.full_name, expiresIn: process.env.JWT_EXPIRES || '30d' });",
    label='magic claims')

rep('middleware/auth.js', "    req.user = user;\n\n    next();",
    "    req.user = user;\n    req.auth = {\n      authTime: Number.isFinite(Number(decoded.auth_time)) ? Number(decoded.auth_time) : null,\n      amr: Array.isArray(decoded.amr) ? decoded.amr.map(String) : [],\n      jti: decoded.jti || null,\n      exp: decoded.exp || null,\n    };\n\n    next();",
    label='middleware proof context')

# WebAuthn step-up service.
p = Path('services/webauthn-service.js')
text = p.read_text(encoding='utf-8')
marker = "// ── Helpers internes : extraction du challenge depuis clientDataJSON ──────"
if text.count(marker) != 1:
    raise SystemExit('webauthn helper marker mismatch')
step = r'''
// ── Step-up AUTH-7 ───────────────────────────────────────────────────────
async function getStepUpOptions({ userId }) {
  const creds = await _findActiveCredentialsByUser(userId);
  if (!creds.length) return { available: false, reason: 'no_active_credential' };
  const options = await generateAuthenticationOptions({
    rpID: _rpID(),
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports || undefined })),
  });
  await _storeChallenge({ userId, challenge: options.challenge, ceremonyType: 'step_up' });
  return { available: true, options };
}

async function verifyStepUp({ userId, response }) {
  if (!response?.id) return { verified: false, error: 'malformed_response' };
  const expectedChallenge = _clientDataChallenge(response);
  const consumed = await _consumeChallenge({ challenge: expectedChallenge, ceremonyType: 'step_up' });
  if (!consumed.ok) return { verified: false, error: consumed.reason };
  if (consumed.userId !== userId) return { verified: false, error: 'user_mismatch' };

  const stored = await _findCredentialByCredentialId(response.id);
  if (!stored) return { verified: false, error: 'unknown_credential' };
  if (stored.user_id !== userId) return { verified: false, error: 'user_mismatch' };
  if (stored.revoked_at) return { verified: false, error: 'credential_revoked' };

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: _expectedOrigin(),
      expectedRPID: _rpID(),
      requireUserVerification: true,
      credential: {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: Number(stored.sign_count),
        transports: stored.transports || undefined,
      },
    });
  } catch (err) {
    log.warn('[verifyStepUp] verification échouée:', err.message);
    return { verified: false, error: 'verification_failed' };
  }
  if (!result.verified) return { verified: false, error: 'not_verified' };
  const newCounter = result.authenticationInfo.newCounter;
  if (!stored.backup_state && Number(stored.sign_count) > 0 && newCounter <= Number(stored.sign_count)) {
    return { verified: false, error: 'sign_count_regression' };
  }
  await db.query('UPDATE webauthn_credentials SET sign_count = $1, last_used_at = NOW() WHERE id = $2', [newCounter, stored.id]);
  return { verified: true, userId };
}

'''
text = text.replace(marker, step + marker, 1)
text = text.replace("  getLoginOptions,\n  verifyLogin,\n", "  getLoginOptions,\n  verifyLogin,\n  getStepUpOptions,\n  verifyStepUp,\n", 1)
p.write_text(text, encoding='utf-8')

# Passkey routes.
p = Path('routes/auth-passkey.js')
text = p.read_text(encoding='utf-8')
text = text.replace("const { randomUUID } = require('crypto');\nconst jwt = require('jsonwebtoken');\n\n", "")
text = text.replace("const { authenticate } = require('../middleware/auth');\n", "const { authenticate } = require('../middleware/auth');\nconst { requireRecentAuth } = require('../middleware/require-recent-auth');\n")
text = text.replace("const { setAuthCookie } = require('../utils/auth-cookie');\n", "const { setAuthCookie } = require('../utils/auth-cookie');\nconst { signAuthToken } = require('../utils/auth-session');\n")
text = text.replace("const _JWT_SECRET = process.env.JWT_SECRET;\nconst JWT_EXPIRES = process.env.JWT_EXPIRES || '30d';\n", "")
old = "function _issueSession(res, user) {\n  const token = jwt.sign(\n    { id: user.id, role: user.role, jti: randomUUID() },\n    _JWT_SECRET,\n    { expiresIn: JWT_EXPIRES }\n  );\n  setAuthCookie(res, token);\n}\n"
new = "function _issueSession(res, user, method = 'passkey') {\n  setAuthCookie(res, signAuthToken(user, { method }));\n}\n"
if text.count(old) != 1:
    raise SystemExit('passkey issue session mismatch')
text = text.replace(old, new, 1)
text = text.replace("router.delete('/credentials/:id', authenticate, async", "router.delete('/credentials/:id', authenticate, requireRecentAuth, async")
text = text.replace("router.post('/register/options', authenticate, async", "router.post('/register/options', authenticate, requireRecentAuth, async")
text = text.replace("router.post('/register/verify', authenticate, async", "router.post('/register/verify', authenticate, requireRecentAuth, async")
route_block = r'''
// ── AUTH-7 — Step-up du même compte ─────────────────────────────────────
router.post('/step-up/options', authenticate, async (req, res) => {
  try {
    const result = await webauthn.getStepUpOptions({ userId: req.user.id });
    if (!result.available) return res.status(409).json({ error: 'Aucune passkey active', code: 'passkey_step_up_unavailable' });
    res.json(result.options);
  } catch (err) {
    log.error('[step-up/options] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/step-up/verify', authenticate, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || !req.body.id) return res.status(400).json({ error: 'Réponse WebAuthn invalide' });
    const result = await webauthn.verifyStepUp({ userId: req.user.id, response: req.body });
    if (!result.verified) return res.status(401).json({ error: 'Confirmation refusée', reason: result.error });
    _issueSession(res, req.user, 'passkey');
    res.json({ verified: true });
  } catch (err) {
    log.error('[step-up/verify] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

'''
marker = "// ── AUTH-2/3 — Enregistrement"
if text.count(marker) != 1:
    raise SystemExit('register marker mismatch')
text = text.replace(marker, route_block + marker, 1)
p.write_text(text, encoding='utf-8')

# Sensitive UI mutations.
rep('public/boutique/js/b-passkey-security.js', "import { apiGet, apiDelete } from './b-utils.js';\n",
    "import { apiGet, apiDelete } from './b-utils.js';\nimport { withStepUpRetry } from './b-passkey-step-up.js';\n",
    label='security step-up import')
rep('public/boutique/js/b-passkey-security.js', "        await apiDelete(`/api/auth/passkey/credentials/${encodeURIComponent(credential.id)}`);",
    "        await withStepUpRetry(() => apiDelete(`/api/auth/passkey/credentials/${encodeURIComponent(credential.id)}`));",
    label='revoke step-up')

rep('public/boutique/js/b-komerce.js', "import { loadPasskeySecurity } from './b-passkey-security.js';\n",
    "import { loadPasskeySecurity } from './b-passkey-security.js';\nimport { withStepUpRetry } from './b-passkey-step-up.js';\n",
    label='komerce step-up import')
rep('public/boutique/js/b-komerce.js', "      await apiDelete('/api/auth/me/pickup-authorization');",
    "      await withStepUpRetry(() => apiDelete('/api/auth/me/pickup-authorization'));",
    label='pickup delete retry')
rep('public/boutique/js/b-komerce.js',
    "      const result = await apiPut('/api/auth/me/pickup-authorization', {\n        given_names: givenNames, family_name: familyName,\n      });",
    "      const result = await withStepUpRetry(() => apiPut('/api/auth/me/pickup-authorization', {\n        given_names: givenNames, family_name: familyName,\n      }));",
    label='pickup put retry')

# Contract generator.
p = Path('scripts/contract-generate.js')
text = p.read_text(encoding='utf-8')
route_marker = "  { prefix: '/api/auth/passkey/login/verify',     method: 'post', schema: null },\n"
if text.count(route_marker) != 1:
    raise SystemExit('contract route marker mismatch')
text = text.replace(route_marker, route_marker + "  { prefix: '/api/auth/passkey/step-up/options',   method: 'post', schema: null },\n  { prefix: '/api/auth/passkey/step-up/verify',    method: 'post', schema: null },\n", 1)
known = "  '/api/auth/passkey/login/verify':     { post: { fields: ['verified','user'], source: 'route-read' } },\n"
if text.count(known) != 1:
    raise SystemExit('contract known marker mismatch')
text = text.replace(known, known + "  '/api/auth/passkey/step-up/options': { post: { fields: ['challenge','timeout','rpId','allowCredentials','userVerification','extensions'], source: 'service-read' } },\n  '/api/auth/passkey/step-up/verify':  { post: { fields: ['verified'], source: 'route-read' } },\n", 1)
ov = "  'POST /api/auth/passkey/login/verify': { '400': { description: 'Réponse WebAuthn invalide' }, '401': { description: 'Passkey inconnue, révoquée ou refusée' }, '500': { description: 'Erreur serveur WebAuthn' } },\n"
if text.count(ov) != 1:
    raise SystemExit('contract override marker mismatch')
text = text.replace(ov, ov + "  'POST /api/auth/passkey/step-up/options': { '401': { description: 'Session requise' }, '409': { description: 'Aucune passkey active' }, '500': { description: 'Erreur serveur WebAuthn' } },\n  'POST /api/auth/passkey/step-up/verify': { '400': { description: 'Réponse WebAuthn invalide' }, '401': { description: 'Session ou confirmation invalide' }, '500': { description: 'Erreur serveur WebAuthn' } },\n", 1)
p.write_text(text, encoding='utf-8')

# Feature manifests.
p = Path('features/auth-passkey.feature.js')
text = p.read_text(encoding='utf-8')
text = text.replace("(AUTH-2→6).", "(AUTH-2→7).")
text = text.replace("      'step-up des opérations sensibles (AUTH-7)',\n", "")
text = text.replace("      'services/webauthn-management-service.js',\n", "      'services/webauthn-management-service.js',\n      'utils/auth-session.js',\n      'middleware/require-recent-auth.js',\n")
text = text.replace("      'migrations/133_webauthn_credentials.sql',\n", "      'migrations/133_webauthn_credentials.sql',\n      'migrations/134_webauthn_step_up.sql',\n")
text = text.replace("      'tests/unit/auth-passkey-management.test.js',\n", "      'tests/unit/auth-passkey-management.test.js',\n      'tests/unit/auth-passkey-step-up.test.js',\n      'tests/unit/auth-session.test.js',\n      'tests/unit/require-recent-auth.test.js',\n")
text = text.replace("    authedRoutesDetected: 4,\n    totalRoutes: 6,", "    authedRoutesDetected: 6,\n    totalRoutes: 8,")
text = text.replace("      'DELETE /api/auth/passkey/credentials/{id}',\n", "      'DELETE /api/auth/passkey/credentials/{id}',\n      'POST /api/auth/passkey/step-up/options',\n      'POST /api/auth/passkey/step-up/verify',\n")
text = text.replace("    'une révocation est toujours scellée par id de gestion ET user_id authentifié',\n", "    'une révocation est toujours scellée par id de gestion ET user_id authentifié',\n    'un challenge step_up est distinct de login/register et lié au user_id de la session',\n    'une passkey d un autre compte ne peut jamais satisfaire un step-up',\n    'les mutations de sécurité exigent auth_time récent avec amr otp ou passkey',\n")
p.write_text(text, encoding='utf-8')

p = Path('public/boutique/features/auth-passkey.feature.js')
text = p.read_text(encoding='utf-8')
text = text.replace("(AUTH-6).", "(AUTH-6) et step-up Passkey des mutations sensibles (AUTH-7).")
text = text.replace("      'step-up (AUTH-7)',\n", "")
text = text.replace("      '../js/b-passkey-security.js',\n", "      '../js/b-passkey-security.js',\n      '../js/b-passkey-step-up.js',\n")
text = text.replace("      '../tests/unit/b-passkey-security.test.js',\n", "      '../tests/unit/b-passkey-security.test.js',\n      '../tests/unit/b-passkey-step-up.test.js',\n")
text = text.replace("      'loadPasskeySecurity (b-passkey-security.js)',\n", "      'loadPasskeySecurity (b-passkey-security.js)',\n      'performPasskeyStepUp / withStepUpRetry (b-passkey-step-up.js)',\n")
text = text.replace("    'la révocation UI utilise uniquement l identifiant de gestion opaque fourni par le serveur',\n", "    'la révocation UI utilise uniquement l identifiant de gestion opaque fourni par le serveur',\n    'un 428 step_up_required déclenche au plus un challenge Passkey puis un seul retry',\n    'sans Passkey disponible le client exige une reconnexion WhatsApp fraîche au lieu de contourner le step-up',\n")
p.write_text(text, encoding='utf-8')

# Remove temporary patch helper from intended final tree.
Path('scripts/tmp-auth7-apply.py').unlink()
Path('.github/workflows/tmp-auth7-finalize-v2.yml').unlink(missing_ok=True)
