'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const vm = require('vm');

const read = file => fs.readFileSync(require.resolve(`../../public/dashboards/canonical/js/${file}`), 'utf8');

function hub() {
  const context = { URLSearchParams, window: { location:{ pathname:'/admin/hub-live', search:'' }, history:{ pushState:jest.fn() }, addEventListener:jest.fn() } };
  context.globalThis = context.window;
  vm.runInNewContext(`${read('live-kit.js')}\n${read('hub-live.js')}`, context.window && Object.assign(context.window, { URLSearchParams, Date, Promise, Math, JSON, Number, String, Object, Array, Set, Map, Error, setInterval, clearInterval }));
  return context.window.KomerceCanonicalHubLive;
}

const ORDER = (over = {}) => ({
  id:'o-1', reference:'KMC-0001', status:'confirmed', client_name:'Amina', relais_name:'Relais Moroni', destination_island:'Grande Comore',
  payment_mode:'cash_relais', payment_status:'pending', age_hours:60, items_count:3, items_assigned:1, completeness:'partial',
  parcels_count:1, open_incidents:0, ...over,
});
const DASH = { orders:{ to_prepare:7, in_preparation:2, shipped_total:11, shipped_today:3, urgent:2, cash_pending:4 }, parcels:{ at_relay:5 }, incidents:{ open:3, critical:1 } };
const OVERVIEW = { dash:DASH, first:{ data:[ORDER(), ORDER({ id:'o-2', reference:'KMC-0002', age_hours:5, open_incidents:1 })] }, blocked:{ pagination:{ total:2 } }, fetched_at:'2026-10-01T10:00:00Z' };
const QUEUE = { data:[ORDER(), ORDER({ id:'o-2', reference:'KMC-0002' })], pagination:{ page:1, pages:3, total:60 }, tab:'to_prepare' };
const DETAIL = { id:'o-1', reference:'KMC-0001', status:'preparation', client_name:'Amina', relais_name:'Relais Moroni', payment_mode:'cash_relais', payment_status:'pending', total_kmf:15000,
  meta:{ age_hours:60, items_assigned:1, items_count:3, parcels_count:1 }, items:[{ product_name:'Coque', quantity:2, stock_status:'ok' }], parcels:[{ reference:'P-1', status:'draft', items:[{}], shipped_at:null }],
  timeline:[{ step:'prep_start', scanned_by_name:'Agent', created_at:'2026-10-01T09:00:00Z' }], incidents:[{ type:'retard', priority:'high', status:'open', created_at:'2026-10-01T09:30:00Z' }] };

const html = (search, data) => hub().renderHtml(search, data);
const crumbs = h => (h.match(/<nav class="kir-breadcrumb"[^>]*>([\s\S]*?)<\/nav>/) || [])[1]?.replace(/<i aria-hidden="true">›<\/i>/g, ' > ').replace(/<[^>]+>/g, '');
const back = h => { const m = h.match(/<a href="([^"]+)" data-cockpit-nav class="kir-back">([^<]+)<\/a>/); return m ? { href:m[1], label:m[2] } : null; };
const activeTab = h => (h.match(/is-active[^>]*>([^<]+)</) || [])[1];

test('Suivi : flux, chiffres cliquables vers la liste exacte, signaux et file à traiter en premier', () => {
  const h = html('', OVERVIEW);
  expect(h).toContain('OPÉRATIONS · HUB');
  expect(h).toContain('2 commandes en attente depuis plus de 48 h');
  expect(h).toContain('href="/admin/hub-live?view=queue&tab=to_prepare"');
  expect(h).toContain('href="/admin/hub-live?view=queue&tab=preparation"');
  expect(h).toContain('href="/admin/hub-live?view=queue&tab=ready"');
  expect(h).toContain('href="/admin/hub-live?view=queue&tab=blocked"');
  expect(h).toContain('Disponibles au relais');
  expect(h).toContain('5 colis');
  expect(h).toMatch(/<strong>4<\/strong> cash à sécuriser/);
  expect(h).toContain('KMC-0001');
  expect(activeTab(h)).toBe('Suivi');
  expect(h).not.toContain('kir-back');
});

test('Suivi : aucune commande → état calme sans fausse alerte', () => {
  const h = html('', { dash:{ orders:{}, parcels:{}, incidents:{} }, first:{ data:[] }, blocked:{ pagination:{ total:0 } } });
  expect(h).toContain('Aucune commande à traiter');
  expect(h).toContain('rien à faire');
  expect(h).not.toContain('is-attention');
  expect(h).toContain('Aucune commande en attente de préparation.');
});

test('population : Hub › Suivi › file, retour au suivi, onglet Suivi actif ; pagination qui garde la file', () => {
  const h = html('?view=queue&tab=preparation', QUEUE);
  expect(crumbs(h)).toBe('Hub > Suivi > En préparation');
  expect(back(h)).toEqual({ href:'/admin/hub-live', label:'← Retour au suivi' });
  expect(activeTab(h)).toBe('Suivi');
  expect(h).toContain('60 au total');
  expect(h).toContain('href="/admin/hub-live?view=queue&tab=preparation&page=2"');
  expect(h).toContain('from=preparation');
});

test('Commandes : vue de 1er niveau, onglet actif, aucun bouton retour', () => {
  const h = html('?view=queue&tab=all', QUEUE);
  expect(crumbs(h)).toBe('Hub > Commandes');
  expect(back(h)).toBeNull();
  expect(activeTab(h)).toBe('Commandes');
});

test('commande : retour à sa file d’origine, jamais au Suivi quand elle vient d’une file', () => {
  const fromQueue = html('?view=order&order=o-1&from=ready', DETAIL);
  expect(crumbs(fromQueue)).toBe('Hub > Suivi > Expédiées > KMC-0001');
  expect(back(fromQueue)).toEqual({ href:'/admin/hub-live?view=queue&tab=ready', label:'← Retour à Expédiées' });
  expect(activeTab(fromQueue)).toBe('Suivi');
  const fromAll = html('?view=order&order=o-1&from=all', DETAIL);
  expect(crumbs(fromAll)).toBe('Hub > Commandes > KMC-0001');
  expect(back(fromAll)).toEqual({ href:'/admin/hub-live?view=queue&tab=all', label:'← Retour à Commandes' });
  expect(activeTab(fromAll)).toBe('Commandes');
  const direct = html('?view=order&order=o-1', DETAIL);
  expect(back(direct)).toEqual({ href:'/admin/hub-live', label:'← Retour au suivi' });
});

test('commande : articles, colis, incidents, chronologie ; aucune donnée personnelle de contact, aucune action', () => {
  const h = html('?view=order&order=o-1&from=to_prepare', DETAIL);
  expect(h.replace(/\s/g, ' ')).toMatch(/15 000 KMF/);
  for (const text of ['Coque', 'En stock', 'P-1', 'Retard', 'prep_start', 'Cash à encaisser']) expect(h).toContain(text);
  expect(h).not.toMatch(/<button|data-source-|phone|email|@/);
});

test('vue inconnue → Suivi ; le KIR/les ids ne deviennent jamais un niveau du fil', () => {
  const h = html('?view=nimporte', OVERVIEW);
  expect(h).toContain('OPÉRATIONS · HUB');
  expect(activeTab(h)).toBe('Suivi');
});

test('le module Hub est en lecture seule : aucune méthode d’écriture, aucun endpoint d’action', () => {
  const source = read('hub-live.js') + read('live-kit.js');
  expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
  expect(source).not.toMatch(/\/(start-prep|create-parcel|ship|ready|escalate|backorder)\b/);
  expect(source).toContain('/api/hub-dash/dashboard');
});
