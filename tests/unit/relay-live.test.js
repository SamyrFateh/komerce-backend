'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/relay-live.js'), 'utf8');

test('Relais live : chaque référence de commande porte un lien 360 direct avec retour vers la vue courante', () => {
  expect(src).toContain('const { order360Link,');
  expect(src).toContain("order360Link(order.reference, 'Retour au Relais live')");
  // La liaison reste interne au cockpit (data-cockpit-nav) : le lien 360 s'y ajoute sans le remplacer.
  expect(src).toContain('data-cockpit-nav>${esc(order.reference)}</a>');
});

test('Relais live : KPI, file et détail dans une seule vue, mêmes endpoints, lecture seule', () => {
  expect(src).toContain('data-relay-detail');
  expect(src).toContain("api(`/api/relay/orders/${encodeURIComponent(p.sel)}?projection=live`)");
  expect(src).toContain('Articles, incidents et chronologie');
  expect(src).toContain('data-relay-action="execute"');
  expect(src).toContain('Ce dossier est indisponible ou hors de votre périmètre.');
  // Seule mutation locale du cockpit : signalement via le writer serveur autorisé.
  expect(src).toContain("method:'POST'");
  expect(src).toContain('data-relay-incident-form');
  expect(src).not.toMatch(/method:\\s*'(PUT|PATCH|DELETE)'/);
  expect(src).toContain("relayViewer=options?.user||null");
});

test('Relais conserve le marché de navigation et verrouille les doubles soumissions incident',()=>{
  expect(src).toContain('market:currentRelayMarket()');
  expect(src).toContain('market:v4Market(p)');
  expect(src).toContain("if(form.dataset.relayIncidentPending==='true')return;");
  expect(src).toContain('delete form.dataset.relayIncidentPending');
});

test('Relais canonique : lecteur marché sans geste physique, signalement conditionné par capacité',()=>{
  expect(src).toContain("relayViewer?.role==='market_operator'");
  expect(src).toContain("includes('hub.supervise')");
  expect(src).toContain('receivable&&!marketReader()');
  expect(src).toContain('!handed&&!marketReader()');
  expect(src).toContain("!marketReader()||item.id!=='remises'");
});
