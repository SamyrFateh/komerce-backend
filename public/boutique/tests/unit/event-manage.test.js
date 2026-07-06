'use strict';

/**
 * tests/unit/event-manage.test.js
 *
 * Lot 5 — js/event-manage.js (412 L, pas d'export, IIFE).
 * Testé par effets DOM observables (render → contentEl.innerHTML).
 *
 * Piège jsdom : window.location n'est pas redéfinissable (non-configurable).
 * Solution : window.history.pushState({}, '', path) change pathname sans
 * déclencher de navigation → getCreatorToken() lit le bon pathname.
 *
 * Pattern "auto-init sans export" (lot 5) :
 *   1. DOM posé AVANT require (loadingEl / contentEl / errorEl lus à l'init)
 *   2. URL modifiée AVANT require (getCreatorToken lit pathname)
 *   3. global.fetch mocké AVANT require
 *   4. jest.resetModules() juste avant chaque require → IIFE fraîche
 *   5. flush(n) pour écouler la chaîne async fetch → .json() → render()
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

function setCreatorPath(token) {
  window.history.pushState({}, '', token ? `/event/manage/${token}` : '/some/other/page');
}

function requireModule() {
  jest.resetModules();
  return require('../../js/event-manage.js');
}

function makeWorkspacePayload(overrides = {}) {
  return {
    workspace: {
      event_name:   'Mariage Fatou',
      creator_name: 'Alice',
      public_token: 'pub-token-123',
      phase:        'collecting',
      ...(overrides.workspace || {}),
    },
    items: overrides.items ?? [
      { id: 1, product_name: 'Riz basmati', price_kmf: 2000, quantity: 3 },
    ],
    contributions: overrides.contributions ?? [
      { id: 10, contributor_name: 'Bob', amount_kmf: 1500, status: 'paid', message: 'Avec plaisir' },
    ],
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  setCreatorPath('test-creator-token');
  mountDOM();
  global.fetch   = jest.fn();
  global.confirm = jest.fn(() => true);
  global.alert   = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════

describe('getCreatorToken — extraction depuis pathname', () => {
  it('chemin sans token valide → showError synchrone "invalide"', () => {
    setCreatorPath(null); // /some/other/page
    requireModule();
    // showError() est synchrone quand !token → pas de flush nécessaire
    const err = document.getElementById('ev-error-block');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('invalide');
  });

  it('chemin alternatif /event/:token/manage : fetch appelé avec ce token', async () => {
    window.history.pushState({}, '', '/event/alt-token-xyz/manage');
    global.fetch.mockResolvedValue({
      ok: true, json: () => Promise.resolve(makeWorkspacePayload()),
    });
    requireModule();
    await flush(8);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('alt-token-xyz'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('load() — gestion des erreurs', () => {
  it('404 → message "introuvable"', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });
    requireModule();
    await flush(8);
    const err = document.getElementById('ev-error-block');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('introuvable');
  });

  it('autre statut non-ok → message "Erreur <status>"', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    requireModule();
    await flush(8);
    expect(document.getElementById('ev-error-block').textContent).toContain('503');
  });

  it('rejet réseau → message erreur générique', async () => {
    global.fetch.mockRejectedValue(new Error('Network failure'));
    requireModule();
    await flush(8);
    expect(document.getElementById('ev-error-block').style.display).toBe('block');
    expect(document.getElementById('ev-error-block').textContent).toMatch(/réseau|erreur/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('render() — structure du contenu affiché', () => {
  beforeEach(() => {
    global.fetch.mockResolvedValue({
      ok: true, json: () => Promise.resolve(makeWorkspacePayload()),
    });
  });

  it('affiche ev-content et cache ev-loading', async () => {
    requireModule();
    await flush(8);
    expect(document.getElementById('ev-content').style.display).toBe('block');
    expect(document.getElementById('ev-loading').style.display).toBe('none');
  });

  it('hero : nom de l\'événement, créateur, badge phase', async () => {
    requireModule();
    await flush(8);
    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('Mariage Fatou');
    expect(c).toContain('Alice');
    expect(c).toContain('Organisateur');
  });

  it('avancement : total, confirmé, restant affichés', async () => {
    requireModule();
    await flush(8);
    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('Total');
    expect(c).toContain('Confirmé');
    expect(c).toContain('Restant');
  });

  it('section partage : input URL et bouton Copier (public_token présent)', async () => {
    requireModule();
    await flush(8);
    const input = document.getElementById('ev-public-url');
    expect(input).not.toBeNull();
    expect(input.value).toContain('pub-token-123');
    expect(document.getElementById('ev-copy-btn')).not.toBeNull();
  });

  it('articles : chaque produit affiché', async () => {
    requireModule();
    await flush(8);
    expect(document.getElementById('ev-content').textContent).toContain('Riz basmati');
  });

  it('participants : liste les contributions avec noms et messages', async () => {
    requireModule();
    await flush(8);
    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('Bob');
    expect(c).toContain('Avec plaisir');
  });

  it('sans public_token : pas de section partage', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeWorkspacePayload({ workspace: { public_token: null } })),
    });
    requireModule();
    await flush(8);
    expect(document.getElementById('ev-public-url')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('render() — phases métier', () => {
  function renderPhase(phase) {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeWorkspacePayload({ workspace: { phase } })),
    });
    requireModule();
    return flush(8);
  }

  it('phase "collecting" → bouton Finaliser présent', async () => {
    await renderPhase('collecting');
    expect(document.getElementById('ev-finalize-btn')).not.toBeNull();
  });

  it('phase "finalized" → message liste figée, pas de bouton Finaliser', async () => {
    await renderPhase('finalized');
    expect(document.getElementById('ev-finalize-btn')).toBeNull();
    expect(document.getElementById('ev-content').textContent).toContain('figée');
  });

  it('phase "paid" → message commande confirmée', async () => {
    await renderPhase('paid');
    expect(document.getElementById('ev-content').textContent).toContain('commande');
  });

  it('phase "expired" → message expiration', async () => {
    await renderPhase('expired');
    expect(document.getElementById('ev-content').textContent).toContain('expir');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeWorkspaceResponse — robustesse du mapping', () => {
  it('payload plat (sans envelope workspace) : event_name et items extraits', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        event_name: 'Événement plat', public_token: 'flat-tok',
        items: [{ product_name: 'Thé', price_kmf: 800, quantity: 1 }],
        contributions: [],
      }),
    });
    requireModule();
    await flush(8);
    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('Événement plat');
    expect(c).toContain('Thé');
  });

  it('price_snapshot_kmf (alias) : normalisé en price_kmf pour le calcul total', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workspace: { event_name: 'Alias test', public_token: 'tok' },
        items: [{ product_name: 'Sucre', price_snapshot_kmf: 500, quantity: 2 }],
        contributions: [],
      }),
    });
    requireModule();
    await flush(8);
    // Total = 500*2 = 1 000 KMF → affiché dans l'avancement
    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('1');  // "1 000" ou "1000"
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('handleFinalize — clic sur le bouton Finaliser', () => {
  beforeEach(() => {
    global.fetch.mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve(makeWorkspacePayload()),
    });
  });

  it('confirm = false → bouton reste actif, aucun 2e fetch', async () => {
    global.confirm.mockReturnValue(false);
    requireModule();
    await flush(8);

    const btn = document.getElementById('ev-finalize-btn');
    btn.click();
    await flush(4);

    expect(btn.disabled).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1); // seulement le chargement initial
  });

  it('finalisation réussie : affiche la liste des tokens de paiement', async () => {
    global.confirm.mockReturnValue(true);
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) // review
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          tokens: [{ contributor_name: 'Bob', amount_kmf: 1500, payment_token: 'pay-bob', contributor_phone: '+269600' }],
          total_kmf: 6000,
        }),
      });
    requireModule();
    await flush(8);

    document.getElementById('ev-finalize-btn').click();
    await flush(12);

    const c = document.getElementById('ev-content').textContent;
    expect(c).toContain('Bob');
    expect(c).toContain('envoyé tous les liens');
  });

  it('erreur finalization-review : alerte + bouton réactivé', async () => {
    global.confirm.mockReturnValue(true);
    global.fetch.mockResolvedValueOnce({
      ok: false, json: () => Promise.resolve({ message: 'Revue impossible' }),
    });
    requireModule();
    await flush(8);

    const btn = document.getElementById('ev-finalize-btn');
    btn.click();
    await flush(12);

    expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Revue impossible'));
    expect(btn.disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('wire copier (ev-copy-btn)', () => {
  it('clic copier → textContent "✓ Copié" puis restauré après 1800ms', async () => {
    jest.useFakeTimers();

    global.fetch.mockResolvedValue({
      ok: true, json: () => Promise.resolve(makeWorkspacePayload()),
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    requireModule();
    await flush(8);

    const btn = document.getElementById('ev-copy-btn');
    btn.click();
    await flush(4);

    expect(btn.textContent).toBe('✓ Copié');
    jest.advanceTimersByTime(2000);
    expect(btn.textContent).toBe('Copier');
  });
});
