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
  heures_attente:80, age_jours:4, urgence:'haute', nb_items:2, cash_pending:true, payment_status:'pending', incidents_ouverts:0, market_code:'KM', ...over,
});
const DASH = { kpi:{ en_transit:4, disponibles:9, cash_a_encaisser:3, montant_cash_pending:45000, montant_cash_par_devise:[{ currency:'KMF', amount:45000 }], cash_sans_montant_local:0, collectes_aujourd_hui:2, collectes_7j:14, en_attente_72h:2, total_actives:20, incidents_ouverts:1 }, alertes:[] };
const OVERVIEW = { dash:DASH, first:{ orders:[ORDER(), ORDER({ id:'r-2', reference:'KMC-0102', heures_attente:10, urgence:'normale' })] }, fetched_at:'2026-10-01T10:00:00Z' };
const LIST = { orders:[ORDER(), ORDER({ id:'r-2', reference:'KMC-0102' })], total:2 };
const DETAIL = { order:{ id:'r-1', reference:'KMC-0101', status:'available', heures_attente:80, age_jours:4, pickup_code:'••1234' },
  client:{ nom:'Fatima', phone:'+269000000', email:'f@x.km' }, relais:{ nom:'Relais Mitsamiouli', ile:'Grande Comore', phone:'+269111111' },
  paiement:{ cash_pending:true, is_paid:false, total_kmf:12000, a_encaisser:{ amount:12000, currency:'KMF', available:true } }, items:[{ produit:'Coque', quantity:1 }],
  timeline:[{ status:'available', changed_by_name:'Agent', created_at:'2026-10-01T08:00:00Z' }], incidents:[{ type:'client_absent', priority:'normal', status:'open', created_at:'2026-10-01T09:00:00Z' }],
  notifications_envoyees:[{ message_preview:'Votre colis est prêt' }] };

const html = (search, data) => relay().renderHtml(search, data);
const crumbs = h => (h.match(/<nav class="kir-breadcrumb"[^>]*>([\s\S]*?)<\/nav>/) || [])[1]?.replace(/<i aria-hidden="true">›<\/i>/g, ' > ').replace(/<[^>]+>/g, '');
const back = h => { const m = h.match(/<a href="([^"]+)" data-cockpit-nav class="kir-back">([^<]+)<\/a>/); return m ? { href:m[1], label:m[2] } : null; };
const activeTab = h => (h.match(/is-active[^>]*>([^<]+)</) || [])[1];

test('Flux : quatre étapes visibles, pas de fausse attestation physique', () => {
  const h=html('',{...OVERVIEW,queue:{orders:[ORDER()]}});
  expect(h).toContain('Préparer les colis');
  expect(h).toContain('aria-label="Kanban Relais · étapes et actions"');
  for(const key of ['transit','receive','organize','available']) {
    expect(h).toContain('data-relay-lane="'+key+'"');
    expect(h).toContain('data-relay-stage="'+key+'"');
  }
  expect(h).toContain('Rangement libre');
  expect(h).toContain('Emplacement facultatif · non attesté');
  expect(h).toContain('href="/admin/relais-live?view=remises&amp;market=KM"');
  expect(h).not.toContain('data-workspace-action="collect"');
  expect(activeTab(h)).toBe('Flux Relais');
});

test('Flux : en transit peut ouvrir une réception canonique, sans exécuter de writer', () => {
  const h=html('',{...OVERVIEW,queue:{orders:[ORDER({status:'shipped'})]}});
  expect(h).toContain('data-relay-stage-action="shipments"');
  expect(h).toContain('href="/admin/relais-live?view=execute&amp;market=KM&amp;focus=shipments"');
  expect(h).toContain('Après réception');
  expect(h).toContain('data-relay-stage-signal="waiting"');
  expect(h).not.toContain('data-workspace-action="receive"');
});

test('Flux vide : le parcours et les liens restent présents sans dossier fictif', () => {
  const h=html('',{...OVERVIEW,queue:{orders:[]}});
  expect(h).toContain('Flux sans commande active');
  for(const key of ['transit','receive','organize','available']) {
    expect(h).toContain('data-relay-empty-lane="'+key+'"');
  }
  expect(h).toContain('Contrôler les arrivages');
  expect(h).toContain('Ouvrir les remises');
});

test('La remise enregistrée ne réapparaît pas dans le flux de préparation', () => {
  const h=html('',{...OVERVIEW,queue:{orders:[ORDER({status:'collected',id:'r-99'})]}});
  expect(h).not.toContain('data-relay-workboard-order="r-99"');
  expect(h).toContain('Historique');
});

test('Incidents : anomalies reliées au dossier et signalements du relais', () => {
  const data={incidents:[{id:'i-1',order_id:'r-1',order_reference:'KMC-0101',
    incident_type:'colis_endommage',title:'Emballage abîmé',severity:'high',status:'open',
    source:'relay_report'}]};
  const h=html('?view=incidents',data);
  expect(h).toContain('Incidents &amp; SAV');
  expect(h).toContain('KMC-0101');
  expect(h).toContain('Emballage abîmé');
  expect(h).toContain('href="/admin/relais-live?view=order&amp;order=r-1&amp;from=incidents"');
  expect(h).toContain('Un dossier n’atteste pas la reprise physique ni le remboursement.');
  expect(h).toContain('data-relay-returns-link');
  expect(activeTab(h)).toBe('Incidents &amp; SAV');
});

test('Historique : consultation distincte du comptoir et du flux',()=>{
  const h=html('?view=orders&list=collected',LIST);
  expect(h).toContain('Historique des remises');
  expect(activeTab(h)).toBe('Historique');
  expect(h).toContain('Flux Relais');
});

test('Détail commande : aucune donnée sensible divulguée dans la projection',()=>{
  const h=html('?view=order&order=r-1',DETAIL);
  expect(h).toContain('Coque');
  expect(h).toContain('Client absent');
  for(const secret of ['+269000000','f@x.km','+269111111','••1234','Votre colis est prêt']) {
    expect(h).not.toContain(secret);
  }
});

test('Détail venant des incidents : le retour garde la file d’origine',()=>{
  const h=html('?view=order&order=r-1&from=incidents',DETAIL);
  expect(h).toContain('Retour aux incidents');
  expect(h).toContain('href="/admin/relais-live?view=incidents"');
});

test('Signalement : seul un POST incident est ajouté au cockpit de lecture',()=>{
  const src=read('relay-live.js');
  expect(src).toContain("method:'POST'");
  expect(src).toContain("+'/incident'");
  expect(src).toContain('data-relay-incident-form');
  expect(src).toContain('relayViewer=options?.user||null');
  expect(src).not.toContain("method:'DELETE'");
  expect(src).not.toContain('data-workspace-action="collect"');
});

test('Projection et simulation : mêmes sources et même cloisonnement rôle/marché',()=>{
  const src=read('relay-live.js');
  expect(src).toContain("api('/api/relay/dashboard')");
  expect(src).toContain("api('/api/relay/incidents')");
  expect(src).toContain("projection=live");
  expect(src).toContain('setViewer(relayViewer)');
});
