/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('../../public/dashboards/canonical/js/providers-admin');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('Providers admin — projection d’affichage', () => {
  test('GAP et refus runtime sont explicites, avec la raison serveur', () => {
    const rows = admin.rowsFor({ records: [
      { capability: 'purchasing.contract', classification: 'CONFIRMED', availability: 'PROVEN', highest_proof: 'P4', environment: 'LIVE_STAGING', limitations: ['a', 'b'], runtime_decision: { allowed: true, reason: null } },
      { capability: 'reconcile_payment', classification: 'GAP', availability: 'UNPROVEN', highest_proof: null, environment: 'LIVE_STAGING', runtime_decision: { allowed: false, reason: 'CERTIFICATION_CAPABILITY_GAP' } },
      { capability: 'x', classification: 'CONFIRMED', runtime_decision: { allowed: false, reason: 'CERTIFICATION_ENVIRONMENT_MISMATCH' } },
      { capability: 'y', runtime_decision: undefined },
    ] });
    expect(rows[0].decision).toBe('✓ Autorisée au runtime');
    expect(rows[0].limitations).toBe('a · b');
    expect(rows[1].classification).toBe('✖ GAP — non disponible');
    expect(rows[1].proof).toBe('— aucune preuve');
    expect(rows[1].decision).toContain('Capability non disponible (GAP)');
    expect(rows[2].decision).toContain('Environnement certifié ≠ environnement d’exécution');
    expect(rows[3].decision).toContain('Refusée');
    expect(rows[3].classification).toBe('? non classé');
  });

  test('la décision n’est jamais « autorisée » sans allowed === true', () => {
    for (const decision of [undefined, null, {}, { allowed: 'true' }, { allowed: 1 }]) {
      expect(admin.decisionLabel(decision)).toContain('Refusée');
    }
  });

  test('aucune écriture ni secret : une seule requête GET, source sans verbe mutant', () => {
    const source = read('public/dashboards/canonical/js/providers-admin.js');
    expect(source).toMatch(/method:\s*'GET'/);
    expect(source).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/);
    expect(admin.ENDPOINT).toBe('/api/admin/providers/capabilities');
  });
});

describe('Providers admin — câblage de la surface', () => {
  test('route HTML, surface app, shell, routeur client et navigation admin', () => {
    expect(read('bootstrap/html-routes.js')).toContain("app.get('/admin/providers'");
    const app = read('public/dashboards/canonical/js/app.js');
    expect(app).toContain("PROVIDERS_ADMIN: 'providers-admin'");
    expect(app).toContain("path === '/admin/providers'");
    expect(read('public/dashboards/canonical/index.html')).toContain('/dashboards/canonical/js/providers-admin.js');
    expect(read('public/dashboards/canonical/js/canonical-client-router-v4.js')).toContain("'/admin/providers'");
    const nav = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    expect(nav).toMatch(/id: 'admin-providers', label: 'Providers', href: '\/admin\/providers', roles: \['admin'\], surfaces: \['providers-admin'\]/);
  });

  test('l’avis « activer ≠ autoriser » est rendu dans le DOM', () => {
    const made = [];
    const doc = { createElement(tag) { const n = { tag, children: [], className: '', textContent: '', attributes: {}, appendChild(c) { n.children.push(c); return c; }, replaceChildren() { n.children = []; }, setAttribute(k, v) { n.attributes[k] = v; } }; made.push(n); return n; } };
    const rootNode = doc.createElement('main');
    admin.renderPayload(rootNode, { activation_notice: 'Activer un provider n’autorise pas son exécution : seule la certification runtime décide.', runtime_environment: null, providers: [] }, doc, null);
    const notice = rootNode.children.find(c => c.attributes['data-providers-notice'] !== undefined);
    expect(notice).toBeTruthy();
    const texts = made.map(n => n.textContent).filter(Boolean);
    expect(texts.some(t => /n’autorise pas son exécution/.test(t))).toBe(true);
    expect(texts.some(t => /non déclaré — toute exécution certifiée est refusée/.test(t))).toBe(true);
  });
});
