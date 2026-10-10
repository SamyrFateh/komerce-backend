'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const vm = require('vm');

const read = file => fs.readFileSync(require.resolve(`../../public/dashboards/canonical/js/${file}`), 'utf8');

function relay() {
  const win = { URLSearchParams, Date, Promise, Math, JSON, Number, String, Object, Array, Set, Map, Error, setInterval:() => 1, clearInterval:() => {},
    location:{ pathname:'/admin/relais-live', search:'' }, history:{ pushState:jest.fn() }, addEventListener:jest.fn() };
  vm.runInNewContext(`${read('live-kit.js')}\n${read('relay-live.js')}`, win);
  return win.KomerceCanonicalRelayLive;
}

const ORDER = (over = {}) => ({
  id:'r-1', reference:'KMC-0101', status:'available', client_nom:'Fatima', relais_nom:'Relais Mitsamiouli', ile:'Grande Comore',
  heures_attente:80, age_jours:4, urgence:'haute', nb_items:2, cash_pending:true, payment_status:'pending', incidents_ouverts:0, ...over,
});
const DASH = { kpi:{ en_transit:4, disponibles:9, cash_a_encaisser:3, montant_cash_pending:45000, collectes_aujourd_hui:2, collectes_7j:14, en_attente_72h:2, total_actives:20, incidents_ouverts:1 }, alertes:[] };
const OVERVIEW = { dash:DASH, first:{ orders:[ORDER(), ORDER({ id:'r-2', reference:'KMC-0102', heures_attente:10, urgence:'normale' })] }, fetched_at:'2026-10-01T10:00:00Z' };
const LIST = { orders:[ORDER(), ORDER({ id:'r-2', reference:'KMC-0102' })], total:2 };
const DETAIL = { order:{ id:'r-1', reference:'KMC-0101', status:'available', heures_attente:80, age_jours:4, pickup_code:'••1234' },
  client:{ nom:'Fatima', phone:'+269000000', email:'f@x.km' }, relais:{ nom:'Relais Mitsamiouli', ile:'Grande Comore', phone:'+269111111' },
  paiement:{ cash_pending:true, is_paid:false, total_kmf:12000 }, items:[{ produit:'Coque', quantity:1, prix_kmf:12000 }],
  timeline:[{ status:'available', changed_by_name:'Agent', created_at:'2026-10-01T08:00:00Z' }], incidents:[{ type:'client_absent', priority:'normal', status:'open', created_at:'2026-10-01T09:00:00Z' }],
  notifications_envoyees:[{ message_preview:'Votre colis est prêt' }] };

const html = (search, data) => relay().renderHtml(search, data);
const crumbs = h => (h.match(/<nav class="kir-breadcrumb"[^>]*>([\s\S]*?)<\/nav>/) || [])[1]?.replace(/<i aria-hidden="true">›<\/i>/g, ' > ').replace(/<[^>]+>/g, '');
const back = h => { const m = h.match(/<a href="([^"]+)" data-cockpit-nav class="kir-back">([^<]+)<\/a>/); return m ? { href:m[1], label:m[2] } : null; };
const activeTab = h => (h.match(/is-active[^>]*>([^<]+)</) || [])[1];

test('Suivi : flux, chiffres cliquables vers la liste exacte, attente +72 h en attention', () => {
  const h = html('', OVERVIEW);
  expect(h).toContain('OPÉRATIONS · RELAIS');
  expect(h).toContain('2 colis en attente de retrait depuis plus de 72 h');
  expect(h).toContain('href="/admin/relais-live?view=orders&list=in_transit"');
  expect(h).toContain('href="/admin/relais-live?view=orders&list=available"');
  expect(h).toContain('dont 2 depuis +72 h');
  expect(h.replace(/\s/g, ' ')).toMatch(/45 000 KMF/);
  expect(h).toMatch(/<strong>14<\/strong> retirés sur 7 jours/);
  expect(h).toContain('KMC-0101');
  expect(activeTab(h)).toBe('Suivi');
  expect(h).not.toContain('kir-back');
});

test('Suivi calme : aucune alerte inventée', () => {
  const h = html('', { dash:{ kpi:{} }, first:{ orders:[] } });
  expect(h).toContain('Aucun colis à traiter');
  expect(h).not.toContain('is-attention');
  expect(h).toContain('Aucun colis disponible au retrait.');
});

test('liste : Relais › Suivi › liste, retour au suivi, pagination par décalage', () => {
  const h = html('?view=orders&list=available&offset=25', { orders:Array.from({ length:25 }, (_, i) => ORDER({ id:`r-${i}`, reference:`KMC-${i}` })) });
  expect(crumbs(h)).toBe('Relais > Suivi > Disponibles au retrait');
  expect(back(h)).toEqual({ href:'/admin/relais-live', label:'← Retour au suivi' });
  expect(activeTab(h)).toBe('Suivi');
  expect(h).toContain('href="/admin/relais-live?view=orders&list=available"');
  expect(h).toContain('href="/admin/relais-live?view=orders&list=available&offset=50"');
});

test('Colis : vue de 1er niveau, onglet actif, aucun retour', () => {
  const h = html('?view=orders&list=all', LIST);
  expect(crumbs(h)).toBe('Relais > Colis');
  expect(back(h)).toBeNull();
  expect(activeTab(h)).toBe('Colis');
});

test('colis : retour à sa liste d’origine ; jamais le Suivi quand il vient d’une liste', () => {
  const fromList = html('?view=order&order=r-1&from=in_transit', DETAIL);
  expect(crumbs(fromList)).toBe('Relais > Suivi > Colis en transit > KMC-0101');
  expect(back(fromList)).toEqual({ href:'/admin/relais-live?view=orders&list=in_transit', label:'← Retour à Colis en transit' });
  const fromAll = html('?view=order&order=r-1&from=all', DETAIL);
  expect(back(fromAll)).toEqual({ href:'/admin/relais-live?view=orders&list=all', label:'← Retour à Colis' });
  expect(activeTab(fromAll)).toBe('Colis');
  expect(back(html('?view=order&order=r-1', DETAIL))).toEqual({ href:'/admin/relais-live', label:'← Retour au suivi' });
});

test('colis : jamais de contact client, de code de retrait ni de SMS ; aucune action', () => {
  const h = html('?view=order&order=r-1&from=available', DETAIL);
  expect(h).toContain('Coque');
  expect(h).toContain('Client absent');
  for (const secret of ['+269000000', 'f@x.km', '+269111111', '••1234', 'Votre colis est prêt']) expect(h).not.toContain(secret);
  expect(h).not.toMatch(/<button/);
});

test('le module Relais est en lecture seule', () => {
  const source = read('relay-live.js');
  expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
  expect(source).not.toMatch(/\/(collect|pay-cash|incident|comment|verify)\b/);
  expect(source).toContain('/api/relay/dashboard');
});

test('LIVE-02/07 : l’écran lit les endpoints en projection Live et affiche l’heure serveur', () => {
  const src = fs.readFileSync(require.resolve('../../public/dashboards/canonical/js/relay-live.js'), 'utf8');
  expect(src).toContain('fetched_at:dash?.generated_at');
  expect((src.match(/projection=live|projection:'live'/g) || []).length).toBeGreaterThanOrEqual(3);
});
