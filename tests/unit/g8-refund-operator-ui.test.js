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

function makeUi(role, result, status = 200) {
  const nodes = [];
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
    return {
      ok: status < 400,
      status,
      json: async () => result
    };
  };
  vm.runInNewContext(script, { document, fetch,
    window: { confirm: () => false, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } } }, { timeout: 1000 });
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
    expect(x.calls.map(n => n.url)).toEqual(['/api/auth/me', '/api/admin/orders/local-refunds']);
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
    expect(x.calls).toHaveLength(2); // Negative confirmation prevents financial POST
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
  test('the UI does not forge payment receipts, inject server strings as HTML or call providers', () => {
    expect(script).not.toMatch(/\.innerHTML\s*=/);
    expect(script).not.toMatch(/fetch\(['"]https?:\/\//);
    expect(script).toContain('operator_verification_ref');
    expect(script).toContain('window.confirm');
  });
});
