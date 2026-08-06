'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/pickup-proof-html.test.js
 * Couvre utils/documents/pickup-proof-html.js
 */
const { buildReceiptHTML, escapeHTML } = require('../../utils/documents/pickup-proof-html');

describe('escapeHTML', () => {
  it('echappe &, <, >, ", \'', () => {
    expect(escapeHTML(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('null → chaine vide', () => {
    expect(escapeHTML(null)).toBe('');
  });

  it('undefined → chaine vide', () => {
    expect(escapeHTML(undefined)).toBe('');
  });

  it('nombre → converti en string sans crash', () => {
    expect(escapeHTML(42)).toBe('42');
  });

  it('chaine sans caracteres speciaux → inchangee', () => {
    expect(escapeHTML('Relais Moroni')).toBe('Relais Moroni');
  });

  it('tentative d\'injection de script → neutralisee', () => {
    const result = escapeHTML('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
    expect(result).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('buildReceiptHTML', () => {
  const fullData = {
    reference: 'RET-2026-000001',
    order_reference: 'ORD-1',
    recipient_name: 'Jean Client',
    recipient_phone: '+269 321 00 00',
    collected_at: '2026-01-01 10:00',
    issued_at: '2026-01-01 10:05',
    relais_name: 'Relais Moroni',
  };

  it('retourne un document HTML valide (DOCTYPE + balises fermees)', () => {
    const html = buildReceiptHTML(fullData);
    expect(html.trim().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('</html>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('inclut les donnees fournies dans le HTML', () => {
    const html = buildReceiptHTML(fullData);
    expect(html).toContain('RET-2026-000001');
    expect(html).toContain('ORD-1');
    expect(html).toContain('Jean Client');
    expect(html).toContain('Relais Moroni');
  });

  it('echappe les champs injectes dans le HTML (anti-XSS)', () => {
    const html = buildReceiptHTML({ ...fullData, recipient_name: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('recipient_phone fourni → affiche la ligne telephone', () => {
    const html = buildReceiptHTML(fullData);
    expect(html).toContain('Tél bénéficiaire :');
    expect(html).toContain('+269 321 00 00');
  });

  it('recipient_phone absent → pas de ligne telephone', () => {
    const html = buildReceiptHTML({ ...fullData, recipient_phone: null });
    expect(html).not.toContain('Tél bénéficiaire :');
  });

  it('donnees null/champs manquants → ne crash pas', () => {
    expect(() => buildReceiptHTML({})).not.toThrow();
  });

  it('objet completement vide → genere quand meme un document HTML structurel', () => {
    const html = buildReceiptHTML({});
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('PREUVE DE RETRAIT');
  });

  it('inclut le logo Komerce en data-URI', () => {
    const html = buildReceiptHTML(fullData);
    expect(html).toMatch(/src="data:image\/png;base64,/);
  });
});
