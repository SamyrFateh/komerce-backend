'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, text) { fs.writeFileSync(file, text); }
function replaceOnce(file, from, to) {
  const text = read(file);
  if (!text.includes(from)) throw new Error(`${file}: target not found: ${from.slice(0, 180)}`);
  write(file, text.replace(from, to));
}
function replaceRegex(file, re, to) {
  const text = read(file);
  if (!re.test(text)) throw new Error(`${file}: regex target not found: ${re}`);
  write(file, text.replace(re, to));
}

// ──────────────────────────────────────────────────────────────
// P0 — central runtime-environment guard for staging-only surfaces
// KOMERCE_ENV is the business runtime identity. NODE_ENV is only a fallback
// for older/local deployments where KOMERCE_ENV is absent.
// ──────────────────────────────────────────────────────────────
const middlewareFile = 'middleware/require-non-production.js';
write(middlewareFile, `/**
 * @komerce-arch
 * @role          runtime-environment-guard
 * @domain        infrastructure
 * @layer         middleware
 * @criticality   high
 * @inputs        KOMERCE_ENV, NODE_ENV, optional_bypass_env_var
 * @outputs       next_or_403
 * @depends       none
 * @used-by       routes/admin/system.js, routes/simulator.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      production_sensitive_routes_fail_closed_on_business_environment
 * @impact-areas  security, admin-dashboard, simulator
 * @version       2026-08
 */
'use strict';

function resolveRuntimeEnvironment() {
  const komerceEnv = String(process.env.KOMERCE_ENV || '').trim().toLowerCase();
  if (komerceEnv) return { env: komerceEnv, source: 'KOMERCE_ENV' };

  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  return { env: nodeEnv, source: 'NODE_ENV' };
}

function requireNonProduction(bypassEnvVar) {
  return (req, res, next) => {
    const { env, source } = resolveRuntimeEnvironment();
    const bypass = Boolean(bypassEnvVar) && process.env[bypassEnvVar] === 'true';

    if (env === 'production' && !bypass) {
      return res.status(403).json({
        error: 'Endpoint désactivé en production',
        environment_source: source,
        ...(bypassEnvVar ? { hint: \`Définissez explicitement ${bypassEnvVar}=true pour une activation exceptionnelle\` } : {}),
      });
    }

    next();
  };
}

module.exports = { requireNonProduction, resolveRuntimeEnvironment };
`);

const adminFile = 'routes/admin/system.js';
replaceOnce(
  adminFile,
  "const { authenticate, requireRole } = require('../../middleware/auth');\n",
  "const { authenticate, requireRole } = require('../../middleware/auth');\nconst { requireNonProduction } = require('../../middleware/require-non-production');\n"
);
replaceOnce(
  adminFile,
  "const guard = [authenticate, requireRole(['admin'])];\n",
  "const guard = [authenticate, requireRole(['admin'])];\nconst allowFlushOutsideProd = requireNonProduction('ALLOW_FLUSH');\nconst allowSeedOutsideProd = requireNonProduction('ALLOW_SEED');\n"
);
replaceOnce(
  adminFile,
  "router.post('/reset', ...guard, validate(admin.reset), async (req, res, next) => {\n  // ══════════════════════════════════════════════════════════════════\n  // CRIT-04 FIX: Block in production — this endpoint is dev/staging only.\n  // R4 FIX: ALLOW_FLUSH distinct de ALLOW_SEED — activer ALLOW_SEED en prod\n  //         pour un seed de démo ne doit pas débloquer le flush destructif.\n  // ══════════════════════════════════════════════════════════════════\n  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_FLUSH !== 'true') {\n    return res.status(403).json({\n      error: 'Endpoint désactivé en production',\n      hint: 'Ajoutez ALLOW_FLUSH=true (distinct de ALLOW_SEED) dans les variables Railway pour activer',\n    });\n  }\n\n",
  "router.post('/reset', ...guard, validate(admin.reset), allowFlushOutsideProd, async (req, res, next) => {\n  // Production guard centralisé : KOMERCE_ENV est prioritaire sur NODE_ENV.\n  // ALLOW_FLUSH reste un bypass explicite distinct de ALLOW_SEED.\n\n"
);
replaceOnce(
  adminFile,
  "router.post('/seed-test', ...guard, async (req, res, next) => {\n  // ══════════════════════════════════════════════════════════════════\n  // CRIT-04 FIX: Block in production — seed-test is dev/staging only.\n  // ══════════════════════════════════════════════════════════════════\n  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {\n    return res.status(403).json({\n      error: 'Endpoint désactivé en production',\n      hint: 'Ajoutez ALLOW_SEED=true dans les variables Railway pour activer',\n    });\n  }\n\n",
  "router.post('/seed-test', ...guard, allowSeedOutsideProd, async (req, res, next) => {\n  // Production guard centralisé : KOMERCE_ENV est prioritaire sur NODE_ENV.\n\n"
);

