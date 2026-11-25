'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief P0-3 — Hub Live : les cellules Engagement / Autorisation proposent des actions réelles seulement au détenteur du droit, dans l'ordre engagement → soumission → paiement, sans jamais déduire une décision du statut de la PO.
 */
function el(tag) {
  const handlers = {};
  const node = {
    tagName: tag.toUpperCase(), className: '', children: [], attrs: {}, value: '', textContent: '', style: {}, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    replaceChildren(...nodes) { this.children = nodes; },
    remove() { if (this.parentNode) this.parentNode.children=this.parentNode.children.filter(child=>child!==this); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] || null; },
    addEventListener(evt, fn) { handlers[evt] = fn; },
    click() { return handlers.click && handlers.click({ target: this }); },
    focus() {},
  };
  return node;
}
const doc = { createElement: el };
const PO_ID = '10000000-0000-4000-8000-000000000001';
const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };
const actions = (menu) => walk(menu).filter((n) => n.attrs && n.attrs['data-hub-real-action']).map((n) => n.attrs['data-hub-real-action']);
const links = menu => walk(menu).filter(n=>Object.prototype.hasOwnProperty.call(n.attrs,'data-hub-workflow-link'));
const texts = (menu) => walk(menu).map((n) => n.textContent).filter(Boolean).join(' | ');

function load() {
  jest.resetModules();
  delete global.KomerceHubContextActions;
  require('../../public/dashboards/canonical/js/hub-context-actions.js');
  return global.KomerceHubContextActions;
}
const decision = { decided_by_name: 'Directrice', decided_at: '2026-11-03T10:00:00Z', amount: 30, currency: 'AED', proof_ref: 'BC-1' };
const run = (po, field, grants, user = { role: 'agent_hub' }, fetchFn = jest.fn()) => {
  const menu = el('div');
  load().administration(menu, { doc, fetch: fetchFn, user, po: { id: PO_ID, market:'KM', status: 'draft', ...po }, field, grants, refresh: jest.fn() });
  return menu;
};

test('engagement : sans droit, aucune action ; le message dit que la PO préparée n\'est pas un engagement', () => {
  const menu = run({}, 'Engagement', { purchase_commitment: false });
  expect(actions(menu)).toEqual([]);
  expect(texts(menu)).toContain('ne détient pas cette autorisation');
});

test('engagement : le détenteur du droit voit « Valider l\'engagement d\'achat » (pas « Soumettre » tant que non validé)', () => {
  const menu = run({}, 'Engagement', { purchase_commitment: true });
  expect(actions(menu)).toEqual([]);
  expect(links(menu)).toHaveLength(1);
  expect(links(menu)[0].textContent).toContain('décision d’engagement');
  expect(links(menu)[0].href).toContain('decision=commitment');
});

test('engagement validé + brouillon : lien vers la soumission canonique sans POST', async () => {
  const fetchFn = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
  const menu = run({ commitment_decision: decision }, 'Engagement', {}, undefined, fetchFn);
  expect(actions(menu)).toEqual([]);
  expect(texts(menu)).toContain('Engagement d’achat validé par Directrice');
  expect(links(menu)[0].href).toContain('sel=po%3A'+PO_ID);
  expect(fetchFn).not.toHaveBeenCalled();
});

test('engagement : PO déjà soumise sans décision tracée → aucune action fictive', () => {
  const menu = run({ status: 'notified' }, 'Engagement', { purchase_commitment: true });
  expect(actions(menu)).toEqual([]);
});

test('paiement : impossible avant l\'engagement, et la soumission n\'autorise rien', () => {
  expect(actions(run({ status: 'notified' }, 'Autorisation', { supplier_payment: true }))).toEqual([]);
  expect(texts(run({ status: 'notified' }, 'Autorisation', { supplier_payment: true }))).toContain('après la validation de l’engagement');
  expect(actions(run({ status: 'draft', commitment_decision: decision }, 'Autorisation', { supplier_payment: true }))).toEqual([]);
});

test('paiement : sans droit aucune action ; avec droit, engagement validé et PO soumise → « Autoriser le paiement fournisseur »', () => {
  expect(actions(run({ status: 'notified', commitment_decision: decision }, 'Autorisation', { supplier_payment: false }))).toEqual([]);
  const menu=run({ status:'notified',commitment_decision:decision },'Autorisation',{supplier_payment:true});
  expect(actions(menu)).toEqual([]);
  expect(links(menu)[0].textContent).toContain('autorisation de paiement');
  expect(links(menu)[0].href).toContain('decision=payment');
});

test('paiement déjà autorisé : décision affichée, aucune seconde action ; un débit ne vaut pas autorisation', () => {
  const menu = run({ status: 'notified', commitment_decision: decision, payment_decision: { ...decision, proof_ref: 'VIR-1' } }, 'Autorisation', { supplier_payment: true });
  expect(actions(menu)).toEqual([]);
  expect(texts(menu)).toContain('Paiement fournisseur autorisé par Directrice');
});

test('rôle non Hub : aucune écriture', () => {
  expect(actions(run({}, 'Engagement', { purchase_commitment: true }, { role: 'agent_relais' }))).toEqual([]);
});

