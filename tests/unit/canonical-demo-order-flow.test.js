'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { JSDOM } = require('jsdom');
const demo = require('../../public/dashboards/canonical/js/demo-order-flow');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function response(body, ok = true, status = 200) {
  return { ok, status, json: jest.fn().mockResolvedValue(body) };
}

function trace(overrides = {}) {
  return {
    order: {
      id: ORDER_ID,
      reference: 'CMD-42',
      status: 'confirmed',
      payment_status: 'paid',
      total_kmf: 12500,
      customer_name: 'Amina',
      market_code: 'KM',
      ...overrides,
    },
    history: [{ id: 'h1', status: 'confirmed', created_at: '2026-08-22T12:00:00Z', changed_by_name: 'Admin', note: 'OK' }],
    notifications: [{ id: 'n1', title: 'Commande confirmée', message: 'OK', status: 'open', created_at: '2026-08-22T12:00:00Z' }],
    invoices: [{ id: 'i1', invoice_number: 'FAC-1', payment_status: 'paid', created_at: '2026-08-22T12:00:00Z' }],
    documents: [{ id: 'd1', document_type: 'purchase_order', reference: 'PO-1', status: 'generated', issued_at: '2026-08-22T12:00:00Z' }],
  };
}

function setup(fetchMock) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://staging.test/admin-next' });
  const root = dom.window.document.getElementById('root');
  const mounted = demo.mount({
    document: dom.window.document,
    root,
    user: { first_name: 'Jojo' },
    fetch: fetchMock,
  });
  return { dom, root, mounted };
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('décrit la séquence et le prochain statut', () => {
  expect(Object.isFrozen(demo.STATUS_FLOW)).toBe(true);
  expect(demo.nextStatusFor('pending')).toBe('confirmed');
  expect(demo.nextStatusFor('collected')).toBeNull();
  expect(demo.nextStatusFor('cancelled')).toBeNull();
});

test('bloque la confirmation sans paiement et les statuts terminaux', () => {
  expect(demo.advanceGuard({ status: 'pending', payment_status: 'pending' })).toEqual({
    allowed: false, nextStatus: 'confirmed', reason: 'Confirmer d’abord le paiement dans le parcours d’achat.',
  });
  expect(demo.advanceGuard({ status: 'collected', payment_status: 'paid' }).allowed).toBe(false);
  expect(demo.advanceGuard({ status: 'confirmed', payment_status: 'paid' })).toEqual({
    allowed: true, nextStatus: 'ordered', reason: null,
  });
});

test('jsonRequest propage le message API et tolère une réponse non JSON', async () => {
  await expect(demo.jsonRequest(jest.fn().mockResolvedValue(response({ ok: true })), '/ok')).resolves.toEqual({ ok: true });
  const bad = { ok: false, status: 503, json: jest.fn().mockRejectedValue(new Error('html')) };
  await expect(demo.jsonRequest(jest.fn().mockResolvedValue(bad), '/bad')).rejects.toThrow('Erreur HTTP 503');
  await expect(demo.jsonRequest(jest.fn().mockResolvedValue(response({ error: 'Refusé' }, false, 403)), '/bad')).rejects.toThrow('Refusé');
});

test('monte le cockpit, charge une commande et affiche les traces', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(response({ orders: [{ id: ORDER_ID, reference: 'CMD-42', status: 'confirmed', market_code: 'KM' }] }))
    .mockResolvedValueOnce(response(trace()));
  const { root } = setup(fetchMock);
  await settle();

  expect(root.textContent).toContain('Démo parcours commande');
  expect(root.textContent).toContain('STAGING');
  expect(root.textContent).toContain('CMD-42');
  expect(root.textContent).toContain('Notifications client');
  expect(root.textContent).toContain('Facture FAC-1');
  expect(root.querySelector('a[href="/api/invoices/' + ORDER_ID + '"]')).not.toBeNull();
});

test('avance le statut réel puis recharge la trace', async () => {
  const first = trace();
  const second = trace({ status: 'ordered' });
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(response({ orders: [{ id: ORDER_ID, reference: 'CMD-42', status: 'confirmed' }] }))
    .mockResolvedValueOnce(response(first))
    .mockResolvedValueOnce(response({ success: true, status: 'ordered' }))
    .mockResolvedValueOnce(response(second));
  const { root } = setup(fetchMock);
  await settle();

  root.querySelector('.demo-flow__button--primary').click();
  await settle();

  expect(fetchMock).toHaveBeenCalledWith(`/api/orders/${ORDER_ID}/status`, expect.objectContaining({ method: 'PATCH' }));
  expect(root.textContent).toContain('Achat validé');
  expect(root.textContent).toContain('Statut avancé');
});

test('affiche les états vides, paiement bloqué et changement de sélection', async () => {
  const secondId = '22222222-2222-4222-8222-222222222222';
  const emptyTrace = {
    ...trace({ status: 'pending', payment_status: 'pending' }),
    history: [], notifications: [], invoices: [], documents: [],
  };
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(response({ orders: [
      { id: ORDER_ID, reference: 'CMD-42', status: 'pending' },
      { id: secondId, reference: 'CMD-43', status: 'available' },
    ] }))
    .mockResolvedValueOnce(response(emptyTrace))
    .mockResolvedValueOnce(response(trace({ id: secondId, reference: 'CMD-43', status: 'available' })));
  const { dom, root } = setup(fetchMock);
  await settle();

  expect(root.textContent).toContain('Confirmer d’abord le paiement');
  expect(root.textContent).toContain('Aucune notification');
  expect(root.textContent).toContain('Disponible après paiement confirmé');
  const select = root.querySelector('select');
  select.value = secondId;
  select.dispatchEvent(new dom.window.Event('change'));
  await settle();
  expect(root.textContent).toContain('CMD-43');
});