const simulatorFile = 'routes/simulator.js';
replaceOnce(
  simulatorFile,
  "const { authenticate, requireRole } = require('../middleware/auth');\n",
  "const { authenticate, requireRole } = require('../middleware/auth');\nconst { requireNonProduction } = require('../middleware/require-non-production');\n"
);
replaceOnce(
  simulatorFile,
  "const adminAuth = [authenticate, requireRole(['admin'])];\n",
  "const adminAuth = [authenticate, requireRole(['admin']), requireNonProduction()];\n"
);

// ──────────────────────────────────────────────────────────────
// Backend debt hygiene — remove 16 stale large-file grandfather entries.
// The only remaining >800-line exception is scan-engine.js, audited 2026-08-28
// as a cohesive scan state machine (KEEP_LARGE, no cross-feature lifecycle bypass).
// ──────────────────────────────────────────────────────────────
const auditFile = 'scripts/audit-backend-arch.js';
replaceRegex(
  auditFile,
  /\/\/ I-BACK-2 : fichiers > 800 lignes existants au 2026-05-17[\s\S]*?const ALLOWED_LARGE_FILES = new Set\(\[[\s\S]*?\n\]\);/,
  `// I-BACK-2 : exception de taille explicitement réauditée le 2026-08-28.\n// Les 16 anciennes entrées ont été supprimées : elles sont désormais <800 lignes\n// ou n'existent plus. scan-engine.js reste volontairement monolithique : state\n// machine de scan cohésive, testée et sans contournement de lifecycle owner.\nconst ALLOWED_LARGE_FILES = new Set([\n  'services/scan-engine.js', // 935L au 2026-08-28 — KEEP_LARGE, vigilance si content verification grossit\n]);`
);

// payment-paypal no longer writes orders.status directly: remove the stale
// historical exception so the ownership matrix reflects current code.
replaceOnce(
  auditFile,
  "      // ── Exception délibérée (P3-A.4, 2026-06) — PAS une dette à fermer ──\n      // refundPaypalOrder force status='refunded' depuis N'IMPORTE QUEL statut\n      // payé (seule précondition : payment_status='paid' + capture existante).\n      // order-status-machine n'autorise 'refunded' que depuis 'cancelled' :\n      // y passer bloquerait ce refund APRÈS que l'argent ait déjà été rendu.\n      // Resoumettre à revue si la précondition métier change.\n      'services/payment-paypal.js',\n",
  ''
);

// N2 baseline: a 0/0 status is information, not a debt item.
const debtFile = 'scripts/debt-audit.js';
replaceOnce(
  debtFile,
  "  if (cqBaseline) {\n    const totalErrors   = cqBaseline.totalErrors   || 0;\n    const totalWarnings = cqBaseline.totalWarnings || 0;\n    const fileCount     = Object.keys(cqBaseline.files || {}).length;\n    addDebt({\n      rule: 'N2 (baseline)',\n      label: 'Violations N2 figées dans la baseline',\n      lot: 'Correction progressive — relance npm run quality:gate pour mesurer',\n      entries: [`${totalErrors} erreur(s), ${totalWarnings} avertissement(s) dans ${fileCount} fichier(s)`],\n      note: `Baseline sauvegardée le ${cqBaseline.savedAt || '?'}`,\n    });\n  }\n",
  "  if (cqBaseline) {\n    const totalErrors   = cqBaseline.totalErrors   || 0;\n    const totalWarnings = cqBaseline.totalWarnings || 0;\n    const fileCount     = Object.keys(cqBaseline.files || {}).length;\n    if (totalErrors > 0 || totalWarnings > 0) {\n      addDebt({\n        rule: 'N2 (baseline)',\n        label: 'Violations N2 figées dans la baseline',\n        lot: 'Correction progressive — relance npm run quality:gate pour mesurer',\n        entries: [`${totalErrors} erreur(s), ${totalWarnings} avertissement(s) dans ${fileCount} fichier(s)`],\n        note: `Baseline sauvegardée le ${cqBaseline.savedAt || '?'}`,\n      });\n    }\n  }\n"
);

// Security: fast-uri <3.1.5 is vulnerable. Root AJV is production runtime.
for (const packageFile of ['package.json', 'public/boutique/package.json']) {
  replaceOnce(packageFile, '"fast-uri": "^3.1.4"', '"fast-uri": "^3.1.5"');
}

