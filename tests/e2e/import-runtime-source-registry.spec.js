/**
 * @e2e   import-runtime-source-registry.spec.js
 * @feature sourcing, dashboard (gestion canonique des sources depuis l'interface)
 * @brief Assistant « + Ajouter une source » de la vue Sources : API fournisseur → connexion →
 *        préparation/certification → activation → Suivi, doublon, « Autre fournisseur »
 *        (CONNECTEUR REQUIS, jamais une source) et persistance au rechargement.
 *        API simulée par un petit automate qui reproduit les garde-fous du backend
 *        (la vérité reste côté serveur : voir tests/integration/sourcing-source-registry-real-db.test.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const CSS = ['base', 'canonical-theme-v2', 'canonical-shell-v4', 'canonical-legacy-theme-v1', 'cockpit-legacy-v1', 'import-runtime'];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function emptyRun(runRef, provider) {
  return {
    run_ref: runRef, provider, source_ref: 'api:cj', status: 'COMPLETED', started_at: new Date().toISOString(), progress_pct: 100,
    accounting: { source_total: 1, accepted: 1, duplicates: 0, rejected: 0, quarantined: 0, deferred: 0, certification_blocked: 0, refined: 1, taxonomized: 1,
      certified: 1, catalogued: 1, awaiting_catalogue_promotion: 0, unaccounted: 0, overflow: 0, action_required: 0 },
    sourcing_status: 'DONE', action_items: [], stages: [], events: [], recent_items: [],
    business: { run_ref: runRef, business_status: 'CLOSED', promoted_products: 1, decisions: { catalogue: 0, commercial: 0, exceptions: 0 },
      closure: { eligible: false, remaining_products: 0 }, products: [] },
  };
}

// Automate backend : reproduit création fail-closed, test de connexion, préparation, activation.
function createBackend() {
  const backend = {
    source: null,            // une seule source API possible : CJ
    requests: [],
    runs: [],                // passages créés
    connectionOk: true,
    calls: [],
    state() {
      const s = backend.source;
      if (!s) return null;
      let state;
      if (s.archived) state = 'archived';
      else if (s.enabled) state = 'active';
      else if (!s.connected) state = 'connection_to_test';
      else if (!s.certified) state = 'to_certify';
      else state = 'ready';
      return {
        source_ref: 'api:cj', label: s.label || 'CJdropshipping API', state, archived: Boolean(s.archived), autopilot_enabled: s.enabled,
        autopilot_ready: s.certified, activation_ready: true, production_runtime_certified: s.certified,
        connection: { verified: s.connected || s.certified },
        capabilities: { discovery: s.certified, sync: s.certified, import: s.certified, production: s.certified },
        last_capture_at: s.certified ? new Date().toISOString() : null,
      };
    },
    cockpit(requestedRun) {
      const lots = backend.runs.map((r) => ({ run_ref: r.run_ref, provider: 'CJdropshipping', source_total: 1, business_status: 'CLOSED' }));
      const selected = backend.runs.find((r) => r.run_ref === requestedRun) || backend.runs[backend.runs.length - 1] || null;
      return {
        source_controls: backend.source ? [backend.state()] : [],
        source_requests: backend.requests,
        lots, selected, run_nav: { older_ref: null, newer_ref: null },
      };
    },
  };
  return backend;
}

async function mount(page, backend) {
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
    if (p.endsWith('/import-cockpit')) return json(route, backend.cockpit(url.searchParams.get('run')));

    const base = '/api/admin/workspaces/sourcing/sources';
    if (req.method() === 'GET' && p === `${base}/catalog`) {
      backend.calls.push('catalog');
      return json(route, { connectors: [
        { adapter: 'cj', name: 'CJdropshipping', label: 'CJdropshipping API', available: true, automatable: true, onboarding_ready: true,
          onboarding: { status: 'defined', authority: 'provider_documentation', evidence_url: 'https://developers.cjdropshipping.com/en/summary/course.html',
            prerequisites: ['Disposer d’un compte CJdropshipping avec accès API autorisé'],
            setup_steps: ['Dans CJdropshipping : My CJ → Authorization → API → API Key', 'Créer ou récupérer la clé API du compte fournisseur'],
            operator_must_obtain: [{ key: 'api_key', label: 'Clé API CJdropshipping' }],
            operator_must_not_request: ['Mot de passe du compte CJdropshipping', 'Access Token ou Refresh Token temporaire'],
            completion: 'Renseigner la clé API dans Komerce.' },
          connection_mode: 'server_managed', connect_path: null, can_test_connection: true,
          auth: { mode: 'api_key', scope: 'source',
            fields: [{ key: 'api_key', label: 'Clé API CJdropshipping', secret: true }] },
          can_create: !backend.source, reason: null, existing_source_ref: backend.source ? 'api:cj' : null, existing_archived: Boolean(backend.source?.archived) },
        { adapter: 'ebay', name: 'eBay Sandbox', label: 'eBay Sandbox Browse API', available: true, automatable: false, onboarding_ready: false,
          onboarding: { status: 'missing', prerequisites: [], setup_steps: [], operator_must_obtain: [], operator_must_not_request: [], completion: null },
          connection_mode: 'server_managed', connect_path: null, can_test_connection: true, auth: { mode: 'client_credentials', scope: 'platform', fields: [] },
          can_create: false, reason: 'Autopilot non certifié', existing_source_ref: null },
      ] });
    }
    if (req.method() === 'POST' && p === base) {
      backend.calls.push('create');
      if (backend.source) return json(route, { error: 'Cette source existe déjà', code: 'sourcing_source_already_exists', details: { existing_source_ref: 'api:cj' } }, 409);
      backend.source = { connected: false, certified: false, enabled: false };
      return json(route, { ok: true, result: { source_ref: 'api:cj', created: true } }, 201);
    }
    if (req.method() === 'POST' && p === `${base}/requests`) {
      backend.calls.push('request');
      const body = JSON.parse(req.postData() || '{}');
      backend.requests.push({ request_ref: `REQ-${backend.requests.length + 1}`, provider_name: body.provider_name,
        requested_label: body.requested_label || body.provider_name, reference_url: body.reference_url || null, status: 'connector_required' });
      return json(route, { ok: true, result: { status: 'connector_required' } }, 201);
    }
    if (req.method() === 'PATCH' && p === `${base}/api:cj`) {
      backend.calls.push('rename');
      const body = JSON.parse(req.postData() || '{}');
      if (!body.label || body.label.length < 2) return json(route, { error: 'Nom de la source invalide (2 à 80 caractères)', code: 'sourcing_source_label_invalid' }, 400);
      backend.source.label = body.label;
      return json(route, { ok: true, result: { source_ref: 'api:cj', label: body.label } });
    }
    if (req.method() === 'POST' && p === `${base}/api:cj/archive`) {
      backend.calls.push('archive');
      backend.source.archived = true; backend.source.enabled = false;
      return json(route, { ok: true, result: { archived: true, changed: true } });
    }
    if (req.method() === 'POST' && p === `${base}/api:cj/restore`) {
      backend.calls.push('restore');
      backend.source.archived = false;
      return json(route, { ok: true, result: { archived: false, changed: true } });
    }
    const reqMatch = p.match(new RegExp(`^${base}/requests/([^/]+)$`));
    if (reqMatch && req.method() === 'PATCH') {
      backend.calls.push('request-rename');
      const found = backend.requests.find((r) => r.request_ref === reqMatch[1]);
      if (!found) return json(route, { error: 'Demande introuvable', code: 'sourcing_source_request_not_found' }, 404);
      found.requested_label = JSON.parse(req.postData() || '{}').requested_label;
      return json(route, { ok: true, result: found });
    }
    if (reqMatch && req.method() === 'DELETE') {
      backend.calls.push('request-delete');
      backend.requests = backend.requests.filter((r) => r.request_ref !== reqMatch[1]);
      return json(route, { ok: true, result: { deleted: true } });
    }
    if (req.method() === 'POST' && p === `${base}/api:cj/test-connection`) {
      backend.calls.push('test');
      if (backend.connectionOk) backend.source.connected = true;
      return json(route, { ok: true, result: backend.connectionOk
        ? { ok: true, code: 'connection_ok', message: 'Connexion valide' }
        : { ok: false, code: 'credentials_rejected', message: 'Identifiants refusés par le fournisseur' } });
    }
    if (req.method() === 'POST' && p === `${base}/api:cj/prepare`) {
      backend.calls.push('prepare');
      if (!backend.source.connected) return json(route, { error: 'Testez la connexion avant de préparer la source', code: 'sourcing_source_connection_untested' }, 409);
      await new Promise((r) => setTimeout(r, 300));
      backend.source.certified = true;
      backend.runs.push(emptyRun('KIR-000010', 'CJdropshipping'));
      return json(route, { ok: true, result: { prepared: true, autopilot_enabled: false, certification_run: { status: 'certified', run_ref: 'KIR-000010' } } });
    }
    if (req.method() === 'POST' && p === `${base}/api:cj/activate`) {
      backend.calls.push('activate');
      if (!backend.source.certified) return json(route, { error: 'Source non certifiée', code: 'sourcing_source_activation_blocked' }, 409);
      backend.source.enabled = true;
      backend.runs.push(emptyRun('KIR-000011', 'CJdropshipping'));
      return json(route, { ok: true, result: { prepared: false, certification_run: null } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.setViewportSize({ width: 1672, height: 941 });
}

async function boot(page, query = 'view=sources') {
  await page.goto(`${ORIGIN}/admin/import-runtime?${query}`);
  await page.evaluate(() => window.KomerceCanonicalImportRuntime.mount({ root: document.getElementById('root') }));
}

const card = (page) => page.locator('[data-source-card="api:cj"]');
const wizard = (page) => page.locator('[data-source-wizard]');

async function addCj(page) {
  await page.locator('[data-add-source]').click();
  await wizard(page).locator('[data-wizard-kind="api"]').click();
  await wizard(page).locator('[data-wizard-create="cj"]').click();
  await expect(wizard(page).locator('[data-wizard-created]')).toBeVisible();
}

test.describe('Sources — assistant « + Ajouter une source »', () => {
  test('A–E : ajout, test de connexion, interrupteur verrouillé puis activable après certification, activation → ON → Suivi', async ({ page }) => {
    const backend = createBackend();
    await mount(page, backend);
    await boot(page);
    await expect(page.locator('.kir-sources-empty')).toBeVisible();
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Sources');

    // Avant même de créer la source, le registre explique ce qu'il faudra fournir.
    await page.locator('[data-add-source]').click();
    await wizard(page).locator('[data-wizard-kind="api"]').click();
    await expect(wizard(page).locator('[data-wizard-connector="cj"] [data-wizard-auth-requirement]'))
      .toContainText('Clé API CJdropshipping');
    await wizard(page).locator('[data-wizard-create="cj"]').click();
    await expect(wizard(page).locator('[data-wizard-created]')).toBeVisible();

    // A — ajout via l'assistant : fail-closed, aucun import déclenché.
    expect(backend.calls).toEqual(['catalog', 'create']);
    expect(backend.runs).toHaveLength(0);
    await expect(card(page).locator('.kir-source-badge')).toHaveText('CONNEXION À TESTER');
    await expect(card(page).locator('[data-source-toggle]')).toBeDisabled();
    await expect(card(page).locator('[data-source-toggle]')).toHaveAttribute('aria-checked', 'false');
    await expect(wizard(page).locator('[data-wizard-checklist]')).toHaveCount(0);

    // B — test de connexion réel : ce n'est pas une certification.
    await wizard(page).locator('[data-wizard-test]').click();
    await expect(wizard(page).locator('[data-wizard-test-result]')).toContainText('Connexion valide');
    await expect(card(page).locator('.kir-source-badge')).toHaveText('À CERTIFIER');
    expect(backend.runs).toHaveLength(0);

    // C — interrupteur toujours désactivé avant la certification.
    await expect(card(page).locator('[data-source-toggle]')).toBeDisabled();
    await expect(wizard(page).locator('[data-wizard-activate]')).toHaveCount(0);
    await expect(wizard(page).locator('[data-wizard-checklist]')).toContainText('Certification');

    // D — certification réelle (premier passage) puis source prête.
    await wizard(page).locator('[data-wizard-prepare]').click();
    await expect(wizard(page).locator('[data-wizard-ready]')).toBeVisible();
    await expect(card(page).locator('.kir-source-badge')).toHaveText('PRÊTE');
    await expect(card(page).locator('[data-source-toggle]')).toBeEnabled();
    await expect(card(page).locator('[data-source-toggle]')).toHaveAttribute('aria-checked', 'false');
    expect(backend.source.enabled).toBe(false);

    // E — activation explicite → ON → nouveau passage visible dans Suivi.
    await wizard(page).locator('[data-wizard-activate]').click();
    await expect.poll(() => backend.source.enabled).toBe(true);
    await expect.poll(() => backend.calls.filter((c) => c === 'activate').length).toBe(1);
    await page.locator('.kir-domain-nav a', { hasText: 'Sources' }).click().catch(() => {});
    await expect(card(page).locator('.kir-source-badge')).toHaveText('ACTIVE');
    await expect(card(page).locator('[data-source-toggle]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('.kir-domain-nav a', { hasText: 'Suivi' }).click();
    await expect(page.locator('.kir-run-truth')).toHaveCount(1);
    expect(backend.runs.map((r) => r.run_ref)).toEqual(['KIR-000010', 'KIR-000011']);
    await page.screenshot({ path: 'test-results/import-runtime-source-registry-active.png' });
  });

  test('B bis : connexion refusée → message métier, source toujours verrouillée, aucun secret affiché', async ({ page }) => {
    const backend = createBackend();
    backend.connectionOk = false;
    await mount(page, backend);
    await boot(page);
    await addCj(page);
    await wizard(page).locator('[data-wizard-test]').click();
    await expect(wizard(page).locator('[data-wizard-test-result]')).toContainText('Connexion impossible');
    await expect(card(page).locator('.kir-source-badge')).toHaveText('CONNEXION À TESTER');
    await expect(card(page).locator('[data-source-toggle]')).toBeDisabled();
    await expect(wizard(page).locator('[data-wizard-prepare]')).toHaveCount(0);
    const text = await page.locator('.kmc-import-runtime, #root').first().innerText();
    expect(text).not.toMatch(/api[_ -]?key|access[_ -]?token|bearer|cj-connector|\.js\b|Error:/i);
  });

  test('F : Retour au suivi puis navigateur Back → Sources', async ({ page }) => {
    const backend = createBackend();
    backend.source = { connected: true, certified: true, enabled: false };
    backend.runs.push(emptyRun('KIR-000010', 'CJdropshipping'));
    await mount(page, backend);
    await boot(page, 'run=KIR-000010&view=sources');
    await expect(page.locator('.kir-back')).toHaveText('← Retour au suivi');
    await page.locator('.kir-back').click();
    await expect(page.locator('.kir-run-truth')).toHaveCount(1);
    await page.goBack();
    await expect(page.locator('.kir-sources-board')).toHaveCount(1);
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Sources');
  });

  test('G : doublon — « Voir la source existante », jamais de seconde source', async ({ page }) => {
    const backend = createBackend();
    backend.source = { connected: true, certified: true, enabled: false };
    await mount(page, backend);
    await boot(page);
    await page.locator('[data-add-source]').click();
    await wizard(page).locator('[data-wizard-kind="api"]').click();
    await expect(wizard(page).locator('[data-wizard-connector="cj"]')).toContainText('Déjà ajoutée');
    await expect(wizard(page).locator('[data-wizard-create="cj"]')).toHaveCount(0);
    await wizard(page).locator('[data-wizard-existing="api:cj"]').click();
    await expect(wizard(page)).toHaveCount(0);
    await expect(page.locator('[data-source-card]')).toHaveCount(1);
    expect(backend.calls).not.toContain('create');

    // Garde-fou serveur : même une création forcée est refusée proprement.
    const status = await page.evaluate(async () => {
      const res = await fetch('/api/admin/workspaces/sourcing/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'cj' }) });
      return { status: res.status, body: await res.json() };
    });
    expect(status.status).toBe(409);
    expect(status.body.code).toBe('sourcing_source_already_exists');
  });

  test('H : Autre fournisseur → CONNECTEUR REQUIS, aucune source, aucun interrupteur, aucun test', async ({ page }) => {
    const backend = createBackend();
    await mount(page, backend);
    await boot(page);
    await page.locator('[data-add-source]').click();
    await wizard(page).locator('[data-wizard-kind="api"]').click();
    await expect(wizard(page).locator('[data-wizard-connector="ebay"]')).toContainText('autopilot non certifié');
    await expect(wizard(page).locator('[data-wizard-connector="other"]')).toContainText('Étude API requise');
    await expect(wizard(page).locator('[data-wizard-connector="other"]')).toContainText('aucun secret à demander');
    await expect(wizard(page).locator('[data-wizard-create="ebay"]')).toHaveCount(0);
    await wizard(page).locator('[data-wizard-other]').click();
    await wizard(page).locator('[data-wizard-field="provider_name"]').fill('BigBuy');
    await wizard(page).locator('[data-wizard-save-request]').click();
    await expect(wizard(page).locator('[data-wizard-request-status]')).toHaveText('À étudier · connecteur requis');
    await expect(wizard(page).locator('[data-wizard-test], [data-wizard-prepare], [data-wizard-activate], [data-source-toggle]')).toHaveCount(0);
    await wizard(page).locator('[data-wizard-close]').first().click();
    const req = page.locator('[data-source-request-card]');
    await expect(req).toHaveCount(1);
    await expect(req.locator('.kir-source-badge')).toHaveText('CONNECTEUR REQUIS');
    await expect(req.locator('[data-source-toggle], [data-source-step]')).toHaveCount(0);
    await expect(page.locator('[data-source-card]')).toHaveCount(0);
    expect(backend.source).toBeNull();
    expect(backend.calls).not.toContain('create');
    expect(backend.calls).not.toContain('test');
  });

  test('I : rechargement — source créée, état et demande « connecteur requis » persistent', async ({ page }) => {
    const backend = createBackend();
    await mount(page, backend);
    await boot(page);
    await addCj(page);
    await wizard(page).locator('[data-wizard-test]').click();
    await expect(card(page).locator('.kir-source-badge')).toHaveText('À CERTIFIER');
    backend.requests.push({ request_ref: 'REQ-1', provider_name: 'BigBuy', requested_label: 'BigBuy', reference_url: null, status: 'connector_required' });

    await page.reload();
    await page.evaluate(() => window.KomerceCanonicalImportRuntime.mount({ root: document.getElementById('root') }));
    await expect(card(page).locator('.kir-source-badge')).toHaveText('À CERTIFIER');
    await expect(card(page).locator('[data-source-toggle]')).toBeDisabled();
    await expect(page.locator('[data-source-request-card] .kir-source-badge')).toHaveText('CONNECTEUR REQUIS');
    expect(backend.calls.filter((c) => c === 'create')).toHaveLength(1);
  });

  test('CSV et saisie manuelle : aucune alimentation automatique créée', async ({ page }) => {
    const backend = createBackend();
    await mount(page, backend);
    await boot(page);
    await page.locator('[data-add-source]').click();
    await wizard(page).locator('[data-wizard-kind="csv"]').click();
    await expect(wizard(page).locator('[data-wizard-manual-note]')).toContainText('ne s’alimente pas automatiquement');
    expect(backend.source).toBeNull();
    await expect(page.locator('[data-source-card], [data-source-toggle]')).toHaveCount(0);
  });

  test('J : renommer une source — inline, persistant, sans toucher à l’état', async ({ page }) => {
    const backend = createBackend();
    backend.source = { connected: true, certified: true, enabled: false };
    await mount(page, backend);
    await boot(page);
    await card(page).locator('[data-source-menu] summary').click();
    await card(page).locator('[data-manage-rename]').click();
    const input = card(page).locator('[data-manage-input]');
    await expect(input).toBeFocused();
    await input.fill('CJ principal');
    await card(page).locator('[data-manage-form] button[type=submit]').click();
    await expect(card(page).locator('h3')).toHaveText('CJ principal');
    await expect(card(page).locator('.kir-source-badge')).toHaveText('PRÊTE');
    expect(backend.source.enabled).toBe(false);
    await page.reload();
    await page.evaluate(() => window.KomerceCanonicalImportRuntime.mount({ root: document.getElementById('root') }));
    await expect(card(page).locator('h3')).toHaveText('CJ principal');
    // Annuler ne modifie rien.
    await card(page).locator('[data-source-menu] summary').click();
    await card(page).locator('[data-manage-rename]').click();
    await card(page).locator('[data-manage-cancel]').click();
    await expect(card(page).locator('h3')).toHaveText('CJ principal');
    expect(backend.calls.filter((c) => c === 'rename')).toHaveLength(1);
  });

  test('K : archiver — confirmation, source sortie du tableau, section Archivées, aucun DELETE', async ({ page }) => {
    const backend = createBackend();
    backend.source = { connected: true, certified: true, enabled: true };
    backend.runs.push(emptyRun('KIR-000010', 'CJdropshipping'));
    const deletes = [];
    page.on('request', (r) => { if (r.method() === 'DELETE') deletes.push(r.url()); });
    await mount(page, backend);
    await boot(page);
    await expect(card(page).locator('.kir-source-badge')).toHaveText('ACTIVE');
    await card(page).locator('[data-source-menu] summary').click();
    await card(page).locator('[data-manage-archive]').click();
    await expect(card(page).locator('[data-archive-confirm]')).toContainText('alimentation automatique sera arrêtée');
    await expect(card(page).locator('[data-archive-confirm]')).toContainText('historique');
    expect(backend.calls).not.toContain('archive');
    await card(page).locator('[data-manage-cancel]').click();
    await expect(card(page).locator('[data-archive-confirm]')).toHaveCount(0);
    await card(page).locator('[data-source-menu] summary').click();
    await card(page).locator('[data-manage-archive]').click();
    await card(page).locator('[data-manage-archive-confirm]').click();
    await expect(page.locator('[data-source-card]')).toHaveCount(0);
    const archived = page.locator('[data-sources-archived]');
    await expect(archived.locator('summary')).toHaveText('Archivées (1)');
    await archived.locator('summary').click();
    await expect(archived.locator('[data-archived-source="api:cj"]')).toContainText('historique conservé');
    await expect(page.locator('[data-sources-summary]')).toContainText('0 active');
    expect(backend.source.enabled).toBe(false);
    expect(backend.runs).toHaveLength(1);
    expect(deletes).toEqual([]);
    await page.screenshot({ path: 'test-results/import-runtime-source-archived.png' });
  });

  test('L : restaurer — la source revient PRÊTE, jamais ACTIVE, et le doublon propose Restaurer', async ({ page }) => {
    const backend = createBackend();
    backend.source = { connected: true, certified: true, enabled: false, archived: true };
    await mount(page, backend);
    await boot(page);
    await page.locator('[data-add-source]').click();
    await wizard(page).locator('[data-wizard-kind="api"]').click();
    await expect(wizard(page).locator('[data-wizard-connector="cj"]')).toContainText('Archivée');
    await expect(wizard(page).locator('[data-wizard-create="cj"]')).toHaveCount(0);
    await wizard(page).locator('[data-manage-restore]').click();
    await expect(wizard(page)).toHaveCount(0);
    await expect(card(page).locator('.kir-source-badge')).toHaveText('PRÊTE');
    await expect(card(page).locator('[data-source-toggle]')).toHaveAttribute('aria-checked', 'false');
    expect(backend.source.enabled).toBe(false);
    expect(backend.calls).not.toContain('create');
    expect(backend.calls).not.toContain('activate');
  });

  test('M : demandes « connecteur requis » — renommer puis retirer avec confirmation', async ({ page }) => {
    const backend = createBackend();
    backend.requests.push({ request_ref: 'REQ-1', provider_name: 'BigBuy', requested_label: 'BigBuy', reference_url: null, status: 'connector_required' });
    await mount(page, backend);
    await boot(page);
    const req = page.locator('[data-source-request-card="REQ-1"]');
    await req.locator('[data-request-menu] summary').click();
    await req.locator('[data-manage-rename-request]').click();
    await req.locator('[data-manage-input]').fill('BigBuy Europe');
    await req.locator('[data-manage-form] button[type=submit]').click();
    await expect(req.locator('h3')).toHaveText('BigBuy Europe');
    await req.locator('[data-request-menu] summary').click();
    await req.locator('[data-manage-remove-request]').click();
    await expect(req.locator('[data-remove-confirm]')).toContainText('rien d’autre n’est supprimé');
    await req.locator('[data-manage-remove-confirm]').click();
    await expect(page.locator('[data-source-request-card]')).toHaveCount(0);
    expect(backend.calls).toEqual(expect.arrayContaining(['request-rename', 'request-delete']));
    expect(backend.source).toBeNull();
  });

  test('N : une source en cours de préparation n’offre ni renommage ni archivage', async ({ page }) => {
    const backend = createBackend();
    backend.source = { connected: true, certified: false, enabled: false };
    await mount(page, backend);
    await boot(page);
    await expect(card(page).locator('[data-source-menu]')).toHaveCount(1);
    await expect(card(page).locator('.kir-source-badge')).toHaveText('À CERTIFIER');
    // Pendant « Préparer et certifier », le menu disparaît (aucun archivage en plein import).
    await page.route(`${ORIGIN}/**/prepare`, async (route) => { await new Promise((r) => setTimeout(r, 1200)); route.fallback(); });
    await card(page).locator('[data-source-step="prepare"]').click();
    await expect(card(page).locator('[data-source-menu]')).toHaveCount(0);
    // La préparation est un passage de certification, pas une activation de l'autopilot :
    // le switch reste fidèle à l'autorité backend (OFF) même pendant l'état busy.
    await expect(card(page).locator('[data-source-toggle]')).toHaveAttribute('aria-checked', 'false');
    await expect(card(page).locator('.kir-source-switch-label')).toHaveText('OFF');
    await expect(card(page).locator('.kir-source-autopilot')).toContainText('Arrêtée : aucun import automatique');
  });
});

