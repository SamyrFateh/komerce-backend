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
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] || null; },
    addEventListener(evt, fn) { handlers[evt] = fn; },
    click() { return handlers.click && handlers.click({ target: this }); },
    focus() {},
    remove() { this.removed = true; },
  };
  return node;
}
const doc = { createElement: el };
const PO_ID = '10000000-0000-4000-8000-000000000001';
const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };
const actions = (menu) => walk(menu).filter((n) => n.attrs && n.attrs['data-hub-real-action']).map((n) => n.attrs['data-hub-real-action']);
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
  load().administration(menu, { doc, fetch: fetchFn, user, po: { id: PO_ID, status: 'draft', ...po }, field, grants, refresh: jest.fn() });
  return menu;
};

test('engagement : sans droit, aucune action ; le message dit que la PO préparée n\'est pas un engagement', () => {
  const menu = run({}, 'Engagement', { purchase_commitment: false });
  expect(actions(menu)).toEqual([]);
  expect(texts(menu)).toContain('ne détient pas cette autorisation');
});

test('engagement : le détenteur du droit voit « Valider l\'engagement d\'achat » (pas « Soumettre » tant que non validé)', () => {
  const menu = run({}, 'Engagement', { purchase_commitment: true });
  expect(actions(menu)).toEqual(['Valider l’engagement d’achat']);
});

test('engagement validé + brouillon : « Soumettre au fournisseur » poste sur la route canonique', async () => {
  const fetchFn = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
  const menu = run({ commitment_decision: decision }, 'Engagement', {}, undefined, fetchFn);
  expect(actions(menu)).toEqual(['Soumettre au fournisseur']);
  expect(texts(menu)).toContain('Engagement d’achat validé par Directrice');
  await walk(menu).find((n) => n.attrs['data-hub-real-action']).click();
  expect(fetchFn).toHaveBeenCalledWith('/api/purchasing/po/' + PO_ID + '/submit', expect.objectContaining({ method: 'POST' }));
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
  expect(actions(run({ status: 'notified', commitment_decision: decision }, 'Autorisation', { supplier_payment: true })))
    .toEqual(['Autoriser le paiement fournisseur']);
});

test('paiement déjà autorisé : décision affichée, aucune seconde action ; un débit ne vaut pas autorisation', () => {
  const menu = run({ status: 'notified', commitment_decision: decision, payment_decision: { ...decision, proof_ref: 'VIR-1' } }, 'Autorisation', { supplier_payment: true });
  expect(actions(menu)).toEqual([]);
  expect(texts(menu)).toContain('Paiement fournisseur autorisé par Directrice');
});

test('L8 : Hub central guide le sourcing vers la commande exacte sans mutation', async () => {
  const menu = el('div');
  menu.setAttribute('data-hub-request', '1');
  const orderId = 'cf9520d0-84ff-4fe1-ab9b-a5e972b1365b';
  const fetchFn = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      market_id: 'KM',
      orders: [{ id: orderId, reference: 'KRGNX5O', items: [
        { sourcing_required: true, purchasing_missing: 2 },
        { sourcing_required: true, purchasing_missing: 1 },
      ] }],
      purchase_orders: [], needs: [], boxes: [], open_shipments: [],
    }),
  }));
  const result = await load().operations(menu, {
    doc, fetch: fetchFn, user: { role: 'agent_hub' },
    order: { id: orderId, reference: 'KRGNX5O', market: 'KM',
      po: 'Sourcing requis' },
    stage: 'PO', refresh: jest.fn(),
  });
  expect(result).toBe(true);
  const links = walk(menu).filter(n => n.tagName === 'A');
  expect(links).toHaveLength(1);
  expect(links[0].href).toBe(
    '/admin/hub-live?view=execute&market=KM&order=' + orderId
  );
  expect(links[0].textContent).toContain('3 unité(s)');
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: 'GET' });
});

test('L8 : aucune action sourcing depuis une commande couverte, ni depuis un rôle lecteur', async () => {
  const orderId = 'cf9520d0-84ff-4fe1-ab9b-a5e972b1365b';
  const fetchFn = jest.fn(async () => ({
    ok: true, json: async () => ({
      orders: [{ id: orderId, items: [{ sourcing_required: false, purchasing_missing: 0 }] }],
      purchase_orders: [], needs: [], boxes: [],
    }),
  }));
  const menu = el('div');
  menu.setAttribute('data-hub-request', '2');
  await load().operations(menu, {
    doc, fetch: fetchFn, user: { role: 'agent_hub' },
    order: { id: orderId, reference: 'KRGNX5O', market: 'KM' },
    stage: 'PO',
  });
  expect(walk(menu).filter(n => n.tagName === 'A')).toHaveLength(0);
  const observer = el('div');
  const handled = await load().operations(observer, {
    doc, fetch: fetchFn, user: { role: 'market_operator' },
    order: { id: orderId, reference: 'KRGNX5O', market: 'KM' },
    stage: 'PO',
  });
  expect(handled).toBe(false);
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

test('rôle non Hub : aucune écriture', () => {
  expect(actions(run({}, 'Engagement', { purchase_commitment: true }, { role: 'agent_relais' }))).toEqual([]);
});

test('régression P0-3 : un UUID réel (5 groupes) active les actions d\'achat — attester l\'envoi d\'une PO soumise', () => {
  const menu = run({ status: 'notified' }, 'Fournisseur', {});
  expect(actions(menu)).toEqual(['Attester l’envoi fournisseur']);
  expect(actions(run({ status: 'notified', sent_at: '2026-11-03T09:00:00Z' }, 'Fournisseur', {}))).toEqual([]);
});
