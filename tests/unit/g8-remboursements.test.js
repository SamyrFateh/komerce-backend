'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 * G8 operator UI browser-contract proof: roles, OFF flag, confirmation and no hidden money transfer.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const script = fs.readFileSync(path.join(__dirname, '../../public/js/g8-remboursements.js'), 'utf8');

function makeUi(role, result, status = 200, config = {}) {
  const nodes = [];
  let uuidCounter=0;
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.className = '';
      this.style = {};
      this.textContent = '';
      this.value = '';
      nodes.push(this);
    }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    replaceChildren() { this.children = []; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    insertBefore(c, existing) { c.parentNode = this; const pos = this.children.indexOf(existing); this.children.splice(pos < 0 ? 0 : pos, 0, c); }
    reportValidity() { return true; }
    reset() {}
  }
  const elements = {};
  for (const id of ['g8-status', 'g8-list', 'g8-title', 'g8-env', 'g8-back', 'g8-refresh']) {
    elements[id] = new Element('div');
    elements[id].id = id;
  }
  const shell = new Element('main');
  shell.appendChild(elements['g8-list']);
  const brand = new Element('a');
  const document = {
    createElement: tag => new Element(tag),
    querySelector: sel => sel === '.brand' ? brand :
      sel[0] === '#' ? nodes.find(n => n.id === sel.slice(1)) || null : null,
  };
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/auth/me') {
      return { ok: true, json: async () => ({ user: { role } }) };
    }
    if(url==='/api/admin/orders/item-refund-readiness')
      return {ok:true,json:async()=>({enabled:config.itemRefundEnabled===true})};
    if(url.includes('/item-refund-context'))
      return {ok:true,json:async()=>config.itemRefundContext};
    if(url.endsWith('/execute'))
      return {ok:true,status:202,json:async()=>config.execution||{status:'unknown'}};
    if(url.endsWith('/refund-reservations')&&options.method==='POST'&&config.itemRefundStatuses?.length){
      const nextStatus=config.itemRefundStatuses.shift();
      return {ok:nextStatus<400,status:nextStatus,json:async()=>config.itemReservation||result};
    }
    if(url.endsWith('/refund-reservations')&&options.method==='POST')
      return {ok:true,status:202,json:async()=>config.itemReservation||result};
    return {
      ok: status < 400,
      status,
      json: async () => config.payload || result
    };
  };
  vm.runInNewContext(script, { document, fetch,
    window: { confirm: () => config.confirm===true, crypto: { randomUUID: () =>
      '00000000-0000-4000-8000-'+String(++uuidCounter).padStart(12,'0') } } }, { timeout: 1000 });
  return { nodes, elements, calls };
}
const settle = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

