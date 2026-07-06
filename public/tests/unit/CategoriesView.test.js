'use strict';

const { loadView, mockConfirm, flush, submitForm } = require('./helpers/dashboardTestKit');

const REL = '../../dashboards/admin/js/views/CategoriesView.js';

function mockFetchSeq(handler) {
  global.fetch = jest.fn(handler);
  return global.fetch;
}

function jsonRes(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

function makeCat(overrides = {}) {
  return {
    key: 'bijoux', label: 'Bijoux', short_label: 'Bijoux', section_emoji: '💍',
    is_active: true, display_order: 1, show_in_rail: true, show_in_sections: true,
    db_keys: ['bijoux'], image_url: null, theme_token: null, accent_token: null,
    subcategories: [],
    ...overrides,
  };
}

describe('CategoriesView', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
  });

  afterEach(() => {
    delete global.fetch;
    document.querySelectorAll('.toast, [style*="position:fixed"]').forEach((n) => n.remove());
    jest.restoreAllMocks();
  });

  it('expose render() (contrat app.js#invokeView)', () => {
    const View = loadView(REL, 'CategoriesView');
    expect(typeof View.render).toBe('function');
  });

  it('pose le shell (titre + bouton + zone de chargement) avant résolution', async () => {
    mockFetchSeq(() => new Promise(() => {})); // never resolves
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    const p = View.render(main);
    expect(main.querySelector('#btn-add-cat')).toBeTruthy();
    expect(main.querySelector('.loading-state')).toBeTruthy();
    await Promise.race([p, flush()]);
  });

  it('liste vide → message "Aucune catégorie"', async () => {
    mockFetchSeq(() => jsonRes([]));
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);
    expect(main.querySelector('#cats-container').textContent).toContain('Aucune catégorie');
  });

  it('échec apiFetch (non-ok, json error) → message d\'erreur échappé', async () => {
    mockFetchSeq(() => jsonRes({ error: '<img onerror=alert(1)>' }, false, 500));
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);
    const err = main.querySelector('.error-state');
    expect(err).toBeTruthy();
    expect(err.innerHTML).not.toContain('<img');
    expect(err.innerHTML).toContain('&lt;img');
  });

  it('échec apiFetch (non-ok, json non parsable) → fallback HTTP {status}', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false, status: 503, json: () => Promise.reject(new Error('bad json')),
    }));
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);
    expect(main.querySelector('.error-state').textContent).toContain('HTTP 503');
  });

  it('affiche une catégorie active avec ses sous-catégories, sans badge [inactif]', async () => {
    const cat = makeCat({
      subcategories: [{ key: 'bagues', label: 'Bagues', icon: '💍' }],
    });
    mockFetchSeq(() => jsonRes([cat]));
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    expect(main.textContent).toContain('Bijoux');
    expect(main.textContent).toContain('Bagues');
    expect(main.textContent).not.toContain('[inactif]');
    expect(main.querySelector('[data-action="toggle-cat"]').textContent).toContain('Désactiver');
  });

  it('catégorie inactive → badge [inactif] et bouton "Activer"', async () => {
    const cat = makeCat({ is_active: false });
    mockFetchSeq(() => jsonRes([cat]));
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    expect(main.textContent).toContain('[inactif]');
    expect(main.querySelector('[data-action="toggle-cat"]').textContent).toContain('Activer');
  });

  it('toggle-cat : confirm() refusé → aucun PUT envoyé', async () => {
    mockConfirm(false);
    const cat = makeCat();
    const fetchMock = mockFetchSeq(() => jsonRes([cat]));
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('[data-action="toggle-cat"]').click();
    await flush();

    const putCalls = fetchMock.mock.calls.filter(([, opts]) => opts && opts.method === 'PUT');
    expect(putCalls.length).toBe(0);
  });

  it('toggle-cat : confirm() accepté → PUT is_active inversé puis refresh', async () => {
    mockConfirm(true);
    const cat = makeCat({ is_active: true });
    let getCount = 0;
    const fetchMock = mockFetchSeq((url, opts) => {
      if (opts && opts.method === 'PUT') return jsonRes({ ...cat, is_active: false });
      getCount++;
      return jsonRes([cat]);
    });
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('[data-action="toggle-cat"]').click();
    await flush();
    await flush();

    const putCall = fetchMock.mock.calls.find(([, opts]) => opts && opts.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(putCall[0]).toContain('/bijoux');
    expect(JSON.parse(putCall[1].body)).toEqual({ is_active: false });
    expect(getCount).toBeGreaterThanOrEqual(2); // initial + refresh
  });

  it('bouton "+ Nouvelle catégorie" ouvre un modal avec formulaire', async () => {
    mockFetchSeq(() => jsonRes([]));
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('#btn-add-cat').click();
    await flush();

    const form = document.getElementById('modal-form');
    expect(form).toBeTruthy();
    expect(form.querySelector('[name="key"]')).toBeTruthy();
    expect(form.querySelector('[name="label"]')).toBeTruthy();
  });

  it('soumission du modal "Nouvelle catégorie" → POST body cohérent puis refresh', async () => {
    let posted = null;
    const fetchMock = mockFetchSeq((url, opts) => {
      if (opts && opts.method === 'POST') { posted = JSON.parse(opts.body); return jsonRes({ ok: true }); }
      return jsonRes([]);
    });
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('#btn-add-cat').click();
    await flush();
    const form = document.getElementById('modal-form');
    form.querySelector('[name="key"]').value = 'Nouvelle';
    form.querySelector('[name="label"]').value = 'Nouvelle Cat';
    form.querySelector('[name="db_keys"]') && (form.querySelector('[name="db_keys"]').value = 'a, b ,c');
    submitForm(form);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(posted).toBeTruthy();
    expect(posted.key).toBe('Nouvelle');
    expect(posted.label).toBe('Nouvelle Cat');
    expect(document.getElementById('modal-form')).toBeNull(); // overlay removed after success
    expect(fetchMock.mock.calls.some(([u, o]) => !o || !o.method)).toBe(true); // GET refresh happened
  });

  it('échec de soumission du modal → toast erreur, overlay reste ouvert', async () => {
    mockFetchSeq((url, opts) => {
      if (opts && opts.method === 'POST') return jsonRes({ error: 'clé déjà utilisée' }, false, 409);
      return jsonRes([]);
    });
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('#btn-add-cat').click();
    await flush();
    const form = document.getElementById('modal-form');
    form.querySelector('[name="key"]').value = 'x';
    form.querySelector('[name="label"]').value = 'y';
    submitForm(form);
    await flush();
    await flush();

    expect(document.getElementById('modal-form')).toBeTruthy(); // still open
    expect(document.body.textContent).toContain('clé déjà utilisée');
  });

  it('clic "Annuler" dans le modal ferme l\'overlay sans requête', async () => {
    const fetchMock = mockFetchSeq(() => jsonRes([]));
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('#btn-add-cat').click();
    await flush();
    document.getElementById('modal-cancel').click();

    expect(document.getElementById('modal-form')).toBeNull();
    expect(fetchMock.mock.calls.every(([, opts]) => !opts || !opts.method)).toBe(true);
  });

  it('edit-cat : modal pré-rempli avec les valeurs existantes, soumission → PUT', async () => {
    const cat = makeCat({ label: 'Bijoux Précieux', display_order: 5 });
    let putBody = null;
    mockFetchSeq((url, opts) => {
      if (opts && opts.method === 'PUT') { putBody = JSON.parse(opts.body); return jsonRes({ ok: true }); }
      return jsonRes([cat]);
    });
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('[data-action="edit-cat"]').click();
    await flush();
    const form = document.getElementById('modal-form');
    expect(form.querySelector('[name="label"]').value).toBe('Bijoux Précieux');
    expect(form.querySelector('[name="display_order"]').value).toBe('5');

    form.querySelector('[name="label"]').value = 'Bijoux Modifiés';
    submitForm(form);
    await flush();
    await flush();

    expect(putBody.label).toBe('Bijoux Modifiés');
  });

  it('add-subcat : soumission → POST vers /subcategories', async () => {
    const cat = makeCat();
    let posted = null;
    let postedUrl = null;
    mockFetchSeq((url, opts) => {
      if (opts && opts.method === 'POST') { posted = JSON.parse(opts.body); postedUrl = url; return jsonRes({ ok: true }); }
      return jsonRes([cat]);
    });
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('[data-action="add-subcat"]').click();
    await flush();
    const form = document.getElementById('modal-form');
    form.querySelector('[name="key"]').value = 'bagues';
    form.querySelector('[name="label"]').value = 'Bagues';
    submitForm(form);
    await flush();
    await flush();

    expect(postedUrl).toContain('/bijoux/subcategories');
    expect(posted.key).toBe('bagues');
  });

  it('edit-subcat : modal pré-rempli, soumission → PUT vers /subcategories/:key', async () => {
    const cat = makeCat({ subcategories: [{ key: 'bagues', label: 'Bagues', icon: '💍', display_order: 2 }] });
    let putUrl = null;
    mockFetchSeq((url, opts) => {
      if (opts && opts.method === 'PUT') { putUrl = url; return jsonRes({ ok: true }); }
      return jsonRes([cat]);
    });
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('[data-action="edit-subcat"]').click();
    await flush();
    const form = document.getElementById('modal-form');
    expect(form.querySelector('[name="label"]').value).toBe('Bagues');
    submitForm(form);
    await flush();
    await flush();

    expect(putUrl).toContain('/bijoux/subcategories/bagues');
  });

  it('del-subcat : confirm() refusé → aucun DELETE', async () => {
    mockConfirm(false);
    const cat = makeCat({ subcategories: [{ key: 'bagues', label: 'Bagues' }] });
    const fetchMock = mockFetchSeq(() => jsonRes([cat]));
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('[data-action="del-subcat"]').click();
    await flush();

    expect(fetchMock.mock.calls.some(([, o]) => o && o.method === 'DELETE')).toBe(false);
  });

  it('del-subcat : confirm() accepté → DELETE puis refresh', async () => {
    mockConfirm(true);
    const cat = makeCat({ subcategories: [{ key: 'bagues', label: 'Bagues' }] });
    let deleteUrl = null;
    mockFetchSeq((url, opts) => {
      if (opts && opts.method === 'DELETE') { deleteUrl = url; return jsonRes(null, true, 204); }
      return jsonRes([cat]);
    });
    const View = loadView(REL, 'CategoriesView');
    const main = document.getElementById('main');
    await View.render(main);

    main.querySelector('[data-action="del-subcat"]').click();
    await flush();
    await flush();

    expect(deleteUrl).toContain('/bijoux/subcategories/bagues');
  });
});
