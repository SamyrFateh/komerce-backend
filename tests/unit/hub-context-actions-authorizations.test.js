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

test('rôle non Hub : aucune écriture', () => {
  expect(actions(run({}, 'Engagement', { purchase_commitment: true }, { role: 'agent_relais' }))).toEqual([]);
});

test('régression P0-3 : un UUID réel (5 groupes) active les actions d\'achat — attester l\'envoi d\'une PO soumise', () => {
  const menu = run({ status: 'notified' }, 'Fournisseur', {});
  expect(actions(menu)).toEqual(['Attester l’envoi fournisseur']);
  expect(actions(run({ status: 'notified', sent_at: '2026-11-03T09:00:00Z' }, 'Fournisseur', {}))).toEqual([]);
});
