'use strict';

/**
 * tests/unit/shipping-customs-declare-form.test.js
 *
 * canonical/js/shipping-customs-workspace.js — formulaire intégré de déclaration / correction douane
 * (remplace prompt()/confirm() natifs). Couvre : normalisation de la saisie, contenu (référence, colis, CIF, KMF),
 * conservation de la saisie sur erreur API, fermeture seulement après succès serveur, double clic,
 * annulation, correction (montant identique refusé, motif), expédition toujours visible après déclaration.
 */

const workspace = require('../../canonical/js/shipping-customs-workspace.js');

const SHIP = (over = {}) => ({
  reference: 'A8-SHIP-1', shipment_date: '2026-10-17', status: 'pending', is_active: true,
  linked_parcels: 3, cif_value_kmf: 30000, customs_paid_kmf: null, ...over,
});
const PAYLOAD = (ships) => ({
  scope: { code: 'KM', name: 'Comores' }, summary: {}, signals: {},
  transit: { ready: [], history: [] }, customs: { shipments: ships, candidates: [] },
});
const ui = {
  Section: { create: ({ title }) => { const element = document.createElement('section'); element.setAttribute('data-title', title); const slot = document.createElement('div'); element.appendChild(slot); return { element, slot }; } },
  MetricStrip: { render: () => {} },
  DataTable: { render: () => {} },
};
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });

async function setup(initial, handlers = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root');
  let current = initial;
  const calls = [];
  const fetchFn = jest.fn(async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if ((opts.method || 'GET') === 'GET') return res(200, PAYLOAD(current));
    const h = Object.keys(handlers).find((k) => url.endsWith(k));
    return h ? handlers[h](url, JSON.parse(opts.body), (next) => { current = next; }) : res(200, { ok: true });
  });
  const prompt = jest.fn(() => null);
  const confirm = jest.fn(() => true);
  await workspace.mount({
    root, document, ui, fetch: fetchFn, prompt, confirm, user: { role: 'admin' },
    adminContext: {}, requestedMarket: 'KM',
    contextContract: { resolveMarketView: () => ({ marketCode: 'KM' }) },
  });
  return { root, calls, fetchFn, prompt, confirm, setCurrent: (v) => { current = v; } };
}
const q = (root, sel) => root.querySelector(sel);
const type = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
const submit = (root) => q(root, '[data-customs-form]').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('parseAmountInput', () => {
  const { parseAmountInput } = workspace._test;
  it.each([['6 000', 6000], ['6 000', 6000], ['6 000', 6000], ['1 234,50', 1234.5], ['12.5', 12.5], ['0', 0], ['  42 ', 42]])('accepte %j → %d', (raw, value) => {
    expect(parseAmountInput(raw)).toEqual({ ok: true, value });
  });
  it.each([[''], ['   '], ['-5'], ['abc'], ['1.2.3'], ['12,345'], ['1e5'], [null]])('refuse %j (jamais converti en 0)', (raw) => {
    expect(parseAmountInput(raw).ok).toBe(false);
  });
});

