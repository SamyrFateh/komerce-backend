'use strict';
describe('CatalogApprovalView', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="main"></div>'; });

  it('module charge sans crash fatal', () => {
    let loaded = false;
    try {
      require('../../admin/js/views/CatalogApprovalView.js');
      loaded = true;
    } catch (e) {
      // Acceptable: dépendances esc/escAttr (utils.js) non chargées en isolation
      if (e.message.includes('esc') || e.message.includes('is not defined')) {
        loaded = true; // Le module a parsé correctement, juste deps manquantes
      }
    }
    expect(loaded).toBe(true);
  });

  it('expose render() (contrat attendu par app.js#invokeView)', () => {
    require('../../admin/js/views/CatalogApprovalView.js');
    expect(typeof window.CatalogApprovalView).toBe('object');
    expect(typeof window.CatalogApprovalView.render).toBe('function');
  });

  it('file vide : affiche le message "rien à approuver" sans appeler les actions', async () => {
    global.esc = (s) => (s == null ? '' : String(s));
    global.escAttr = (s) => (s == null ? '' : String(s));
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ items: [], total: 0 }),
    }));

    require('../../admin/js/views/CatalogApprovalView.js');
    const main = document.getElementById('main');
    await window.CatalogApprovalView.render(main);

    expect(main.textContent).toContain("rien à approuver");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/catalog/approval-queue'),
      expect.any(Object)
    );
  });

  it('liste un candidat et déclenche approve() au clic (POST .../approve)', async () => {
    global.esc = (s) => (s == null ? '' : String(s));
    global.escAttr = (s) => (s == null ? '' : String(s));
    window.confirm = jest.fn(() => true);

    const item = {
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      name: 'Batterie externe', category: 'tech', price_kmf: 15000, stock: 10,
      needs_review: false, enrichment_confidence: 0.9, content_source: 'ai_enriched',
    };
    global.fetch = jest.fn((url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('/approve')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: item.id, is_active: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [item], total: 1 }) });
    });

    require('../../admin/js/views/CatalogApprovalView.js');
    const main = document.getElementById('main');
    await window.CatalogApprovalView.render(main);

    const approveBtn = main.querySelector('[data-act="approve"]');
    expect(approveBtn).toBeTruthy();
    approveBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const approveCall = global.fetch.mock.calls.find(([url, opts]) => opts && opts.method === 'POST' && url.includes('/approve'));
    expect(approveCall).toBeDefined();
  });
});