// ──────────────────────────────────────────────────────────────
// Regression tests for the central environment guard.
// ──────────────────────────────────────────────────────────────
write('tests/unit/require-non-production.test.js', `'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { requireNonProduction, resolveRuntimeEnvironment } = require('../../middleware/require-non-production');

const ORIGINAL_ENV = { ...process.env };

function invoke(mw) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = jest.fn();
  mw({}, res, next);
  return { res, next };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.KOMERCE_ENV;
  delete process.env.NODE_ENV;
  delete process.env.ALLOW_FLUSH;
});

afterAll(() => { process.env = ORIGINAL_ENV; });

test('KOMERCE_ENV est prioritaire sur NODE_ENV', () => {
  process.env.KOMERCE_ENV = 'staging';
  process.env.NODE_ENV = 'production';
  expect(resolveRuntimeEnvironment()).toEqual({ env: 'staging', source: 'KOMERCE_ENV' });
  const { next } = invoke(requireNonProduction());
  expect(next).toHaveBeenCalledTimes(1);
});

test('bloque quand KOMERCE_ENV=production même si NODE_ENV=development', () => {
  process.env.KOMERCE_ENV = 'production';
  process.env.NODE_ENV = 'development';
  const { res, next } = invoke(requireNonProduction());
  expect(res.statusCode).toBe(403);
  expect(res.body.error).toMatch(/désactivé en production/);
  expect(res.body.environment_source).toBe('KOMERCE_ENV');
  expect(next).not.toHaveBeenCalled();
});

test('retombe sur NODE_ENV quand KOMERCE_ENV est absent', () => {
  process.env.NODE_ENV = 'production';
  const { res, next } = invoke(requireNonProduction());
  expect(res.statusCode).toBe(403);
  expect(res.body.environment_source).toBe('NODE_ENV');
  expect(next).not.toHaveBeenCalled();
});

test('bypass explicite uniquement pour la variable demandée', () => {
  process.env.KOMERCE_ENV = 'production';
  process.env.ALLOW_FLUSH = 'true';
  const { next } = invoke(requireNonProduction('ALLOW_FLUSH'));
  expect(next).toHaveBeenCalledTimes(1);
});
`);

// Simulator route: prove the business environment guard is wired, not merely unit-tested.
const simulatorTest = 'tests/unit/simulator-route.test.js';
replaceOnce(
  simulatorTest,
  "beforeEach(() => {\n  jest.clearAllMocks();\n",
  "beforeEach(() => {\n  jest.clearAllMocks();\n  delete process.env.KOMERCE_ENV;\n"
);
replaceOnce(
  simulatorTest,
  "describe('routes/simulator — auth', () => {\n",
  "describe('routes/simulator — runtime environment', () => {\n  it('403 en production métier même pour un admin', async () => {\n    process.env.KOMERCE_ENV = 'production';\n    const res = await request(app).post('/api/simulator/start').send({});\n    expect(res.status).toBe(403);\n    expect(mockStart).not.toHaveBeenCalled();\n  });\n\n  it('reste disponible en staging même si NODE_ENV=production', async () => {\n    process.env.KOMERCE_ENV = 'staging';\n    process.env.NODE_ENV = 'production';\n    mockStart.mockResolvedValueOnce({ running: true });\n    const res = await request(app).post('/api/simulator/start').send({});\n    expect(res.status).toBe(200);\n  });\n});\n\ndescribe('routes/simulator — auth', () => {\n"
);

// Admin route regression: business environment must dominate NODE_ENV.
const adminTest = 'tests/unit/admin-system.test.js';
replaceOnce(
  adminTest,
  "  delete process.env.NODE_ENV;\n  delete process.env.ALLOW_FLUSH;\n",
  "  delete process.env.NODE_ENV;\n  delete process.env.KOMERCE_ENV;\n  delete process.env.ALLOW_FLUSH;\n"
);
replaceOnce(
  adminTest,
  "  it('403 en production sans ALLOW_FLUSH', async () => {\n    process.env.NODE_ENV = 'production';\n",
  "  it('403 en production sans ALLOW_FLUSH', async () => {\n    process.env.KOMERCE_ENV = 'production';\n    process.env.NODE_ENV = 'development';\n"
);
replaceOnce(
  adminTest,
  "  it('autorisé en production si ALLOW_FLUSH=true', async () => {\n    process.env.NODE_ENV = 'production';\n",
  "  it('autorisé en production si ALLOW_FLUSH=true', async () => {\n    process.env.KOMERCE_ENV = 'production';\n    process.env.NODE_ENV = 'development';\n"
);

console.log('Debt Zero: final GoLive P0/B closure applied');