describe('formulaire de déclaration douane', () => {
  it('remplace prompt/confirm : formulaire intégré avec référence, colis, CIF et unité KMF', async () => {
    const { root, prompt, confirm } = await setup([SHIP()]);
    q(root, '[data-workspace-action="declare-customs"]').click();
    const form = q(root, '[data-customs-form="declare"]');
    expect(form).not.toBeNull();
    expect(form.textContent).toContain('A8-SHIP-1');
    expect(form.textContent).toContain('3');
    expect(form.textContent).toMatch(/30\s?000\s?KMF/);
    expect(q(form, '.kmc-customs-unit').textContent).toBe('KMF');
    expect(q(form, '[data-customs-cancel]').textContent).toBe('Annuler');
    expect(q(form, '[data-customs-confirm]').textContent).toBe('Confirmer la déclaration');
    expect(prompt).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('normalise 6 000 → 6000, aperçu en KMF, envoi POST /declare, ferme après succès et garde l’expédition visible', async () => {
    const declared = SHIP({ status: 'declared', customs_paid_kmf: 6000 });
    const { root, calls } = await setup([SHIP()], { '/declare': (u, b, set) => { set([declared]); return res(200, { ok: true }); } });
    q(root, '[data-workspace-action="declare-customs"]').click();
    type(q(root, '[data-customs-amount]'), '6 000');
    expect(q(root, '[data-customs-preview]').textContent).toMatch(/= 6\s?000\s?KMF/);
    submit(root);
    await flush(); await flush();
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toMatch(/customs\/shipments\/A8-SHIP-1\/declare$/);
    expect(post.body).toEqual({ customs_paid_kmf: 6000 });
    expect(q(root, '[data-customs-form]')).toBeNull();
    const row = q(root, 'tr[data-shipment-ref="A8-SHIP-1"]');
    expect(row).not.toBeNull();
    expect(row.getAttribute('data-shipment-status')).toBe('declared');
    expect(row.textContent).toContain('Déclarée');
    expect(row.textContent).toMatch(/6\s?000\s?KMF/);
    expect(row.className).toContain('is-highlighted');
    expect(q(row, '[data-workspace-action="correct-customs"]')).not.toBeNull();
    expect(q(root, '[data-workspace-feedback]').textContent).toContain('Douane déclarée');
  });

  it('accepte 0 (douane confirmée à zéro) et le transmet tel quel', async () => {
    const { root, calls } = await setup([SHIP()]);
    q(root, '[data-workspace-action="declare-customs"]').click();
    type(q(root, '[data-customs-amount]'), '0');
    submit(root);
    await flush();
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ customs_paid_kmf: 0 });
  });

  it('saisie vide ou invalide : aucun appel API, message, formulaire conservé', async () => {
    const { root, calls } = await setup([SHIP()]);
    q(root, '[data-workspace-action="declare-customs"]').click();
    submit(root);
    await flush();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(q(root, '[data-customs-error]').textContent).toMatch(/Saisissez le montant/);
    type(q(root, '[data-customs-amount]'), 'abc');
    submit(root);
    expect(q(root, '[data-customs-error]').textContent).toMatch(/invalide/);
    expect(q(root, '[data-customs-form]')).not.toBeNull();
  });

  it('erreur API : saisie conservée, message affiché, formulaire ouvert, nouvel essai possible', async () => {
    let n = 0;
    const { root, calls } = await setup([SHIP()], { '/declare': () => (++n === 1 ? res(422, { error: 'Montant refusé par le contrôle métier' }) : res(200, { ok: true })) });
    q(root, '[data-workspace-action="declare-customs"]').click();
    const input = q(root, '[data-customs-amount]');
    type(input, '6 000');
    submit(root);
    await flush(); await flush();
    expect(q(root, '[data-customs-form]')).not.toBeNull();
    expect(q(root, '[data-customs-error]').textContent).toBe('Montant refusé par le contrôle métier');
    expect(input.value).toBe('6 000');
    expect(input.readOnly).toBe(false);
    expect(q(root, '[data-customs-confirm]').disabled).toBe(false);
    submit(root);
    await flush(); await flush();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    expect(q(root, '[data-customs-form]')).toBeNull();
  });

  it('double clic / double envoi : une seule requête ; pendant l’attente le formulaire reste ouvert, saisie verrouillée, Annuler inactif', async () => {
    let release;
    const { root, calls } = await setup([SHIP()], { '/declare': () => new Promise((resolve) => { release = () => resolve(res(200, { ok: true })); }) });
    q(root, '[data-workspace-action="declare-customs"]').click();
    type(q(root, '[data-customs-amount]'), '6000');
    submit(root); submit(root); submit(root);
    await flush();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(q(root, '[data-customs-form]')).not.toBeNull();
    expect(q(root, '[data-customs-amount]').readOnly).toBe(true);
    expect(q(root, '[data-customs-amount]').value).toBe('6000');
    expect(q(root, '[data-customs-cancel]').disabled).toBe(true);
    expect(q(root, '[data-customs-confirm]').disabled).toBe(true);
    q(root, '[data-customs-cancel]').click();
    expect(q(root, '[data-customs-form]')).not.toBeNull();
    release();
    await flush(); await flush();
    expect(q(root, '[data-customs-form]')).toBeNull();
  });

  it('Annuler ferme sans appel API', async () => {
    const { root, calls } = await setup([SHIP()]);
    q(root, '[data-workspace-action="declare-customs"]').click();
    type(q(root, '[data-customs-amount]'), '123');
    q(root, '[data-customs-cancel]').click();
    expect(q(root, '[data-customs-form]')).toBeNull();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});

describe('correction d’une douane déclarée', () => {
  const DECLARED = SHIP({ status: 'declared', customs_paid_kmf: 6000 });

  it('Corriger ouvre le formulaire prérempli avec le montant déclaré et le statut', async () => {
    const { root } = await setup([DECLARED]);
    expect(q(root, '[data-workspace-action="declare-customs"]')).toBeNull();
    q(root, '[data-workspace-action="correct-customs"]').click();
    const form = q(root, '[data-customs-form="correct"]');
    expect(form.textContent).toContain('Déclarée');
    expect(q(form, '[data-customs-amount]').value.replace(/\s/g, '')).toBe('6000');
    expect(q(form, '[data-customs-confirm]').textContent).toBe('Confirmer la correction');
  });

  it('montant identique refusé ; nouveau montant → POST /update avec motif, expédition toujours listée', async () => {
    const corrected = SHIP({ status: 'declared', customs_paid_kmf: 5000 });
    const { root, calls } = await setup([DECLARED], { '/update': (u, b, set) => { set([corrected]); return res(200, { ok: true }); } });
    q(root, '[data-workspace-action="correct-customs"]').click();
    submit(root);
    await flush();
    expect(q(root, '[data-customs-error]').textContent).toMatch(/identique/);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    type(q(root, '[data-customs-amount]'), '5 000');
    q(root, '[data-customs-reason]').value = 'Facture transitaire révisée';
    submit(root);
    await flush(); await flush();
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toMatch(/customs\/shipments\/A8-SHIP-1\/update$/);
    expect(post.body).toEqual({ customs_paid_kmf: 5000, reason: 'Facture transitaire révisée' });
    const row = q(root, 'tr[data-shipment-ref="A8-SHIP-1"]');
    expect(row.textContent).toMatch(/5\s?000\s?KMF/);
    expect(q(root, '[data-customs-form]')).toBeNull();
  });

  it('expédition confirmée ou inactive : ni Déclarer ni Corriger', async () => {
    const { root } = await setup([SHIP({ status: 'confirmed', customs_paid_kmf: 6000 }), SHIP({ reference: 'X2', status: 'declared', is_active: false })]);
    expect(q(root, '[data-workspace-action="declare-customs"]')).toBeNull();
    expect(q(root, '[data-workspace-action="correct-customs"]')).toBeNull();
  });
});
