'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const JS = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
const LIVE = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/relay-live.js'),'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/operations-workspace.css'),'utf8');
const ROUTES = fs.readFileSync(path.join(__dirname, '../../routes/relay-dashboard.js'),'utf8');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../../migrations/399_relay_product_return_requests.sql'),'utf8');

test('Atelier : le troisième onglet SAV est séparé des encaissements et des opérations colis', () => {
  expect(JS).toContain("{ id: 'returns', label: 'Retours & SAV' }");
  expect(JS).toContain("view === 'returns' && context.mode === 'relay-execution'");
  expect(JS).toContain("data-relay-return-requests");
  expect(LIVE).toContain('data-relay-returns-link');
  expect(LIVE).toContain('focus:/^(shipments|cash|receive|collect|returns)$/');
  expect(CSS).toContain('[data-relay-return-create]');
});

test('Atelier : seule la demande liée à une ligne est créée, sans scan ni wallet fictif', () => {
  expect(JS).toContain("'/api/relay/returns/eligible?reference='");
  expect(JS).toContain("'/api/relay/returns', {");
  expect(JS).toContain("order_item_id: chosen.id");
  expect(JS).toContain("count > chosen.remaining_returnable");
  expect(JS).not.toContain("'/api/wallet/credit'");
});

test('API : lecture, recherche et création protégées par le rôle et le relais serveur', () => {
  expect(ROUTES).toContain("const relayReturnActors = [authenticate, requireRole(['admin', 'agent_relais'])];");
  expect(ROUTES).toContain("router.get('/returns/eligible', ...relayReturnActors");
  expect(ROUTES).toContain("router.get('/returns', ...relayReturnActors");
  expect(ROUTES).toContain("router.post('/returns', ...relayReturnActors");
  expect(ROUTES).toContain('req.user');
  expect(ROUTES).not.toMatch(/router\.post\('\/returns'[^]*?walletService\.credit/);
});

test('Schéma : type SAV borné, quantité positive, un dossier actif par ligne', () => {
  expect(SCHEMA).toContain("return_order_item_id uuid REFERENCES public.order_items(id)");
  expect(SCHEMA).toMatch(/return_quantity > 0/);
  expect(SCHEMA).toContain("uq_disputes_product_return_active_line");
  expect(SCHEMA).toContain("status IN ('open', 'processing')");
});
