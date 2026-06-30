'use strict';

/**
 * tests/unit/event-pay.test.js
 *
 * Module #23 — js/event-pay.js (207L)
 *
 * IIFE pure (pas d'ESM export, pas de module.exports) : escHtml, fmt,
 * statusBadge, render, handleConfirmCash, load sont toutes des closures
 * internes. Le module appelle load() immédiatement à l'exécution (require-time
 * side effect) et lit window.location.pathname + #ev-loading/#ev-content/
 * #ev-error-block au chargement.
 *
 * Stratégie (pattern du repo, cf. boutique-core.unit.test.js) :
 *  1. Copie inline des 3 fonctions pures (escHtml, fmt, statusBadge) pour les
 *     tester en isolation totale — comportement figé identique au fichier source.
 *  2. Test fumée + comportemental du vrai module : DOM minimal + pathname
 *     /event/pay/:token + fetch mocké → on vérifie le HTML produit dans le
 *     vrai #ev-content (render() réel, pas une copie).
 *
 * Source: js/event-pay.js L32-63 (2026-06)
 */

const NF = new Intl.NumberFormat('fr-FR');
function fmt(n) { return NF.format(Math.round(Number(n) || 0)); }

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function statusBadge(status) {
  if (status === 'paid') return '<span class="ev-badge ev-badge-paid">✓ Payé</span>';
  if (status === 'authorized') return '<span class="ev-badge ev-badge-auth">Confirmé</span>';
  if (status === 'expired') return '<span class="ev-badge" style="background:#fee2e2;color:#991b1b;">Expiré</span>';
  if (status === 'cancelled') return '<span class="ev-badge" style="background:#fee2e2;color:#991b1b;">Annulé</span>';
  return '<span class="ev-badge ev-badge-pending">À confirmer</span>';
}

describe('event-pay — fonctions pures (copie inline)', () => {
  describe('fmt', () => {
    it('formate un entier avec séparateur de milliers fr-FR', () => {
      expect(fmt(12500)).toBe(NF.format(12500));
    });

    it('arrondit les décimales', () => {
      expect(fmt(99.6)).toBe(NF.format(100));
    });

    it('null/undefined → 0', () => {
      expect(fmt(null)).toBe('0');
      expect(fmt(undefined)).toBe('0');
    });

    it('NaN ou non-numérique → 0', () => {
      expect(fmt('abc')).toBe('0');
    });
  });

  describe('escHtml', () => {
    it('échappe & < > " et apostrophe', () => {
      expect(escHtml(`<script>"x" & 'y'</script>`)).toBe(
        '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;'
      );
    });

    it('null/undefined → string vide', () => {
      expect(escHtml(null)).toBe('');
      expect(escHtml(undefined)).toBe('');
    });

    it('texte sans caractères spéciaux → inchangé', () => {
      expect(escHtml('Awa Mohamed')).toBe('Awa Mohamed');
    });

    it('nombre passé en entrée → converti en string', () => {
      expect(escHtml(42)).toBe('42');
    });
  });

  describe('statusBadge', () => {
    it("'paid' → badge vert payé", () => {
      expect(statusBadge('paid')).toBe('<span class="ev-badge ev-badge-paid">✓ Payé</span>');
    });

    it("'authorized' → badge confirmé", () => {
      expect(statusBadge('authorized')).toBe('<span class="ev-badge ev-badge-auth">Confirmé</span>');
    });

    it("'expired' → badge rouge expiré", () => {
      expect(statusBadge('expired')).toContain('Expiré');
      expect(statusBadge('expired')).toContain('#fee2e2');
    });

    it("'cancelled' → badge rouge annulé", () => {
      expect(statusBadge('cancelled')).toContain('Annulé');
    });

    it("statut inconnu/null → badge par défaut 'À confirmer'", () => {
      expect(statusBadge('pending')).toBe('<span class="ev-badge ev-badge-pending">À confirmer</span>');
      expect(statusBadge(null)).toBe('<span class="ev-badge ev-badge-pending">À confirmer</span>');
      expect(statusBadge(undefined)).toBe('<span class="ev-badge ev-badge-pending">À confirmer</span>');
    });
  });
});

describe('event-pay — module réel (smoke + rendu)', () => {
  function setupDom() {
    document.body.innerHTML = `
      <div id="ev-loading"></div>
      <div id="ev-content"></div>
      <div id="ev-error-block"></div>
    `;
  }

  beforeEach(() => {
    jest.resetModules();
    setupDom();
  });

  it("pathname sans token valide → showError, pas de fetch déclenché", async () => {
    window.history.pushState(null, '', '/event/pay/');
    global.fetch = jest.fn();
    require('../../js/event-pay.js');
    await new Promise((r) => setTimeout(r, 0));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.getElementById('ev-error-block').style.display).toBe('block');
    expect(document.getElementById('ev-error-block').textContent).toContain('invalide');
  });

  it('token 404 → message "lien introuvable"', async () => {
    window.history.pushState(null, '', '/event/pay/abc123');
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404 }));
    require('../../js/event-pay.js');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.getElementById('ev-error-block').textContent).toContain('introuvable');
  });

  it('statut pending → rend le hero, le montant formaté et le bouton de confirmation', async () => {
    window.history.pushState(null, '', '/event/pay/tok-xyz');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        token_status: 'pending',
        contributor_name: 'Awa',
        event_name: 'Anniversaire de Fatima',
        amount_kmf: 5000,
      }),
    }));
    require('../../js/event-pay.js');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const content = document.getElementById('ev-content');
    expect(content.style.display).toBe('block');
    expect(content.innerHTML).toContain('Bonjour Awa');
    expect(content.innerHTML).toContain('Anniversaire de Fatima');
    expect(content.innerHTML).toContain(NF.format(5000));
    expect(content.querySelector('#ev-pay-btn')).toBeTruthy();
  });

  it('statut paid → bloc succès affiché, pas de bouton de confirmation', async () => {
    window.history.pushState(null, '', '/event/pay/tok-paid');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        token_status: 'paid',
        contributor_name: 'Awa',
        event_name: 'Anniversaire',
        amount_kmf: 5000,
      }),
    }));
    require('../../js/event-pay.js');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const content = document.getElementById('ev-content');
    expect(content.innerHTML).toContain('Paiement confirmé');
    expect(content.querySelector('#ev-pay-btn')).toBeNull();
  });

  it("contributor_name contenant du HTML → échappé dans le rendu (pas d'injection)", async () => {
    window.history.pushState(null, '', '/event/pay/tok-xss');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        token_status: 'pending',
        contributor_name: '<img src=x onerror=alert(1)>',
        event_name: 'Test',
        amount_kmf: 1000,
      }),
    }));
    require('../../js/event-pay.js');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const content = document.getElementById('ev-content');
    expect(content.innerHTML).not.toContain('<img src=x onerror=alert(1)>');
    expect(content.innerHTML).toContain('&lt;img');
  });

  it('clic sur le bouton de confirmation cash → POST vers /pay-cash puis désactive le bouton', async () => {
    window.history.pushState(null, '', '/event/pay/tok-confirm');
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          token_status: 'pending',
          contributor_name: 'Awa',
          event_name: 'Test',
          amount_kmf: 2000,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

    require('../../js/event-pay.js');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const btn = document.getElementById('ev-pay-btn');
    expect(btn).toBeTruthy();
    btn.click();

    // le bouton est désactivé immédiatement (synchrone, avant l'appel réseau)
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Enregistrement');

    await new Promise((r) => setTimeout(r, 0));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/collective-payments/tok-confirm/pay-cash'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
