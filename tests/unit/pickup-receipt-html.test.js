'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/pickup-receipt-html.test.js
 * Couvre utils/pickup-receipt-html.js
 *
 * Module de présentation pur : aucun accès DB, aucun effet de bord.
 * `renderQR` est une fonction côté client embarquée dans le <script> généré
 * (pas un export du module) — on vérifie sa présence textuelle dans le HTML.
 */

const { buildReceiptHTML, escapeHTML } = require('../../utils/pickup-receipt-html');

describe('escapeHTML', () => {
  it('échappe < > & " \' dans cet ordre sans double-échappement', () => {
    expect(escapeHTML('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('échappe les apostrophes', () => {
    expect(escapeHTML("l'agent")).toBe('l&#39;agent');
  });

  it('échappe le esperluette en premier (pas de double encodage)', () => {
    expect(escapeHTML('Tom & Jerry <3')).toBe('Tom &amp; Jerry &lt;3');
  });

  it('null → chaîne vide', () => {
    expect(escapeHTML(null)).toBe('');
  });

  it('undefined → chaîne vide', () => {
    expect(escapeHTML(undefined)).toBe('');
  });

  it('nombre → converti en string', () => {
    expect(escapeHTML(42)).toBe('42');
  });

  it('chaîne vide → reste vide', () => {
    expect(escapeHTML('')).toBe('');
  });

  it('chaîne sans caractère spécial → inchangée', () => {
    expect(escapeHTML('Komerce SARL')).toBe('Komerce SARL');
  });
});

describe('buildReceiptHTML — structure générale', () => {
  function baseOrder(overrides = {}) {
    return {
      reference: 'CMD-2026-001',
      payment_received_at: '2026-06-30T10:00:00.000Z',
      created_at: '2026-06-29T08:00:00.000Z',
      relais_name: 'Relais Moroni Centre',
      agent_name: 'Agent Fatima',
      payer_name: 'Ali Said',
      total_kmf: 18000,
      ...overrides,
    };
  }

  function baseItems() {
    return [
      { quantity: 2, product_name: 'Téléphone', price_kmf: 5000 },
      { quantity: 1, product_name: 'Coque', price_kmf: 8000 },
    ];
  }

  it('retourne un document HTML valide (DOCTYPE + html + body fermé)', () => {
    const html = buildReceiptHTML({ code: 'ABC123', order: baseOrder(), items: baseItems() });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('</html>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('inclut le titre avec la référence échappée', () => {
    const html = buildReceiptHTML({ code: 'ABC123', order: baseOrder({ reference: '<CMD>' }), items: [] });
    expect(html).toContain('<title>Reçu Komerce — &lt;CMD&gt;</title>');
  });

  it('inclut le code secret échappé dans .code-value', () => {
    const html = buildReceiptHTML({ code: '<XSS>', order: baseOrder(), items: [] });
    expect(html).toContain('<div class="code-value">&lt;XSS&gt;</div>');
  });

  it('formate le total en KMF avec séparateur de milliers français', () => {
    const html = buildReceiptHTML({ code: 'ABC123', order: baseOrder({ total_kmf: 1234567 }), items: [] });
    expect(html.replace(/\u202f|\u00a0/g, ' ')).toContain('1 234 567 KMF');
  });

  it('total_kmf null/undefined → traité comme 0', () => {
    const html = buildReceiptHTML({ code: 'ABC123', order: baseOrder({ total_kmf: null }), items: [] });
    expect(html).toContain('0 KMF');
  });

  it('formate la date en français (jour/mois/année heure:minute)', () => {
    const html = buildReceiptHTML({ code: 'ABC123', order: baseOrder(), items: [] });
    expect(html).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('utilise payment_received_at en priorité, fallback sur created_at si absent', () => {
    const withReceived = buildReceiptHTML({ code: 'C', order: baseOrder({ payment_received_at: '2026-01-01T00:00:00.000Z' }), items: [] });
    const withoutReceived = buildReceiptHTML({ code: 'C', order: baseOrder({ payment_received_at: null, created_at: '2025-12-25T00:00:00.000Z' }), items: [] });
    expect(withReceived).toContain('01/01/2026');
    expect(withoutReceived).toContain('25/12/2025');
  });

  it('relais_name/agent_name/payer_name absents → fallback "-"', () => {
    const html = buildReceiptHTML({
      code: 'ABC123',
      order: baseOrder({ relais_name: null, agent_name: null, payer_name: null }),
      items: [],
    });
    expect(html).toContain('<span>Relais :</span><span>-</span>');
    expect(html).toContain('<span>Agent :</span><span>-</span>');
    expect(html).toContain('<span>Payé par :</span><span>-</span>');
  });

  it('échappe les champs textuels de la commande (XSS)', () => {
    const html = buildReceiptHTML({
      code: 'ABC123',
      order: baseOrder({ agent_name: '<img src=x onerror=alert(1)>' }),
      items: [],
    });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('buildReceiptHTML — liste des articles', () => {
  it('génère une ligne <tr> par article avec quantité × nom et prix total ligne', () => {
    const html = buildReceiptHTML({
      code: 'ABC123',
      order: { reference: 'CMD-1', total_kmf: 10000 },
      items: [{ quantity: 2, product_name: 'Casque audio', price_kmf: 5000 }],
    });
    expect(html).toContain('2× Casque audio');
    expect(html.replace(/\u202f|\u00a0/g, ' ')).toContain('10 000 KMF'); // 2 * 5000
  });

  it('plusieurs articles → plusieurs lignes, dans l\'ordre fourni', () => {
    const html = buildReceiptHTML({
      code: 'ABC123',
      order: { reference: 'CMD-1', total_kmf: 0 },
      items: [
        { quantity: 1, product_name: 'A', price_kmf: 1000 },
        { quantity: 3, product_name: 'B', price_kmf: 500 },
      ],
    });
    const idxA = html.indexOf('1× A');
    const idxB = html.indexOf('3× B');
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(idxA);
  });

  it('items null/undefined → aucune ligne générée, pas de crash', () => {
    expect(() => buildReceiptHTML({ code: 'ABC123', order: { reference: 'CMD-1', total_kmf: 0 }, items: null })).not.toThrow();
    expect(() => buildReceiptHTML({ code: 'ABC123', order: { reference: 'CMD-1', total_kmf: 0 } })).not.toThrow();
  });

  it('items tableau vide → table TOTAL toujours présente', () => {
    const html = buildReceiptHTML({ code: 'ABC123', order: { reference: 'CMD-1', total_kmf: 5000 }, items: [] });
    expect(html).toContain('TOTAL PAYÉ CASH');
  });

  it('nom de produit avec caractères HTML → échappé dans la ligne', () => {
    const html = buildReceiptHTML({
      code: 'ABC123',
      order: { reference: 'CMD-1', total_kmf: 0 },
      items: [{ quantity: 1, product_name: '<b>Produit</b>', price_kmf: 100 }],
    });
    expect(html).toContain('&lt;b&gt;Produit&lt;/b&gt;');
    expect(html).not.toContain('<b>Produit</b>');
  });
});

describe('buildReceiptHTML — QR code embarqué', () => {
  it('inclut le script de génération QR (renderQR) avec le payload encodé', () => {
    const html = buildReceiptHTML({ code: 'SECRET1', order: { reference: 'CMD-9', total_kmf: 0 }, items: [] });
    expect(html).toContain('function renderQR()');
    expect(html).toContain('renderQR();');
    expect(html).toContain('QRious');
  });

  it('encode code et reference dans le payload JSON (via JSON.stringify côté template)', () => {
    const html = buildReceiptHTML({ code: 'SECRET1', order: { reference: 'CMD-9', total_kmf: 0 }, items: [] });
    expect(html).toContain('c: ' + JSON.stringify('SECRET1'));
    expect(html).toContain('o: ' + JSON.stringify('CMD-9'));
  });

  it('inclut un canvas avec id pickup-qr pour le rendu', () => {
    const html = buildReceiptHTML({ code: 'ABC', order: { reference: 'CMD-1', total_kmf: 0 }, items: [] });
    expect(html).toContain('id="pickup-qr"');
  });

  it('données null (code) → pas de crash, le JSON.stringify(null) est inséré tel quel', () => {
    expect(() => buildReceiptHTML({ code: null, order: { reference: 'CMD-1', total_kmf: 0 }, items: [] })).not.toThrow();
  });
});

describe('buildReceiptHTML — robustesse données manquantes', () => {
  it('order minimal (seulement reference + total_kmf) → ne plante pas', () => {
    expect(() => buildReceiptHTML({ code: 'X', order: { reference: 'CMD-1', total_kmf: 0 }, items: [] })).not.toThrow();
  });

  it('code manquant → echappé en chaîne vide, pas de crash', () => {
    const html = buildReceiptHTML({ order: { reference: 'CMD-1', total_kmf: 0 }, items: [] });
    expect(html).toContain('<div class="code-value"></div>');
  });
});