test('régression P0-3 : un UUID réel (5 groupes) active les actions d\'achat — attester l\'envoi d\'une PO soumise', () => {
  const menu = run({ status: 'notified' }, 'Fournisseur', {});
  expect(actions(menu)).toEqual([]);
  expect(links(menu)[0].href).toContain('market=KM&atelier=purchasing&sel=po%3A'+PO_ID);
  const confirmed=run({status:'notified',sent_at:'2026-11-03T09:00:00Z'},'Fournisseur',{});
  expect(actions(confirmed)).toEqual([]);
  expect(links(confirmed)[0].textContent).toContain('confirmer les lignes');
});

test('écart fournisseur : la décision est distincte et réservée au détenteur du grant paiement', () => {
  const po = { status: 'confirmed', payment_decision: decision };
  expect(actions(run(po, 'Paiement', {}))).toEqual([]);
  expect(actions(run(po, 'Paiement', { supplier_payment: true }, { role: 'finance' }))).toEqual([]);
  expect(actions(run(po, 'Justificatifs', { supplier_payment: true }))).toEqual([]);
  const admin=run(po,'Paiement',{supplier_payment:true});
  expect(actions(admin)).toEqual([]);
  expect(links(admin)[0].href).toContain('entry=direction');
  expect(links(admin)[0].href).toContain('decision=variance');
  const menu=el('div');
  load().directionVariance(menu,{doc,fetch:jest.fn(),user:{role:'agent_hub'},po:{id:PO_ID,...po},grants:{supplier_payment:true}});
  expect(actions(menu)).toEqual(['Décider un écart fournisseur']);
});

test('écart déjà décidé : la preuve s’affiche sans offrir de nouvelle décision', () => {
  const menu = run({
    status: 'confirmed', payment_decision: decision,
    variance_decision: { amount: '25', currency: 'AED', reason: 'Écart de prix', proof_ref: 'DEVIS-2' },
  }, 'Paiement', { supplier_payment: true });
  expect(actions(menu)).toEqual([]);
  expect(texts(menu)).toContain('25 AED · Écart de prix · Pièce DEVIS-2');
});

test('préparation COMBOX : navigation vers le dossier et le marché, sans mutation', async () => {
  const menu=el('div');
  menu.setAttribute('data-hub-request','1');
  const order={id:PO_ID,reference:'KABC123',market:'CM',stage_states:{cartons:'ready'}};
  const fetchFn=jest.fn(async()=>({ok:true,json:async()=>({purchase_orders:[{id:PO_ID,lines:[{order_id:order.id,received:2}]}],boxes:[],needs:[]})}));
  await load().operations(menu,{doc,fetch:fetchFn,user:{role:'agent_hub'},order,stage:'Cartons',refresh:jest.fn()});
  const links=walk(menu).filter(n=>Object.prototype.hasOwnProperty.call(n.attrs,'data-hub-workflow-link'));
  expect(links).toHaveLength(1);
  const url=new URL(links[0].href,'https://staging.invalid');
  expect(url.pathname).toBe('/admin/hub-live');
  expect(url.searchParams.get('view')).toBe('execute');
  expect(url.searchParams.get('market')).toBe('CM');
  expect(url.searchParams.get('sel')).toBe('order:'+order.id);
  expect(fetchFn.mock.calls.every(([,opts])=>opts.method==='GET')).toBe(true);
});

test.each(['PO','Fournisseur','Réception','Cartons','Départ','Reste à solder'])('Kanban %s : aucune action métier locale, seuls les liens',async stage=>{
  const menu=el('div');
  menu.setAttribute('data-hub-request','1');
  const order={id:PO_ID,reference:'KABC123',market:'CM',stage_states:{}};
  const fetchFn=jest.fn(async()=>({ok:true,json:async()=>({purchase_orders:[{id:PO_ID,lines:[{order_id:order.id,received:2}]}],boxes:[{unit_id:PO_ID,reference:'BOX-1',contents:[{order_id:order.id}]}],needs:[]})}));
  await load().operations(menu,{doc,fetch:fetchFn,user:{role:'agent_hub'},order,stage});
  expect(actions(menu)).toEqual([]);
  const links=walk(menu).filter(n=>Object.prototype.hasOwnProperty.call(n.attrs,'data-hub-workflow-link'));
  expect(links.length).toBeGreaterThan(0);
  for(const l of links){
    const url=new URL(l.href,'https://staging.invalid');
    expect(url.searchParams.get('market')).toBe('CM');
    expect(url.searchParams.get('entry')).toBe('operations');
    expect(url.searchParams.get('atelier')).toBeTruthy();
    expect(url.searchParams.get('sel')).toBeTruthy();
  }
  expect(fetchFn.mock.calls.every(([,opts])=>opts.method==='GET')).toBe(true);
});

test('PO partagée : les liens permettent de choisir un vrai marché sans modifier la PO',()=>{
 const menu=run({market:'CM · KM',status:'confirmed',payment_decision:decision},'Paiement',{supplier_payment:true});
 expect(actions(menu)).toEqual([]);
 expect(links(menu).map(n=>new URL(n.href,'https://staging.invalid').searchParams.get('market'))).toEqual(['CM','KM']);
});
