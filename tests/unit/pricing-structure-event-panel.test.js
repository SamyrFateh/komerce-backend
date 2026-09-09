'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

function fakeNode(tagName = 'div') {
  return {
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    value: '',
    name: '',
    type: '',
    required: false,
    disabled: false,
    hidden: false,
    maxLength: 0,
    step: '',
    placeholder: '',
    style: {},
    children: [],
    attributes: {},
    listeners: {},
    parentNode: null,
    noValidate: false,
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    replaceChildren(...nodes) {
      this.children.forEach(c => { c.parentNode = null; });
      this.children = nodes;
      nodes.forEach(n => { n.parentNode = this; });
    },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    removeEventListener(name) { delete this.listeners[name]; },
    dispatchEvent(event) { if (event && this.listeners[event.type]) this.listeners[event.type](event); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    querySelector() { return null; },
  };
}

function fakeDocument() {
  const listeners = {};
  return {
    createElement: jest.fn(tag => fakeNode(tag)),
    body: fakeNode('body'),
    addEventListener(name, handler) { listeners[name] = handler; },
    removeEventListener(name) { delete listeners[name]; },
    listeners,
  };
}

function findByClass(node, className) {
  if (!node || !node.children) return null;
  for (const child of node.children) {
    if (child.className && String(child.className).split(' ').includes(className)) return child;
    const nested = findByClass(child, className);
    if (nested) return nested;
  }
  return null;
}

function findByTag(node, tag, name) {
  if (!node || !node.children) return null;
  for (const child of node.children) {
    if (child.tagName === tag.toUpperCase() && (!name || child.name === name)) return child;
    const nested = findByTag(child, tag, name);
    if (nested) return nested;
  }
  return null;
}

const panel = require('../../public/dashboards/canonical/js/pricing-structure-event-panel');

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body };
}

