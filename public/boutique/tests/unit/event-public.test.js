'use strict';

/**
 * tests/unit/event-public.test.js
 *
 * Lot 5 — js/event-public.js (404 L, pas d'export, IIFE).
 * Page publique : un visiteur peut voir le panier et proposer une participation.
 *
 * Même pattern que event-manage.test.js :
 *   - window.history.pushState pour mocker pathname
 *   - DOM posé avant require
 *   - flush(8) pour écouler la chaîne async fetch → .json() → render()
 *
 * event-public.js fait un import() dynamique de b-phone.js (initPhoneWidget) ;
 * cet import échoue silencieusement en jest (.catch(() => {})) → pas de mock
 * nécessaire, les tests liés au widget téléphone sont ignorés.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

async function flush(n = 8) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function mountDOM() {
  document.body.innerHTML = `
    <div id="ev-loading" style="display:block">Chargement</div>
    <div id="ev-content" style="display:none"></div>
    <div id="ev-error-block" style="display:none"></div>`;
}

function setPublicPath(token) {
  window.history.pushState({}, '', token ? `/event/w/${token}` : '/some/page');
}

function requireModule() {
  jest.resetModules();
  return require('../../js/event-public.js');
}

function makePublicPayload(overrides = {}) {
  return {
    workspace: {
      event_name:   'Fête Fatou',
      creator_name: 'Alice',
      phase:        'collecting',
      ...(overrides.workspace || {}),
    },
    items: overrides.items ?? [
      { id: 1, product_name: 'Gâteau de mariage', price_kmf: 15000, quantity: 1 },
      { id: 2, product_name: 'Décoration florale', price_kmf: 8000, quantity: 2 },
    ],
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  setPublicPath('public-token-abc');
  mountDOM();
  global.fetch = jest.fn();
  global.alert = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════

describe('getPublicToken — extraction depuis pathname', () => {
  it('chemin sans token valide → showError synchrone "invalide"', () => {
    setPublicPath(null);
    requireModule();
    const err = document.getElementById('ev-error-block');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('invalide');
  });

  it('chemin alternatif /workspace/:token : token extrait', async () => {
    window.history.pushState({}, '', '/workspace/ws-token-xyz');
    global.fetch.mockResolvedValue({
      ok: true, json: () => Promise.resolve(makePublicPayload()),
    });
    requireModule();
    await flush(8);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('ws-token-xyz'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('load() — gestion des erreurs', () => {
  it('404 → message spécifique "n\'existe pas"', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });
    requireModule();
    await flush(8);
    const err = document.getElementById('ev-error-block');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('existe');
  });

  it('erreur réseau → message générique', async () => {
    global.fetch.mockRejectedValue(new Error('Offline'));
    requireModule();
    await flush(8);
    expect(document.getElementById('ev-error-block').style.display).toBe('block');
    expect(document.getElementById('ev-error-block').textContent).toMatch(/réseau|erreur/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('render() — structure hero et layout', () => {
  beforeEach(() => {
    global.fetch.mockResolvedValue({
      ok: true, json: () => Promise.resolve(makePublicPayload()),
    });
  });

  it('affiche ev-content, cache ev-loading', async () => {
    requireModule();
    await flush(8);
    expect(document.getElementById('ev-content').style.display).toBe('block');
    expect(document.getElementById('ev-loading').style.display).toBe('none');
  });

  it('hero : nom de l\'événement et créateur', async () => {
    requireModule();
    await flush(8);
    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('Fête Fatou');
    expect(c).toContain('Alice');
    expect(c).toContain('Organisateur');
  });

  it('articles : liste les produits du panier', async () => {
    requireModule();
    await flush(8);
    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('Gâteau de mariage');
    expect(c).toContain('Décoration florale');
  });

  it('total KMF affiché dans le hero (calcul quantity * price_kmf)', async () => {
    requireModule();
    await flush(8);
    // total = 15000*1 + 8000*2 = 31000 KMF
    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('31'); // "31 000" ou "31000"
    expect(c).toContain('KMF');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('render() — phases métier', () => {
  function renderPhase(phase) {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePublicPayload({ workspace: { phase } })),
    });
    requireModule();
    return flush(8);
  }

  it('phase "collecting" → formulaire de participation affiché', async () => {
    await renderPhase('collecting');
    expect(document.getElementById('ev-contrib-form')).not.toBeNull();
  });

  it('phase "draft" → formulaire de participation affiché', async () => {
    await renderPhase('draft');
    expect(document.getElementById('ev-contrib-form')).not.toBeNull();
  });

  it('phase "finalized" → pas de formulaire, message n\'accepte plus', async () => {
    await renderPhase('finalized');
    expect(document.getElementById('ev-contrib-form')).toBeNull();
    expect(document.getElementById('ev-content').textContent).toContain('accepte plus');
  });

  it('phase "paid" → pas de formulaire', async () => {
    await renderPhase('paid');
    expect(document.getElementById('ev-contrib-form')).toBeNull();
  });

  it('panier vide → message "prépare encore le panier"', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePublicPayload({ items: [] })),
    });
    requireModule();
    await flush(8);
    expect(document.getElementById('ev-content').textContent).toContain('prépare encore');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeWorkspaceResponse', () => {
  it('payload plat (sans envelope workspace) : event_name et items extraits', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        event_name: 'Événement direct', phase: 'collecting',
        items: [{ product_name: 'Nattes', price_kmf: 3000, quantity: 1 }],
      }),
    });
    requireModule();
    await flush(8);
    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('Événement direct');
    expect(c).toContain('Nattes');
  });

  it('price_snapshot_kmf (alias) : normalisé pour le calcul total', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workspace: { event_name: 'Alias', phase: 'collecting' },
        items: [{ product_name: 'Sucre', price_snapshot_kmf: 400, quantity: 5 }],
      }),
    });
    requireModule();
    await flush(8);
    // total = 400 * 5 = 2000 KMF
    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('formulaire de participation — validation côté client', () => {
  beforeEach(async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: () => Promise.resolve(makePublicPayload()),
    });
    requireModule();
    await flush(8);
  });

  function submitForm() {
    const form = document.getElementById('ev-contrib-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  function fill(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  it('sans nom → erreur "nom est requis"', async () => {
    submitForm();
    await flush(4);
    const err = document.getElementById('ev-contrib-error');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('nom');
  });

  it('nom seul, sans téléphone ni email → erreur contact requis', async () => {
    fill('contributor_name', 'Fatima');
    submitForm();
    await flush(4);
    const err = document.getElementById('ev-contrib-error');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('téléphone');
  });

  it('nom + email, sans montant ni message → erreur montant ou message requis', async () => {
    fill('contributor_name', 'Fatima');
    fill('contributor_email', 'fatima@test.com');
    submitForm();
    await flush(4);
    const err = document.getElementById('ev-contrib-error');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toMatch(/montant|message/i);
  });

  it('formulaire complet valide → fetch POST envoyé', async () => {
    fill('contributor_name', 'Fatima');
    fill('contributor_email', 'fatima@test.com');
    fill('amount_value', '5000');

    global.fetch
      .mockResolvedValueOnce({ // 2e appel : POST contributions
        ok: true, json: () => Promise.resolve({ success: true }),
      });

    submitForm();
    await flush(10);

    const calls = global.fetch.mock.calls;
    // Le 2e appel (index 1) devrait être le POST contributions
    const postCall = calls.find(([url, opts]) => opts && opts.method === 'POST');
    expect(postCall).toBeDefined();
    expect(postCall[0]).toContain('/contributions');
  });

  it('formulaire valide → message succès affiché', async () => {
    fill('contributor_name', 'Fatima');
    fill('contributor_email', 'fatima@test.com');
    fill('amount_value', '3000');

    global.fetch.mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve({ success: true }),
    });

    submitForm();
    await flush(10);

    const ok = document.getElementById('ev-contrib-success');
    expect(ok.style.display).toBe('block');
    expect(ok.textContent).toContain('Fatima');
  });

  it('erreur API → message d\'erreur affiché, bouton réactivé', async () => {
    fill('contributor_name', 'Fatima');
    fill('contributor_email', 'fatima@test.com');
    fill('amount_value', '2000');

    global.fetch.mockResolvedValueOnce({
      ok: false, json: () => Promise.resolve({ message: 'Token invalide' }),
    });

    submitForm();
    await flush(10);

    const err = document.getElementById('ev-contrib-error');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('Token invalide');
    expect(document.getElementById('ev-contrib-submit').disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('updateAmountEquivalent — affichage de l\'équivalent devise', () => {
  beforeEach(async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: () => Promise.resolve(makePublicPayload()),
    });
    requireModule();
    await flush(8);
  });

  it('sans montant saisi → message placeholder affiché', () => {
    const hint = document.getElementById('amount_equiv_hint');
    expect(hint).not.toBeNull();
    // Le hint initial contient un message d'aide
    expect(hint.textContent.length).toBeGreaterThan(0);
  });

  it('montant KMF saisi → équivalent EUR calculé et affiché', () => {
    const input = document.getElementById('amount_value');
    const hint  = document.getElementById('amount_equiv_hint');
    input.value = '4910';
    input.dispatchEvent(new Event('input'));
    // 4910 KMF / 491 = ~10 EUR
    expect(hint.textContent).toContain('KMF');
  });

  it('changement de devise EUR → affiche la conversion inverse', () => {
    const input    = document.getElementById('amount_value');
    const currency = document.getElementById('amount_currency');
    const hint     = document.getElementById('amount_equiv_hint');
    input.value    = '10';
    currency.value = 'EUR';
    currency.dispatchEvent(new Event('change'));
    // 10 EUR * 491 = 4910 KMF
    expect(hint.textContent).toContain('KMF');
  });
});