test('gère liste vide, erreurs de chargement et erreur de transition', async () => {
  const emptyFetch = jest.fn().mockResolvedValueOnce(response({ orders: [] }));
  const empty = setup(emptyFetch);
  await settle();
  expect(empty.root.textContent).toContain('Créez une commande test');

  const loadError = setup(jest.fn().mockResolvedValueOnce(response({ error: 'Indisponible' }, false, 500)));
  await settle();
  expect(loadError.root.textContent).toContain('Indisponible');

  const fetchMock = jest.fn()
    .mockResolvedValueOnce(response({ orders: [{ id: ORDER_ID, reference: 'CMD-42', status: 'confirmed' }] }))
    .mockResolvedValueOnce(response(trace()))
    .mockResolvedValueOnce(response({ error: 'Transition refusée' }, false, 422));
  const failed = setup(fetchMock);
  await settle();
  failed.root.querySelector('.demo-flow__button--primary').click();
  await settle();
  expect(failed.root.textContent).toContain('Transition refusée');
  expect(failed.root.querySelector('.demo-flow__button--primary').disabled).toBe(false);
});

test('couvre les fallbacks d’affichage et les commandes de rafraîchissement', async () => {
  const unusual = trace({
    status: 'manual_review', payment_status: 'paid', total_kmf: null,
    customer_name: null, market_code: null,
  });
  unusual.history = [{ id: 'h2', status: 'manual_review', created_at: null, changed_by_name: null, note: null }];
  unusual.notifications = [{ id: 'n2', title: 'Info', message: 'Info', status: 'resolved', created_at: null }];
  unusual.invoices = [];
  unusual.documents = [{ id: 'd2', document_type: 'pickup_proof', reference: 'P-1', status: null, payment_status: 'paid', issued_at: null, created_at: '2026-08-22T12:00:00Z' }];

  const fetchMock = jest.fn()
    .mockResolvedValueOnce(response({ orders: [{ id: ORDER_ID, reference: 'CMD-42', status: 'manual_review', market_code: null }] }))
    .mockResolvedValueOnce(response(unusual))
    .mockResolvedValueOnce(response(unusual))
    .mockResolvedValueOnce(response({ orders: [{ id: ORDER_ID, reference: 'CMD-42', status: 'manual_review' }] }))
    .mockResolvedValueOnce(response(unusual))
    .mockResolvedValueOnce(response({ error: 'Trace indisponible' }, false, 500));
  const { root, mounted } = setup(fetchMock);
  await settle();

  expect(root.textContent).toContain('manual_review');
  expect(root.textContent).toContain('Client · 0 KMF · Marché non renseigné');
  expect(root.textContent).toContain('Parcours terminé');
  expect(root.textContent).toContain('—');

  root.querySelector('.demo-flow__summary .demo-flow__button--secondary').click();
  await settle();
  root.querySelector('.demo-flow__toolbar .demo-flow__button').click();
  await settle();
  await mounted.loadTrace('');
  await mounted.loadTrace(ORDER_ID);
  expect(root.textContent).toContain('Trace indisponible');
});

test('couvre les identités de repli et le rafraîchissement après retrait', async () => {
  const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(callback => {
    callback();
    return 1;
  });
  const collected = trace({ status: 'collected' });
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(response({ orders: [{ id: ORDER_ID, reference: 'CMD-42', status: 'available' }] }))
    .mockResolvedValueOnce(response(trace({ status: 'available' })))
    .mockResolvedValueOnce(response({ success: true, status: 'collected' }))
    .mockResolvedValueOnce(response(collected))
    .mockResolvedValueOnce(response(collected));
  const dom = new JSDOM('<main id="root"></main>');
  const root = dom.window.document.getElementById('root');
  demo.mount({ document: dom.window.document, root, user: { name: 'Nom' }, fetch: fetchMock });
  await settle();
  root.querySelector('.demo-flow__button--primary').click();
  await settle();
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/demo/orders/${ORDER_ID}/timeline`, expect.anything());
  expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 900);
  timeoutSpy.mockRestore();

  for (const user of [{ email: 'mail@test' }, { role: 'admin' }, undefined]) {
    const oneFetch = jest.fn()
      .mockResolvedValueOnce(response({ orders: [] }));
    const local = new JSDOM('<main id="root"></main>');
    demo.mount({ document: local.window.document, root: local.window.document.getElementById('root'), user, fetch: oneFetch });
    await settle();
  }
});

test('le garde de clic refuse aussi une trace devenue non avançable', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(response({ orders: [{ id: ORDER_ID, reference: 'CMD-42', status: 'pending' }] }))
    .mockResolvedValueOnce(response(trace({ status: 'pending', payment_status: 'pending' })));
  const { root } = setup(fetchMock);
  await settle();
  const button = root.querySelector('.demo-flow__button--primary');
  button.disabled = false;
  button.click();
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
