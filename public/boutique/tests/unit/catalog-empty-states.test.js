/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * GAP-F3 — une grille vide n'affichait rien : aucun message, aucune
 * action. Trois raisons distinctes doivent produire trois messages
 * distincts, jamais un texte générique ni un formulaire d'inscription
 * fonctionnel (le consentement n'est pas encore implémenté — seul un
 * lien WhatsApp direct est honnête aujourd'hui).
 * Cf. docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md.
 */
'use strict';

const {
  renderCatalogEmptyState,
  renderCategoryEmptyState,
  renderSearchEmptyState,
  renderCatalogLoadErrorState,
} = require('../../js/b-catalog.js');

describe('renderCatalogEmptyState — catalogue global vide', () => {
  let html;
  beforeAll(() => { html = renderCatalogEmptyState(); });

  test('annonce que le catalogue arrive, jamais un compte de produits inventé', () => {
    expect(html).toMatch(/catalogue de votre marché arrive/i);
    expect(html).not.toMatch(/\d+\s*produit/i);
  });

  test('propose un vrai lien WhatsApp, pas un formulaire d\'inscription fonctionnel', () => {
    document.body.innerHTML = html;
    const link = document.getElementById('k-catalog-empty-wa-btn');
    expect(link).not.toBeNull();
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(
      'https://wa.me/33699272526?text=' +
      encodeURIComponent('Bonjour Komerce ! Le catalogue de mon marché est vide, prévenez-moi quand il ouvre 🙂')
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    // Aucune case de consentement, aucun champ numéro : la doctrine de
    // consentement (DOCTRINE_CONSENTEMENT_COMMUNICATION.md) n'est pas
    // implémentée — ne jamais laisser croire le contraire.
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(document.querySelector('input[type="tel"]')).toBeNull();
    expect(document.querySelector('form')).toBeNull();
  });

  test('réutilise le patron visuel déjà établi (classes .k-track-error*)', () => {
    expect(html).toMatch(/class="k-track-error k-catalog-empty"/);
    expect(html).toMatch(/k-track-error-icon/);
    expect(html).toMatch(/k-track-error-title/);
    expect(html).toMatch(/k-track-error-sub/);
    expect(html).toMatch(/k-track-retry-btn/);
  });
});

describe('renderCategoryEmptyState — un rayon précis est vide', () => {
  let html;
  beforeAll(() => { html = renderCategoryEmptyState(); });

  test('un texte différent du catalogue global, jamais WhatsApp pour ce cas', () => {
    expect(html).toMatch(/aucun produit dans ce rayon/i);
    expect(html).not.toMatch(/wa\.me/);
  });

  test('propose un bouton "voir tout", jamais un lien externe', () => {
    document.body.innerHTML = html;
    const btn = document.getElementById('k-catalog-empty-see-all-btn');
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
  });
});

describe('renderSearchEmptyState — recherche sans résultat', () => {
  test('affiche la requête exacte du client, jamais tronquée ni reformulée', () => {
    const html = renderSearchEmptyState('chaussures de sport');
    expect(html).toMatch(/Aucun résultat pour « chaussures de sport »/);
  });

  test('échappe la requête utilisateur — jamais d\'injection HTML via la barre de recherche', () => {
    const html = renderSearchEmptyState('<img src=x onerror=alert(1)>');
    // La chaîne doit être échappée (&lt;...&gt;), jamais insérée telle quelle
    // comme balise réellement interprétable par le navigateur.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    document.body.innerHTML = html;
    expect(document.querySelector('img')).toBeNull();
  });

  test('propose un bouton de réinitialisation, jamais WhatsApp pour ce cas', () => {
    document.body.innerHTML = renderSearchEmptyState('xyz');
    const btn = document.getElementById('k-catalog-empty-clear-search-btn');
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe('BUTTON');
    expect(document.querySelector('a[href*="wa.me"]')).toBeNull();
  });
});

describe('Les trois variantes restent visuellement et textuellement distinctes', () => {
  test('aucune des trois n\'utilise le texte des deux autres', () => {
    const catalog  = renderCatalogEmptyState();
    const category = renderCategoryEmptyState();
    const search   = renderSearchEmptyState('test');
    expect(catalog).not.toBe(category);
    expect(catalog).not.toBe(search);
    expect(category).not.toBe(search);
  });
});

describe('P-05 — renderCatalogLoadErrorState', () => {
  test('coupure réseau (TypeError) → message hors ligne + Réessayer', () => {
    const html = renderCatalogLoadErrorState(Object.assign(new TypeError('Failed to fetch')));
    expect(html).toContain('Pas de connexion internet');
    expect(html).toContain('id="k-catalog-retry-btn"');
    expect(html).toContain('Réessayer');
  });
  test('429 / 503 → catalogue indisponible + forte affluence', () => {
    for (const status of [429, 503]) {
      const html = renderCatalogLoadErrorState(Object.assign(new Error('x'), { status }));
      expect(html).toContain('Le catalogue ne répond pas pour le moment');
      expect(html).toContain('Beaucoup de visites');
    }
  });
  test('500 → catalogue indisponible, sans mention d\'affluence ni de réseau', () => {
    const html = renderCatalogLoadErrorState(Object.assign(new Error('x'), { status: 500 }));
    expect(html).toContain('Le catalogue ne répond pas pour le moment');
    expect(html).not.toContain('Beaucoup de visites');
    expect(html).not.toContain('Pas de connexion');
  });
  test('le bouton Réessayer est un <button>, pas un lien', () => {
    const html = renderCatalogLoadErrorState(new Error('x'));
    expect(html).toMatch(/<button class="k-track-retry-btn" id="k-catalog-retry-btn" type="button">Réessayer<\/button>/);
  });
});