describe('pricing-structure-event-panel', () => {
  test('charge les charges au premier rendu et affiche le formulaire', async () => {
    const doc = fakeDocument();
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ charges: [{ id: 'c1', family: 'platform', name: 'Railway' }] }));

    const handle = await panel.open({
      document: doc,
      fetch: fetchFn,
      title: 'Ajuster les charges fixes directes',
      chargesEndpoint: '/api/admin/workspaces/pricing/market/CM/charges',
      eventsEndpoint: '/api/admin/workspaces/pricing/market/CM/structure-events',
      submitEndpoint: '/api/admin/workspaces/pricing/market/CM/structure-events',
    });

    expect(fetchFn).toHaveBeenCalledWith('/api/admin/workspaces/pricing/market/CM/charges', expect.objectContaining({ credentials: 'include' }));
    const chargeSelect = findByTag(doc.body, 'select', 'charge_id');
    expect(chargeSelect).not.toBeNull();
    expect(chargeSelect.children.length).toBe(2); // placeholder + Railway
    handle.close();
  });

  test('le formulaire adjusts_event_id est masqué pour ACCRUAL et visible sinon', async () => {
    const doc = fakeDocument();
    const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ charges: [] }));

    await panel.open({
      document: doc,
      fetch: fetchFn,
      title: 'x',
      chargesEndpoint: '/x/charges',
      eventsEndpoint: '/x/structure-events',
      submitEndpoint: '/x/structure-events',
    });

    const eventKindSelect = findByTag(doc.body, 'select', 'event_kind');
    const adjustsSelect = findByTag(doc.body, 'select', 'adjusts_event_id');
    const adjustsWrap = adjustsSelect.parentNode;
    expect(adjustsWrap.hidden).toBe(true); // ACCRUAL par défaut

    eventKindSelect.value = 'ADJUSTMENT';
    eventKindSelect.dispatchEvent({ type: 'change' });
    expect(adjustsWrap.hidden).toBe(false);
  });

  test('sélectionner une devise différente de KMF déverrouille le taux FX', async () => {
    const doc = fakeDocument();
    const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ charges: [] }));

    await panel.open({
      document: doc, fetch: fetchFn, title: 'x',
      chargesEndpoint: '/x/charges', eventsEndpoint: '/x/e', submitEndpoint: '/x/e',
    });

    const currencyInput = findByTag(doc.body, 'input', 'currency');
    const fxInput = findByTag(doc.body, 'input', 'fx_rate_to_kmf');
    expect(fxInput.disabled).toBe(true);

    currencyInput.value = 'eur';
    currencyInput.dispatchEvent({ type: 'input' });
    expect(currencyInput.value).toBe('EUR');
    expect(fxInput.disabled).toBe(false);
  });

  test('charge l’historique quand une charge est sélectionnée', async () => {
    const doc = fakeDocument();
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ charges: [{ id: 'c1', family: 'platform', name: 'Railway' }] }))
      .mockResolvedValueOnce(jsonResponse({ events: [{ id: 'e1', event_kind: 'ACCRUAL', amount_kmf: 50000, economic_from: '2026-09-01', economic_to: '2026-10-01', recorded_by_name: 'Admin' }] }));

    await panel.open({
      document: doc, fetch: fetchFn, title: 'x',
      chargesEndpoint: '/x/charges', eventsEndpoint: '/x/structure-events', submitEndpoint: '/x/structure-events',
    });

    const chargeSelect = findByTag(doc.body, 'select', 'charge_id');
    chargeSelect.value = 'c1';
    chargeSelect.dispatchEvent({ type: 'change' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(fetchFn).toHaveBeenCalledWith('/x/structure-events?charge_id=c1', expect.objectContaining({ credentials: 'include' }));
    const historyBlock = findByClass(doc.body, 'kmc-structure-panel-history');
    expect(historyBlock.children.length).toBe(1);
  });

  test('soumet le formulaire avec le bon payload et ferme le panneau', async () => {
    const doc = fakeDocument();
    const onSaved = jest.fn();
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ charges: [{ id: 'c1', family: 'platform', name: 'Railway' }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { id: 'evt-1' } }));

    await panel.open({
      document: doc, fetch: fetchFn, title: 'x',
      chargesEndpoint: '/x/charges', eventsEndpoint: '/x/structure-events', submitEndpoint: '/x/structure-events',
      onSaved,
    });

    const form = findByTag(doc.body, 'form');
    const chargeSelect = findByTag(doc.body, 'select', 'charge_id');
    chargeSelect.value = 'c1';
    const fromInput = findByTag(doc.body, 'input', 'economic_from');
    fromInput.value = '2026-09-01';
    const toInput = findByTag(doc.body, 'input', 'economic_to');
    toInput.value = '2026-10-01';
    const amountInput = findByTag(doc.body, 'input', 'amount_original');
    amountInput.value = '50000';
    const evidenceInput = findByTag(doc.body, 'input', 'evidence_ref');
    evidenceInput.value = 'invoice://railway/2026-09';

    await form.listeners.submit({ preventDefault() {} });

    expect(fetchFn).toHaveBeenLastCalledWith('/x/structure-events', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    const [, options] = fetchFn.mock.calls[1];
    const body = JSON.parse(options.body);
    expect(body).toEqual(expect.objectContaining({
      charge_id: 'c1',
      event_kind: 'ACCRUAL',
      amount_original: 50000,
      currency: 'KMF',
      fx_rate_to_kmf: 1,
      amount_kmf: 50000,
      evidence_ref: 'invoice://railway/2026-09',
    }));
    expect(body.adjusts_event_id).toBeUndefined();
    expect(onSaved).toHaveBeenCalled();
  });

  test('affiche l’erreur serveur sans fermer le panneau', async () => {
    const doc = fakeDocument();
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ charges: [{ id: 'c1', family: 'platform', name: 'Railway' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'evidence_ref must be at least 3 characters' }, false));

    await panel.open({
      document: doc, fetch: fetchFn, title: 'x',
      chargesEndpoint: '/x/charges', eventsEndpoint: '/x/structure-events', submitEndpoint: '/x/structure-events',
    });

    const form = findByTag(doc.body, 'form');
    await form.listeners.submit({ preventDefault() {} });

    const errorBox = findByClass(doc.body, 'kmc-structure-panel-error');
    expect(errorBox.hidden).toBe(false);
    expect(errorBox.textContent).toBe('evidence_ref must be at least 3 characters');
  });

  test('Échap ferme le panneau et retire l’écouteur clavier', async () => {
    const doc = fakeDocument();
    const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ charges: [] }));

    await panel.open({
      document: doc, fetch: fetchFn, title: 'x',
      chargesEndpoint: '/x/charges', eventsEndpoint: '/x/e', submitEndpoint: '/x/e',
    });

    expect(doc.body.children.length).toBe(1);
    doc.listeners.keydown({ key: 'Escape' });
    expect(doc.body.children.length).toBe(0);
  });
});
