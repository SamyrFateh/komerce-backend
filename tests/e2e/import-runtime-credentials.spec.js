/**
 * @e2e   import-runtime-credentials.spec.js
 * @feature sourcing, dashboard (identifiants fournisseur depuis Sources, sans Railway)
 * @brief Parcours CJ (configurer → tester → « ✓ Connexion valide »), parcours remplacement
 *        (refus fournisseur = ancienne connexion intacte, puis succès) et parcours OAuth (aucun
 *        champ secret). Le navigateur ne relit JAMAIS un secret : ni réponse API, ni DOM, ni
 *        valeur de champ. API simulée par un automate qui reproduit les garde-fous du backend
 *        (la vérité reste côté serveur : tests/integration/provider-credential-vault-real-db.test.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const CSS = ['base', 'canonical-theme-v2', 'canonical-shell-v4', 'canonical-legacy-theme-v1', 'cockpit-legacy-v1', 'import-runtime'];
const BASE = '/api/admin/workspaces/sourcing/sources';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const CJ_AUTH = {
  mode: 'api_key',
  scope: 'source',
  description: 'Renseignez la clé API permanente du compte CJdropshipping.',
  fields: [{
    key: 'api_key',
    label: 'Clé API CJdropshipping',
    secret: true,
    help: 'Clé API du compte fournisseur utilisée pour autoriser Komerce.',
  }],
};
const OAUTH_AUTH = { mode: 'oauth', scope: 'platform', fields: [] };

function createBackend({ ref = 'api:cj', adapter = 'cj', auth = CJ_AUTH, credential = null } = {}) {
  const backend = {
    ref, auth,
    secret: credential,       // secret côté serveur uniquement
    tested: false,
    credentialStatus: credential ? 'valid' : 'missing',
    calls: [],
    responses: [],            // tout ce que le navigateur a reçu
    requests: [],
    control() {
      const missing = backend.credentialStatus === 'missing';
      const valid = backend.credentialStatus === 'valid';
      return {
        source_ref: ref, label: adapter === 'cj' ? 'CJdropshipping API' : 'AliExpress',
        state: missing ? 'to_configure' : valid ? 'to_certify' : 'connection_to_test',
        archived: false, autopilot_enabled: false, autopilot_ready: false, activation_ready: false,
        production_runtime_certified: false, connector_ready: true,
        credential_status: backend.credentialStatus, credential_in_vault: Boolean(backend.secret), auth: backend.auth,
        connection: { verified: valid, test_status: valid ? 'ok' : null },
        capabilities: { discovery: false, sync: false, import: false, production: false },
      };
    },
  };
  return backend;
}

async function mount(page, backend) {
  const reply = (route, body, status = 200) => {
    backend.responses.push(JSON.stringify(body));
    return json(route, body, status);
  };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = decodeURIComponent(url.pathname);
    if (p === '/admin/import-runtime') {
      const links = CSS.map((n) => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head>
        <body class="kmc-shell-v4"><main id="root"></main><script src="/dashboards/canonical/js/import-runtime.js"></script></body></html>` });
    }
    if (p.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, p.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (p.endsWith('/import-passages')) return json(route, { passages: [], offset: 0, next_offset: null });
    if (p.endsWith('/import-cockpit')) {
      return reply(route, { source_controls: [backend.control()], source_requests: [], lots: [], selected: null, run_nav: { older_ref: null, newer_ref: null } });
    }
    if (req.method() === 'POST' && p.startsWith(`${BASE}/${backend.ref}/`)) {
      const action = p.slice(`${BASE}/${backend.ref}/`.length);
      const body = JSON.parse(req.postData() || '{}');
      backend.calls.push(action);
      backend.requests.push(body);
      if (action === 'credentials') {
        if (backend.secret) return reply(route, { error: 'Des identifiants existent déjà : utilisez le remplacement.', code: 'credentials_already_configured' }, 409);
        backend.secret = body.credentials?.api_key;
        backend.credentialStatus = 'untested';
        return reply(route, { ok: true, action: 'configure_credentials', result: { configured: true, connected: false, credential_status: 'untested' } }, 201);
      }
      if (action === 'credentials/rotate') {
        const next = body.credentials?.api_key;
        if (String(next).startsWith('BAD')) {
          return reply(route, { ok: true, action: 'rotate_credentials', result: { ok: false, rotated: false, code: 'credentials_rejected', message: 'Le fournisseur a refusé les identifiants.' } });
        }
        backend.secret = next;
        backend.credentialStatus = 'valid';
        return reply(route, { ok: true, action: 'rotate_credentials', result: { ok: true, rotated: true, code: 'connection_ok', message: 'Connexion valide' } });
      }
      if (action === 'test-connection') {
        const ok = Boolean(backend.secret) && String(backend.secret).startsWith('GOOD');
        backend.credentialStatus = ok ? 'valid' : 'invalid';
        return reply(route, { ok: true, result: ok
          ? { ok: true, code: 'connection_ok', message: 'Connexion valide' }
          : { ok: false, code: 'credentials_rejected', message: 'Le fournisseur a refusé les identifiants.' } });
      }
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.setViewportSize({ width: 1672, height: 941 });
}

async function boot(page) {
  await page.goto(`${ORIGIN}/admin/import-runtime?view=sources`);
  await page.evaluate(() => window.KomerceCanonicalImportRuntime.mount({ root: document.getElementById('root') }));
}

const card = (page, ref = 'api:cj') => page.locator(`[data-source-card="${ref}"]`);

async function assertNoSecretInBrowser(page, backend, secrets) {
  const html = await page.content();
  const values = await page.$$eval('input', (nodes) => nodes.map((n) => n.value));
  for (const secret of secrets) {
    expect(html).not.toContain(secret);
    expect(values.join('|')).not.toContain(secret);
    expect(backend.responses.join('|')).not.toContain(secret);
  }
}

test.describe('Sources — identifiants fournisseur', () => {
  test('CJ : À CONFIGURER → configurer → À TESTER → tester → « ✓ Connexion valide »', async ({ page }) => {
    const backend = createBackend();
    await mount(page, backend);
    await boot(page);

    await expect(card(page).locator('.kir-source-badge')).toHaveText('À CONFIGURER');
    await expect(card(page).locator('[data-credentials-status]')).toHaveText('À configurer');
    await expect(card(page).locator('[data-source-step]')).toHaveCount(0);
    await expect(card(page).locator('[data-source-toggle]')).toBeDisabled();

    // Formulaire dérivé du contrat auth : l'opérateur sait quoi fournir, sans nom de variable Railway.
    await expect(card(page).locator('[data-credentials-guidance]')).toContainText('clé API permanente du compte CJdropshipping');
    await expect(card(page).locator('.kir-wizard-field', { hasText: 'Clé API CJdropshipping' })).toContainText('autoriser Komerce');
    const field = card(page).locator('[data-credential-field="api_key"]');
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toHaveValue('');
    await expect(card(page).locator('[data-credentials-form] button[type="submit"]')).toHaveText('Configurer la connexion');

    await field.fill('GOOD-cj-secret-123456');
    await card(page).locator('[data-credentials-form] button[type="submit"]').click();

    await expect(card(page).locator('[data-credentials-status]')).toHaveText('Configurée');
    await expect(card(page).locator('[data-credentials-notice]')).toHaveText('Identifiants enregistrés.');
    await expect(card(page).locator('.kir-source-badge')).toHaveText('CONNEXION À TESTER');
    await expect(card(page).locator('[data-credentials-open]')).toHaveText('Modifier les identifiants');
    expect(backend.requests[0]).toEqual({ credentials: { api_key: 'GOOD-cj-secret-123456' } });
    await assertNoSecretInBrowser(page, backend, ['GOOD-cj-secret-123456']);

    // « Modifier les identifiants » ouvre un formulaire VIDE (jamais la valeur enregistrée).
    await card(page).locator('[data-credentials-open]').click();
    await expect(card(page).locator('[data-credential-field="api_key"]')).toHaveValue('');
    await card(page).locator('[data-credentials-cancel]').click();

    await card(page).locator('[data-source-step="test"]').click();
    await expect(card(page).locator('.kir-source-badge')).toHaveText('À CERTIFIER');
    await expect(card(page).locator('[data-source-connection]')).toHaveText('Connectée ✓');
    expect(backend.calls).toEqual(['credentials', 'test-connection']);
    await assertNoSecretInBrowser(page, backend, ['GOOD-cj-secret-123456']);
  });

  test('Remplacement : refus fournisseur = ancienne connexion intacte ; succès = « ✓ Connexion valide »', async ({ page }) => {
    const backend = createBackend({ credential: 'GOOD-old-secret-000111' });
    await mount(page, backend);
    await boot(page);

    await expect(card(page).locator('[data-credentials-status]')).toHaveText('Configurée');
    await card(page).locator('[data-credentials-open]').click();
    await expect(card(page).locator('[data-credential-field="api_key"]')).toHaveValue('');
    await expect(card(page).locator('[data-credentials-form] button[type="submit"]')).toHaveText('Remplacer et tester');

    await card(page).locator('[data-credential-field="api_key"]').fill('BAD-new-secret-999888');
    await card(page).locator('[data-credentials-form] button[type="submit"]').click();
    await expect(card(page).locator('[data-credentials-error]')).toContainText('refusé');
    expect(backend.secret).toBe('GOOD-old-secret-000111');           // l'ancienne connexion reste active
    await expect(card(page).locator('[data-credentials-status]')).toHaveText('Configurée');
    await expect(card(page).locator('[data-credential-field="api_key"]')).toHaveValue('');
    await assertNoSecretInBrowser(page, backend, ['BAD-new-secret-999888', 'GOOD-old-secret-000111']);

    await card(page).locator('[data-credential-field="api_key"]').fill('GOOD-new-secret-777666');
    await card(page).locator('[data-credentials-form] button[type="submit"]').click();
    await expect(card(page).locator('[data-credentials-notice]')).toHaveText('✓ Connexion valide');
    expect(backend.secret).toBe('GOOD-new-secret-777666');
    expect(backend.calls).toEqual(['credentials/rotate', 'credentials/rotate']);
    await assertNoSecretInBrowser(page, backend, ['BAD-new-secret-999888', 'GOOD-old-secret-000111', 'GOOD-new-secret-777666']);
  });

  test('Un rafraîchissement ne vide pas un secret en cours de saisie', async ({ page }) => {
    const backend = createBackend();
    await mount(page, backend);
    await boot(page);
    const field = card(page).locator('[data-credential-field="api_key"]');
    await field.fill('typing-in-progress');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(300);
    await expect(field).toHaveValue('typing-in-progress');
  });

  test('OAuth plateforme : aucun champ secret, aucun formulaire d’identifiants', async ({ page }) => {
    const backend = createBackend({ ref: 'api:aliexpress', adapter: 'aliexpress', auth: OAUTH_AUTH, credential: null });
    backend.credentialStatus = 'untested';
    await mount(page, backend);
    await boot(page);
    await expect(card(page, 'api:aliexpress')).toBeVisible();
    await expect(card(page, 'api:aliexpress').locator('[data-credentials-form]')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test('Erreur serveur : message sûr, aucun secret ni trace', async ({ page }) => {
    const backend = createBackend();
    await mount(page, backend);
    await page.route(/\/sources\/api(:|%3A)cj\/credentials$/, (route) => json(route, { error: 'Les identifiants enregistrés sont illisibles : nouvelle saisie nécessaire.', code: 'credentials_unreadable' }, 409));
    await boot(page);
    await card(page).locator('[data-credential-field="api_key"]').fill('SECRET-should-vanish-4242');
    await card(page).locator('[data-credentials-form] button[type="submit"]').click();
    await expect(card(page).locator('[data-credentials-error]')).toContainText('nouvelle saisie');
    await expect(card(page).locator('[data-credential-field="api_key"]')).toHaveValue('');
    await assertNoSecretInBrowser(page, backend, ['SECRET-should-vanish-4242']);
    expect(await page.content()).not.toMatch(/stack|at .*\.js:\d+/i);
  });
});