describe('G8 standalone operator UI', () => {
  test('flags OFF cause explicit HOLD, no proof form and no financial POST', async () => {
    const x = makeUi('admin', { code:'LOCAL_REFUND_NOT_CERTIFIED', error:'Parcours désactivé' }, 409);
    await settle();
    expect(x.elements['g8-env'].textContent).toBe('Parcours désactivé');
    expect(x.nodes.some(n => n.tagName === 'form')).toBe(false);
    expect(x.calls.map(n => n.url)).toEqual(['/api/auth/me', '/api/admin/orders/item-refund-readiness', '/api/admin/orders/local-refunds']);
    expect(x.calls.every(n => !n.options.method)).toBe(true);
  });
  test('admin sees verified cash obligation and explicit 2-person authorization form', async () => {
    const row = { reservation_id:'reservation-1',order_id:'order-1',order_item_id:'item-1',
      order_reference:'E2E-G8-0001',market_code:'KM',payment_mode:'cash_relais',
      amount_kmf:'2000',quantity:2,reason:'Rupture constatée',cash_status:null };
    const x = makeUi('admin', { refunds:[row] });
    await settle();
    expect(x.elements['g8-env'].textContent).toBe('Recette autorisée');
    const submit = x.nodes.find(n => n.tagName === 'button' &&
      n.textContent === 'Autoriser la remise au relais');
    expect(submit).toBeTruthy();
    expect(x.nodes.some(n => n.tagName === 'form')).toBe(true);
    await submit.parentNode.listeners.submit({ preventDefault() {} });
    expect(x.calls).toHaveLength(3); // Readiness and list are read-only; confirmation prevents financial POST
  });
  test('relay only receives scoped cash API; cannot access admin refund mutations', async () => {
    const row = { authorization_id:'a1',order_id:'o1',order_item_id:'i1',
      order_reference:'E2E-G8-0002',market_code:'KM',status:'approved',amount_kmf:'1000',quantity:1 };
    const x = makeUi('agent_relais', { refunds:[row] });
    await settle();
    expect(x.calls.map(n=>n.url)).toEqual(['/api/auth/me','/api/relay/local-cash-refunds']);
    expect(x.nodes.some(n=>n.tagName==='button' && n.textContent==='Engager une remise physique')).toBe(true);
    expect(x.nodes.some(n=>n.tagName==='input' && n.name==='operator_id')).toBe(false);
  });
  test('manual Mobile Money payer fingerprint requires exactly 64 lowercase SHA-256 hex characters', async () => {
    const row = { reservation_id:'r1',order_id:'o1',order_item_id:'i1',
      order_reference:'G8-TEST-MM',market_code:'CG',payment_mode:'mobile_money',
      amount_minor:'1200',currency:'XAF',quantity:1,reason:'Rupture attestée' };
    const x = makeUi('admin', { refunds:[row] });
    await settle();
    const fingerprint = x.nodes.find(n => n.tagName === 'input' && n.name === 'payer_fingerprint');
    expect(fingerprint).toBeTruthy();
    expect(fingerprint.attributes.pattern).toBe('[a-f0-9]{64}');
    expect(fingerprint.maxLength).toBe(64);
  });
  test('the UI does not forge payment receipts, inject server strings as HTML or call providers', () => {
    expect(script).not.toMatch(/\.innerHTML\s*=/);
    expect(script).not.toMatch(/fetch\(['"]https?:\/\//);
    expect(script).toContain('operator_verification_ref');
    expect(script).toContain('window.confirm');
  });
  test('N26a reserves a proof-bound partial refund before the separate PSP sandbox execution',async()=>{
    const context={order:{id:'order-1',reference:'K1FOWL5',payment_mode:'stripe_eur',payment_status:'paid'},
      items:[{id:'item-1',product_name:'Tissu test',quantity:3,qty_collected:1,qty_refunded:0}],
      candidates:[{order_item_id:'item-1',incident_id:'incident-1',proof:'relay_receipt',verified_missing:2,available_quantity:2}],blocked:false};
    const x=makeUi('admin',{refunds:[]},200,{itemRefundEnabled:true,itemRefundContext:context,confirm:true,
      itemReservation:{reservationId:'reservation-1',status:'reserved',amountKmf:'1000.00',amountEur:'2.00'},
      execution:{status:'confirmed',paid:true}});
    await settle();
    const reference=x.nodes.find(n=>n.name==='order_reference');reference.value='K1FOWL5';
    await reference.parentNode.parentNode.listeners.submit({preventDefault(){}});
    const candidate=x.nodes.find(n=>n.name==='candidate');candidate.value='0';
    x.nodes.find(n=>n.name==='reason').value='Manquant confirmé au relais';
    const decision=candidate.parentNode.parentNode;
    await decision.listeners.submit({preventDefault(){}});
    const reserve=x.calls.find(call=>call.url.endsWith('/refund-reservations')&&call.options.method==='POST');
    expect(reserve.url).toBe('/api/admin/orders/order-1/items/item-1/refund-reservations');
    expect(JSON.parse(reserve.options.body)).toMatchObject({incident_id:'incident-1',quantity:1,
      operation_key:'00000000-0000-4000-8000-000000000001',reason:'Manquant confirmé au relais'});
    expect(x.calls.some(call=>call.url.endsWith('/execute'))).toBe(false);
    const execute=x.nodes.find(n=>n.attributes['data-g8-action']==='execute-item-refund');
    await execute.listeners.click();
    expect(x.calls.some(call=>call.url.endsWith('/refund-reservations/reservation-1/execute')&&
      call.options.method==='POST')).toBe(true);
    expect(x.nodes.find(n=>n.attributes.role==='status').textContent).toContain('Remboursement PSP confirmé');
  });
  test('N26a reuses the reservation key on uncertain response and suppresses repeat after PSP unknown',async()=>{
    const context={order:{id:'order-1',reference:'K1FOWL5',payment_mode:'paypal_eur',payment_status:'paid'},
      items:[{id:'item-1',product_name:'Tissu test',quantity:1,qty_collected:0,qty_refunded:0}],
      candidates:[{order_item_id:'item-1',incident_id:'incident-1',proof:'supplier_shortage',verified_missing:1,available_quantity:1}],blocked:false};
    const x=makeUi('admin',{refunds:[]},200,{itemRefundEnabled:true,itemRefundContext:context,confirm:true,
      itemRefundStatuses:[503,202],itemReservation:{reservationId:'reservation-1',status:'reserved',amountKmf:'1000',amountEur:'2.00'},
      execution:{status:'unknown',requiresReconciliation:true}});
    await settle();const reference=x.nodes.find(n=>n.name==='order_reference');reference.value='K1FOWL5';
    await reference.parentNode.parentNode.listeners.submit({preventDefault(){}});
    const candidate=x.nodes.find(n=>n.name==='candidate');candidate.value='0';
    x.nodes.find(n=>n.name==='reason').value='Manquant fournisseur';
    const decision=candidate.parentNode.parentNode;
    await decision.listeners.submit({preventDefault(){}});await decision.listeners.submit({preventDefault(){}});
    const reserves=x.calls.filter(call=>call.url.endsWith('/refund-reservations')&&call.options.method==='POST');
    expect(reserves).toHaveLength(2);
    expect(reserves.map(call=>JSON.parse(call.options.body).operation_key)).toEqual([
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'
    ]);
    const execute=x.nodes.find(n=>n.attributes['data-g8-action']==='execute-item-refund');
    await execute.listeners.click();await execute.listeners.click();
    expect(execute.hidden).toBe(true);
    expect(x.calls.filter(call=>call.url.endsWith('/execute')).length).toBe(1);
    expect(x.nodes.find(n=>n.attributes.role==='status').textContent).toContain('Aucun nouvel essai');
  });
});
